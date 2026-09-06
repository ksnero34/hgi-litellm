import asyncio
import json
import time
from dataclasses import replace

import pytest

from litellm.proxy.guardrails.guardrail_hooks.presidio_analysis_cache import (
    _FLIGHTS,
    AnalysisCache,
    AnalysisCacheConfig,
    RequestAnalysisContext,
    validate_entities,
)


class MemoryPipeline:
    def __init__(self, redis):
        self.redis = redis
        self.commands = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    def get(self, key):
        self.commands.append(("get", key))
        return self

    def set(self, key, value, ex):
        self.commands.append(("set", key, value, ex))
        return self

    async def execute(self):
        self.redis.pipelines.append(self.commands)
        if self.redis.fail:
            raise ConnectionError("synthetic Redis outage")
        if self.redis.hold_write is not None and any(command[0] == "set" for command in self.commands):
            self.redis.write_started.set()
            await self.redis.hold_write.wait()
        result = []
        for command in self.commands:
            if command[0] == "get":
                value, deadline = self.redis.values.get(command[1], (None, 0))
                result.append(value if deadline > time.monotonic() else None)
            else:
                self.redis.values[command[1]] = (command[2], time.monotonic() + command[3])
                result.append(True)
        return result


class MemoryRedis:
    def __init__(self, hold_write=None, write_started=None):
        self.values = {}
        self.pipelines = []
        self.fail = False
        self.hold_write = hold_write
        self.write_started = write_started

    def init_async_client(self):
        return self

    def pipeline(self, transaction=False):
        assert transaction is False
        return MemoryPipeline(self)

    def check_and_fix_namespace(self, key):
        return key


def config(**kwargs):
    return replace(
        AnalysisCacheConfig(
            enabled=True,
            complete_analysis_verified=True,
            secret="synthetic-secret-at-least-32-bytes-long",
            key_version="k1",
            analysis_version="synthetic-model-regex-policy-v1",
        ),
        **kwargs,
    )


def context(tenant="team:synthetic", timeout=2, concurrency=3, redis_cache=None):
    return RequestAnalysisContext(time.monotonic() + timeout, tenant, concurrency, redis_cache)


class SyntheticAnalyzer:
    def __init__(self, delay=0):
        self.calls = 0
        self.active = 0
        self.peak = 0
        self.delay = delay

    async def __call__(self, payload):
        self.calls += 1
        self.active += 1
        self.peak = max(self.peak, self.active)
        try:
            await asyncio.sleep(self.delay)
            if payload["text"].startswith("none"):
                return []
            return [
                {
                    "start": 0,
                    "end": 2,
                    "entity_type": "PERSON",
                    "score": 0.98,
                    "analysis_explanation": "synthetic secret explanation",
                    "recognition_metadata": {"text": payload["text"]},
                }
            ]
        finally:
            self.active -= 1


@pytest.mark.asyncio
async def test_bulk_dedupe_cross_instance_cache_and_defensive_copy():
    redis = MemoryRedis()
    engine = AnalysisCache(config(), redis)
    analyze = SyntheticAnalyzer()
    ctx = context()
    payloads = [{"text": "가상🙂\r\n  인물", "language": "ko"}, {"text": "none synthetic", "language": "ko"}]
    first = await engine.analyze_many([payloads[0], payloads[1], payloads[0]], ctx, analyze)
    assert analyze.calls == 2
    assert len(redis.pipelines[0]) == 2
    assert len(redis.pipelines[1]) == 2
    first[0][0]["start"] = 99
    assert first[2][0]["start"] == 0
    repeated = await engine.analyze_many(payloads, ctx, analyze)
    assert repeated[0][0]["start"] == 0
    assert analyze.calls == 2
    assert len(redis.pipelines) == 2
    second_pod = AnalysisCache(config(), redis)
    assert await second_pod.analyze_many(payloads, context(), analyze) == repeated
    assert analyze.calls == 2
    assert second_pod.counters["cache_hit"] == 2
    stored = list(redis.values.values())
    assert all("explanation" not in value and "recognition" not in value and "가상" not in value for value, _ in stored)
    assert all(set(json.loads(value)) == {"schema_version", "analysis_version", "entities"} for value, _ in stored)
    assert all("team:synthetic" not in key for key in redis.values)
    ctx.clear()
    assert not ctx.results and not ctx.pending and ctx.tenant_scope is None


@pytest.mark.parametrize(
    "changed",
    [
        {"text": "가상2"},
        {"language": "en"},
        {"entities": ["PHONE_NUMBER"]},
        {"context": ["synthetic"]},
        {"score_threshold": 0.3},
        {"allow_list": ["synthetic"]},
        {"ad_hoc_recognizers": [{"name": "synthetic", "patterns": [{"regex": "abc"}]}]},
    ],
)
def test_all_effective_payload_options_change_hmac(changed):
    engine = AnalysisCache(config(), MemoryRedis())
    payload = {"text": "가상", "language": "ko"}
    assert engine.cache_key(payload, "team:a") != engine.cache_key({**payload, **changed}, "team:a")


def test_versions_tenant_and_serialization_isolation():
    payload = {"text": "가상", "language": "ko"}
    redis = MemoryRedis()
    baseline = AnalysisCache(config(), redis).cache_key(payload, "team:a")
    for changed in [
        config(key_version="k2"),
        config(analysis_version="new-regex"),
        config(secret="another-synthetic-secret-at-least-32-bytes"),
    ]:
        assert AnalysisCache(changed, redis).cache_key(payload, "team:a") != baseline
    assert AnalysisCache(config(), redis).cache_key(payload, "team:b") != baseline
    assert AnalysisCache(config(), redis).cache_key(dict(reversed(list(payload.items()))), "team:a") == baseline
    assert AnalysisCache(config(), redis).cache_key(payload, None) is None
    assert AnalysisCache(config(complete_analysis_verified=False), redis).cache_key(payload, "team:a") is None
    assert AnalysisCache(config(secret=""), redis).cache_key(payload, "team:a") is None


@pytest.mark.parametrize(
    "entities",
    [
        [{"start": -1, "end": 2, "entity_type": "PERSON", "score": 0.9}],
        [{"start": 0, "end": 99, "entity_type": "PERSON", "score": 0.9}],
        [{"start": True, "end": 2, "entity_type": "PERSON", "score": 0.9}],
        [{"start": 0, "end": 2, "entity_type": "PERSON", "score": float("nan")}],
        [{"start": 0, "end": 2, "entity_type": "PERSON", "score": 1.1}],
        [{"start": 0, "end": 2, "entity_type": "raw text!", "score": 0.9}],
        [None],
        {"error": "synthetic failure"},
    ],
)
def test_invalid_entities_rejected_completely(entities):
    assert validate_entities(entities, 3) is None


@pytest.mark.asyncio
async def test_corrupt_incompatible_offsets_and_expired_cache_reanalyze():
    redis = MemoryRedis()
    engine = AnalysisCache(config(), redis)
    payload = {"text": "가상🙂\r\n  인물", "language": "ko"}
    key = engine.cache_key(payload, "team:synthetic")
    analyze = SyntheticAnalyzer()
    for bad in [
        "{broken",
        json.dumps({"schema_version": "v2", "analysis_version": engine.config.analysis_version, "entities": []}),
        json.dumps(
            {
                "schema_version": "v1",
                "analysis_version": engine.config.analysis_version,
                "entities": [{"start": 0, "end": 99, "entity_type": "PERSON", "score": 0.9}],
            }
        ),
    ]:
        redis.values[key] = (bad, time.monotonic() + 10)
        await engine.analyze_many([payload], context(), analyze)
    assert analyze.calls == 3
    value, _ = redis.values[key]
    redis.values[key] = (value, time.monotonic() - 1)
    await engine.analyze_many([payload], context(), analyze)
    assert analyze.calls == 4


@pytest.mark.asyncio
async def test_unknown_tenant_or_redis_outage_direct_analysis_and_request_dedupe():
    redis = MemoryRedis()
    engine = AnalysisCache(config(), redis)
    analyze = SyntheticAnalyzer()
    payload = {"text": "가상", "language": "ko"}
    await engine.analyze_many([payload, payload], context(None), analyze)
    assert analyze.calls == 1 and not redis.pipelines
    redis.fail = True
    assert await engine.analyze_many([payload], context(), analyze)
    assert analyze.calls == 2 and engine.counters["cache_error"] == 2
    assert not redis.values


@pytest.mark.asyncio
@pytest.mark.parametrize("use_redis", [True, False])
async def test_shared_miss_cancel_one_waiter_bounded_workers_and_deadline(use_redis):
    redis = MemoryRedis() if use_redis else None
    engine = AnalysisCache(config(), redis)
    other = AnalysisCache(config(), redis)
    analyze = SyntheticAnalyzer(0.08)
    payload = {"text": "가상", "language": "ko"}
    first = asyncio.create_task(engine.analyze_many([payload], context(), analyze))
    second_context = context()
    second = asyncio.create_task(other.analyze_many([payload], second_context, analyze))
    await asyncio.sleep(0.02)
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    assert await second
    assert analyze.calls == 1
    assert other.counters["singleflight_shared"] == 1
    assert other.cache_info([payload], second_context) == {"status": "miss", "hit_count": 0, "total_count": 1}
    assert not _FLIGHTS[asyncio.get_running_loop()]
    limited = SyntheticAnalyzer(0.02)
    await engine.analyze_many([{"text": "가상" + str(i)} for i in range(20)], context(concurrency=2), limited)
    assert limited.peak == 2
    slow = SyntheticAnalyzer(0.2)
    with pytest.raises(asyncio.TimeoutError):
        await engine.analyze_many(
            [{"text": "다른가상" + str(i)} for i in range(5)], context(timeout=0.03, concurrency=1), slow
        )
    await asyncio.sleep(0.01)
    assert slow.active == 0
    assert not _FLIGHTS[asyncio.get_running_loop()]
    assert engine.counters["timeout"] == 1


@pytest.mark.asyncio
async def test_errors_invalid_and_timeout_never_cached_and_retry_recovers():
    redis = MemoryRedis()
    engine = AnalysisCache(config(), redis)
    payload = {"text": "가상"}

    async def failing(payload):
        raise RuntimeError("synthetic failure")

    async def invalid(payload):
        return [{"start": 0, "end": 99, "entity_type": "PERSON", "score": 0.9}]

    for callback in [failing, invalid]:
        with pytest.raises((RuntimeError, ValueError)):
            await engine.analyze_many([payload], context(), callback)
        assert not redis.values
    assert await engine.analyze_many([payload], context(), SyntheticAnalyzer())
    assert not _FLIGHTS[asyncio.get_running_loop()]


@pytest.mark.asyncio
async def test_parallel_guardrail_calls_share_request_pending_and_auth_redis():
    redis = MemoryRedis()
    engine = AnalysisCache(config())
    ctx = context(redis_cache=redis)
    analyze = SyntheticAnalyzer(0.02)
    payload = {"text": "가상"}
    results = await asyncio.gather(*(engine.analyze_many([payload], ctx, analyze) for _ in range(6)))
    assert all(item == results[0] for item in results)
    assert analyze.calls == 1
    assert len(redis.values) == 1
    assert len(redis.pipelines) == 2


@pytest.mark.asyncio
async def test_per_engine_limit_persists_across_calls_under_aggregate_request_cap():
    engine = AnalysisCache(config(), MemoryRedis())
    ctx = context(concurrency=4)
    analyze = SyntheticAnalyzer(0.005)
    await asyncio.gather(
        engine.analyze_many([{"text": "가상A" + str(i)} for i in range(4)], ctx, analyze, max_concurrency=1),
        engine.analyze_many([{"text": "가상B" + str(i)} for i in range(4)], ctx, analyze, max_concurrency=1),
    )
    assert analyze.peak == 1
    assert len(ctx.engine_semaphores) == 1


@pytest.mark.asyncio
async def test_disabled_cache_keeps_request_dedupe_but_has_no_pod_l1_results():
    redis = MemoryRedis()
    engine = AnalysisCache(config(enabled=False), redis)
    analyze = SyntheticAnalyzer()
    payload = {"text": "가상🙂\r\n  인물", "language": "ko"}
    ctx = context()
    assert await engine.analyze_many([payload, payload], ctx, analyze)
    assert await engine.analyze_many([payload], ctx, analyze)
    assert analyze.calls == 1
    ctx.clear()
    assert await engine.analyze_many([payload], context(), analyze)
    assert analyze.calls == 2
    assert not redis.pipelines


@pytest.mark.asyncio
async def test_fragment_limit_does_not_double_count_existing_results():
    engine = AnalysisCache(config(max_request_fragments=2), MemoryRedis())
    ctx = context()
    analyze = SyntheticAnalyzer()
    payloads = [{"text": "가상A"}, {"text": "가상B"}]
    await engine.analyze_many(payloads, ctx, analyze)
    await engine.analyze_many(payloads, ctx, analyze)
    assert analyze.calls == 2
    with pytest.raises(ValueError, match="analysis limit"):
        await engine.analyze_many([{"text": "가상C"}], ctx, analyze)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "invalid",
    [
        {"analyze_timeout_seconds": -1},
        {"analyze_timeout_seconds": float("nan")},
        {"analyze_timeout_seconds": float("inf")},
        {"batch_size": 0},
        {"max_request_fragments": -1},
        {"max_singleflight": 0},
    ],
)
async def test_invalid_operational_config_disables_cache_but_still_analyzes(invalid):
    redis = MemoryRedis()
    engine = AnalysisCache(config(**invalid), redis)
    analyze = SyntheticAnalyzer()
    assert await engine.analyze_many([{"text": "가상"}], context(), analyze)
    assert analyze.calls == 1
    assert not redis.pipelines
    assert not engine.config.enabled


@pytest.mark.asyncio
async def test_near_capacity_concurrent_apply_during_redis_write_counts_union():
    release_write = asyncio.Event()
    write_started = asyncio.Event()
    redis = MemoryRedis(hold_write=release_write, write_started=write_started)
    engine = AnalysisCache(config(max_request_fragments=2, redis_timeout_seconds=1), redis)
    ctx = context()
    analyze = SyntheticAnalyzer()
    payloads = [{"text": "가상A"}, {"text": "가상B"}]
    first = asyncio.create_task(engine.analyze_many(payloads, ctx, analyze))
    await asyncio.wait_for(write_started.wait(), 1)
    assert len(ctx.results) == 2 and len(ctx.pending) == 2
    second = asyncio.create_task(engine.analyze_many(payloads, ctx, analyze))
    try:
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(asyncio.shield(second), 0.02)
    finally:
        release_write.set()
        results = await asyncio.gather(first, second)
    assert results[0] == results[1]
    assert analyze.calls == 2


class SyntheticClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


@pytest.mark.asyncio
async def test_local_persistent_results_empty_hits_offsets_and_ttl():
    clock = SyntheticClock()
    engine = AnalysisCache(config(ttl_seconds=5), clock=clock)
    analyzer = SyntheticAnalyzer()
    payloads = [{"text": "가상🙂\r\n  인물", "language": "ko"}, {"text": "none synthetic", "language": "ko"}]
    first_context = context()
    first = await engine.analyze_many(payloads, first_context, analyzer)
    first_context.clear()
    first[0][0]["start"] = 88
    second = await engine.analyze_many(payloads, context(), analyzer)
    assert second[0][0]["start"] == 0
    assert second[1] == []
    assert analyzer.calls == 2
    assert engine.backend == "local"
    assert engine.counters["cache_hit"] == 2
    assert engine.counters["cache_miss"] == 2
    serialized = str(engine._local_store._entries)
    assert all(secret not in serialized for secret in ("가상", "team:synthetic", "explanation", "recognition", "map"))
    clock.now = 5.0
    assert await engine.analyze_many(payloads, context(), analyzer) == second
    assert analyzer.calls == 4


@pytest.mark.asyncio
async def test_local_capacity_entry_and_byte_eviction_and_oversize():
    payloads = [{"text": "none synthetic " + str(index)} for index in range(3)]
    size = len(AnalysisCache(config())._encode([]).encode())
    for settings in (config(local_max_entries=2), config(local_max_bytes=size * 2)):
        engine = AnalysisCache(settings)
        analyzer = SyntheticAnalyzer()
        await engine.analyze_many(payloads, context(), analyzer)
        assert len(engine._local_store._entries) == 2
        assert engine._local_store._bytes == size * 2
        await engine.analyze_many(payloads[1:], context(), analyzer)
        assert analyzer.calls == 3
        await engine.analyze_many(payloads[:1], context(), analyzer)
        assert analyzer.calls == 4
    for settings in (config(local_max_bytes=size - 1), config(max_entry_bytes=size - 1)):
        engine = AnalysisCache(settings)
        analyzer = SyntheticAnalyzer()
        for _ in range(2):
            await engine.analyze_many(payloads[:1], context(), analyzer)
        assert analyzer.calls == 2
        assert engine._local_store._bytes == 0
        assert engine.counters["cache_oversize"] == 2


@pytest.mark.asyncio
async def test_local_tenant_and_instance_isolation_and_fail_safe_configuration():
    payload = {"text": "synthetic person"}
    analyzer = SyntheticAnalyzer()
    engine = AnalysisCache(config())
    for tenant in ("team:a", "team:b", None, None):
        await engine.analyze_many([payload], context(tenant=tenant), analyzer)
    assert analyzer.calls == 4
    await engine.analyze_many([payload], context(tenant="team:a"), analyzer)
    assert analyzer.calls == 4
    await AnalysisCache(config()).analyze_many([payload], context(tenant="team:a"), analyzer)
    assert analyzer.calls == 5
    for settings in (
        config(enabled=False),
        config(complete_analysis_verified=False),
        config(secret=""),
        config(local_max_entries=0),
        config(local_max_bytes=-1),
    ):
        disabled = AnalysisCache(settings)
        assert disabled.backend == "disabled"
        assert disabled.cache_key(payload, "team:a") is None
        for _ in range(2):
            await disabled.analyze_many([payload], context(), analyzer)
        assert not disabled._local_store._entries
    assert analyzer.calls == 15


@pytest.mark.asyncio
async def test_local_errors_timeouts_and_corruption_are_not_hits():
    payload = {"text": "synthetic person"}
    engine = AnalysisCache(config(analyze_timeout_seconds=0.01))
    slow = SyntheticAnalyzer(delay=0.1)
    for _ in range(2):
        with pytest.raises(asyncio.TimeoutError):
            await engine.analyze_many([payload], context(), slow)
    assert slow.calls == 2
    assert not engine._local_store._entries

    async def broken(_):
        raise ConnectionError("synthetic analyzer failure")

    with pytest.raises(ConnectionError):
        await engine.analyze_many([payload], context(), broken)
    assert not engine._local_store._entries
    analyzer = SyntheticAnalyzer()
    key = engine.cache_key(payload, "team:synthetic")
    for value in ("broken", engine._encode([{"start": 0, "end": 999, "score": 1, "entity_type": "PERSON"}])):
        engine._local_store.write(((key, value),))
        await engine.analyze_many([payload], context(), analyzer)
    assert analyzer.calls == 2
    assert engine.counters["cache_invalid"] == 2


@pytest.mark.asyncio
async def test_redis_context_priority_and_outage_never_use_local_results():
    payload = {"text": "synthetic person"}
    analyzer = SyntheticAnalyzer()
    engine = AnalysisCache(config())
    await engine.analyze_many([payload], context(), analyzer)
    redis = MemoryRedis()
    await engine.analyze_many([payload], context(redis_cache=redis), analyzer)
    assert analyzer.calls == 2
    await engine.analyze_many([payload], context(redis_cache=redis), analyzer)
    assert analyzer.calls == 2
    redis.fail = True
    for _ in range(2):
        await engine.analyze_many([payload], context(redis_cache=redis), analyzer)
    assert analyzer.calls == 4
    await engine.analyze_many([payload], context(), analyzer)
    assert analyzer.calls == 4
    configured = AnalysisCache(config(), redis)
    assert configured.backend == "redis"
    await configured.analyze_many([payload], context(), analyzer)
    assert not configured._local_store._entries


@pytest.mark.asyncio
async def test_local_concurrent_requests_singleflight_and_warm_reuse():
    engine = AnalysisCache(config())
    analyzer = SyntheticAnalyzer(delay=0.01)
    payloads = [{"text": "synthetic person"}]
    results = await asyncio.gather(*(engine.analyze_many(payloads, context(), analyzer) for _ in range(10)))
    assert all(result == results[0] for result in results)
    assert analyzer.calls == 1
    assert engine.counters["singleflight_shared"] == 9
    await engine.analyze_many(payloads, context(), analyzer)
    assert analyzer.calls == 1
    assert not _FLIGHTS[asyncio.get_running_loop()]


def test_local_configuration_from_environment(monkeypatch):
    monkeypatch.setenv("PRESIDIO_ANALYSIS_CACHE_LOCAL_MAX_ENTRIES", "17")
    monkeypatch.setenv("PRESIDIO_ANALYSIS_CACHE_LOCAL_MAX_BYTES", "8192")
    configured = AnalysisCacheConfig.from_env()
    assert configured.local_max_entries == 17
    assert configured.local_max_bytes == 8192
    monkeypatch.setenv("PRESIDIO_ANALYSIS_CACHE_LOCAL_MAX_ENTRIES", "invalid")
    assert AnalysisCacheConfig.from_env().enabled is False


def test_local_store_concurrent_threads_preserve_bounds_and_ttl():
    from concurrent.futures import ThreadPoolExecutor

    clock = SyntheticClock()
    engine = AnalysisCache(config(local_max_entries=8, local_max_bytes=2048), clock=clock)
    value = engine._encode([])

    def access(index):
        key = engine.cache_key({"text": "synthetic " + str(index)}, "team:synthetic")
        engine._local_store.write(((key, value),))
        assert engine._local_store.read((key,))[0] in (None, value)

    with ThreadPoolExecutor(max_workers=8) as executor:
        tuple(executor.map(access, range(200)))
    assert len(engine._local_store._entries) <= 8
    assert engine._local_store._bytes <= 2048
    assert engine._local_store._bytes == sum(entry[2] for entry in engine._local_store._entries.values())
    clock.now = 300.0
    engine._local_store.read(())
    assert engine._local_store._bytes == 0
    assert not engine._local_store._entries


def test_guardrail_cache_overrides_preserve_server_safety():
    inherited = config(enabled=False, ttl_seconds=123)
    assert inherited.with_guardrail_overrides() == inherited
    enabled = inherited.with_guardrail_overrides(True, 60)
    assert enabled.safe_to_enable and enabled.ttl_seconds == 60
    assert not enabled.with_guardrail_overrides(False).safe_to_enable
    for unsafe in (
        config(secret=""),
        config(complete_analysis_verified=False),
        config(key_version=""),
        config(analysis_version=""),
    ):
        assert not unsafe.with_guardrail_overrides(True, 60).safe_to_enable
    assert not enabled.with_guardrail_overrides().unavailable_reasons
    assert not config(enabled=False).unavailable_reasons


@pytest.mark.parametrize("value", [0, -1, 86401, True, "60", 1.5])
def test_guardrail_cache_ttl_validation(value):
    from pydantic import ValidationError
    from litellm.types.guardrails import LitellmParams

    with pytest.raises(ValueError, match="presidio_analysis_cache_ttl_seconds"):
        config().with_guardrail_overrides(ttl_seconds=value)
    with pytest.raises(ValidationError):
        LitellmParams(guardrail="presidio", mode="pre_call", presidio_analysis_cache_ttl_seconds=value)


@pytest.mark.parametrize("value", ["false", 1, 0])
def test_guardrail_cache_enabled_validation(value):
    from pydantic import ValidationError
    from litellm.types.guardrails import LitellmParams

    with pytest.raises(ValueError, match="presidio_analysis_cache_enabled"):
        config().with_guardrail_overrides(enabled=value)
    with pytest.raises(ValidationError):
        LitellmParams(guardrail="presidio", mode="pre_call", presidio_analysis_cache_enabled=value)
