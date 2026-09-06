import asyncio
from contextlib import asynccontextmanager
from unittest.mock import patch

import pytest
from aiohttp import web

from litellm.proxy.guardrails.guardrail_hooks.presidio import (
    _OPTIONAL_PresidioPIIMasking,
    _PresidioServiceError,
)
from litellm.proxy.guardrails.guardrail_hooks.presidio_http import PROCESS_ADMISSION


@asynccontextmanager
async def server(handler):
    app = web.Application()
    app.router.add_post("/analyze", handler)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    base = f"http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}/"
    guard = _OPTIONAL_PresidioPIIMasking(
        presidio_analyzer_api_base=base,
        presidio_anonymizer_api_base=base,
    )
    try:
        yield guard
    finally:
        await guard._close_http_session()
        await runner.cleanup()


@pytest.mark.asyncio
async def test_real_http_parallelism_shared_process_limit():
    active = 0
    peak = 0

    async def analyze(request):
        nonlocal active, peak
        await request.json()
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.025)
        active -= 1
        return web.json_response([])

    with patch.dict("os.environ", {"PRESIDIO_HTTP_MAX_CONCURRENCY": "3"}):
        async with server(analyze) as guard:
            other = _OPTIONAL_PresidioPIIMasking(
                presidio_analyzer_api_base=guard.presidio_analyzer_api_base,
                presidio_anonymizer_api_base=guard.presidio_analyzer_api_base,
            )
            try:
                results = await asyncio.gather(
                    *(
                        (guard if i % 2 else other)._analyze_payload({"text": f"synthetic {i}", "language": "en"})
                        for i in range(12)
                    )
                )
                assert results == [[]] * 12
                assert peak == 3
            finally:
                await other._close_http_session()
    assert PROCESS_ADMISSION.active == PROCESS_ADMISSION.waiting == 0


@pytest.mark.asyncio
async def test_close_retires_session_without_interrupting_http():
    started = asyncio.Event()
    release = asyncio.Event()

    async def analyze(request):
        started.set()
        await release.wait()
        return web.json_response([])

    async with server(analyze) as guard:
        task = asyncio.create_task(guard._analyze_payload({"text": "synthetic"}))
        await asyncio.wait_for(started.wait(), 1)
        session = guard._http_session
        await guard._close_http_session()
        assert not session.closed
        release.set()
        assert await asyncio.wait_for(task, 1) == []
        assert session.closed
        assert await guard._analyze_payload({"text": "synthetic"}) == []
        assert guard._http_session is not session


@pytest.mark.asyncio
async def test_queue_overload_cancellation_and_deadline_cleanup():
    started = asyncio.Event()
    release = asyncio.Event()

    async def analyze(request):
        started.set()
        await release.wait()
        return web.json_response([])

    with patch.dict(
        "os.environ",
        {
            "PRESIDIO_HTTP_MAX_CONCURRENCY": "1",
            "PRESIDIO_HTTP_MAX_QUEUE": "1",
            "PRESIDIO_HTTP_TIMEOUT_SECONDS": "0.12",
        },
    ):
        async with server(analyze) as guard:
            first = asyncio.create_task(guard._analyze_payload({"text": "first"}))
            await asyncio.wait_for(started.wait(), 1)
            second = asyncio.create_task(guard._analyze_payload({"text": "second"}))
            await asyncio.sleep(0.02)
            assert PROCESS_ADMISSION.waiting == 1
            with pytest.raises(_PresidioServiceError):
                await guard._analyze_payload({"text": "third"})
            second.cancel()
            with pytest.raises(asyncio.CancelledError):
                await second
            assert PROCESS_ADMISSION.waiting == 0
            begin = asyncio.get_running_loop().time()
            queued = asyncio.create_task(guard._analyze_payload({"text": "queued"}))
            with pytest.raises(_PresidioServiceError):
                await first
            with pytest.raises(_PresidioServiceError):
                await queued
            assert asyncio.get_running_loop().time() - begin < 0.25
            assert PROCESS_ADMISSION.active == PROCESS_ADMISSION.waiting == 0
            release.set()
            assert await guard._analyze_payload({"text": "recovery"}) == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "result",
    [
        {"error": "synthetic"},
        [None],
        [{"start": 0, "end": 10, "entity_type": "PERSON", "score": 0.9}],
        [{"start": 0, "end": 1, "entity_type": "PERSON", "score": 0.9}, None],
        [{"start": True, "end": 1, "entity_type": "PERSON", "score": 0.9}],
    ],
)
async def test_real_http_malformed_or_partial_analysis_fails_closed(result):
    async def analyze(request):
        return web.json_response(result)

    async with server(analyze) as guard:
        with pytest.raises(_PresidioServiceError):
            await guard._analyze_payload({"text": "abc"})


@pytest.mark.asyncio
async def test_real_http_sensitive_extra_fields_are_removed():
    async def analyze(request):
        return web.json_response(
            [
                {
                    "start": 0,
                    "end": 3,
                    "entity_type": "PERSON",
                    "score": 0.99,
                    "analysis_explanation": {"text": "synthetic sensitive"},
                    "recognition_metadata": {"text": "synthetic sensitive"},
                }
            ]
        )

    async with server(analyze) as guard:
        assert await guard._analyze_payload({"text": "가나😀\r\n  다"}) == [
            {"start": 0, "end": 3, "entity_type": "PERSON", "score": 0.99},
        ]


@pytest.mark.asyncio
async def test_real_http_background_loop_session_reuse_and_process_cap():
    active = 0
    peak = 0

    async def analyze(request):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.025)
        active -= 1
        return web.json_response([])

    with patch.dict("os.environ", {"PRESIDIO_HTTP_MAX_CONCURRENCY": "2"}):
        async with server(analyze) as guard:

            async def background_requests():
                results = await asyncio.gather(*(guard._analyze_payload({"text": f"background {i}"}) for i in range(4)))
                async with guard._get_session_iterator() as first:
                    pass
                async with guard._get_session_iterator() as second:
                    assert first is second
                return results

            background = asyncio.create_task(asyncio.to_thread(lambda: asyncio.run(background_requests())))
            foreground = await asyncio.gather(*(guard._analyze_payload({"text": f"foreground {i}"}) for i in range(4)))
            assert foreground == await background == [[]] * 4
            assert peak == 2
            assert len(guard._loop_sessions) == 1
            assert next(iter(guard._loop_sessions.values())) is not guard._http_session
    assert PROCESS_ADMISSION.active == PROCESS_ADMISSION.waiting == 0
