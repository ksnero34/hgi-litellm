import asyncio
import copy
import hashlib
import hmac
import json
import math
import os
import re
import threading
import time
import weakref
from collections import Counter, OrderedDict
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from types import MappingProxyType
from typing import Final, Protocol, TypeAlias, TypedDict

from typing_extensions import ReadOnly

from litellm.caching.redis_cache import RedisCache
from litellm.secret_managers.main import get_secret

Entity: TypeAlias = dict[str, object]


class Analyzer(Protocol):
    def __call__(self, payload: Mapping[str, object]) -> Awaitable[Sequence[Mapping[str, object]]]: ...


class _CacheIdentity(TypedDict):
    authenticated_tenant_scope: ReadOnly[str]
    analysis_version: ReadOnly[str]
    effective_analyzer_payload: ReadOnly[Mapping[str, object]]


class _RequestIdentity(TypedDict):
    payload: ReadOnly[Mapping[str, object]]
    tenant: ReadOnly[str | None]
    analysis_version: ReadOnly[str]
    instance: ReadOnly[int]


class _CacheRecord(TypedDict):
    schema_version: ReadOnly[str]
    analysis_version: ReadOnly[str]
    entities: ReadOnly[Sequence[Entity]]


class _Pipeline(Protocol):
    async def __aenter__(self) -> "_Pipeline": ...
    async def __aexit__(self, exc_type: object, exc: object, traceback: object) -> None: ...
    def get(self, key: str) -> object: ...
    def set(self, key: str, value: str, *, ex: int) -> object: ...
    async def execute(self) -> list[object]: ...


class _RedisClient(Protocol):
    def pipeline(self, transaction: bool = False) -> _Pipeline: ...


def _validate_entity(value: object, text_length: int) -> Entity | None:
    if not isinstance(value, dict):
        return None
    item: Final[Mapping[str, object]] = value
    start: Final = item.get("start")
    end: Final = item.get("end")
    kind: Final = item.get("entity_type")
    score: Final = item.get("score")
    if (
        not isinstance(start, int)
        or isinstance(start, bool)
        or not isinstance(end, int)
        or isinstance(end, bool)
        or not 0 <= start < end <= text_length
        or not isinstance(kind, str)
        or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,127}", kind)
        or not isinstance(score, (int, float))
        or isinstance(score, bool)
        or not math.isfinite(score)
        or not 0 <= score <= 1
    ):
        return None
    return {"start": start, "end": end, "entity_type": kind, "score": score}


def validate_entities(value: object, text_length: int) -> list[Entity] | None:
    if not isinstance(value, list):
        return None
    items: Final[Sequence[object]] = value
    results: Final = tuple(_validate_entity(item, text_length) for item in items)
    if any(item is None for item in results):
        return None
    return [item for item in results if item is not None]


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


@dataclass(frozen=True)
class AnalysisCacheConfig:
    enabled: bool = False
    complete_analysis_verified: bool = False
    secret: str = field(default="", repr=False)
    key_version: str = ""
    analysis_version: str = ""
    ttl_seconds: int = 300
    max_entry_bytes: int = 65536
    redis_timeout_seconds: float = 0.2
    analyze_timeout_seconds: float = 30.0
    max_singleflight: int = 256
    batch_size: int = 128
    max_request_fragments: int = 4096
    local_max_entries: int = 1024
    local_max_bytes: int = 16 * 1024 * 1024

    @classmethod
    def from_env(cls) -> "AnalysisCacheConfig":
        try:
            secret: Final = get_secret("PRESIDIO_ANALYSIS_CACHE_HMAC_SECRET", default_value="")
            return cls(
                enabled=os.getenv("PRESIDIO_ANALYSIS_CACHE_ENABLED", "false").lower() == "true",
                complete_analysis_verified=os.getenv(
                    "PRESIDIO_ANALYSIS_CACHE_COMPLETE_ANALYSIS_VERIFIED", "false"
                ).lower()
                == "true",
                secret=secret if isinstance(secret, str) else "",
                key_version=os.getenv("PRESIDIO_ANALYSIS_CACHE_KEY_VERSION", ""),
                analysis_version=os.getenv("PRESIDIO_ANALYSIS_CACHE_ANALYSIS_VERSION", ""),
                ttl_seconds=int(os.getenv("PRESIDIO_ANALYSIS_CACHE_TTL_SECONDS", "300")),
                max_entry_bytes=int(os.getenv("PRESIDIO_ANALYSIS_CACHE_MAX_ENTRY_BYTES", "65536")),
                local_max_entries=int(os.getenv("PRESIDIO_ANALYSIS_CACHE_LOCAL_MAX_ENTRIES", "1024")),
                local_max_bytes=int(os.getenv("PRESIDIO_ANALYSIS_CACHE_LOCAL_MAX_BYTES", "16777216")),
                redis_timeout_seconds=float(os.getenv("PRESIDIO_ANALYSIS_CACHE_REDIS_TIMEOUT_SECONDS", "0.2")),
                analyze_timeout_seconds=float(os.getenv("PRESIDIO_PRE_CALL_TIMEOUT_SECONDS", "30")),
            )
        except Exception:  # noqa: BLE001  # Secret-provider failures must disable caching and retain direct inspection
            return cls()

    @property
    def safe_to_enable(self) -> bool:
        return bool(
            self.enabled
            and self.complete_analysis_verified
            and len(self.secret.encode()) >= 32
            and re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", self.key_version)
            and re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", self.analysis_version)
            and self.ttl_seconds > 0
            and self.max_entry_bytes > 0
            and math.isfinite(self.redis_timeout_seconds)
            and self.redis_timeout_seconds > 0
            and math.isfinite(self.analyze_timeout_seconds)
            and self.analyze_timeout_seconds > 0
            and self.max_singleflight > 0
            and self.batch_size > 0
            and self.local_max_entries > 0
            and self.local_max_bytes > 0
        )


@dataclass
class RequestAnalysisContext:
    deadline: float
    tenant_scope: str | None = None
    max_concurrency: int = 8
    redis_cache: RedisCache | None = field(default=None, repr=False)
    results: dict[str, list[Entity]] = field(default_factory=dict, repr=False)
    pending: dict[str, asyncio.Future[list[Entity]]] = field(default_factory=dict, repr=False)
    semaphore: asyncio.Semaphore = field(init=False, repr=False)
    analysis_semaphore: asyncio.Semaphore = field(init=False, repr=False)
    engine_semaphores: dict[int, asyncio.Semaphore] = field(default_factory=dict, repr=False)
    http_semaphore: asyncio.Semaphore = field(init=False, repr=False)
    http_semaphores: dict[int, asyncio.Semaphore] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        self.semaphore = asyncio.Semaphore(max(1, self.max_concurrency))
        self.analysis_semaphore = asyncio.Semaphore(max(1, self.max_concurrency))
        self.http_semaphore = asyncio.Semaphore(max(1, self.max_concurrency))

    def remaining(self) -> float:
        return max(0.0, self.deadline - time.monotonic())

    def clear(self) -> None:
        for task in tuple(self.pending.values()):
            task.cancel()
        self.pending.clear()
        self.results.clear()
        self.engine_semaphores.clear()
        self.http_semaphores.clear()
        self.tenant_scope = None
        self.redis_cache = None


@dataclass
class _Flight:
    task: asyncio.Task[list[Entity]]
    waiters: int = 0


_FLIGHTS: Final[weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, dict[str, _Flight]]] = weakref.WeakKeyDictionary()


class _LocalResultStore:
    def __init__(self, config: AnalysisCacheConfig, clock: Callable[[], float]) -> None:
        self._config = config
        self._clock = clock
        self._lock = threading.Lock()
        self._entries: OrderedDict[str, tuple[float, str, int]] = OrderedDict()  # mutable-ok: Locked FIFO updates.
        self._bytes = 0

    def _remove_oldest(self) -> None:
        _, (_, _, size) = self._entries.popitem(last=False)
        self._bytes -= size

    def _expire(self, now: float) -> None:
        while self._entries and next(iter(self._entries.values()))[0] <= now:
            self._remove_oldest()

    def read(self, keys: Sequence[str]) -> tuple[str | None, ...]:
        with self._lock:
            self._expire(self._clock())
            return tuple(self._entries[key][1] if key in self._entries else None for key in keys)

    def _write_entry(self, key: str, value: str, now: float) -> None:
        size: Final = len(value.encode())
        if size > min(self._config.max_entry_bytes, self._config.local_max_bytes):
            return
        previous: Final = self._entries.pop(key, None)
        if previous is not None:
            self._bytes -= previous[2]
        while self._entries and (
            len(self._entries) >= self._config.local_max_entries or self._bytes + size > self._config.local_max_bytes
        ):
            self._remove_oldest()
        self._entries[key] = (now + self._config.ttl_seconds, value, size)
        self._bytes += size

    def write(self, entries: Sequence[tuple[str, str]]) -> None:
        with self._lock:
            now: Final = self._clock()
            self._expire(now)
            for key, value in entries:
                self._write_entry(key, value, now)


class AnalysisCache:
    def __init__(
        self,
        config: AnalysisCacheConfig,
        redis_cache: RedisCache | None = None,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        bounds_valid: Final = (
            math.isfinite(config.analyze_timeout_seconds)
            and config.analyze_timeout_seconds > 0
            and config.batch_size > 0
            and config.max_request_fragments > 0
            and config.max_singleflight > 0
        )
        self.config = (
            config
            if bounds_valid
            else replace(
                config,
                enabled=False,
                analyze_timeout_seconds=30.0,
                batch_size=128,
                max_request_fragments=4096,
                max_singleflight=256,
            )
        )
        self.redis_cache = redis_cache
        self._local_store = _LocalResultStore(self.config, clock)
        self._identity = id(self)
        self.counters: Counter[str] = Counter()  # mutable-ok: Aggregate counters change as requests execute.
        self.timings: dict[
            str, tuple[int, float]
        ] = {}  # mutable-ok: Running counts and latency totals update per operation.

    def observe(self, name: str, elapsed: float) -> None:
        count, total = self.timings.get(name, (0, 0.0))
        self.timings[name] = (count + 1, total + elapsed)

    @property
    def backend(self) -> str:
        if not self.config.safe_to_enable:
            return "disabled"
        return "redis" if self.redis_cache is not None else "local"

    def cache_key(self, payload: Mapping[str, object], tenant_scope: str | None) -> str | None:
        if not self.config.safe_to_enable or not tenant_scope:
            return None
        secret: Final = self.config.secret.encode()
        tenant: Final = hmac.new(secret, ("tenant:" + tenant_scope).encode(), hashlib.sha256).hexdigest()
        identity: Final[_CacheIdentity] = {
            "authenticated_tenant_scope": tenant_scope,
            "analysis_version": self.config.analysis_version,
            "effective_analyzer_payload": payload,
        }
        digest: Final = hmac.new(secret, canonical_json(identity).encode(), hashlib.sha256).hexdigest()
        return f"pii:analysis:v1:{self.config.key_version}:{tenant}:{self.config.analysis_version}:{digest}"

    def _request_key(self, payload: Mapping[str, object], context: RequestAnalysisContext) -> str:
        identity: Final[_RequestIdentity] = {
            "payload": payload,
            "tenant": context.tenant_scope,
            "analysis_version": self.config.analysis_version,
            "instance": self._identity,
        }
        return hashlib.sha256(canonical_json(identity).encode()).hexdigest()

    def _encode(self, entities: Sequence[Entity]) -> str:
        record: Final[_CacheRecord] = {
            "schema_version": "v1",
            "analysis_version": self.config.analysis_version,
            "entities": entities,
        }
        return canonical_json(record)

    def _decode(self, raw: object, text_length: int) -> list[Entity] | None:
        if raw is None:
            self.counters["cache_miss"] += 1
            return None
        try:
            if (
                not isinstance(raw, (bytes, str))
                or len(raw.encode() if isinstance(raw, str) else raw) > self.config.max_entry_bytes
            ):
                raise ValueError("Invalid cached size")
            decoded: Final[object] = json.loads(raw)
            if not isinstance(decoded, dict):
                raise TypeError("Invalid cached schema")
            record: Final[Mapping[str, object]] = decoded
            if (
                frozenset(record) != frozenset(("schema_version", "analysis_version", "entities"))
                or record["schema_version"] != "v1"
                or record["analysis_version"] != self.config.analysis_version
            ):
                raise ValueError("Incompatible cached schema")
            raw_entities: Final = record["entities"]
            if not isinstance(raw_entities, list):
                raise TypeError("Invalid cached entities")
            entities: Final = validate_entities(raw_entities, text_length)
            if entities is None or any(
                frozenset(item) != frozenset(("start", "end", "entity_type", "score")) for item in raw_entities
            ):
                raise ValueError("Invalid cached entities")
            self.counters["cache_hit"] += 1
            return entities
        except (ValueError, TypeError, KeyError, UnicodeError):
            self.counters["cache_invalid"] += 1
            self.counters["cache_miss"] += 1
            return None

    async def _read(self, entries: Sequence[tuple[str, Mapping[str, object]]]) -> Mapping[str, list[Entity]]:
        redis_cache: Final = self.redis_cache
        if not entries:
            return MappingProxyType({})
        if redis_cache is None:
            local_values: Final = self._local_store.read(tuple(key for key, _ in entries))
            return MappingProxyType(
                {
                    key: entities
                    for (key, payload), raw in zip(entries, local_values)
                    if (entities := self._decode(raw, len(str(payload["text"])))) is not None
                }
            )
        started: Final = time.monotonic()
        try:

            async def run() -> list[object]:
                client: Final[_RedisClient] = redis_cache.init_async_client()
                async with client.pipeline(transaction=False) as pipe:
                    for key, _ in entries:
                        pipe.get(redis_cache.check_and_fix_namespace(key))
                    return await pipe.execute()

            values: Final = await asyncio.wait_for(run(), self.config.redis_timeout_seconds)
            if len(values) != len(entries):
                raise ValueError("Invalid Redis pipeline response")
            return MappingProxyType(
                {
                    key: entities
                    for (key, payload), raw in zip(entries, values)
                    if (entities := self._decode(raw, len(str(payload["text"])))) is not None
                }
            )
        except Exception:
            self.counters["cache_error"] += 1
            self.counters["fallback"] += 1
            return MappingProxyType({})
        finally:
            self.observe("redis", time.monotonic() - started)

    async def _write(self, entries: Sequence[tuple[str, list[Entity]]]) -> None:
        redis_cache: Final = self.redis_cache
        if not entries:
            return
        started: Final = time.monotonic()
        encoded: Final = tuple((key, self._encode(entities)) for key, entities in entries)
        if redis_cache is None:
            self.counters["cache_oversize"] += sum(
                len(value.encode()) > min(self.config.max_entry_bytes, self.config.local_max_bytes)
                for _, value in encoded
            )
            self._local_store.write(encoded)
            return
        try:

            async def run() -> None:
                client: Final[_RedisClient] = redis_cache.init_async_client()
                async with client.pipeline(transaction=False) as pipe:
                    for key, value in encoded:
                        if len(value.encode()) <= self.config.max_entry_bytes:
                            pipe.set(redis_cache.check_and_fix_namespace(key), value, ex=self.config.ttl_seconds)
                        else:
                            self.counters["cache_oversize"] += 1
                    await pipe.execute()

            await asyncio.wait_for(run(), self.config.redis_timeout_seconds)
        except Exception:
            self.counters["cache_error"] += 1
        finally:
            self.observe("redis", time.monotonic() - started)

    async def _analyze(self, payload: Mapping[str, object], analyze: Analyzer) -> list[Entity]:
        started: Final = time.monotonic()
        self.counters["analyze_calls"] += 1
        try:
            raw: Final = await asyncio.wait_for(analyze(payload), self.config.analyze_timeout_seconds)
            entities: Final = validate_entities(list(raw), len(str(payload["text"])))
            if entities is None:
                raise ValueError("Presidio returned incomplete or invalid analysis")
            return entities
        finally:
            self.observe("analyze", time.monotonic() - started)

    async def _singleflight(self, key: str | None, payload: Mapping[str, object], analyze: Analyzer) -> list[Entity]:
        if key is None:
            return await self._analyze(payload, analyze)
        flights: Final = _FLIGHTS.setdefault(
            asyncio.get_running_loop(), {}
        )  # mutable-ok: Active flights enter and leave the event-loop registry.
        existing: Final = flights.get(key)
        if existing is None and len(flights) >= self.config.max_singleflight:
            self.counters["singleflight_capacity_fallback"] += 1
            return await self._analyze(payload, analyze)
        flight: Final = existing or _Flight(asyncio.create_task(self._analyze(payload, analyze)))
        if existing is None:
            flights[key] = flight
        else:
            self.counters["singleflight_shared"] += 1
        flight.waiters += 1
        try:
            return await asyncio.shield(flight.task)
        finally:
            flight.waiters -= 1
            if flight.waiters == 0:
                if flights.get(key) is flight:
                    flights.pop(key, None)
                if not flight.task.done():
                    flight.task.cancel()
                    await asyncio.gather(flight.task, return_exceptions=True)
                else:
                    if not flight.task.cancelled():
                        flight.task.exception()

    async def analyze_many(
        self,
        payloads: Sequence[Mapping[str, object]],
        context: RequestAnalysisContext,
        analyze: Analyzer,
        max_concurrency: int | None = None,
    ) -> list[list[Entity]]:
        started: Final = time.monotonic()
        try:
            engine: Final = copy.copy(self) if self.redis_cache is None and context.redis_cache is not None else self
            if engine is not self:
                engine.redis_cache = context.redis_cache
            limit: Final = max(1, min(max_concurrency or context.max_concurrency, context.max_concurrency))
            context.engine_semaphores.setdefault(self._identity, asyncio.Semaphore(limit))
            return await asyncio.wait_for(engine._many(payloads, context, analyze), context.remaining())
        except asyncio.TimeoutError:
            self.counters["timeout"] += 1
            self.counters["fail_closed"] += 1
            raise
        except Exception:
            self.counters["fail_closed"] += 1
            raise
        finally:
            self.observe("pre_call", time.monotonic() - started)

    async def _many(
        self, payloads: Sequence[Mapping[str, object]], context: RequestAnalysisContext, analyze: Analyzer
    ) -> list[list[Entity]]:
        if len(payloads) > self.config.max_request_fragments:
            raise ValueError("Presidio request fragment limit exceeded")
        unique: Final = MappingProxyType({self._request_key(payload, context): payload for payload in payloads})
        missing: Final = tuple(
            (key, payload)
            for key, payload in unique.items()
            if key not in context.results and key not in context.pending
        )
        if len(context.results.keys() | context.pending.keys() | unique.keys()) > self.config.max_request_fragments:
            raise ValueError("Presidio request analysis limit exceeded")
        self.counters["request_dedupe"] += len(payloads) - len(missing)
        waiting: Final = MappingProxyType({key: context.pending[key] for key in unique if key in context.pending})
        owned: Final[Mapping[str, asyncio.Future[list[Entity]]]] = MappingProxyType(
            {key: asyncio.get_running_loop().create_future() for key, _ in missing}
        )
        context.pending.update(owned)
        try:
            for offset in range(0, len(missing), self.config.batch_size):
                await self._batch(missing[offset : offset + self.config.batch_size], context, analyze, owned)
            for key, pending in waiting.items():
                context.results[key] = await asyncio.shield(pending)
            return [copy.deepcopy(context.results[self._request_key(payload, context)]) for payload in payloads]
        except BaseException as error:
            for pending in owned.values():
                if not pending.done():
                    if isinstance(error, asyncio.CancelledError):
                        pending.cancel()
                    else:
                        pending.set_exception(error)
                        pending.exception()
            raise
        finally:
            for key in owned:
                context.pending.pop(key, None)

    async def _batch(
        self,
        batch: Sequence[tuple[str, Mapping[str, object]]],
        context: RequestAnalysisContext,
        analyze: Analyzer,
        owned: Mapping[str, asyncio.Future[list[Entity]]],
    ) -> None:
        keys: Final = MappingProxyType({key: self.cache_key(payload, context.tenant_scope) for key, payload in batch})
        hits: Final = await self._read(
            tuple((cache_key, payload) for key, payload in batch if (cache_key := keys[key]) is not None)
        )

        async def process(key: str, payload: Mapping[str, object]) -> list[Entity]:
            cache_key: Final = keys[key]
            if cache_key is not None and cache_key in hits:
                return copy.deepcopy(hits[cache_key])
            queued: Final = time.monotonic()
            async with context.analysis_semaphore, context.engine_semaphores[self._identity]:
                self.observe("queue", time.monotonic() - queued)
                entities: Final = await self._singleflight(cache_key, payload, analyze)
                return entities

        tasks: Final = MappingProxyType({key: asyncio.create_task(process(key, payload)) for key, payload in batch})
        try:
            values: Final = await asyncio.gather(*tasks.values())
            context.results.update(zip(tasks, values))
            writes: Final = tuple(
                (cache_key, context.results[key])
                for key, cache_key in keys.items()
                if cache_key is not None and cache_key not in hits
            )
            await self._write(writes)
            for key in tasks:
                if not owned[key].done():
                    owned[key].set_result(context.results[key])
        finally:
            for task in tasks.values():
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks.values(), return_exceptions=True)
