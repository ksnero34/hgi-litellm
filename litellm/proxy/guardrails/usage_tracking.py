"""
Track guardrail and policy usage for the dashboard: upsert daily metrics and
insert into SpendLogGuardrailIndex when spend logs are written.
"""

import asyncio
import json
from collections import defaultdict
from collections.abc import Awaitable, Callable, Iterator, Mapping, Sequence
from datetime import datetime, timezone
from functools import partial
from itertools import groupby
from operator import itemgetter
from types import MappingProxyType
from typing import TYPE_CHECKING, Any, Final, NamedTuple, TypeVar

from litellm._logging import verbose_proxy_logger
from litellm.proxy._types import DB_RETRY_SAFE_ERROR_TYPES
from litellm.proxy.db.db_spend_update_writer import LOGGING_ONLY_GUARDRAILS_PENDING
from litellm.proxy.utils import PrismaClient
from litellm.repositories.table_repositories import (
    DailyGuardrailMetricsRepository,
    DailyGuardrailUsageUnitsRepository,
    DailyPolicyMetricsRepository,
    SpendLogGuardrailIndexRepository,
    SpendLogPolicyIndexRepository,
)

if TYPE_CHECKING:
    from prisma import types as prisma_types


_UPSERT_RETRY_TIMES: Final = 3
_MAX_PENDING_ROWS: Final = 10_000

_RowKey = TypeVar("_RowKey")
_RowValue = TypeVar("_RowValue")


class _UsageUnitKey(NamedTuple):
    guardrail_id: str
    date: str
    team_id: str
    api_key: str
    usage_unit: str


class _MetricsKey(NamedTuple):
    guardrail_id: str
    date: str


class PendingRollups:
    """Rollup rows whose connection-error retries exhausted, held for the next flush."""

    def __init__(self) -> None:
        self.lock: Final = asyncio.Lock()
        self.metrics: Mapping[_MetricsKey, Mapping[str, int]] = MappingProxyType({})
        self.units: Mapping[_UsageUnitKey, int] = MappingProxyType({})


_PENDING_ROLLUPS: Final = PendingRollups()

_NO_COUNTERS: Final[Mapping[str, int]] = MappingProxyType({})


def _merged_keys(base: Mapping[_RowKey, object], extra: Mapping[_RowKey, object]) -> tuple[_RowKey, ...]:
    return (*base, *(key for key in extra if key not in base))


def _merged_unit_rows(
    base: Mapping[_UsageUnitKey, int], extra: Mapping[_UsageUnitKey, int]
) -> Mapping[_UsageUnitKey, int]:
    return MappingProxyType({key: base.get(key, 0) + extra.get(key, 0) for key in _merged_keys(base, extra)})


def _merged_metric_rows(
    base: Mapping[_MetricsKey, Mapping[str, int]], extra: Mapping[_MetricsKey, Mapping[str, int]]
) -> Mapping[_MetricsKey, Mapping[str, int]]:
    def merged_counters(key: _MetricsKey) -> Mapping[str, int]:
        base_counters: Final = base.get(key, _NO_COUNTERS)
        extra_counters: Final = extra.get(key, _NO_COUNTERS)
        return MappingProxyType(
            {
                counter: int(base_counters.get(counter, 0)) + int(extra_counters.get(counter, 0))
                for counter in _merged_keys(base_counters, extra_counters)
            }
        )

    return MappingProxyType({key: merged_counters(key) for key in _merged_keys(base, extra)})


def _capped(rows: Mapping[_RowKey, _RowValue], label: str) -> Mapping[_RowKey, _RowValue]:
    if len(rows) <= _MAX_PENDING_ROWS:
        return rows
    verbose_proxy_logger.warning(
        "Guardrail usage tracking: pending %s requeue exceeds %d rows; dropping the %d oldest (non-fatal)",
        label,
        _MAX_PENDING_ROWS,
        len(rows) - _MAX_PENDING_ROWS,
    )
    return MappingProxyType(dict(tuple(rows.items())[len(rows) - _MAX_PENDING_ROWS :]))


async def _attempt_upsert(
    upsert_row: Callable[[_RowKey, _RowValue], Awaitable[None]], key: _RowKey, value: _RowValue
) -> Exception | None:
    try:
        await upsert_row(key, value)
    except Exception as error:
        return error
    return None


async def _upsert_rows_with_retry(
    rows: Mapping[_RowKey, _RowValue],
    upsert_row: Callable[[_RowKey, _RowValue], Awaitable[None]],
    label: str,
    sleep: Callable[[float], Awaitable[None]],
    retries_left: int = _UPSERT_RETRY_TIMES,
) -> Mapping[_RowKey, _RowValue]:
    """Returns the rows still failing with connection errors once retries exhaust, for requeueing."""
    outcomes: Final = {key: await _attempt_upsert(upsert_row, key, value) for key, value in rows.items()}
    for key, error in outcomes.items():
        if error is not None and not isinstance(error, DB_RETRY_SAFE_ERROR_TYPES):
            verbose_proxy_logger.warning(
                "Guardrail usage tracking: %s upsert failed for %s and is not safe to retry (non-fatal): %s",
                label,
                key,
                error,
            )
    retryable: Final = MappingProxyType(
        {key: rows[key] for key, error in outcomes.items() if isinstance(error, DB_RETRY_SAFE_ERROR_TYPES)}
    )
    if not retryable:
        return MappingProxyType({})
    if retries_left == 0:
        for key in retryable:
            verbose_proxy_logger.warning(
                "Guardrail usage tracking: %s upsert failed for %s after %d retries; requeued for the next flush "
                "(non-fatal): %s",
                label,
                key,
                _UPSERT_RETRY_TIMES,
                outcomes[key],
            )
        return retryable
    await sleep(2 ** (_UPSERT_RETRY_TIMES - retries_left))
    return await _upsert_rows_with_retry(retryable, upsert_row, label, sleep, retries_left - 1)


def _guardrail_status_to_action(status: str | None) -> str:
    """Map StandardLogging guardrail_status to blocked/passed/flagged."""
    if not status:
        return "passed"
    s: Final = (status or "").lower()
    if "intervened" in s or "block" in s:
        return "blocked"
    if "fail" in s or "error" in s:
        return "flagged"
    return "passed"


def _usage_action(entry: dict[str, Any]) -> str:
    explicit_action = entry.get("usage_action")
    if isinstance(explicit_action, str) and explicit_action.lower() in {"passed", "blocked", "flagged"}:
        return explicit_action.lower()
    status = entry.get("guardrail_status")
    return _guardrail_status_to_action(status if isinstance(status, str) else None)


def _parse_metadata(payload: dict[str, Any]) -> dict[str, Any]:
    metadata = payload.get("metadata")
    if isinstance(metadata, str):
        try:
            parsed = json.loads(metadata)
        except (json.JSONDecodeError, TypeError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return metadata if isinstance(metadata, dict) else {}


def _policy_usage_from_payload(
    payload: dict[str, Any], guardrail_entries: list[dict[str, Any]]
) -> list[tuple[str, str]]:
    metadata = _parse_metadata(payload)
    raw_information = metadata.get("policy_information")
    information = raw_information if isinstance(raw_information, list) else []
    raw_applied = metadata.get("applied_policies")
    applied = raw_applied if isinstance(raw_applied, list) else []
    identities = {
        identity: (name, "passed")
        for entry in information
        if isinstance(entry, dict)
        and isinstance((name := entry.get("policy_name")), str)
        and name
        and isinstance((identity := entry.get("policy_id") or name), str)
        and identity
    }
    identities.update(
        {
            name: (name, "passed")
            for name in applied
            if isinstance(name, str) and name and name not in {known_name for known_name, _ in identities.values()}
        }
    )
    precedence = {"passed": 0, "flagged": 1, "blocked": 2}
    for guardrail_entry in guardrail_entries:
        raw_ids = guardrail_entry.get("policy_ids")
        raw_names = guardrail_entry.get("policy_names")
        policy_ids = raw_ids if isinstance(raw_ids, list) else []
        policy_names = raw_names if isinstance(raw_names, list) else []
        legacy_id = guardrail_entry.get("policy_id")
        legacy_name = guardrail_entry.get("policy_name")
        references = {
            reference
            for reference in (*policy_ids, *policy_names, legacy_id, legacy_name)
            if isinstance(reference, str) and reference
        }
        action = _usage_action(guardrail_entry)
        for identity, (name, previous_action) in tuple(identities.items()):
            if identity in references or name in references:
                identities[identity] = (
                    name,
                    action if precedence[action] > precedence[previous_action] else previous_action,
                )
        for reference in references:
            if reference not in identities and legacy_id == reference:
                identities[reference] = (reference, action)
    return [(identity, action) for identity, (_, action) in identities.items()]


def _parse_guardrail_info_from_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract guardrail_information from spend log payload metadata."""
    meta = _parse_metadata(payload)
    if not meta:
        return []
    info: Final = meta.get("guardrail_information") or meta.get("standard_logging_guardrail_information")
    if not isinstance(info, list):
        return []
    return [entry for entry in info if isinstance(entry, dict)]


def _aggregate_request_guardrail_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    precedence = {"passed": 0, "flagged": 1, "blocked": 2}
    identities = tuple(
        dict.fromkeys(
            entry.get("guardrail_id") or entry.get("guardrail_name")
            for entry in entries
            if entry.get("guardrail_id") or entry.get("guardrail_name")
        )
    )
    return [
        max(
            (entry for entry in entries if (entry.get("guardrail_id") or entry.get("guardrail_name")) == identity),
            key=lambda entry: precedence[_usage_action(entry)],
        )
        for identity in identities
    ]


def _date_str(dt: datetime) -> str:
    """YYYY-MM-DD in UTC."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d")


def _parse_payload_start_time(payload: Mapping[str, Any]) -> datetime | None:
    start_time: Final = payload.get("startTime")
    if isinstance(start_time, datetime):
        return start_time
    if not isinstance(start_time, str):
        return None
    try:
        return datetime.fromisoformat(start_time.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _iter_usage_unit_increments(logs_to_process: Sequence[Mapping[str, Any]]) -> Iterator[tuple[_UsageUnitKey, int]]:
    for payload in logs_to_process:
        start_time = _parse_payload_start_time(payload)
        if not payload.get("request_id") or start_time is None:
            continue
        date_key = _date_str(start_time)
        team_id = str(payload.get("team_id") or "")
        api_key = str(payload.get("api_key") or "")
        for entry in _parse_guardrail_info_from_payload(dict(payload)):
            guardrail_id = str(entry.get("guardrail_id") or entry.get("guardrail_name") or "")
            usage = entry.get("guardrail_usage")
            if not guardrail_id or not isinstance(usage, dict):
                continue
            for unit_name, units in usage.items():
                if isinstance(units, int) and not isinstance(units, bool) and units > 0:
                    yield _UsageUnitKey(guardrail_id, date_key, team_id, api_key, str(unit_name)), units


def _sum_usage_unit_increments(logs_to_process: Sequence[Mapping[str, Any]]) -> Mapping[_UsageUnitKey, int]:
    ordered: Final = sorted(_iter_usage_unit_increments(logs_to_process), key=itemgetter(0))
    return MappingProxyType(
        {key: sum(units for _, units in group) for key, group in groupby(ordered, key=itemgetter(0))}
    )


async def _upsert_usage_unit_row(prisma_client: PrismaClient, key: _UsageUnitKey, units: int) -> None:
    row: Final[prisma_types.LiteLLM_DailyGuardrailUsageUnitsCreateInput] = {
        "guardrail_id": key.guardrail_id,
        "date": key.date,
        "team_id": key.team_id,
        "api_key": key.api_key,
        "usage_unit": key.usage_unit,
        "units": units,
    }
    where: Final[prisma_types.LiteLLM_DailyGuardrailUsageUnitsWhereUniqueInput] = {
        "guardrail_id_date_team_id_api_key_usage_unit": {
            "guardrail_id": key.guardrail_id,
            "date": key.date,
            "team_id": key.team_id,
            "api_key": key.api_key,
            "usage_unit": key.usage_unit,
        }
    }
    data: Final[prisma_types.LiteLLM_DailyGuardrailUsageUnitsUpsertInput] = {
        "create": row,
        "update": {"units": {"increment": units}},
    }
    await DailyGuardrailUsageUnitsRepository(prisma_client).table.upsert(where=where, data=data)


async def _upsert_metrics_row(prisma_client: PrismaClient, key: _MetricsKey, agg: Mapping[str, int]) -> None:
    n: Final = int(agg["requests_evaluated"])
    await DailyGuardrailMetricsRepository(prisma_client).table.upsert(
        where={"guardrail_id_date": {"guardrail_id": key.guardrail_id, "date": key.date}},
        data={
            "create": {
                "guardrail_id": key.guardrail_id,
                "date": key.date,
                "requests_evaluated": n,
                "passed_count": int(agg["passed_count"]),
                "blocked_count": int(agg["blocked_count"]),
                "flagged_count": int(agg["flagged_count"]),
            },
            "update": {
                "requests_evaluated": {"increment": n},
                "passed_count": {"increment": int(agg["passed_count"])},
                "blocked_count": {"increment": int(agg["blocked_count"])},
                "flagged_count": {"increment": int(agg["flagged_count"])},
            },
        },
    )


async def process_spend_logs_guardrail_usage(  # noqa: C901  # Aggregation keeps guardrail and policy writes in one batch.
    prisma_client: PrismaClient,
    logs_to_process: list[dict[str, Any]],
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    pending: PendingRollups = _PENDING_ROLLUPS,
) -> None:
    """
    After spend logs are written: update DailyGuardrailMetrics and insert
    SpendLogGuardrailIndex rows from guardrail_information in each payload.
    """
    if not logs_to_process:
        return
    eligible_logs: Final = tuple(
        payload
        for payload in logs_to_process
        if _parse_metadata(payload).get(LOGGING_ONLY_GUARDRAILS_PENDING) is not True
    )
    if not eligible_logs:
        return
    # Aggregate daily metrics by (guardrail_id, date). Latency/score metrics dropped.
    daily_guardrail: Final[dict[_MetricsKey, dict[str, Any]]] = defaultdict(
        lambda: {
            "requests_evaluated": 0,
            "passed_count": 0,
            "blocked_count": 0,
            "flagged_count": 0,
        }
    )
    index_rows: Final[list[dict[str, Any]]] = []
    daily_policy: dict[tuple, dict[str, int]] = defaultdict(
        lambda: {
            "requests_evaluated": 0,
            "passed_count": 0,
            "blocked_count": 0,
            "flagged_count": 0,
        }
    )
    policy_index_rows: list[dict[str, Any]] = []
    seen_request_guardrails: set[tuple[str, str]] = set()
    seen_request_policies: set[tuple[str, str]] = set()

    for payload in eligible_logs:
        request_id = payload.get("request_id")
        start_time = _parse_payload_start_time(payload)
        if not request_id or start_time is None:
            continue
        date_key = _date_str(start_time)

        guardrail_entries = _parse_guardrail_info_from_payload(payload)
        request_guardrail_entries = _aggregate_request_guardrail_entries(guardrail_entries)
        for entry in request_guardrail_entries:
            guardrail_id = entry.get("guardrail_id") or entry.get("guardrail_name") or ""
            if not guardrail_id:
                continue
            request_guardrail = (str(request_id), guardrail_id)
            if request_guardrail in seen_request_guardrails:
                continue
            seen_request_guardrails.add(request_guardrail)
            key = _MetricsKey(guardrail_id, date_key)
            daily_guardrail[key]["requests_evaluated"] += 1
            action = _usage_action(entry)
            if action == "passed":
                daily_guardrail[key]["passed_count"] += 1
            elif action == "blocked":
                daily_guardrail[key]["blocked_count"] += 1
            else:
                daily_guardrail[key]["flagged_count"] += 1
            policy_id = entry.get("policy_id")
            if not isinstance(policy_id, str):
                policy_ids = entry.get("policy_ids")
                policy_id = policy_ids[0] if isinstance(policy_ids, list) and policy_ids else None
            if not isinstance(policy_id, str):
                policy_id = entry.get("policy_name")
            if not isinstance(policy_id, str):
                policy_names = entry.get("policy_names")
                policy_id = policy_names[0] if isinstance(policy_names, list) and policy_names else None
            index_rows.append(
                {
                    "request_id": request_id,
                    "guardrail_id": guardrail_id,
                    "policy_id": policy_id,
                    "start_time": start_time,
                }
            )

        for policy_id, action in _policy_usage_from_payload(payload, guardrail_entries):
            request_policy = (str(request_id), policy_id)
            if request_policy in seen_request_policies:
                continue
            seen_request_policies.add(request_policy)
            aggregate = daily_policy[(policy_id, date_key)]
            aggregate["requests_evaluated"] += 1
            aggregate[f"{action}_count"] += 1
            policy_index_rows.append(
                {
                    "request_id": request_id,
                    "policy_id": policy_id,
                    "start_time": start_time,
                }
            )

    async with pending.lock:
        pending_metrics: Final = pending.metrics
        pending_units: Final = pending.units
        pending.metrics = MappingProxyType({})
        pending.units = MappingProxyType({})

    evaluated_metrics: Final = MappingProxyType(
        {key: agg for key, agg in daily_guardrail.items() if int(agg["requests_evaluated"]) > 0}
    )
    metrics_rows: Final = _merged_metric_rows(pending_metrics, evaluated_metrics)
    unit_rows: Final = _merged_unit_rows(pending_units, _sum_usage_unit_increments(eligible_logs))

    if not metrics_rows and not index_rows and not unit_rows and not daily_policy and not policy_index_rows:
        return

    try:
        # Insert index rows (skip duplicates by request_id + guardrail_id)
        if index_rows:
            try:
                await SpendLogGuardrailIndexRepository(prisma_client).table.create_many(
                    data=index_rows,
                    skip_duplicates=True,
                )
            except Exception as e:
                verbose_proxy_logger.debug("Guardrail usage tracking: index create_many skipped: %s", e)

        if policy_index_rows:
            try:
                await SpendLogPolicyIndexRepository(prisma_client).table.create_many(
                    data=policy_index_rows,
                    skip_duplicates=True,
                )
            except Exception as e:  # noqa: BLE001  # Policy index writes are non-fatal during rolling migrations.
                verbose_proxy_logger.debug("Policy usage tracking: index create_many skipped: %s", e)

        failed_metrics: Final = await _upsert_rows_with_retry(
            metrics_rows, partial(_upsert_metrics_row, prisma_client), "daily metrics", sleep
        )
        failed_units: Final = await _upsert_rows_with_retry(
            unit_rows, partial(_upsert_usage_unit_row, prisma_client), "usage unit", sleep
        )
        if failed_metrics or failed_units:
            async with pending.lock:
                pending.metrics = _capped(_merged_metric_rows(pending.metrics, failed_metrics), "daily metrics")
                pending.units = _capped(_merged_unit_rows(pending.units, failed_units), "usage unit")

        for (policy_id, date_key), aggregate in daily_policy.items():
            requests_evaluated = aggregate["requests_evaluated"]
            await DailyPolicyMetricsRepository(prisma_client).table.upsert(
                where={"policy_id_date": {"policy_id": policy_id, "date": date_key}},
                data={
                    "create": {
                        "policy_id": policy_id,
                        "date": date_key,
                        **aggregate,
                    },
                    "update": {
                        "requests_evaluated": {"increment": requests_evaluated},
                        "passed_count": {"increment": aggregate["passed_count"]},
                        "blocked_count": {"increment": aggregate["blocked_count"]},
                        "flagged_count": {"increment": aggregate["flagged_count"]},
                    },
                },
            )
    except Exception as e:
        verbose_proxy_logger.warning("Guardrail and policy usage tracking failed (non-fatal): %s", e)
