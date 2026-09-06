import asyncio
import math
import os
import time
from collections.abc import AsyncGenerator, Generator
from contextlib import asynccontextmanager, contextmanager
from contextvars import ContextVar
from typing import Final

from litellm.caching.redis_cache import RedisCache
from litellm.proxy.guardrails.guardrail_hooks.presidio_analysis_cache import RequestAnalysisContext

_ANALYSIS_CONTEXT: Final[ContextVar[RequestAnalysisContext | None]] = ContextVar(
    "presidio_request_analysis", default=None
)


def current_analysis_context() -> RequestAnalysisContext | None:
    return _ANALYSIS_CONTEXT.get()


def _pre_call_timeout() -> float:
    try:
        configured: Final = float(os.getenv("PRESIDIO_PRE_CALL_TIMEOUT_SECONDS", "30"))
    except (ValueError, TypeError):
        return 30.0
    return configured if math.isfinite(configured) and configured > 0 else 30.0


@contextmanager
def analysis_request_scope(
    tenant_scope: str | None = None,
    max_concurrency: int = 4,
    redis_cache: RedisCache | None = None,
    force_new: bool = False,
) -> Generator[RequestAnalysisContext]:
    existing: Final = current_analysis_context()
    if existing is not None and not force_new:
        yield existing
        return
    context: Final = RequestAnalysisContext(
        deadline=time.monotonic() + _pre_call_timeout(),
        tenant_scope=tenant_scope,
        max_concurrency=max_concurrency,
        redis_cache=redis_cache,
    )
    token: Final = _ANALYSIS_CONTEXT.set(context)
    try:
        yield context
    finally:
        context.clear()
        _ANALYSIS_CONTEXT.reset(token)


@asynccontextmanager
async def analysis_http_limit(owner: int, maximum: int) -> AsyncGenerator[None]:
    context: Final = current_analysis_context()
    if context is None:
        yield
        return
    semaphore: Final = context.http_semaphores.setdefault(owner, asyncio.Semaphore(maximum))
    async with context.http_semaphore, semaphore:
        yield
