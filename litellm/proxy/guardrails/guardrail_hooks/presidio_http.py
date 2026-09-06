import asyncio
import math
import os
import threading
import time
from collections import defaultdict
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Final, cast

import aiohttp

from litellm.types.proxy.guardrails.guardrail_hooks.presidio import PresidioAnalyzeResponseItem


class PresidioHTTPError(aiohttp.ClientError):
    pass


def validated_entities(value: object, text_length: int) -> list[PresidioAnalyzeResponseItem]:
    from litellm.proxy.guardrails.guardrail_hooks.presidio_analysis_cache import validate_entities

    result: Final = validate_entities(value, text_length)
    if result is None:
        raise PresidioHTTPError("Invalid analyzer response")
    return cast(list[PresidioAnalyzeResponseItem], result)


class HTTPMetrics:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.values: defaultdict[str, float] = defaultdict(float)

    def add(self, name: str, amount: float = 1) -> None:
        with self.lock:
            self.values[name] += amount

    def observe(self, name: str, duration: float) -> None:
        with self.lock:
            self.values[f"{name}_seconds_sum"] += duration
            self.values[f"{name}_seconds_count"] += 1

    def snapshot(self) -> dict[str, float]:
        with self.lock:
            return dict(self.values)


HTTP_METRICS: Final = HTTPMetrics()


class ProcessAdmission:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.active = 0
        self.waiting = 0

    @asynccontextmanager
    async def acquire(self, maximum: int, queue_maximum: int, timeout: float) -> AsyncGenerator[None, None]:
        began: Final = time.monotonic()
        deadline: Final = asyncio.get_running_loop().time() + timeout
        with self.lock:
            if self.active < maximum:
                self.active += 1
                queued = False
            elif self.waiting < queue_maximum:
                self.waiting += 1
                queued = True
            else:
                HTTP_METRICS.add("queue_rejected")
                raise PresidioHTTPError("Presidio admission queue full")
        admitted = not queued
        try:
            while not admitted:
                if asyncio.get_running_loop().time() >= deadline:
                    HTTP_METRICS.add("queue_timeout")
                    raise asyncio.TimeoutError
                await asyncio.sleep(0.005)
                with self.lock:
                    if self.active < maximum:
                        self.waiting -= 1
                        self.active += 1
                        admitted = True
            HTTP_METRICS.observe("queue", time.monotonic() - began)
            http_started: Final = time.monotonic()
            try:
                yield
            except asyncio.CancelledError:
                HTTP_METRICS.add("http_cancelled")
                raise
            except asyncio.TimeoutError:
                HTTP_METRICS.add("http_timeout")
                raise
            except Exception:
                HTTP_METRICS.add("http_error")
                raise
            finally:
                HTTP_METRICS.observe("http", time.monotonic() - http_started)
        finally:
            if not admitted:
                HTTP_METRICS.observe("queue", time.monotonic() - began)
            with self.lock:
                if admitted:
                    self.active -= 1
                else:
                    self.waiting -= 1


PROCESS_ADMISSION: Final = ProcessAdmission()


def http_limits() -> tuple[int, int, float]:
    try:
        maximum: Final = int(os.environ.get("PRESIDIO_HTTP_MAX_CONCURRENCY", "16"))
        queue: Final = int(os.environ.get("PRESIDIO_HTTP_MAX_QUEUE", "64"))
        timeout: Final = float(os.environ.get("PRESIDIO_HTTP_TIMEOUT_SECONDS", "10"))
        if maximum < 1 or queue < 0 or not math.isfinite(timeout) or timeout <= 0:
            raise ValueError
        return maximum, queue, timeout
    except ValueError:
        raise PresidioHTTPError("Invalid Presidio HTTP limits") from None


@dataclass
class SessionLease:
    session: aiohttp.ClientSession
    loop: asyncio.AbstractEventLoop
    users: int = 0
    retired: bool = False


class SessionPool:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.sessions: dict[asyncio.AbstractEventLoop, SessionLease] = {}

    @asynccontextmanager
    async def acquire(self) -> AsyncGenerator[aiohttp.ClientSession, None]:
        loop: Final = asyncio.get_running_loop()
        with self.lock:
            if loop not in self.sessions or self.sessions[loop].session.closed:
                self.sessions[loop] = SessionLease(
                    aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=http_limits()[2])), loop
                )
            lease: Final = self.sessions[loop]
            lease.users += 1
        try:
            yield lease.session
        finally:
            with self.lock:
                lease.users -= 1
                close: Final = lease.retired and lease.users == 0
            if close:
                await lease.session.close()

    async def close(self) -> None:
        with self.lock:
            leases: Final = tuple(self.sessions.values())
            self.sessions.clear()
            for lease in leases:
                lease.retired = True
            idle: Final = tuple(lease for lease in leases if lease.users == 0)
        for lease in idle:
            if lease.loop is asyncio.get_running_loop() or not lease.loop.is_running():
                await lease.session.close()
            else:
                await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(lease.session.close(), lease.loop))
