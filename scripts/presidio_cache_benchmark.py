"""Isolated real Redis and synthetic local HTTP validation; never contacts an LLM."""

import argparse
import asyncio
import json
import os
import shutil
import socket
import statistics
import subprocess
import sys
import tempfile
import time
from collections import Counter
from pathlib import Path
from typing import Final

import redis.asyncio as redis
from aiohttp import web

from litellm.caching.redis_cache import RedisCache
from litellm.proxy.guardrails.guardrail_hooks.presidio import _OPTIONAL_PresidioPIIMasking
from litellm.proxy.guardrails.guardrail_hooks.presidio_analysis_cache import (
    AnalysisCache,
    AnalysisCacheConfig,
    RequestAnalysisContext,
)


def unused_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


async def benchmark(binary: str, repetitions: int) -> dict:
    port: Final = unused_port()
    with tempfile.TemporaryDirectory(prefix="presidio-redis-") as directory:
        process: Final = subprocess.Popen(
            [
                binary,
                "--bind",
                "127.0.0.1",
                "--port",
                str(port),
                "--save",
                "",
                "--appendonly",
                "no",
                "--dir",
                directory,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        client: Final = redis.Redis(host="127.0.0.1", port=port)
        runner: Final = web.AppRunner(web.Application())
        adapters: Final = []
        guards: Final = []
        state: Final = Counter()
        try:
            for attempt in range(100):
                try:
                    await client.ping()
                    break
                except redis.ConnectionError:
                    if process.poll() is not None:
                        raise RuntimeError("Isolated redis-server failed to start") from None
                    await asyncio.sleep(0.02)
            else:
                raise RuntimeError("Isolated Redis startup deadline exceeded")

            server_info: Final = await client.info("server")

            async def analyze(request: web.Request) -> web.Response:
                payload: Final = await request.json()
                assert isinstance(payload, dict)
                state["calls"] += 1
                state["active"] += 1
                state["maximum"] = max(state["maximum"], state["active"])
                try:
                    await asyncio.sleep(0.02)
                    start: Final = payload["text"].index("가상인")
                    return web.json_response(
                        [{"start": start, "end": start + 3, "entity_type": "PERSON", "score": 0.98}]
                    )
                finally:
                    state["active"] -= 1

            runner.app.router.add_post("/analyze", analyze)
            await runner.setup()
            http_port: Final = unused_port()
            await web.TCPSite(runner, "127.0.0.1", http_port).start()
            config: Final = AnalysisCacheConfig(
                enabled=True,
                complete_analysis_verified=True,
                secret="synthetic-test-only-secret-32-bytes-long",
                key_version="test-k1",
                analysis_version="synthetic-delay-v1",
                ttl_seconds=300,
            )
            for _ in range(2):
                adapters.append(RedisCache(host="127.0.0.1", port=port, socket_timeout=0.1))
                guard: Final = _OPTIONAL_PresidioPIIMasking(mock_testing=True)
                guard.presidio_analyzer_api_base = f"http://127.0.0.1:{http_port}/"
                guards.append(guard)
            engines: Final = tuple(AnalysisCache(config, adapter) for adapter in adapters)
            payloads: Final = tuple(
                {"text": f"합성 {number} 😀\r\n  가상인 테스트", "language": "ko"} for number in range(8)
            )
            output: Final = {}

            async def run_request(engine: AnalysisCache, guard: _OPTIONAL_PresidioPIIMasking) -> float:
                context: Final = RequestAnalysisContext(time.monotonic() + 10, "team:synthetic", 4)
                started: Final = time.perf_counter()
                try:
                    first: Final = await engine.analyze_many(payloads + payloads, context, guard._analyze_payload)
                    again: Final = await engine.analyze_many(payloads, context, guard._analyze_payload)
                    assert first[:8] == first[8:] == again
                    assert all(
                        payloads[i]["text"][items[0]["start"] : items[0]["end"]] == "가상인"
                        for i, items in enumerate(again)
                    )
                    return (time.perf_counter() - started) * 1000
                finally:
                    context.clear()
                    assert not context.results and not context.pending and context.tenant_scope is None

            for mode in ("cold", "warm_other_instance", "redis_failure"):
                samples: Final = []
                before: Final = state["calls"]
                state["maximum"] = 0
                if mode == "redis_failure":
                    process.terminate()
                    process.wait(timeout=5)
                for _ in range(repetitions):
                    if mode == "cold":
                        await client.flushdb()
                    samples.append(
                        await run_request(engines[0 if mode == "cold" else 1], guards[0 if mode == "cold" else 1])
                    )
                ordered: Final = sorted(samples)
                output[mode] = {
                    "requests": repetitions,
                    "p50_ms": round(statistics.median(samples), 3),
                    "p95_ms": round(ordered[max(0, (95 * len(ordered) + 99) // 100 - 1)], 3),
                    "analyze_calls": state["calls"] - before,
                    "max_active_http": state["maximum"],
                }
                assert output[mode]["analyze_calls"] == (0 if mode == "warm_other_instance" else repetitions * 8)
                assert output[mode]["max_active_http"] <= 4
                if mode == "cold":
                    keys: Final = await client.keys("pii:analysis:*")
                    assert len(keys) == 8
                    records: Final = await client.mget(keys)
                    for key, raw in zip(keys, records):
                        assert await client.ttl(key) > 0
                        record: Final = json.loads(raw)
                        assert set(record) == {"schema_version", "analysis_version", "entities"}
                        assert set(record["entities"][0]) == {"start", "end", "entity_type", "score"}
                        assert "가상인" not in raw.decode() and "team:synthetic" not in key.decode()
            output["conditions"] = {
                "synthetic_http_delay_ms": 20,
                "unique_fragments": 8,
                "fragment_positions": 16,
                "additional_apply_equivalent_fragments": 8,
                "request_concurrency": 1,
                "analysis_concurrency": 4,
                "redis_version": server_info["redis_version"],
                "real_ner": False,
            }
            output["counters"] = [dict(engine.counters) for engine in engines]
            return output
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
            for guard in guards:
                await guard._close_http_session()
            for adapter in adapters:
                await adapter.disconnect()
            await runner.cleanup()
            await client.aclose()


async def local_benchmark(repetitions: int) -> dict:
    from litellm.proxy.guardrails.guardrail_hooks.presidio_analysis_context import analysis_request_scope
    from litellm.types.guardrails import PiiAction

    state: Final = Counter()

    async def analyze(request: web.Request) -> web.Response:
        payload: Final = await request.json()
        state["analyze_calls"] += 1
        await asyncio.sleep(0.02)
        start: Final = payload["text"].index("가상인")
        return web.json_response([{"start": start, "end": start + 3, "entity_type": "PERSON", "score": 0.98}])

    async def anonymize(request: web.Request) -> web.Response:
        await request.json()
        state["anonymize_calls"] += 1
        return web.json_response({"text": "<PERSON>", "items": [{"entity_type": "PERSON"}]})

    app: Final = web.Application()
    app.router.add_post("/analyze", analyze)
    app.router.add_post("/anonymize", anonymize)
    runner: Final = web.AppRunner(app)
    await runner.setup()
    port: Final = unused_port()
    await web.TCPSite(runner, "127.0.0.1", port).start()
    engine: Final = AnalysisCache(
        AnalysisCacheConfig(
            enabled=True,
            complete_analysis_verified=True,
            secret="synthetic-test-only-secret-32-bytes-long",
            key_version="local-test-k1",
            analysis_version="synthetic-local-v1",
            ttl_seconds=1,
        )
    )
    guard: Final = _OPTIONAL_PresidioPIIMasking(
        presidio_analyzer_api_base=f"http://127.0.0.1:{port}/",
        presidio_anonymizer_api_base=f"http://127.0.0.1:{port}/",
        presidio_analysis_cache=engine,
        presidio_language="ko",
        pii_entities_config={"PERSON": PiiAction.MASK},
        output_parse_pii=True,
    )

    async def request(text: str) -> float:
        data: Final = {"metadata": {}}
        started: Final = time.perf_counter()
        with analysis_request_scope(tenant_scope="team:synthetic-local"):
            masked: Final = await guard.apply_guardrail(
                {
                    "texts": [text, text],
                    "text_sources": [
                        {"type": "message", "path": "messages[0].content", "scope": "current_user_prompt"},
                        {"type": "message", "path": "messages[1].content", "scope": "current_user_prompt"},
                    ],
                },
                data,
                "request",
            )
            assert all("가상인" not in item for item in masked["texts"])
            restored: Final = await guard.apply_guardrail({"texts": masked["texts"]}, data, "response")
            assert restored["texts"] == [text, text]
            assert len(data["metadata"]["standard_logging_guardrail_information"]) == 2
        return (time.perf_counter() - started) * 1000

    try:
        output: Final = {}
        for mode in ("local_cold", "local_warm"):
            before: Final = state["analyze_calls"]
            samples: Final = tuple(
                [
                    await request(f"합성 {index if mode == 'local_cold' else repetitions - 1} 😀\r\n  가상인")
                    for index in range(repetitions)
                ]
            )
            ordered: Final = sorted(samples)
            calls: Final = state["analyze_calls"] - before
            assert calls == (repetitions if mode == "local_cold" else 0)
            output[mode] = {
                "requests": repetitions,
                "p50_ms": round(statistics.median(samples), 3),
                "p95_ms": round(ordered[(95 * len(ordered) + 99) // 100 - 1], 3),
                "analyze_calls": calls,
            }
        before_expiry: Final = state["analyze_calls"]
        await asyncio.sleep(1.05)
        await request(f"합성 {repetitions - 1} 😀\r\n  가상인")
        assert state["analyze_calls"] == before_expiry + 1
        output["after_ttl_analyze_calls"] = 1
        output["conditions"] = {
            "redis_configured": False,
            "redis_process_started": False,
            "real_ner": False,
            "synthetic_http_delay_ms": 20,
            "ttl_seconds": 1,
            "fragments_per_request": 2,
        }
        output["mask_restore_audit_verified"] = True
        output["counters"] = dict(engine.counters)
        output["http_calls"] = dict(state)
        return output
    finally:
        await guard._close_http_session()
        await runner.cleanup()


def main() -> None:
    parser: Final = argparse.ArgumentParser()
    parser.add_argument("--redis-server", default=shutil.which("redis-server"))
    parser.add_argument(
        "--local", action="store_true", help="Verify local fallback without starting or configuring Redis"
    )
    parser.add_argument("--repetitions", type=int, default=20)
    parser.add_argument("--output")
    options: Final = parser.parse_args()
    if (not options.local and not options.redis_server) or options.repetitions < 2:
        parser.error("A working redis-server binary and at least 2 repetitions are required")
    os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")
    result: Final = asyncio.run(
        local_benchmark(options.repetitions) if options.local else benchmark(options.redis_server, options.repetitions)
    )
    rendered: Final = json.dumps(result, indent=2, ensure_ascii=False)
    if options.output:
        Path(options.output).write_text(rendered + "\n")
    sys.stdout.write(rendered + "\n")


if __name__ == "__main__":
    main()
