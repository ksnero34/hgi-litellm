"""
Functions to create audit logs for LiteLLM Proxy
"""

import asyncio
import json
from datetime import datetime, timezone
from typing import Final, cast

import litellm
from litellm._logging import verbose_proxy_logger
from litellm._uuid import uuid
from litellm.integrations.custom_logger import CustomLogger
from litellm.proxy._types import (
    AUDIT_ACTIONS,
    LiteLLM_AuditLogs,
    LitellmTableNames,
    UserAPIKeyAuth,
    hash_token,
)
from litellm.repositories.table_repositories import AuditLogRepository
from litellm.types.utils import StandardAuditLogPayload

_audit_log_callback_cache: Final[dict[str, CustomLogger]] = {}
ALLOW_LITELLM_CHANGED_BY_HEADER_METADATA_KEY: Final = "allow_litellm_changed_by_header"
_AUDIT_SECRET_FIELDS = frozenset(
    {
        "api_key",
        "authorization",
        "client_secret",
        "key",
        "master_key",
        "oidc_token",
        "password",
        "refresh_token",
        "saml_token",
        "token",
    }
)
_KEY_AUDIT_FIELDS = frozenset(
    {
        "blocked",
        "budget_duration",
        "created_at",
        "created_by",
        "expires",
        "key_alias",
        "key_name",
        "key_type",
        "max_budget",
        "max_budget_in_team",
        "max_parallel_requests",
        "models",
        "organization_id",
        "project_id",
        "rpm_limit",
        "success",
        "team_id",
        "token_id",
        "tpm_limit",
        "updated_at",
        "updated_by",
        "user_id",
    }
)
_TEAM_AUDIT_FIELDS = frozenset(
    {
        "blocked",
        "budget_duration",
        "max_budget",
        "max_parallel_requests",
        "member",
        "members",
        "members_with_roles",
        "models",
        "organization_id",
        "rpm_limit",
        "allowed_models",
        "success",
        "team_alias",
        "team_id",
        "tpm_limit",
        "user_email",
        "user_id",
        "user_role",
    }
)
_ORGANIZATION_AUDIT_FIELDS = frozenset(
    {
        "blocked",
        "budget_id",
        "created_at",
        "created_by",
        "max_budget",
        "max_budget_in_organization",
        "models",
        "organization_alias",
        "organization_id",
        "rpm_limit",
        "soft_budget",
        "team_id",
        "tpm_limit",
        "updated_at",
        "updated_by",
        "user_email",
        "user_id",
        "user_role",
    }
)


def _audit_allowlist(table_name: LitellmTableNames | str) -> frozenset[str] | None:
    normalized = table_name.value if isinstance(table_name, LitellmTableNames) else table_name
    if normalized == LitellmTableNames.KEY_TABLE_NAME.value:
        return _KEY_AUDIT_FIELDS
    if normalized in {
        LitellmTableNames.TEAM_TABLE_NAME.value,
        LitellmTableNames.TEAM_MEMBERSHIP_TABLE_NAME.value,
    }:
        return _TEAM_AUDIT_FIELDS
    if normalized in {
        LitellmTableNames.ORGANIZATION_TABLE_NAME.value,
        LitellmTableNames.ORGANIZATION_MEMBERSHIP_TABLE_NAME.value,
    }:
        return _ORGANIZATION_AUDIT_FIELDS
    return None


def _safe_audit_value(value: object, allowlist: frozenset[str] | None) -> object:
    if isinstance(value, dict):
        return {
            str(key): _safe_audit_value(item, None)
            for key, item in value.items()
            if str(key).lower() not in _AUDIT_SECRET_FIELDS and (allowlist is None or str(key) in allowlist)
        }
    if isinstance(value, list):
        return [_safe_audit_value(item, None) for item in value]
    if isinstance(value, tuple):
        return [_safe_audit_value(item, None) for item in value]
    return value


def _sanitize_audit_json(value: object | None, table_name: LitellmTableNames | str) -> object | None:
    if value is None:
        return None
    parsed: object = value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (TypeError, json.JSONDecodeError):
            return None
    return _safe_audit_value(parsed, _audit_allowlist(table_name))


def _successful_audit_value(
    value: object | None,
    table_name: LitellmTableNames | str,
    success: bool = True,
) -> object:
    sanitized = _sanitize_audit_json(value, table_name)
    return {**(sanitized if isinstance(sanitized, dict) else {}), "success": success}


def _safe_actor_key(value: str | None) -> str:
    if value is None:
        return ""
    return hash_token(value) if value.startswith("sk-") else value


def is_audit_logging_enabled(store_audit_logs: bool | None = None) -> bool:
    from litellm.secret_managers.main import get_secret_bool

    configured_value: Final[bool | None] = litellm.store_audit_logs if store_audit_logs is None else store_audit_logs
    if configured_value is not None:
        return configured_value

    environment_value: Final[bool | None] = get_secret_bool("LITELLM_STORE_AUDIT_LOGS")
    if environment_value is not None:
        return environment_value

    return False


def _allows_litellm_changed_by_header(user_api_key_dict: UserAPIKeyAuth) -> bool:
    for admin_metadata in (user_api_key_dict.metadata, user_api_key_dict.team_metadata):
        if (
            isinstance(admin_metadata, dict)
            and admin_metadata.get(ALLOW_LITELLM_CHANGED_BY_HEADER_METADATA_KEY) is True
        ):
            return True
    return False


def get_audit_log_changed_by(
    *,
    litellm_changed_by: str | None,
    user_api_key_dict: UserAPIKeyAuth,
    litellm_proxy_admin_name: str | None,
) -> str | None:
    if litellm_changed_by and _allows_litellm_changed_by_header(user_api_key_dict):
        return litellm_changed_by
    return user_api_key_dict.user_id or litellm_proxy_admin_name


def _resolve_audit_log_callback(name: str) -> CustomLogger | None:
    """Resolve a string callback name to a CustomLogger instance, with caching.

    For "s3_v2" with `litellm.s3_audit_callback_params` set, constructs a
    dedicated `S3Logger` so audit logs can target a different bucket than the
    normal-log singleton served by `_init_custom_logger_compatible_class`.
    """
    if name in _audit_log_callback_cache:
        return _audit_log_callback_cache[name]

    instance: CustomLogger | None
    if name == "s3_v2" and getattr(litellm, "s3_audit_callback_params", None) is not None:
        from litellm.integrations.s3_v2 import S3Logger as S3V2Logger

        instance = S3V2Logger(s3_callback_params_override=litellm.s3_audit_callback_params)
    else:
        from litellm.litellm_core_utils.litellm_logging import (
            _init_custom_logger_compatible_class,
        )

        instance = _init_custom_logger_compatible_class(
            logging_integration=name,
            internal_usage_cache=None,
            llm_router=None,
        )

    if instance is not None:
        _audit_log_callback_cache[name] = instance
    return instance


def reset_audit_log_callback_cache() -> None:
    """Clear cached audit-log callback instances. Call on config reload."""
    _audit_log_callback_cache.clear()


def _build_audit_log_payload(
    request_data: LiteLLM_AuditLogs,
) -> StandardAuditLogPayload:
    """Convert LiteLLM_AuditLogs to StandardAuditLogPayload for callback dispatch."""
    updated_at = ""
    if request_data.updated_at is not None:
        updated_at = request_data.updated_at.isoformat()

    table_name_str: Final[str] = (
        request_data.table_name.value
        if isinstance(request_data.table_name, LitellmTableNames)
        else str(request_data.table_name)
    )

    return StandardAuditLogPayload(
        id=request_data.id,
        updated_at=updated_at,
        changed_by=request_data.changed_by or "",
        changed_by_api_key=request_data.changed_by_api_key or "",
        action=request_data.action,
        table_name=table_name_str,
        object_id=request_data.object_id,
        success=request_data.success,
        before_value=request_data.before_value,
        updated_values=request_data.updated_values,
    )


def _audit_log_task_done_callback(task: asyncio.Task) -> None:
    """Log exceptions from audit log callback tasks so they don't slip through silently."""
    try:
        exc: Final = task.exception()
    except asyncio.CancelledError:
        return
    if exc is not None:
        verbose_proxy_logger.error("Audit log callback task failed: %s", exc, exc_info=exc)


async def _dispatch_audit_log_to_callbacks(
    request_data: LiteLLM_AuditLogs,
) -> None:
    """Dispatch audit log to all registered audit_log_callbacks."""
    if not litellm.audit_log_callbacks:
        return

    payload: Final = _build_audit_log_payload(request_data)

    for callback in litellm.audit_log_callbacks:
        try:
            resolved: CustomLogger | None = callback if isinstance(callback, CustomLogger) else None
            if isinstance(callback, str):
                resolved = _resolve_audit_log_callback(callback)
                if resolved is None:
                    verbose_proxy_logger.warning("Could not resolve audit log callback: %s", callback)
                    continue

            if isinstance(resolved, CustomLogger):
                task = asyncio.create_task(resolved.async_log_audit_log_event(payload))
                task.add_done_callback(_audit_log_task_done_callback)
        except Exception as e:
            verbose_proxy_logger.error("Failed dispatching audit log to callback: %s", e)


async def create_object_audit_log(
    object_id: str,
    action: AUDIT_ACTIONS,
    litellm_changed_by: str | None,
    user_api_key_dict: UserAPIKeyAuth,
    litellm_proxy_admin_name: str | None,
    table_name: LitellmTableNames,
    before_value: str | None = None,
    after_value: str | None = None,
):
    """
    Create an audit log for an internal user.

    Parameters:
    - user_id: str - The id of the user to create the audit log for.
    - action: AUDIT_ACTIONS - The action to create the audit log for.
    - user_row: LiteLLM_UserTable - The user row to create the audit log for.
    - litellm_changed_by: Optional[str] - The user id of the user who is changing the user.
    - user_api_key_dict: UserAPIKeyAuth - The user api key dictionary.
    - litellm_proxy_admin_name: Optional[str] - The name of the proxy admin.
    """
    if not is_audit_logging_enabled():
        return

    _changed_by: Final = get_audit_log_changed_by(
        litellm_changed_by=litellm_changed_by,
        user_api_key_dict=user_api_key_dict,
        litellm_proxy_admin_name=litellm_proxy_admin_name,
    )

    await create_audit_log_for_update(
        request_data=LiteLLM_AuditLogs(
            id=str(uuid.uuid4()),
            updated_at=datetime.now(timezone.utc),
            changed_by=_changed_by,
            changed_by_api_key=user_api_key_dict.api_key,
            table_name=table_name,
            object_id=object_id,
            action=action,
            updated_values=after_value,
            before_value=before_value,
        )
    )


async def create_audit_log_for_update(request_data: LiteLLM_AuditLogs, mandatory: bool = False) -> bool:
    """
    Create an audit log for an object.
    """
    from litellm.proxy.proxy_server import prisma_client

    verbose_proxy_logger.debug("creating audit log for %s", request_data)

    safe_request_data = request_data.model_copy(
        update={
            "changed_by_api_key": _safe_actor_key(request_data.changed_by_api_key),
            "updated_values": _successful_audit_value(
                request_data.updated_values,
                request_data.table_name,
                request_data.success,
            ),
            "before_value": _sanitize_audit_json(request_data.before_value, request_data.table_name),
        }
    )

    # Dispatch to external audit log callbacks regardless of DB availability
    await _dispatch_audit_log_to_callbacks(safe_request_data)

    if prisma_client is None:
        verbose_proxy_logger.error(
            "audit_persistence_failed mandatory=%s object_id=%s reason=database_not_connected",
            mandatory,
            request_data.object_id,
        )
        return False

    _request_data: Final = safe_request_data.model_dump(exclude_none=True, exclude={"success"})

    try:
        await AuditLogRepository(prisma_client).table.create(
            data={
                **cast(dict, _request_data),
            }
        )
        return True
    except Exception as e:
        verbose_proxy_logger.error(
            "audit_persistence_failed mandatory=%s object_id=%s error=%s",
            mandatory,
            request_data.object_id,
            e,
        )
        return False
