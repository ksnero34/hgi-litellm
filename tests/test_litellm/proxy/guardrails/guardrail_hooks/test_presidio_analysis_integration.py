"""Real local HTTP pipeline tests; Redis and entity recognition are synthetic."""

import asyncio
import copy
import json
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

import pytest
from aiohttp import web

from litellm.exceptions import BlockedPiiEntityError
from litellm.proxy.guardrails.guardrail_hooks.presidio import _OPTIONAL_PresidioPIIMasking, _PresidioServiceError
from litellm.proxy.guardrails.guardrail_hooks.presidio_analysis_cache import AnalysisCache, AnalysisCacheConfig
from litellm.types.guardrails import LitellmParams, PiiAction


@dataclass
class SyntheticRedis:
    values: dict = field(default_factory=dict)
    reads: int = 0
    writes: int = 0
    unavailable: bool = False

    def init_async_client(self):
        return self

    def check_and_fix_namespace(self, key):
        return key

    def pipeline(self, transaction=False):
        return SyntheticPipeline(self)


class SyntheticPipeline:
    def __init__(self, redis):
        self.redis = redis
        self.commands = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    def get(self, key):
        self.commands.append(("get", key))
        return self

    def set(self, key, value, ex):
        self.commands.append(("set", key, value, ex))
        return self

    async def execute(self):
        if self.redis.unavailable:
            raise ConnectionError("synthetic Redis failure")
        results = []
        for command in self.commands:
            if command[0] == "get":
                self.redis.reads += 1
                stored = self.redis.values.get(command[1])
                results.append(stored[0] if stored and stored[1] > time.monotonic() else None)
            else:
                self.redis.writes += 1
                self.redis.values[command[1]] = (command[2], time.monotonic() + command[3])
                results.append(True)
        return results


@dataclass
class SyntheticPresidio:
    payloads: list = field(default_factory=list)
    anonymize_calls: int = 0
    active: int = 0
    peak: int = 0
    combined_active: int = 0
    combined_peak: int = 0
    delay: float = 0.015
    status: int = 200

    async def analyze(self, request):
        payload = await request.json()
        self.payloads.append(payload)
        self.active += 1
        self.combined_active += 1
        self.combined_peak = max(self.combined_peak, self.combined_active)
        self.peak = max(self.peak, self.active)
        try:
            await asyncio.sleep(self.delay)
            text = payload["text"]
            index = text.find("홍길동")
            entities = (
                []
                if index < 0
                else [
                    {
                        "start": index,
                        "end": index + 3,
                        "entity_type": "PERSON",
                        "score": 0.99,
                        "analysis_explanation": {"textual_explanation": "홍길동 synthetic secret"},
                    }
                ]
            )
            return web.json_response(entities, status=self.status)
        finally:
            self.active -= 1
            self.combined_active -= 1

    async def anonymize(self, request):
        self.anonymize_calls += 1
        payload = await request.json()
        self.combined_active += 1
        self.combined_peak = max(self.combined_peak, self.combined_active)
        try:
            await asyncio.sleep(self.delay)
            text = payload["text"]
            items = []
            for entity in sorted(payload["analyzer_results"], key=lambda item: item["start"], reverse=True):
                replacement = "<" + entity["entity_type"] + ">"
                text = text[: entity["start"]] + replacement + text[entity["end"] :]
                items.append(
                    {
                        "start": entity["start"],
                        "end": entity["start"] + len(replacement),
                        "entity_type": entity["entity_type"],
                        "text": replacement,
                        "operator": "replace",
                    }
                )
            return web.json_response({"text": text, "items": items})
        finally:
            self.combined_active -= 1


@asynccontextmanager
async def local_presidio():
    server = SyntheticPresidio()
    app = web.Application()
    app.router.add_post("/analyze", server.analyze)
    app.router.add_post("/anonymize", server.anonymize)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    try:
        yield server, f"http://127.0.0.1:{port}"
    finally:
        await runner.cleanup()


def cache_for(redis, enabled=True):
    return AnalysisCache(
        AnalysisCacheConfig(
            enabled=enabled,
            complete_analysis_verified=True,
            secret="synthetic-secret-for-tests-only-32-bytes",
            key_version="k1",
            analysis_version="synthetic-v1",
        ),
        redis,
    )


def guardrail_for(url, cache, action=PiiAction.MASK):
    return _OPTIONAL_PresidioPIIMasking(
        presidio_analyzer_api_base=url,
        presidio_anonymizer_api_base=url,
        guardrail_name="synthetic-presidio",
        output_parse_pii=True,
        pii_entities_config={"PERSON": action},
        presidio_language="ko",
        presidio_max_parallel_requests=2,
        presidio_analysis_cache=cache,
    )


@asynccontextmanager
async def tenant_request(tenant="team:synthetic", **kwargs):
    from litellm.proxy.guardrails.guardrail_hooks.presidio_analysis_context import analysis_request_scope

    with analysis_request_scope(tenant_scope=tenant, max_concurrency=2, **kwargs) as context:
        yield context


@pytest.mark.asyncio
async def test_guardrail_cache_settings_control_live_http_reuse(monkeypatch):
    monkeypatch.setenv("PRESIDIO_ANALYSIS_CACHE_ENABLED", "false")
    monkeypatch.setenv("PRESIDIO_ANALYSIS_CACHE_COMPLETE_ANALYSIS_VERIFIED", "true")
    monkeypatch.setenv("PRESIDIO_ANALYSIS_CACHE_HMAC_SECRET", "synthetic-gui-test-secret-at-least-32-bytes")
    monkeypatch.setenv("PRESIDIO_ANALYSIS_CACHE_KEY_VERSION", "test-k1")
    monkeypatch.setenv("PRESIDIO_ANALYSIS_CACHE_ANALYSIS_VERSION", "synthetic-gui-v1")
    monkeypatch.setenv("PRESIDIO_ANALYSIS_CACHE_TTL_SECONDS", "300")

    async with local_presidio() as (server, url):
        guardrail = _OPTIONAL_PresidioPIIMasking(
            presidio_analyzer_api_base=url,
            presidio_anonymizer_api_base=url,
            guardrail_name="synthetic-gui-presidio",
            pii_entities_config={"PERSON": PiiAction.MASK},
            presidio_analysis_cache_enabled=True,
            presidio_analysis_cache_ttl_seconds=17,
        )

        async def inspect_twice():
            for _ in range(2):
                data = {"metadata": {}}
                async with tenant_request():
                    result = await guardrail.apply_guardrail({"texts": ["홍길동"]}, data, "request")
                assert result["texts"] == ["<PERSON>"]
                assert len(data["metadata"]["standard_logging_guardrail_information"]) == 1

        try:
            await inspect_twice()
            assert len(server.payloads) == 1
            assert guardrail._analysis_cache.config.ttl_seconds == 17

            guardrail.update_in_memory_litellm_params(
                LitellmParams(
                    guardrail="presidio",
                    mode="pre_call",
                    presidio_analysis_cache_enabled=False,
                    presidio_analysis_cache_ttl_seconds=17,
                )
            )
            await inspect_twice()
            assert len(server.payloads) == 3

            monkeypatch.setenv("PRESIDIO_ANALYSIS_CACHE_ENABLED", "true")
            guardrail.update_in_memory_litellm_params(
                LitellmParams(
                    guardrail="presidio",
                    mode="pre_call",
                    presidio_analysis_cache_enabled=None,
                    presidio_analysis_cache_ttl_seconds=None,
                )
            )
            await inspect_twice()
            assert len(server.payloads) == 4
            assert guardrail._analysis_cache.config.ttl_seconds == 300
            assert server.anonymize_calls == 6
        finally:
            await guardrail._close_http_session()


@pytest.mark.asyncio
async def test_http_cache_hit_preserves_mask_restore_sources_audit_and_offsets():
    text = "🙂\r\n  홍길동  끝"
    redis = SyntheticRedis()
    async with local_presidio() as (server, url):
        cold = guardrail_for(url, cache_for(redis))
        warm = guardrail_for(url, cache_for(redis))
        off = guardrail_for(url, cache_for(redis, enabled=False))
        try:
            outcomes = []
            for guardrail, expected_status in ((cold, "miss"), (warm, "hit"), (off, "miss")):
                data = {"metadata": {}}
                async with tenant_request():
                    masked = await guardrail.apply_guardrail(
                        {
                            "texts": [text],
                            "text_sources": [
                                {"type": "message", "path": "messages[0].content", "scope": "current_user_prompt"}
                            ],
                        },
                        data,
                        "request",
                    )
                assert masked["texts"] == ["🙂\r\n  <PERSON_1>  끝"]
                metadata = data["metadata"]
                assert metadata["pii_tokens"] == {"<PERSON_1>": "홍길동"}
                assert metadata["pii_token_sources"]["<PERSON_1>"]["path"] == "messages[0].content"
                assert len(metadata["standard_logging_guardrail_information"]) == 1
                assert metadata["standard_logging_guardrail_information"][0]["analysis_cache"] == {
                    "status": expected_status,
                    "hit_count": int(expected_status == "hit"),
                    "total_count": 1,
                }
                restored = await guardrail.apply_guardrail({"texts": masked["texts"]}, data, "response")
                assert restored["texts"] == [text]
                outcomes.append(copy.deepcopy(metadata["pii_tokens"]))
            assert outcomes[0] == outcomes[1] == outcomes[2]
            assert len(server.payloads) == 2
            assert server.anonymize_calls == 3
            assert warm._analysis_cache.counters["cache_hit"] == 1
            serialized = json.dumps(redis.values, ensure_ascii=False)
            assert "홍길동" not in serialized
            assert "explanation" not in serialized
            assert "pii_tokens" not in serialized
        finally:
            for guardrail in (cold, warm, off):
                await guardrail._close_http_session()


@pytest.mark.asyncio
async def test_repeated_fragments_across_apply_and_tool_arguments_are_deduped():
    redis = SyntheticRedis()
    async with local_presidio() as (server, url):
        guardrail = guardrail_for(url, cache_for(redis))
        try:
            data = {"metadata": {}}
            async with tenant_request() as context:
                first = await guardrail.apply_guardrail({"texts": ["홍길동", "홍길동"]}, data, "request")
                second = await guardrail.apply_guardrail(
                    {
                        "texts": ["홍길동"],
                        "tool_calls": [{"function": {"name": "synthetic", "arguments": "홍길동"}}],
                    },
                    data,
                    "request",
                )
                assert len(server.payloads) == 1
                assert redis.reads == 1
                assert first["texts"] == ["<PERSON_1>", "<PERSON_2>"]
                assert "홍길동" not in str(second)
                assert len(data["metadata"]["pii_tokens"]) == 4
                assert len(data["metadata"]["standard_logging_guardrail_information"]) == 4
                assert all(
                    entry["analysis_cache"] == {"status": "miss", "hit_count": 0, "total_count": 1}
                    for entry in data["metadata"]["standard_logging_guardrail_information"]
                )
            assert not context.results
            assert not context.cache_hits
            assert not context.pending
            next_data = {"metadata": {}}
            async with tenant_request():
                await guardrail.apply_guardrail({"texts": ["홍길동"]}, next_data, "request")
            assert next_data["metadata"]["pii_tokens"] == {"<PERSON_1>": "홍길동"}
        finally:
            await guardrail._close_http_session()


@pytest.mark.asyncio
async def test_hit_rechecks_current_block_policy():
    redis = SyntheticRedis()
    async with local_presidio() as (server, url):
        masking = guardrail_for(url, cache_for(redis))
        blocking = guardrail_for(url, cache_for(redis), PiiAction.BLOCK)
        try:
            async with tenant_request():
                await masking.apply_guardrail({"texts": ["홍길동"]}, {"metadata": {}}, "request")
            data = {"metadata": {}}
            async with tenant_request():
                with pytest.raises(BlockedPiiEntityError):
                    await blocking.apply_guardrail({"texts": ["홍길동"]}, data, "request")
            assert len(server.payloads) == 1
            entries = data["metadata"]["standard_logging_guardrail_information"]
            assert entries[-1]["guardrail_status"] == "guardrail_intervened"
        finally:
            await masking._close_http_session()
            await blocking._close_http_session()


@pytest.mark.asyncio
async def test_untrusted_metadata_tenant_does_not_enable_shared_cache():
    redis = SyntheticRedis()
    async with local_presidio() as (server, url):
        guardrail = guardrail_for(url, cache_for(redis))
        try:
            for _ in range(2):
                data = {"metadata": {"tenant": "team:synthetic", "team_id": "synthetic"}}
                async with tenant_request(None):
                    await guardrail.apply_guardrail({"texts": ["홍길동"]}, data, "request")
            assert len(server.payloads) == 2
            assert redis.reads == redis.writes == 0
        finally:
            await guardrail._close_http_session()


@pytest.mark.asyncio
async def test_real_http_session_parallelism_is_bounded_across_apply_calls():
    async with local_presidio() as (server, url):
        guardrail = guardrail_for(url, cache_for(SyntheticRedis(), enabled=False))
        try:
            async with tenant_request():
                await asyncio.gather(
                    *(
                        guardrail.apply_guardrail(
                            {"texts": [f"synthetic {i}-{j}" for j in range(3)]}, {"metadata": {}}, "request"
                        )
                        for i in range(3)
                    )
                )
            assert len(server.payloads) == 9
            assert server.peak == 2
        finally:
            await guardrail._close_http_session()


@pytest.mark.asyncio
async def test_redis_failure_falls_back_and_http_failure_is_not_cached():
    redis = SyntheticRedis(unavailable=True)
    async with local_presidio() as (server, url):
        guardrail = guardrail_for(url, cache_for(redis))
        try:
            async with tenant_request():
                result = await guardrail.apply_guardrail({"texts": ["홍길동"]}, {"metadata": {}}, "request")
            assert result["texts"] == ["<PERSON_1>"]
            redis.unavailable = False
            server.status = 503
            async with tenant_request():
                with pytest.raises(_PresidioServiceError):
                    await guardrail.apply_guardrail({"texts": ["홍길동"]}, {"metadata": {}}, "request")
            assert not redis.values
            server.status = 200
            async with tenant_request():
                result = await guardrail.apply_guardrail({"texts": ["홍길동"]}, {"metadata": {}}, "request")
            assert result["texts"] == ["<PERSON_1>"]
            assert len(server.payloads) == 3
        finally:
            await guardrail._close_http_session()


@pytest.mark.asyncio
async def test_deadline_includes_http_queue_and_cancelled_analysis_is_not_cached():
    from litellm.proxy.guardrails.guardrail_hooks.presidio import _PresidioServiceError

    redis = SyntheticRedis()
    async with local_presidio() as (server, url):
        server.delay = 0.25
        guardrail = guardrail_for(url, cache_for(redis))
        try:
            started = time.monotonic()
            async with tenant_request() as context:
                context.deadline = started + 0.04
                with pytest.raises(_PresidioServiceError):
                    await guardrail.apply_guardrail(
                        {"texts": [f"홍길동 {index}" for index in range(8)]}, {"metadata": {}}, "request"
                    )
            assert time.monotonic() - started < 0.20
            assert not redis.values
            assert not context.pending
            assert not context.results
            assert len(server.payloads) <= 2
            await asyncio.sleep(0.26)
            server.delay = 0.001
            async with tenant_request():
                result = await guardrail.apply_guardrail({"texts": ["홍길동 0"]}, {"metadata": {}}, "request")
            assert result["texts"] == ["<PERSON_1> 0"]
        finally:
            await guardrail._close_http_session()


@pytest.mark.asyncio
async def test_native_chat_authenticated_team_and_effective_language_separate_cache():
    from litellm.caching.caching import DualCache
    from litellm.proxy._types import UserAPIKeyAuth

    redis = SyntheticRedis()
    async with local_presidio() as (server, url):
        guardrail = _OPTIONAL_PresidioPIIMasking(
            presidio_analyzer_api_base=url,
            presidio_anonymizer_api_base=url,
            guardrail_name="synthetic-presidio",
            default_on=True,
            event_hook="pre_call",
            output_parse_pii=True,
            presidio_language="ko",
            presidio_analysis_cache=cache_for(redis),
        )
        try:
            for team, language in (
                ("synthetic-a", "ko"),
                ("synthetic-a", "ko"),
                ("synthetic-b", "ko"),
                ("synthetic-a", "en"),
            ):
                data = {
                    "messages": [
                        {"role": "user", "content": "홍길동"},
                        {"role": "assistant", "content": [{"type": "text", "text": "홍길동"}]},
                    ],
                    "metadata": {"guardrail_config": {"language": language}, "team_id": "client-forged"},
                }
                await guardrail.async_pre_call_hook(UserAPIKeyAuth(team_id=team), DualCache(), data, "completion")
                assert "홍길동" not in str(data["messages"])
                assert len(data["metadata"]["pii_tokens"]) == 2
                assert len(data["metadata"]["standard_logging_guardrail_information"]) == 2
            assert len(server.payloads) == 3
            assert [payload["language"] for payload in server.payloads] == ["ko", "ko", "en"]
        finally:
            await guardrail._close_http_session()


@pytest.mark.asyncio
async def test_responses_instructions_blocks_and_function_arguments_share_context():
    from litellm.llms.openai.responses.guardrail_translation.handler import OpenAIResponsesHandler

    redis = SyntheticRedis()
    async with local_presidio() as (server, url):
        guardrail = guardrail_for(url, cache_for(redis))
        try:
            data = {
                "instructions": "홍길동",
                "metadata": {"guardrail_config": {"language": "en"}},
                "input": [
                    {"role": "user", "content": [{"type": "input_text", "text": "홍길동"}]},
                    {"type": "function_call", "call_id": "synthetic-call", "name": "synthetic", "arguments": "홍길동"},
                ],
            }
            async with tenant_request():
                result = await OpenAIResponsesHandler().process_input_messages(data, guardrail)
            assert "홍길동" not in str(result["input"])
            assert "홍길동" not in result["instructions"]
            assert len(server.payloads) == 1
            assert server.payloads[0]["language"] == "ko"
            assert len(data["metadata"]["standard_logging_guardrail_information"]) == 3
            assert redis.reads == 1
        finally:
            await guardrail._close_http_session()


@pytest.mark.asyncio
async def test_native_configured_one_limits_larger_outer_request_context():
    from litellm.caching.caching import DualCache
    from litellm.proxy._types import UserAPIKeyAuth
    from litellm.proxy.guardrails.guardrail_hooks.presidio_analysis_context import analysis_request_scope

    async with local_presidio() as (server, url):
        guardrail = _OPTIONAL_PresidioPIIMasking(
            presidio_analyzer_api_base=url,
            presidio_anonymizer_api_base=url,
            guardrail_name="synthetic-presidio",
            default_on=True,
            event_hook="pre_call",
            presidio_max_parallel_requests=1,
            presidio_analysis_cache=cache_for(SyntheticRedis(), False),
        )
        try:
            with analysis_request_scope(tenant_scope="team:synthetic", max_concurrency=8):
                await guardrail.async_pre_call_hook(
                    UserAPIKeyAuth(team_id="synthetic"),
                    DualCache(),
                    {
                        "messages": [{"role": "user", "content": f"synthetic {index}"} for index in range(5)],
                        "metadata": {},
                    },
                    "completion",
                )
            assert len(server.payloads) == 5
            assert server.peak == 1
        finally:
            await guardrail._close_http_session()


@pytest.mark.asyncio
async def test_preparation_failure_records_each_fragment_audit():
    from litellm.proxy.guardrails.guardrail_hooks.presidio import _PresidioServiceError

    async with local_presidio() as (server, url):
        server.status = 503
        guardrail = guardrail_for(url, cache_for(SyntheticRedis()))
        data = {"metadata": {}}
        try:
            async with tenant_request():
                with pytest.raises(_PresidioServiceError):
                    await guardrail.apply_guardrail({"texts": ["홍길동", "홍길동", "synthetic"]}, data, "request")
            entries = data["metadata"]["standard_logging_guardrail_information"]
            assert len(entries) == 3
            assert [entry["input_source"]["path"] for entry in entries] == ["texts[0]", "texts[1]", "texts[2]"]
            assert all(entry["guardrail_status"] == "guardrail_failed_to_respond" for entry in entries)
            assert entries[0]["shared_analysis"] == entries[1]["shared_analysis"]
            assert entries[0]["shared_analysis"] == {
                "start_time": entries[0]["start_time"],
                "end_time": entries[0]["end_time"],
            }
            assert "홍길동" not in json.dumps(entries, ensure_ascii=False)
        finally:
            await guardrail._close_http_session()


@pytest.mark.asyncio
async def test_independently_cancelled_fragment_propagates_without_returning_partial_results():
    async with local_presidio() as (_, url):
        guardrail = guardrail_for(url, cache_for(SyntheticRedis(), False))

        async def cancelled_fragment():
            raise asyncio.CancelledError()

        async def successful_fragment():
            return "synthetic"

        try:
            with pytest.raises(asyncio.CancelledError):
                await guardrail._bounded_checks([cancelled_fragment(), successful_fragment(), successful_fragment()])
        finally:
            await guardrail._close_http_session()


@pytest.mark.asyncio
async def test_shared_http_limit_covers_analyze_and_anonymize_across_concurrent_applies():
    from litellm.proxy.guardrails.guardrail_hooks.presidio_analysis_context import analysis_request_scope

    async with local_presidio() as (server, url):
        guardrail = _OPTIONAL_PresidioPIIMasking(
            presidio_analyzer_api_base=url,
            presidio_anonymizer_api_base=url,
            guardrail_name="synthetic-presidio",
            output_parse_pii=True,
            presidio_max_parallel_requests=1,
            presidio_analysis_cache=cache_for(SyntheticRedis(), False),
        )
        try:
            with analysis_request_scope(tenant_scope="team:synthetic", max_concurrency=8):
                results = await asyncio.gather(
                    *(
                        guardrail.apply_guardrail(
                            {"texts": [f"홍길동 {index}-{fragment}" for fragment in range(2)]},
                            {"metadata": {}},
                            "request",
                        )
                        for index in range(2)
                    )
                )
            assert len(server.payloads) == 4
            assert server.anonymize_calls == 4
            assert server.combined_peak == 1
            assert server.combined_active == 0
            assert all("홍길동" not in str(result) for result in results)
            assert all(len(result["texts"]) == 2 for result in results)
        finally:
            await guardrail._close_http_session()


@pytest.mark.asyncio
async def test_cache_audit_mixed_chunks_concurrent_requests_and_direct_check():
    async with local_presidio() as (server, url):
        guardrail = guardrail_for(url, cache_for(None))
        guardrail.presidio_analyze_chunk_size_bytes = 24
        text = "abcdefghij " * 8
        chunks = guardrail._analysis_text_chunks(text)
        unique_chunks = tuple(dict.fromkeys(chunk for _, chunk in chunks))
        assert len(unique_chunks) > 1
        try:
            async with tenant_request():
                await guardrail.analyze_text(unique_chunks[0], None, {})

            async def run(tenant, value):
                data = {"metadata": {}}
                async with tenant_request(tenant=tenant):
                    await guardrail.apply_guardrail({"texts": [value]}, data, "request")
                return data["metadata"]["standard_logging_guardrail_information"][0]["analysis_cache"]

            mixed, other_tenant = await asyncio.gather(run("team:synthetic", text), run("team:other", text))
            assert mixed == {"status": "partial", "hit_count": 1, "total_count": len(unique_chunks)}
            assert other_tenant == {"status": "miss", "hit_count": 0, "total_count": len(unique_chunks)}
            assert await run("team:synthetic", text) == {
                "status": "hit",
                "hit_count": len(unique_chunks),
                "total_count": len(unique_chunks),
            }
            direct = {"metadata": {}}
            await guardrail.check_pii("uncached direct call", True, None, direct)
            assert direct["metadata"]["standard_logging_guardrail_information"][0]["analysis_cache"] == {
                "status": "miss",
                "hit_count": 0,
                "total_count": 1,
            }
            blank = {"metadata": {}}
            await guardrail.check_pii("  ", True, None, blank)
            assert "analysis_cache" not in blank["metadata"]["standard_logging_guardrail_information"][0]
        finally:
            await guardrail._close_http_session()


@pytest.mark.asyncio
async def test_prefetch_failure_cache_audit_is_scoped_to_each_text():
    async with local_presidio() as (server, url):
        guardrail = guardrail_for(url, cache_for(None))
        try:
            async with tenant_request():
                await guardrail.analyze_text("cached plain text", None, {})
            server.status = 503
            data = {"metadata": {}}
            async with tenant_request():
                with pytest.raises(_PresidioServiceError):
                    await guardrail.apply_guardrail(
                        {"texts": ["cached plain text", "uncached plain text"]}, data, "request"
                    )
            entries = data["metadata"]["standard_logging_guardrail_information"]
            assert len(entries) == 2
            assert all(entry["guardrail_status"] == "guardrail_failed_to_respond" for entry in entries)
            assert entries[0]["analysis_cache"] == {"status": "hit", "hit_count": 1, "total_count": 1}
            assert entries[1]["analysis_cache"] == {"status": "miss", "hit_count": 0, "total_count": 1}
        finally:
            await guardrail._close_http_session()


@pytest.mark.asyncio
@pytest.mark.parametrize("native", [False, True])
async def test_shared_analysis_interval_precedes_fragment_checks_and_is_request_scoped(native):
    from typing import Final

    from litellm.caching.caching import DualCache
    from litellm.proxy._types import UserAPIKeyAuth

    async with local_presidio() as (_, url):
        guardrail: Final = guardrail_for(url, cache_for(None))
        data: Final = {
            "metadata": {},
            "guardrails": ["synthetic-presidio"],
            "messages": [
                {"role": "user", "content": "first plain message"},
                {"role": "user", "content": "second plain message"},
            ],
        }
        try:
            async with tenant_request() as context:
                if native:
                    await guardrail.async_pre_call_hook(
                        UserAPIKeyAuth(team_id="synthetic"), DualCache(), data, "completion"
                    )
                else:
                    await guardrail.apply_guardrail(
                        {"texts": ["first plain message", "second plain message"]}, data, "request"
                    )
                entries: Final = data["metadata"]["standard_logging_guardrail_information"]
                shared: Final = entries[0]["shared_analysis"]
                assert len(entries) == 2
                assert all(entry["shared_analysis"] == shared for entry in entries)
                assert shared["start_time"] < shared["end_time"]
                assert all(shared["end_time"] <= entry["start_time"] <= entry["end_time"] for entry in entries)
                assert context.shared_analysis[entries[0]["guardrail_run_id"]] == shared
            assert context.shared_analysis == {}
        finally:
            await guardrail._close_http_session()
