import hashlib
import math
import re
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from functools import reduce
from types import MappingProxyType
from typing import Final, Protocol


@dataclass(frozen=True, slots=True)
class Span:
    start: int
    end: int
    entity_type: str
    score: float


class WindowScanner(Protocol):
    async def analyze(self, text: str) -> Sequence[Span]: ...

    async def mask(self, text: str, spans: Sequence[Span]) -> str: ...


class StreamingInspectionError(ValueError):
    pass


def _safe_boundary(spans: Sequence[Span], boundary: int) -> int:
    def lower(current: int, span: Span) -> int:
        return span.start if span.start < current < span.end else current

    return reduce(lower, sorted(spans, key=lambda span: span.start, reverse=True), boundary)


class WindowState:
    def __init__(
        self,
        scanner: WindowScanner,
        *,
        batch_chars: int = 512,
        context_chars: int = 128,
        tail_chars: int = 128,
        max_window_chars: int = 1024,
        max_output_chars: int = 262144,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if (
            min(batch_chars, tail_chars, max_window_chars, max_output_chars) <= 0
            or context_chars < 0
            or batch_chars <= tail_chars
            or max_window_chars < context_chars + batch_chars
        ):
            raise ValueError("Invalid streaming inspection limits")
        self._scanner = scanner
        self._batch_chars = batch_chars
        self._context_chars = context_chars
        self._tail_chars = tail_chars
        self._max_window_chars = max_window_chars
        self._max_output_chars = max_output_chars
        self._clock = clock
        self._pending = ""
        self._context = ""
        self._emitted = ""
        self._source_length = 0
        self._source_digest = hashlib.sha256()
        self._last_scan = clock()
        self._closed = False

    @property
    def pending(self) -> str:
        return self._pending

    @property
    def has_pending(self) -> bool:
        return bool(self._pending)

    @property
    def last_scan(self) -> float:
        return self._last_scan

    @property
    def emitted(self) -> str:
        return self._emitted

    @property
    def source_length(self) -> int:
        return self._source_length

    @property
    def source_digest(self) -> str:
        return self._source_digest.hexdigest()

    @property
    def finalized(self) -> bool:
        return self._closed

    def matches_source_prefix(self, text: str) -> bool:
        return (
            len(text) >= self._source_length
            and hashlib.sha256(text[: self._source_length].encode()).digest() == self._source_digest.digest()
        )

    async def feed(self, text: str, *, final: bool = False, force: bool = False) -> str:
        if self._closed:
            if text:
                raise StreamingInspectionError("Text received after streaming inspection completed")
            return ""
        if self._source_length + len(text) > self._max_output_chars:
            raise StreamingInspectionError("Streaming inspection text limit exceeded")
        before: Final = len(self._emitted)
        for fragment in (text[offset : offset + self._tail_chars] for offset in range(0, len(text), self._tail_chars)):
            self._pending += fragment
            self._source_length += len(fragment)
            self._source_digest.update(fragment.encode())
            if len(self._pending) >= self._batch_chars:
                await self._scan(final=False)
        if final or force:
            await self._scan(final=final)
        if final:
            self._closed = True
        return self._emitted[before:]

    async def _scan(self, *, final: bool) -> None:
        if not self._pending or (not final and len(self._pending) <= self._tail_chars):
            return
        window: Final = self._context + self._pending
        if len(window) > self._max_window_chars:
            raise StreamingInspectionError("Streaming inspection window limit exceeded")
        spans: Final = tuple(await self._scanner.analyze(window))
        self._last_scan = self._clock()
        if any(
            not 0 <= span.start < span.end <= len(window) or not math.isfinite(span.score) or not 0 <= span.score <= 1
            for span in spans
        ):
            raise StreamingInspectionError("Invalid streaming analysis offsets or score")
        start: Final = len(self._context)
        if any(span.start < start < span.end for span in spans):
            raise StreamingInspectionError("Detected entity crosses previously released streaming text")
        boundary: Final = _safe_boundary(spans, len(window) if final else len(window) - self._tail_chars)
        if boundary <= start:
            if len(window) + self._tail_chars > self._max_window_chars:
                raise StreamingInspectionError("Streaming analysis cannot safely release a bounded window")
            return
        committed_spans: Final = tuple(
            Span(span.start - start, span.end - start, span.entity_type, span.score)
            for span in spans
            if start <= span.start < span.end <= boundary
        )
        masked: Final = await self._scanner.mask(window[start:boundary], committed_spans)
        if len(self._emitted) + len(masked) > self._max_output_chars:
            raise StreamingInspectionError("Sanitized streaming text limit exceeded")
        self._emitted += masked
        self._context = window[max(0, boundary - self._context_chars) : boundary]
        self._pending = window[boundary:]


@dataclass(frozen=True, slots=True)
class PendingTokenPrefix:
    key: tuple[object, ...]
    text: str
    template: object


class TokenRestorationBuffer:
    def __init__(self, tokens: Mapping[str, str]) -> None:
        self._tokens = MappingProxyType({token: value for token, value in tokens.items() if token})
        self._pattern = re.compile("|".join(re.escape(token) for token in self._tokens) or r"(?!)")
        self._prefixes = frozenset(token[:length] for token in self._tokens for length in range(1, len(token)))
        self._longest = max((len(token) for token in self._tokens), default=0)
        self._pending: tuple[PendingTokenPrefix, ...] = ()

    def restore(self, text: str) -> str:
        return self._pattern.sub(lambda match: self._tokens[match.group()], text)

    def push(self, key: tuple[object, ...], text: str, template: object, *, final: bool = False) -> str:
        previous: Final = next((pending.text for pending in self._pending if pending.key == key), "")
        combined: Final = previous + text
        tail_length: Final = (
            0
            if final
            else max(
                (
                    length
                    for length in range(1, min(len(combined) + 1, self._longest))
                    if combined[-length:] in self._prefixes
                ),
                default=0,
            )
        )
        boundary: Final = len(combined) - tail_length
        remaining: Final = tuple(pending for pending in self._pending if pending.key != key)
        if tail_length and len(remaining) >= 128:
            raise StreamingInspectionError("Streaming token restoration field limit exceeded")
        self._pending = remaining + ((PendingTokenPrefix(key, combined[boundary:], template),) if tail_length else ())
        return self.restore(combined[:boundary])

    def flush(self, predicate: Callable[[tuple[object, ...]], bool]) -> tuple[PendingTokenPrefix, ...]:
        flushed: Final = tuple(pending for pending in self._pending if predicate(pending.key))
        self._pending = tuple(pending for pending in self._pending if not predicate(pending.key))
        return flushed
