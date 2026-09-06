import hashlib
from collections.abc import Sequence
from typing import Final

import pytest

from litellm.proxy.guardrails.guardrail_hooks.presidio_streaming import (
    Span,
    StreamingInspectionError,
    WindowState,
)


class Scanner:
    def __init__(self, secret: str = "secret", replacement: str = "<REDACTED>") -> None:
        self.secret = secret
        self.replacement = replacement
        self.windows: tuple[str, ...] = ()

    async def analyze(self, text: str) -> Sequence[Span]:
        self.windows += (text,)
        return tuple(
            Span(offset, offset + len(self.secret), "PERSON", 0.99)
            for offset in range(len(text))
            if text.startswith(self.secret, offset)
        )

    async def mask(self, text: str, spans: Sequence[Span]) -> str:
        boundaries: Final = (0,) + tuple(span.end for span in spans)
        return (
            "".join(text[start : span.start] + self.replacement for start, span in zip(boundaries, spans))
            + text[boundaries[-1] :]
        )


@pytest.mark.asyncio
async def test_batches_deltas_and_handles_replacement_lengths_at_boundary() -> None:
    scanner: Final = Scanner()
    state: Final = WindowState(scanner)
    text: Final = "x" * 382 + "secret" + "y" * 1200
    pieces: Final = tuple([await state.feed(character) for character in text])
    final: Final = await state.feed("", final=True)
    assert "".join(pieces) + final == text.replace("secret", "<REDACTED>")
    assert len(scanner.windows) < 8
    assert max(map(len, scanner.windows)) <= 1024
    assert state.emitted == text.replace("secret", "<REDACTED>")
    assert state.finalized
    assert await state.feed("", final=True) == ""


@pytest.mark.asyncio
async def test_huge_delta_keeps_analysis_windows_bounded() -> None:
    scanner: Final = Scanner()
    state: Final = WindowState(scanner)
    text: Final = "plain text " * 2000
    initial: Final = await state.feed(text)
    final: Final = await state.feed("", final=True)
    assert initial + final == text
    assert max(map(len, scanner.windows)) <= 1024
    assert len(scanner.windows) < 70


@pytest.mark.asyncio
async def test_timer_flush_preserves_tail_and_final_analyzes_remaining_text() -> None:
    scanner: Final = Scanner()
    state: Final = WindowState(scanner, clock=lambda: 10.0)
    assert await state.feed("x" * 200 + "sec") == ""
    assert scanner.windows == ()
    assert await state.feed("", force=True) == "x" * 75
    assert state.pending == "x" * 125 + "sec"
    assert state.last_scan == 10.0
    assert await state.feed("ret", final=True) == "x" * 125 + "<REDACTED>"
    assert not state.has_pending


@pytest.mark.asyncio
async def test_detected_entity_crossing_released_context_fails_closed() -> None:
    scanner: Final = Scanner(secret="x" * 130 + "secret")
    state: Final = WindowState(scanner)
    assert await state.feed("x" * 512) == "x" * 384
    with pytest.raises(StreamingInspectionError, match="previously released"):
        await state.feed("secret", final=True)


@pytest.mark.asyncio
async def test_long_entity_cannot_grow_pending_without_bound() -> None:
    class WholeWindowScanner(Scanner):
        async def analyze(self, text: str) -> Sequence[Span]:
            self.windows += (text,)
            return (Span(0, len(text), "PERSON", 0.99),)

    scanner: Final = WholeWindowScanner()
    state: Final = WindowState(scanner)
    with pytest.raises(StreamingInspectionError, match="bounded window"):
        await state.feed("x" * 5000)
    assert max(map(len, scanner.windows)) <= 1024
    assert len(state.pending) <= 1024
    assert not state.emitted


@pytest.mark.asyncio
async def test_digest_validates_completion_prefix_without_storing_original() -> None:
    scanner: Final = Scanner()
    state: Final = WindowState(scanner)
    assert await state.feed("secret", final=True) == "<REDACTED>"
    assert state.source_length == 6
    assert state.source_digest == hashlib.sha256(b"secret").hexdigest()
    assert state.matches_source_prefix("secret trailing")
    assert not state.matches_source_prefix("secre")
    assert not state.matches_source_prefix("public")
    with pytest.raises(StreamingInspectionError, match="completed"):
        await state.feed("more")


@pytest.mark.asyncio
async def test_source_and_sanitized_limits_prevent_unbounded_accumulation() -> None:
    scanner: Final = Scanner(replacement="x" * 600)
    state: Final = WindowState(scanner, max_output_chars=512)
    with pytest.raises(StreamingInspectionError, match="text limit"):
        await state.feed("x" * 513)
    assert scanner.windows == ()
    with pytest.raises(StreamingInspectionError, match="Sanitized"):
        await state.feed("secret", final=True)


@pytest.mark.asyncio
async def test_invalid_analyzer_offsets_are_not_released() -> None:
    class InvalidScanner(Scanner):
        async def analyze(self, text: str) -> Sequence[Span]:
            return (Span(-1, len(text), "PERSON", 0.99),)

    state: Final = WindowState(InvalidScanner())
    with pytest.raises(StreamingInspectionError, match="Invalid streaming analysis"):
        await state.feed("secret", final=True)
    assert state.emitted == ""
