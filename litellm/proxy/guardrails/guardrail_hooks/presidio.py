# +-----------------------------------------------+
# |                                               |
# |               PII Masking                     |
# |         with Microsoft Presidio               |
# |   https://github.com/BerriAI/litellm/issues/  |
# +-----------------------------------------------+
#
#  Tell us how we can improve! - Krrish & Ishaan


import asyncio
import copy
import json
import re
import threading
import time
from collections.abc import AsyncGenerator, AsyncIterable, Awaitable, Callable, Iterable, Mapping, Sequence
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import reduce
from types import MappingProxyType
from typing import (
    TYPE_CHECKING,
    Any,
    ClassVar,
    Final,
    Literal,
    TypedDict,
    cast,
)
from uuid import uuid4

import aiohttp
from pydantic import BaseModel
from typing_extensions import NotRequired, ReadOnly

import litellm
from litellm import get_secret
from litellm._logging import verbose_proxy_logger
from litellm.constants import (
    DEFAULT_PRESIDIO_ANALYZE_CHUNK_SIZE_BYTES,
    PRESIDIO_ANALYZE_CHUNK_CONCURRENCY,
    PRESIDIO_ANALYZE_CHUNK_OVERLAP_CHARS,
)
from litellm.types.utils import CallTypes, GenericGuardrailAPIInputs, GuardrailInputSource

if TYPE_CHECKING:
    from litellm.litellm_core_utils.litellm_logging import Logging as LiteLLMLoggingObj

from litellm.caching.caching import DualCache
from litellm.exceptions import BlockedPiiEntityError
from litellm.integrations.custom_guardrail import (
    CustomGuardrail,
    log_guardrail_information,
)
from litellm.proxy._types import UserAPIKeyAuth
from litellm.proxy.guardrails.guardrail_hooks.presidio_analysis_cache import AnalysisCache, AnalysisCacheConfig
from litellm.proxy.guardrails.guardrail_hooks.presidio_analysis_context import (
    analysis_http_limit,
    analysis_request_scope,
    current_analysis_context,
)
from litellm.types.guardrails import (
    GuardrailEventHooks,
    LitellmParams,
    PiiAction,
    PiiEntityType,
    PresidioPerRequestConfig,
)
from litellm.types.llms.openai import ResponsesAPIResponse
from litellm.types.proxy.guardrails.guardrail_hooks.presidio import (
    PresidioAnalyzeRequest,
    PresidioAnalyzeResponseItem,
)
from litellm.types.utils import GuardrailAnalysisCacheInfo, GuardrailStatus, StreamingChoices
from litellm.utils import (
    EmbeddingResponse,
    ImageResponse,
    ModelResponse,
    ModelResponseStream,
)


class PresidioLogContext(TypedDict, total=False):
    guardrail_run_id: str
    guardrail_event: GuardrailEventHooks
    input_source: GuardrailInputSource


class _PresidioAnonymizeItem(TypedDict, total=False):
    entity_type: ReadOnly[str | None]


class _PresidioAnonymizeResponse(TypedDict):
    text: ReadOnly[str]
    items: ReadOnly[NotRequired[list[_PresidioAnonymizeItem]]]


_PRESIDIO_LOG_CONTEXT: ContextVar[PresidioLogContext | None] = ContextVar("presidio_log_context", default=None)


class _PresidioServiceError(Exception):
    pass


@dataclass(slots=True)
class _StreamingPiiState:
    pending: str = ""
    emitted: str = ""
    template: object | None = None


_LoopSemaphores = dict[asyncio.AbstractEventLoop, asyncio.Semaphore]


def _json_escaped_len(text: str) -> int:
    """
    Byte length of ``text`` as it appears serialized inside the JSON request
    body sent to Presidio (``json.dumps`` escapes non-ASCII characters, so a
    3-byte UTF-8 character can occupy 6+ bytes on the wire).
    """
    return len(json.dumps(text).encode("utf-8")) - 2  # strip the surrounding quotes


class _OPTIONAL_PresidioPIIMasking(CustomGuardrail):
    requires_guardrailed_previous_response_history: ClassVar[bool] = True
    _STREAM_PII_HOLDBACK_CHARS: ClassVar[int] = 128
    _PII_TOKEN_PATTERN = re.compile(r"<(?P<entity>[A-Z][A-Z0-9_]*)_(?P<sequence>[0-9]+)>")
    _RESTORABLE_INPUT_SCOPES = frozenset({"conversation_history", "current_user_prompt", "current_user_context"})
    _LOGGING_TEXT_FIELDS = frozenset(
        ("arguments", "content", "output_text", "reasoning_content", "refusal", "summary", "text")
    )
    user_api_key_cache = None
    ad_hoc_recognizers: list[str] | None = None

    @classmethod
    def _text_for_pii_analysis(cls, text: str) -> str:
        return cls._PII_TOKEN_PATTERN.sub(
            lambda match: " " * len(match.group()),
            text,
        )

    @classmethod
    def _canonicalize_reversible_token_order(
        cls,
        value: object,
        request_data: dict,
    ) -> object:
        """Renumber request-local reversible tokens in final LLM input order.

        Presidio analyzes message segments independently. Some lifecycle paths run
        those calls concurrently, so the order in which they populate
        ``metadata.pii_tokens`` is completion order rather than message order. Keep
        independent analysis, then make token numbering deterministic immediately
        before the transformed input is returned to the LLM.

        Only tokens created by this request (keys present in ``pii_tokens``) are
        rewritten. Non-restorable placeholders such as ``<ACTNO>`` and matching
        strings supplied by the caller are deliberately left untouched.
        """
        metadata = request_data.get("metadata")
        if not isinstance(metadata, dict):
            return value
        pii_tokens = metadata.get("pii_tokens")
        if not isinstance(pii_tokens, dict) or not pii_tokens:
            return value

        known_tokens = {
            token
            for token in pii_tokens
            if isinstance(token, str) and cls._PII_TOKEN_PATTERN.fullmatch(token) is not None
        }
        if not known_tokens:
            return value

        ordered_tokens: list[str] = []
        seen_tokens: set[str] = set()

        def _collect_tokens(current: object) -> None:
            if isinstance(current, str):
                for match in cls._PII_TOKEN_PATTERN.finditer(current):
                    token = match.group()
                    if token in known_tokens and token not in seen_tokens:
                        seen_tokens.add(token)
                        ordered_tokens.append(token)
                return
            if isinstance(current, Mapping):
                for entry in current.items():
                    if entry[0] != "structured_messages":
                        _collect_tokens(entry[1])
                return
            if isinstance(current, (list, tuple)):
                for nested_value in current:
                    _collect_tokens(nested_value)

        _collect_tokens(value)
        # Preserve any request-local mappings not present in ``value``. This is
        # defensive for provider-specific inputs that may keep their transformed
        # text outside GenericGuardrailAPIInputs.
        ordered_tokens.extend(token for token in pii_tokens if token in known_tokens and token not in seen_tokens)

        replacements: dict[str, str] = {}
        for sequence, old_token in enumerate(ordered_tokens, start=1):
            token_match = cls._PII_TOKEN_PATTERN.fullmatch(old_token)
            if token_match is None:
                continue
            replacements[old_token] = f"<{token_match.group('entity')}_{sequence}>"

        if not replacements:
            return value

        tokens_changed = any(old_token != new_token for old_token, new_token in replacements.items())

        def _replace_tokens(current: object) -> object:
            if isinstance(current, str):
                return cls._PII_TOKEN_PATTERN.sub(
                    lambda match: replacements.get(match.group(), match.group()),
                    current,
                )
            if isinstance(current, dict):
                return {
                    key: nested_value if key == "structured_messages" else _replace_tokens(nested_value)
                    for key, nested_value in current.items()
                }
            if isinstance(current, list):
                return [_replace_tokens(nested_value) for nested_value in current]
            if isinstance(current, tuple):
                return tuple(_replace_tokens(nested_value) for nested_value in current)
            return current

        # Rebuild the maps in the same canonical order as the final LLM input.
        # Dict order is not required for exact-token restoration, but keeping it
        # aligned makes fallback/debug behavior deterministic as well.
        canonical_pii_tokens = {replacements[token]: pii_tokens[token] for token in ordered_tokens}
        canonical_pii_tokens.update(
            {token: original_text for token, original_text in pii_tokens.items() if token not in known_tokens}
        )
        metadata["pii_tokens"] = canonical_pii_tokens
        pii_token_sources = metadata.get("pii_token_sources")
        if isinstance(pii_token_sources, dict):
            canonical_pii_token_sources = {
                replacements[token]: pii_token_sources[token] for token in ordered_tokens if token in pii_token_sources
            }
            canonical_pii_token_sources.update(
                {token: source for token, source in pii_token_sources.items() if token not in known_tokens}
            )
            metadata["pii_token_sources"] = canonical_pii_token_sources
        if not tokens_changed:
            return value
        return _replace_tokens(value)

    @classmethod
    def _should_create_reversible_tokens(
        cls,
        output_parse_pii: bool,
        input_source: GuardrailInputSource,
    ) -> bool:
        scope = input_source.get("scope")
        if scope is None:
            return output_parse_pii
        return output_parse_pii and scope in cls._RESTORABLE_INPUT_SCOPES

    @classmethod
    def get_supported_event_hooks(cls) -> list[GuardrailEventHooks]:
        return [
            GuardrailEventHooks.pre_call,
            GuardrailEventHooks.during_call,
            GuardrailEventHooks.post_call,
            GuardrailEventHooks.logging_only,
            GuardrailEventHooks.pre_mcp_call,
            GuardrailEventHooks.post_mcp_call,
        ]

    # Class variables or attributes
    def __init__(
        self,
        mock_testing: bool = False,
        mock_redacted_text: _PresidioAnonymizeResponse | None = None,
        presidio_analyzer_api_base: str | None = None,
        presidio_anonymizer_api_base: str | None = None,
        output_parse_pii: bool | None = False,
        apply_to_output: bool = False,
        expand_event_hook_for_output_processing: bool = True,
        presidio_ad_hoc_recognizers: str | None = None,
        logging_only: bool | None = None,
        presidio_filter_scope: Literal["input", "output", "both"] = "both",
        presidio_max_parallel_requests: int = 4,
        presidio_analysis_cache: AnalysisCache | None = None,
        presidio_analysis_cache_enabled: bool | None = None,
        presidio_analysis_cache_ttl_seconds: int | None = None,
        pii_entities_config: dict[PiiEntityType | str, PiiAction] | None = None,
        presidio_language: str | None = None,
        presidio_score_thresholds: dict[PiiEntityType | str, float] | None = None,
        presidio_entities_deny_list: list[PiiEntityType | str] | None = None,
        unreachable_fallback: Literal["fail_closed", "fail_open"] = "fail_closed",
        presidio_analyze_chunk_size_bytes: int | None = None,
        **kwargs,
    ):
        if logging_only is True:
            self.logging_only = True
            kwargs["event_hook"] = GuardrailEventHooks.logging_only
        kwargs.setdefault("supported_event_hooks", list(self.get_supported_event_hooks()))
        super().__init__(**kwargs)
        self.guardrail_provider = "presidio"
        self.logging_only = logging_only is True
        self.pii_tokens: dict = {}  # mapping of PII token to original text - only used with Presidio `replace` operation
        self.mock_redacted_text = mock_redacted_text
        self.output_parse_pii = output_parse_pii or False
        self.apply_to_output = apply_to_output
        self.presidio_filter_scope = presidio_filter_scope
        if (
            isinstance(presidio_max_parallel_requests, bool)
            or presidio_max_parallel_requests < 1
            or presidio_max_parallel_requests > 64
        ):
            raise ValueError("presidio_max_parallel_requests must be between 1 and 64")
        self.presidio_max_parallel_requests = presidio_max_parallel_requests
        self._analysis_cache = presidio_analysis_cache or AnalysisCache(
            AnalysisCacheConfig.from_env().with_guardrail_overrides(
                presidio_analysis_cache_enabled, presidio_analysis_cache_ttl_seconds
            )
        )
        self._mock_testing = mock_testing
        self.unreachable_fallback = unreachable_fallback

        # When output_parse_pii or apply_to_output is enabled, the guardrail must
        # also run on post_call to unmask/mask the response.  Expand the event_hook
        # so should_run_guardrail returns True for both pre_call and post_call.
        if (
            expand_event_hook_for_output_processing
            and (self.output_parse_pii or self.apply_to_output)
            and not logging_only
        ):
            current_hook = self.event_hook
            if isinstance(current_hook, str) and current_hook != "post_call":
                self.event_hook = cast(list[GuardrailEventHooks], [current_hook, "post_call"])
            elif isinstance(current_hook, list) and "post_call" not in current_hook:
                self.event_hook = cast(list[GuardrailEventHooks], current_hook + ["post_call"])
        self._set_pii_policy(pii_entities_config, presidio_score_thresholds, presidio_entities_deny_list)
        self.presidio_language = presidio_language or "en"
        self.presidio_analyze_chunk_size_bytes: int = self._coerce_analyze_chunk_size(presidio_analyze_chunk_size_bytes)
        # Shared HTTP session to prevent memory leaks (issue #14540)
        self._http_session: aiohttp.ClientSession | None = None
        # Lock to prevent race conditions when creating session under concurrent load
        # Note: asyncio.Lock() can be created without an event loop; it only needs one when awaited
        self._session_lock: asyncio.Lock = asyncio.Lock()

        # Track main thread ID to safely identity when we are running in main loop vs background thread

        self._main_thread_id = threading.get_ident()

        # Loop-bound session cache for background threads
        self._loop_sessions: dict[asyncio.AbstractEventLoop, aiohttp.ClientSession] = {}

        # Per-loop semaphores bounding chunked-analyze fan-out across ALL
        # concurrent oversized blocks/requests on this instance, not per call
        self._loop_chunk_semaphores: _LoopSemaphores = {}  # mutable-ok: per-loop semaphore cache

        if mock_testing is True:  # for testing purposes only
            return

        ad_hoc_recognizers: Final = presidio_ad_hoc_recognizers
        if ad_hoc_recognizers is not None:
            try:
                with open(ad_hoc_recognizers) as file:
                    self.ad_hoc_recognizers = json.load(file)
            except FileNotFoundError:
                raise Exception(f"File not found. file_path={ad_hoc_recognizers}")
            except json.JSONDecodeError as e:
                raise Exception(f"Error decoding JSON file: {e}, file_path={ad_hoc_recognizers}")
            except Exception as e:
                raise Exception(f"An error occurred: {e}, file_path={ad_hoc_recognizers}")
        self.validate_environment(
            presidio_analyzer_api_base=presidio_analyzer_api_base,
            presidio_anonymizer_api_base=presidio_anonymizer_api_base,
        )

    def validate_environment(
        self,
        presidio_analyzer_api_base: str | None = None,
        presidio_anonymizer_api_base: str | None = None,
    ):
        self.presidio_analyzer_api_base: str | None = presidio_analyzer_api_base or get_secret(
            "PRESIDIO_ANALYZER_API_BASE", None
        )
        self.presidio_anonymizer_api_base: str | None = presidio_anonymizer_api_base or litellm.get_secret(
            "PRESIDIO_ANONYMIZER_API_BASE", None
        )

        if self.presidio_analyzer_api_base is None:
            raise Exception("Missing `PRESIDIO_ANALYZER_API_BASE` from environment")
        if not self.presidio_analyzer_api_base.endswith("/"):
            self.presidio_analyzer_api_base += "/"
        if not (
            self.presidio_analyzer_api_base.startswith("http://")
            or self.presidio_analyzer_api_base.startswith("https://")
        ):
            # add http:// if unset, assume communicating over private network - e.g. render
            self.presidio_analyzer_api_base = "http://" + self.presidio_analyzer_api_base

        if self.presidio_anonymizer_api_base is None:
            raise Exception("Missing `PRESIDIO_ANONYMIZER_API_BASE` from environment")
        if not self.presidio_anonymizer_api_base.endswith("/"):
            self.presidio_anonymizer_api_base += "/"
        if not (
            self.presidio_anonymizer_api_base.startswith("http://")
            or self.presidio_anonymizer_api_base.startswith("https://")
        ):
            # add http:// if unset, assume communicating over private network - e.g. render
            self.presidio_anonymizer_api_base = "http://" + self.presidio_anonymizer_api_base

    @asynccontextmanager
    async def _get_session_iterator(
        self,
    ) -> AsyncGenerator[aiohttp.ClientSession, None]:
        from litellm.proxy.guardrails.guardrail_hooks.presidio_http import (
            PROCESS_ADMISSION,
            SessionPool,
            http_limits,
        )

        pool: Final = self.__dict__.setdefault("_session_pool", SessionPool())
        maximum, queue_maximum, timeout = http_limits()
        async with (
            analysis_http_limit(id(self), self.presidio_max_parallel_requests),
            PROCESS_ADMISSION.acquire(maximum, queue_maximum, timeout),
            pool.acquire() as session,
        ):
            if threading.get_ident() == self._main_thread_id:
                self._http_session = session
            else:
                self._loop_sessions[asyncio.get_running_loop()] = session
            yield session

    async def _close_http_session(self) -> None:
        pool: Final = self.__dict__.get("_session_pool")
        self._http_session = None
        self._loop_sessions.clear()
        self._loop_chunk_semaphores.clear()
        if pool is not None:
            await pool.close()

    def __del__(self):
        """Cleanup: we try to close, but doing async cleanup in __del__ is risky."""

    def _has_block_action(self) -> bool:
        """Return True if pii_entities_config has any BLOCK action (fail-closed on analyzer errors)."""
        if not self.pii_entities_config:
            return False
        return any(action == PiiAction.BLOCK for action in self.pii_entities_config.values())

    @staticmethod
    def _entity_type_value(entity_type: PiiEntityType | str) -> str:
        return entity_type.value if isinstance(entity_type, PiiEntityType) else entity_type

    @classmethod
    def _entity_type_matches(
        cls,
        detected_entity_type: PiiEntityType | str,
        configured_entity_type: PiiEntityType | str,
    ) -> bool:
        detected = cls._entity_type_value(detected_entity_type)
        configured = cls._entity_type_value(configured_entity_type)
        if detected == configured:
            return True
        if not detected.startswith(configured):
            return False
        suffix = detected[len(configured) :]
        return suffix.isdigit() or (suffix.startswith("_") and suffix[1:].isdigit())

    @classmethod
    def _resolve_configured_entity_type(
        cls,
        detected_entity_type: PiiEntityType | str,
        configured_entity_types: Iterable[PiiEntityType | str],
    ) -> PiiEntityType | str | None:
        configured_types = tuple(configured_entity_types)
        detected = cls._entity_type_value(detected_entity_type)
        exact_match = next(
            (entity_type for entity_type in configured_types if cls._entity_type_value(entity_type) == detected),
            None,
        )
        if exact_match is not None:
            return exact_match
        return next(
            (
                entity_type
                for entity_type in configured_types
                if cls._entity_type_matches(detected_entity_type, entity_type)
            ),
            None,
        )

    def _blocked_entity_type(
        self,
        analyze_results: Sequence[PresidioAnalyzeResponseItem] | Mapping[str, object],
    ) -> str | None:
        if not isinstance(analyze_results, list):
            return None
        for result in analyze_results:
            entity_type = result.get("entity_type")
            if entity_type is None:
                continue
            configured_entity_type = self._resolve_configured_entity_type(
                entity_type,
                self.pii_entities_config.keys(),
            )
            if (
                configured_entity_type is not None
                and self.pii_entities_config[configured_entity_type] == PiiAction.BLOCK
            ):
                return self._entity_type_value(entity_type)
        return None

    @classmethod
    def _mask_detected_entities_for_logging(
        cls,
        text: str,
        analyze_results: Sequence[PresidioAnalyzeResponseItem] | Mapping[str, object],
    ) -> tuple[str, tuple[str, ...]]:
        if not isinstance(analyze_results, list):
            return "[REDACTED BY PRESIDIO]", ()
        spans = tuple(
            span for result in analyze_results if (span := cls._logging_redaction_span(text, result)) is not None
        )
        if not spans:
            return "[REDACTED BY PRESIDIO]", ()
        merged_spans = reduce(cls._merge_redaction_span, sorted(spans), ())
        masked_text = text
        for start, end, entity_name in reversed(merged_spans):
            masked_text = f"{masked_text[:start]}<{entity_name}>{masked_text[end:]}"
        return masked_text, tuple(entity_name for _, _, entity_name in spans)

    @classmethod
    def _logging_redaction_span(
        cls,
        text: str,
        result: PresidioAnalyzeResponseItem,
    ) -> tuple[int, int, str] | None:
        start = result.get("start")
        end = result.get("end")
        entity_type = result.get("entity_type")
        if not isinstance(start, int) or not isinstance(end, int) or entity_type is None:
            return None
        if start < 0 or end <= start or end > len(text):
            return None
        return start, end, cls._entity_type_value(entity_type)

    @staticmethod
    def _merge_redaction_span(
        merged_spans: tuple[tuple[int, int, str], ...],
        span: tuple[int, int, str],
    ) -> tuple[tuple[int, int, str], ...]:
        if not merged_spans or span[0] >= merged_spans[-1][1]:
            return (*merged_spans, span)
        previous_start, previous_end, previous_entity = merged_spans[-1]
        return (*merged_spans[:-1], (previous_start, max(previous_end, span[1]), previous_entity))

    @classmethod
    def _replace_sensitive_text(cls, value: object, sensitive_text: str, masked_text: str) -> object:
        if isinstance(value, str):
            return value.replace(sensitive_text, masked_text)
        if isinstance(value, dict):
            for key, nested_value in tuple(value.items()):
                if key == "litellm_logging_obj":
                    continue
                value[key] = cls._replace_sensitive_text(nested_value, sensitive_text, masked_text)
            return value
        if isinstance(value, list):
            for index, nested_value in enumerate(value):
                value[index] = cls._replace_sensitive_text(nested_value, sensitive_text, masked_text)
            return value
        if isinstance(value, tuple):
            return tuple(cls._replace_sensitive_text(item, sensitive_text, masked_text) for item in value)
        if isinstance(value, BaseModel):
            for field_name in type(value).model_fields:
                nested_value = getattr(value, field_name, None)
                setattr(value, field_name, cls._replace_sensitive_text(nested_value, sensitive_text, masked_text))
        return value

    @classmethod
    def _contains_sensitive_text(cls, value: object, sensitive_text: str) -> bool:
        if isinstance(value, str):
            return sensitive_text in value
        if isinstance(value, dict):
            return any(cls._contains_sensitive_text(item, sensitive_text) for item in value.values())
        if isinstance(value, (list, tuple)):
            return any(cls._contains_sensitive_text(item, sensitive_text) for item in value)
        if isinstance(value, BaseModel):
            return any(
                cls._contains_sensitive_text(getattr(value, field_name, None), sensitive_text)
                for field_name in type(value).model_fields
            )
        return False

    @classmethod
    def _redact_response_text_fields(cls, value: object, field_name: str | None = None) -> object:
        if isinstance(value, str):
            return "[REDACTED BY PRESIDIO]" if field_name in cls._LOGGING_TEXT_FIELDS else value
        if isinstance(value, dict):
            for key, nested_value in tuple(value.items()):
                value[key] = cls._redact_response_text_fields(nested_value, str(key))
            return value
        if isinstance(value, list):
            for index, nested_value in enumerate(value):
                value[index] = cls._redact_response_text_fields(nested_value, field_name)
            return value
        if isinstance(value, tuple):
            return tuple(cls._redact_response_text_fields(item, field_name) for item in value)
        if isinstance(value, BaseModel):
            for model_field_name in type(value).model_fields:
                nested_value = getattr(value, model_field_name, None)
                setattr(
                    value,
                    model_field_name,
                    cls._redact_response_text_fields(nested_value, model_field_name),
                )
        return value

    @classmethod
    def _sanitize_blocked_content_for_logging(
        cls,
        request_data: Mapping[str, object],
        sensitive_text: str,
        masked_text: str,
        redact_fragmented_responses: bool = True,
    ) -> None:
        if not isinstance(request_data, dict):
            return
        request_fields = (
            "additional_args",
            "messages",
            "metadata",
            "litellm_params",
            "optional_params",
            "prompt",
            "input",
            "instructions",
            "proxy_server_request",
            "raw_request_typed_dict",
        )
        response_fields = (
            "complete_response",
            "complete_streaming_response",
            "response",
            "responses",
            "responses_so_far",
            "original_response",
            "async_complete_streaming_response",
            "standard_logging_object",
        )
        for field_name in request_fields:
            if field_name in request_data:
                request_data[field_name] = cls._replace_sensitive_text(
                    request_data[field_name],
                    sensitive_text,
                    masked_text,
                )
        for field_name in response_fields:
            if field_name not in request_data:
                continue
            response_value = request_data[field_name]
            request_data[field_name] = (
                cls._redact_response_text_fields(response_value)
                if redact_fragmented_responses
                else cls._replace_sensitive_text(response_value, sensitive_text, masked_text)
                if cls._contains_sensitive_text(response_value, sensitive_text)
                else response_value
            )
        logging_obj = request_data.get("litellm_logging_obj")
        model_call_details_value = getattr(logging_obj, "model_call_details", None)
        if not isinstance(model_call_details_value, dict):
            return
        model_call_details = model_call_details_value
        for field_name in request_fields:
            if field_name in model_call_details:
                model_call_details[field_name] = cls._replace_sensitive_text(
                    model_call_details[field_name],
                    sensitive_text,
                    masked_text,
                )
        for field_name in response_fields:
            if field_name not in model_call_details:
                continue
            response_value = model_call_details[field_name]
            model_call_details[field_name] = (
                cls._redact_response_text_fields(response_value)
                if redact_fragmented_responses
                else cls._replace_sensitive_text(response_value, sensitive_text, masked_text)
                if cls._contains_sensitive_text(response_value, sensitive_text)
                else response_value
            )

    def _get_presidio_analyze_request_payload(
        self,
        text: str,
        presidio_config: PresidioPerRequestConfig | None,
        request_data: dict,
    ) -> PresidioAnalyzeRequest:
        """
        Construct the payload for the Presidio analyze request

        API Ref: https://microsoft.github.io/presidio/api-docs/api-docs.html#tag/Analyzer/paths/~1analyze/post
        """
        analyze_payload: Final[PresidioAnalyzeRequest] = PresidioAnalyzeRequest(
            text=text,
            language=self.presidio_language,
        )
        ##################################################################
        ###### Check if user has configured any params for this guardrail
        ################################################################
        if self.ad_hoc_recognizers is not None:
            analyze_payload["ad_hoc_recognizers"] = self.ad_hoc_recognizers

        if self.pii_entities_config:
            analyze_payload["entities"] = list(self.pii_entities_config.keys())

        ##################################################################
        ######### End of adding config params
        ##################################################################

        # Check if client side request passed any dynamic params
        if presidio_config and presidio_config.language:
            analyze_payload["language"] = presidio_config.language

        casted_analyze_payload: Final = MappingProxyType[str, object](analyze_payload).copy()
        casted_analyze_payload.update(self.get_guardrail_dynamic_request_body_params(request_data=request_data))
        if casted_analyze_payload.get("text") != text:
            raise _PresidioServiceError("Presidio analyzer text override would invalidate masking offsets")
        return cast(PresidioAnalyzeRequest, casted_analyze_payload)

    async def analyze_text(
        self,
        text: str,
        presidio_config: PresidioPerRequestConfig | None,
        request_data: dict,
    ) -> list[PresidioAnalyzeResponseItem] | _PresidioAnonymizeResponse:
        if not text or not text.strip():
            return []
        if self.mock_redacted_text is not None:
            return self.mock_redacted_text
        payload: Final = self._get_presidio_analyze_request_payload(
            text=text, presidio_config=presidio_config, request_data=request_data
        )
        context: Final = current_analysis_context()
        if context is None:
            with analysis_request_scope(max_concurrency=self.presidio_max_parallel_requests):
                return await self.analyze_text(text, presidio_config, request_data)
        try:
            if len(text) > 1 and _json_escaped_len(text) > self.presidio_analyze_chunk_size_bytes:
                return await asyncio.wait_for(
                    self._analyze_text_chunked(text, presidio_config, request_data),
                    timeout=context.remaining(),
                )
            results: Final = await self._analysis_cache.analyze_many(
                (payload,),
                context,
                self._cached_analyze_payload,
                max_concurrency=self.presidio_max_parallel_requests,
            )
            from litellm.proxy.guardrails.guardrail_hooks.presidio_http import validated_entities

            return validated_entities(results[0], len(text))
        except (asyncio.CancelledError, _PresidioServiceError):
            raise
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError, TypeError, KeyError, RuntimeError) as error:
            raise _PresidioServiceError(f"Presidio PII analysis failed: {type(error).__name__}") from None

    async def _cached_analyze_payload(self, payload: Mapping[str, object]) -> Sequence[Mapping[str, object]]:
        return await self._analyze_payload(payload)

    def _analysis_cache_info(
        self, text: str, presidio_config: PresidioPerRequestConfig | None, request_data: dict
    ) -> GuardrailAnalysisCacheInfo | None:
        context: Final = current_analysis_context()
        if context is None or not text.strip() or self._mock_testing or self.mock_redacted_text is not None:
            return None
        try:
            payloads: Final = tuple(
                self._get_presidio_analyze_request_payload(chunk_text, presidio_config, request_data)
                for _, chunk_text in self._analysis_text_chunks(self._text_for_pii_analysis(text))
            )
            return self._analysis_cache.cache_info(payloads, context)
        except (_PresidioServiceError, ValueError, TypeError, KeyError, RuntimeError):
            return None

    async def _prepare_analysis(
        self,
        texts: Sequence[str],
        presidio_config: PresidioPerRequestConfig | None,
        request_data: dict,
        log_contexts: Sequence[PresidioLogContext] = (),
    ) -> None:
        if self._mock_testing or self.mock_redacted_text is not None or not texts:
            return
        context: Final = current_analysis_context()
        if context is None:
            raise _PresidioServiceError("Missing Presidio request scope")
        started: Final = datetime.now(timezone.utc).timestamp()
        try:
            payloads: Final = tuple(
                self._get_presidio_analyze_request_payload(chunk_text, presidio_config, request_data)
                for text in texts
                if text and text.strip()
                for _, chunk_text in self._analysis_text_chunks(self._text_for_pii_analysis(text))
            )
            await self._analysis_cache.analyze_many(
                payloads,
                context,
                self._cached_analyze_payload,
                max_concurrency=self.presidio_max_parallel_requests,
            )
        except BaseException as error:
            ended: Final = datetime.now(timezone.utc).timestamp()
            for index in range(len(texts)):
                (log_context,) = (log_contexts[index] if index < len(log_contexts) else PresidioLogContext(),)
                self.add_standard_logging_guardrail_information_to_request_data(
                    guardrail_provider=self.guardrail_provider,
                    guardrail_json_response="Presidio analysis did not complete",
                    request_data=request_data,
                    guardrail_status="guardrail_failed_to_respond",
                    start_time=started,
                    end_time=ended,
                    duration=ended - started,
                    masked_entity_count=None,
                    guardrail_run_id=log_context.get("guardrail_run_id"),
                    event_type=log_context.get("guardrail_event"),
                    input_source=log_context.get("input_source"),
                    enforcement_mode="observe" if self.logging_only else "enforce",
                    analysis_cache=self._analysis_cache_info(texts[index], presidio_config, request_data),
                )
            self.mark_guardrail_information_recorded()
            if isinstance(error, (asyncio.CancelledError, _PresidioServiceError)):
                raise
            raise _PresidioServiceError(f"Presidio PII analysis failed: {type(error).__name__}") from None

    async def _bounded_checks(self, checks: Sequence[Awaitable[str]]) -> list[str | BaseException]:
        results: Final[
            list[str | BaseException]
        ] = []  # mutable-ok: Bounded batches append results in original fragment order
        try:
            for offset in range(0, len(checks), self.presidio_max_parallel_requests):
                results.extend(
                    await asyncio.gather(
                        *checks[offset : offset + self.presidio_max_parallel_requests], return_exceptions=True
                    )
                )
            cancellation: Final = next(
                (result for result in results if isinstance(result, asyncio.CancelledError)), None
            )
            if cancellation is not None:
                raise cancellation
            return results
        finally:
            for check in checks:
                if asyncio.iscoroutine(check):
                    check.close()

    async def _analyze_payload(self, payload: Mapping[str, object]) -> list[PresidioAnalyzeResponseItem]:
        from litellm.proxy.guardrails.guardrail_hooks.presidio_http import (
            PresidioHTTPError,
            http_limits,
            validated_entities,
        )

        text: Final = payload.get("text")
        if not isinstance(text, str):
            raise _PresidioServiceError("Presidio analyzer payload requires text")

        async def perform() -> list[PresidioAnalyzeResponseItem]:
            async with (
                self._get_session_iterator() as session,
                session.post(
                    f"{self.presidio_analyzer_api_base}analyze",
                    json=payload,
                    headers={"Accept": "application/json"},
                ) as response,
            ):
                if response.status < 200 or response.status >= 300:
                    raise PresidioHTTPError("Analyzer returned unsuccessful HTTP status")
                if "application/json" not in response.content_type:
                    raise PresidioHTTPError("Analyzer returned non-JSON content")
                return validated_entities(await response.json(), len(text))

        try:
            timeout: Final = http_limits()[2]
            return await asyncio.wait_for(perform(), timeout=timeout)
        except (asyncio.CancelledError, _PresidioServiceError):
            raise
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError, TypeError, KeyError, RuntimeError) as error:
            raise _PresidioServiceError(f"Presidio PII analysis failed: {type(error).__name__}") from None

    async def _analyze_text_chunked(
        self,
        text: str,
        presidio_config: PresidioPerRequestConfig | None,
        request_data: dict,  # mutable-ok: shared per-request state dict, matching analyze_text's parameter
    ) -> list[PresidioAnalyzeResponseItem]:  # mutable-ok: analyze_text's declared return type requires list
        """
        Analyze an oversized text by splitting it into overlapping chunks.

        Each chunk serializes to at most ``presidio_analyze_chunk_size_bytes``
        bytes inside the JSON request body, so every /analyze call stays below
        the analyzer deployment's request body limit; per-chunk results are remapped onto the original text and
        merged. Raises exactly like a single ``analyze_text`` call if any chunk
        fails.

        Only the analyzer side is chunked: the later anonymize call still
        receives the full original text, so texts above the anonymizer's own
        body limit that contain detections keep failing there.
        """
        text_chunks: Final = self._split_text_for_analysis(
            text=text,
            chunk_size_bytes=self.presidio_analyze_chunk_size_bytes,
            overlap_chars=PRESIDIO_ANALYZE_CHUNK_OVERLAP_CHARS,
        )
        verbose_proxy_logger.debug(
            "Presidio analyze: text exceeds %s bytes, analyzing in %s overlapping chunks",
            self.presidio_analyze_chunk_size_bytes,
            len(text_chunks),
        )
        analyze_semaphore: Final = self._get_chunk_semaphore()

        async def _analyze_chunk_bounded(
            chunk_text: str,
        ) -> Sequence[PresidioAnalyzeResponseItem] | _PresidioAnonymizeResponse:
            async with analyze_semaphore:
                return await self.analyze_text(
                    text=chunk_text,
                    presidio_config=presidio_config,
                    request_data=request_data,
                )

        gathered: Final = tuple(
            [
                result
                for offset in range(0, len(text_chunks), PRESIDIO_ANALYZE_CHUNK_CONCURRENCY)
                for result in await asyncio.gather(
                    *(
                        _analyze_chunk_bounded(chunk_text)
                        for _, chunk_text in text_chunks[offset : offset + PRESIDIO_ANALYZE_CHUNK_CONCURRENCY]
                    ),
                    return_exceptions=True,
                )
            ]
        )
        chunk_results: Final = []
        for result in gathered:
            if isinstance(result, BaseException):
                raise result
            # analyze_text only returns a non-list shape when mock_redacted_text
            # is set, and the chunked path is never entered in that case.
            typed_result = cast("list[PresidioAnalyzeResponseItem]", result)  # cast-ok: gather() erases element type
            # Apply the configured score thresholds and deny list BEFORE the
            # overlap merge: a below-threshold detection must not win overlap
            # resolution against one the thresholds would keep. The same filter
            # runs again downstream in check_pii, where it is a no-op for the
            # already-filtered items.
            filtered_result = self.filter_analyze_results_by_score(analyze_results=typed_result)
            chunk_results.append(
                cast("list[PresidioAnalyzeResponseItem]", filtered_result)  # cast-ok: list input yields list
            )
        return self._merge_chunked_analyze_results(text_chunks=text_chunks, chunk_results=chunk_results)

    def _analysis_text_chunks(self, text: str) -> Sequence[tuple[int, str]]:
        if len(text) <= 1 or _json_escaped_len(text) <= self.presidio_analyze_chunk_size_bytes:
            return ((0, text),)
        return self._split_text_for_analysis(
            text, self.presidio_analyze_chunk_size_bytes, PRESIDIO_ANALYZE_CHUNK_OVERLAP_CHARS
        )

    def _get_chunk_semaphore(self) -> asyncio.Semaphore:
        """Per-event-loop semaphore shared by all chunked analyze calls on this instance."""
        loop: Final = asyncio.get_running_loop()
        existing: Final = self._loop_chunk_semaphores.get(loop)
        if existing is not None:
            return existing
        created: Final = asyncio.Semaphore(PRESIDIO_ANALYZE_CHUNK_CONCURRENCY)
        self._loop_chunk_semaphores[loop] = created
        return created

    @staticmethod
    def _coerce_analyze_chunk_size(value: int | None) -> int:
        """
        Validate a configured chunk size, falling back to the default.

        Non-positive values would either bypass chunking entirely or degenerate
        it into per-character splits (silently disabling detection), so they are
        replaced by the default; values below 4 bytes are floored to 4 and the
        splitter always emits at least one character per chunk, so the chunked
        path can never re-enter itself.
        """
        if not value or value <= 0:
            return DEFAULT_PRESIDIO_ANALYZE_CHUNK_SIZE_BYTES
        return max(value, 4)

    @staticmethod
    def _split_text_for_analysis(
        text: str,
        chunk_size_bytes: int,
        overlap_chars: int,
    ) -> Sequence[tuple[int, str]]:
        """
        Split ``text`` into chunks whose JSON-serialized form is at most
        ``chunk_size_bytes`` bytes (the analyzer body limit applies to the
        JSON request body, where non-ASCII characters are escaped and larger
        than their raw UTF-8 encoding).

        Consecutive chunks overlap by up to ``overlap_chars`` characters so a
        PII entity up to that length lying across a chunk boundary is still
        seen whole by one of the chunks (longer boundary-straddling entities
        may be seen only truncated); ``_merge_chunked_analyze_results`` resolves
        the duplicate and truncated detections this produces. Returns
        ``(char_offset, chunk_text)`` pairs where ``char_offset`` is the
        chunk's start position in the original text.
        """
        chunks: Final = []
        text_len: Final = len(text)
        start = 0  # rebind-ok: chunk cursor advances across the loop
        while start < text_len:
            # Serialized length of a character is at least 1 byte, so a slice
            # of chunk_size_bytes characters is a sufficient search window.
            candidate = text[start : start + chunk_size_bytes]
            if _json_escaped_len(candidate) <= chunk_size_bytes:
                chunk = candidate
            else:
                # Largest prefix whose serialized form fits the budget.
                low, high = 1, len(candidate)
                while low < high:
                    mid = (low + high + 1) // 2
                    if _json_escaped_len(candidate[:mid]) <= chunk_size_bytes:
                        low = mid
                    else:
                        high = mid - 1
                # low >= 1 keeps the loop advancing even when a single
                # character serializes over a (floored, tiny) budget.
                chunk = candidate[:low]
            end = start + len(chunk)
            chunks.append((start, chunk))
            if end >= text_len:
                break
            # Cap the overlap so the next chunk always makes forward progress.
            effective_overlap = min(overlap_chars, len(chunk) // 2)
            start = max(start + 1, end - effective_overlap)
        return chunks

    @staticmethod
    def _merge_chunked_analyze_results(
        text_chunks: Sequence[tuple[int, str]],
        chunk_results: Sequence[Sequence[PresidioAnalyzeResponseItem]],
    ) -> list[PresidioAnalyzeResponseItem]:  # mutable-ok: analyze_text's declared return type requires list
        """
        Remap per-chunk analyzer offsets onto the original text and merge.

        A detection in an overlap region is reported by both neighbouring
        chunks, and a boundary entity can additionally be reported truncated by
        the chunk that saw only its head or tail. Same-entity-type detections
        with overlapping remapped spans are therefore combined into their union
        after policy filtering, preserving every detected character. The maximum
        score of the combined detections is retained.
        Detections of DIFFERENT entity types may still overlap, exactly as in a
        single-call response. The merged list is sorted by position.
        """
        remapped: Final = []
        for (char_offset, _), results in zip(text_chunks, chunk_results, strict=True):
            for original_item in results:
                item = copy.deepcopy(original_item)
                item_start = item.get("start")
                item_end = item.get("end")
                if item_start is not None:
                    item["start"] = item_start + char_offset
                if item_end is not None:
                    item["end"] = item_end + char_offset
                remapped.append(item)

        def merge_span(
            accumulated: tuple[PresidioAnalyzeResponseItem, ...], item: PresidioAnalyzeResponseItem
        ) -> tuple[PresidioAnalyzeResponseItem, ...]:
            if not accumulated:
                return (item,)
            previous: Final = accumulated[-1]
            if previous.get("entity_type") != item.get("entity_type") or (item.get("start") or 0) >= (
                previous.get("end") or 0
            ):
                return (*accumulated, item)
            combined: Final[PresidioAnalyzeResponseItem] = {
                **previous,
                "end": max(previous.get("end") or 0, item.get("end") or 0),
                "score": max(previous.get("score") or 0.0, item.get("score") or 0.0),
            }
            return (*accumulated[:-1], combined)

        merged: Final = reduce(
            merge_span,
            sorted(remapped, key=lambda item: (str(item.get("entity_type")), item.get("start") or 0)),
            (),
        )
        return sorted(merged, key=lambda item: (item.get("start") or 0, item.get("end") or 0))

    async def _post_presidio_anonymize(
        self,
        text: str,
        analyze_results: list[PresidioAnalyzeResponseItem] | _PresidioAnonymizeResponse,
    ) -> _PresidioAnonymizeResponse | None:
        """POST to Presidio anonymize; returns parsed JSON body."""
        # Use shared session to prevent memory leak (issue #14540)
        async with self._get_session_iterator() as session:
            anonymize_url: Final = f"{self.presidio_anonymizer_api_base}anonymize"
            verbose_proxy_logger.debug("Making request to: %s", anonymize_url)
            anonymize_payload: Final = {
                "text": text,
                "analyzer_results": analyze_results,
            }
            async with session.post(
                anonymize_url,
                json=anonymize_payload,
                headers={"Accept": "application/json"},
            ) as response:
                if response.status >= 400:
                    raise _PresidioServiceError(f"Presidio anonymizer returned HTTP {response.status}")
                content_type = getattr(
                    response,
                    "content_type",
                    response.headers.get("Content-Type", ""),
                )
                if "application/json" not in content_type:
                    raise _PresidioServiceError("Presidio anonymizer returned non-JSON content")
                return await response.json()

    def _finalize_presidio_anonymize_simple(
        self,
        redacted_text: _PresidioAnonymizeResponse,
        masked_entity_count: dict[str, int],
    ) -> str:
        # No need to build numbered tokens — just use Presidio's
        # already-anonymized text directly.  The old code incorrectly
        # applied anonymizer item positions (which reference the
        # *output* text) to the *original* text, causing offset errors.
        for item in redacted_text.get("items", []):
            entity_type = item.get("entity_type", None)
            if entity_type is not None:
                masked_entity_count[entity_type] = masked_entity_count.get(entity_type, 0) + 1
        return redacted_text["text"]

    def _finalize_presidio_anonymize_numbered_tokens(
        self,
        text: str,
        analyze_results: Any,
        request_data: dict | None,
        masked_entity_count: dict[str, int],
    ) -> str:
        # output_parse_pii is True — we need sequentially numbered
        # tokens and a pii_tokens mapping for later unmasking.
        # Use analyze_results positions (which reference the ORIGINAL
        # text) instead of anonymizer items (which reference the output).
        new_text = text
        if request_data is None:
            verbose_proxy_logger.warning(
                "Presidio anonymize_text called without request_data — "
                "PII tokens cannot be stored per-request. "
                "This may indicate a missing caller update."
            )
            request_data = {}
        if not request_data.get("metadata"):
            request_data["metadata"] = {}
        if "pii_tokens" not in request_data["metadata"]:
            request_data["metadata"]["pii_tokens"] = {}
        pii_tokens = request_data["metadata"]["pii_tokens"]
        pii_token_sources = request_data["metadata"].setdefault("pii_token_sources", {})
        log_context = _PRESIDIO_LOG_CONTEXT.get() or {}
        input_source = log_context.get("input_source")

        # Assign sequence numbers in forward (left-to-right) order so
        # that <PERSON_1> is the first entity in the text, etc.
        sorted_forward = sorted(analyze_results, key=lambda x: x["start"])
        sequence_start = len(pii_tokens)
        seq_map = {}
        for idx, ar in enumerate(sorted_forward, start=1):
            seq_map[(ar["start"], ar["end"])] = sequence_start + idx

        # Apply replacements in reverse order by start position so
        # that replacing later spans first does not shift earlier
        # coordinates in the original text.
        for ar in reversed(sorted_forward):
            start = ar["start"]
            end = ar["end"]
            entity_type = ar["entity_type"]
            configured_entity_type = self._resolve_configured_entity_type(
                entity_type,
                self.pii_entities_config.keys(),
            )
            replacement_entity_type = self._entity_type_value(configured_entity_type or entity_type)
            seq = seq_map[(start, end)]
            replacement = f"<{replacement_entity_type}_{seq}>"
            pii_tokens[replacement] = text[start:end]
            if input_source is not None:
                pii_token_sources[replacement] = input_source
            new_text = new_text[:start] + replacement + new_text[end:]
            masked_entity_count[replacement_entity_type] = masked_entity_count.get(replacement_entity_type, 0) + 1
        return new_text

    async def anonymize_text(
        self,
        text: str,
        analyze_results: list[PresidioAnalyzeResponseItem] | _PresidioAnonymizeResponse,
        output_parse_pii: bool,
        masked_entity_count: dict[str, int],
        request_data: dict | None = None,
    ) -> str:
        """
        Send analysis results to the Presidio anonymizer endpoint to get redacted text
        """
        try:
            # If there are no detections after filtering, return the original text
            if isinstance(analyze_results, list) and len(analyze_results) == 0:
                return text

            redacted_text: Final = await self._post_presidio_anonymize(text, analyze_results)
            if redacted_text is None:
                raise Exception("Invalid anonymizer response: received None")

            if not output_parse_pii:
                return self._finalize_presidio_anonymize_simple(redacted_text, masked_entity_count)

            return self._finalize_presidio_anonymize_numbered_tokens(
                text, analyze_results, request_data, masked_entity_count
            )
        except Exception as e:
            # Sanitize exception to avoid leaking the original text (which may
            # contain API keys or other secrets) in error responses.
            error_str = str(e)
            if isinstance(e, (aiohttp.ClientError, asyncio.TimeoutError)):
                raise _PresidioServiceError(f"Presidio PII anonymization failed: {type(e).__name__}") from e
            if isinstance(e, _PresidioServiceError):
                raise
            if "Invalid anonymizer response" in error_str or "Presidio anonymizer returned" in error_str:
                raise _PresidioServiceError(error_str) from e
            raise Exception(f"Presidio PII anonymization failed: {type(e).__name__}") from e

    def filter_analyze_results_by_score(
        self, analyze_results: list[PresidioAnalyzeResponseItem] | _PresidioAnonymizeResponse
    ) -> list[PresidioAnalyzeResponseItem] | _PresidioAnonymizeResponse:
        """
        Drop detections that fall below configured per-entity score thresholds
        or match an entity type in the deny list.
        """
        if not self.presidio_score_thresholds and not self.presidio_entities_deny_list:
            return analyze_results

        if not isinstance(analyze_results, list):
            return analyze_results

        filtered_results: Final[list[PresidioAnalyzeResponseItem]] = []
        deny_list_strings: Final = [getattr(x, "value", str(x)) for x in self.presidio_entities_deny_list]
        for item in analyze_results:
            entity_type = item.get("entity_type")

            if entity_type and self._resolve_configured_entity_type(entity_type, deny_list_strings) is not None:
                continue

            if self.presidio_score_thresholds:
                score = item.get("score")
                threshold = None
                if entity_type is not None:
                    threshold_entity_type = self._resolve_configured_entity_type(
                        entity_type,
                        self.presidio_score_thresholds.keys(),
                    )
                    if threshold_entity_type is not None:
                        threshold = self.presidio_score_thresholds.get(threshold_entity_type)
                if threshold is None:
                    threshold = self.presidio_score_thresholds.get("ALL")

                if threshold is not None:
                    if score is None or score < threshold:
                        continue

            filtered_results.append(item)

        return filtered_results

    def raise_exception_if_blocked_entities_detected(
        self, analyze_results: list[PresidioAnalyzeResponseItem] | _PresidioAnonymizeResponse
    ):
        """
        Raise an exception if blocked entities are detected
        """
        blocked_entity_type = self._blocked_entity_type(analyze_results)
        if blocked_entity_type is not None:
            raise BlockedPiiEntityError(
                entity_type=blocked_entity_type,
                guardrail_name=self.guardrail_name,
            )

    async def _check_pii_with_context(
        self,
        text: str,
        output_parse_pii: bool,
        presidio_config: PresidioPerRequestConfig | None,
        request_data: dict,
        log_context: PresidioLogContext,
    ) -> str:
        context_token = _PRESIDIO_LOG_CONTEXT.set(log_context)
        try:
            return await self.check_pii(
                text=text,
                output_parse_pii=output_parse_pii,
                presidio_config=presidio_config,
                request_data=request_data,
            )
        finally:
            _PRESIDIO_LOG_CONTEXT.reset(context_token)

    async def _check_pii_with_limit(
        self,
        semaphore: asyncio.Semaphore,
        text: str,
        output_parse_pii: bool,
        presidio_config: PresidioPerRequestConfig | None,
        request_data: dict,
        log_context: PresidioLogContext | None = None,
    ) -> str:
        async with semaphore:
            if log_context is not None:
                return await self._check_pii_with_context(
                    text=text,
                    output_parse_pii=output_parse_pii,
                    presidio_config=presidio_config,
                    request_data=request_data,
                    log_context=log_context,
                )
            return await self.check_pii(
                text=text,
                output_parse_pii=output_parse_pii,
                presidio_config=presidio_config,
                request_data=request_data,
            )

    async def check_pii(
        self,
        text: str,
        output_parse_pii: bool,
        presidio_config: PresidioPerRequestConfig | None,
        request_data: dict,
    ) -> str:
        """
        Calls Presidio Analyze + Anonymize endpoints for PII Analysis + Masking
        """
        if current_analysis_context() is None:
            with analysis_request_scope(max_concurrency=self.presidio_max_parallel_requests):
                return await self.check_pii(text, output_parse_pii, presidio_config, request_data)
        start_time = datetime.now()
        analysis_text = self._text_for_pii_analysis(text)
        analyze_results: list[PresidioAnalyzeResponseItem] | dict | None = None
        status: GuardrailStatus = "success"
        masked_entity_count: Final[dict[str, int]] = {}
        exception_str: str = ""
        try:
            if self.mock_redacted_text is not None:
                redacted_text: Final = self.mock_redacted_text
            else:
                # First get analysis results
                analyze_results = await self.analyze_text(
                    text=analysis_text,
                    presidio_config=presidio_config,
                    request_data=request_data,
                )

                # Apply score threshold filtering if configured
                analyze_results = self.filter_analyze_results_by_score(analyze_results=analyze_results)

                ####################################################
                # Blocked Entities check
                ####################################################
                if self._blocked_entity_type(analyze_results) is not None:
                    masked_text, blocked_masked_entities = self._mask_detected_entities_for_logging(
                        text=text,
                        analyze_results=analyze_results,
                    )
                    for masked_entity in blocked_masked_entities:
                        masked_entity_count[masked_entity] = masked_entity_count.get(masked_entity, 0) + 1
                    self._sanitize_blocked_content_for_logging(
                        request_data=request_data,
                        sensitive_text=text,
                        masked_text=masked_text,
                    )
                    if isinstance(analyze_results, list):
                        for result in analyze_results:
                            start = result.get("start")
                            end = result.get("end")
                            entity_type = result.get("entity_type")
                            if not isinstance(start, int) or not isinstance(end, int) or entity_type is None:
                                continue
                            if start < 0 or end <= start or end > len(text):
                                continue
                            self._sanitize_blocked_content_for_logging(
                                request_data=request_data,
                                sensitive_text=text[start:end],
                                masked_text=f"<{self._entity_type_value(entity_type)}>",
                                redact_fragmented_responses=False,
                            )
                self.raise_exception_if_blocked_entities_detected(analyze_results=analyze_results)

                # Then anonymize the text using the analysis results
                anonymized_text: Final = await self.anonymize_text(
                    text=text,
                    analyze_results=analyze_results,
                    output_parse_pii=output_parse_pii,
                    masked_entity_count=masked_entity_count,
                    request_data=request_data,
                )
                return anonymized_text
            return redacted_text["text"]
        except asyncio.CancelledError:
            status = "guardrail_failed_to_respond"
            exception_str = "Presidio check cancelled before completion"
            raise
        except BlockedPiiEntityError as e:
            status = "guardrail_intervened"
            exception_str = str(e)
            raise
        except _PresidioServiceError as e:
            status = "guardrail_failed_to_respond"
            exception_str = str(e)
            if self.unreachable_fallback == "fail_open":
                verbose_proxy_logger.error(
                    "Presidio service unavailable; allowing content because unreachable_fallback=fail_open: %s",
                    type(e).__name__,
                )
                return text
            raise
        finally:
            ####################################################
            # Create Guardrail Trace for logging on Langfuse, Datadog, etc.
            ####################################################
            guardrail_json_response: Exception | str | dict | list[dict] = {}
            if status == "success":
                if isinstance(analyze_results, list):
                    guardrail_json_response = [dict(item) for item in analyze_results]
            else:
                guardrail_json_response = exception_str
            log_context = _PRESIDIO_LOG_CONTEXT.get() or {}
            self.add_standard_logging_guardrail_information_to_request_data(
                guardrail_provider=self.guardrail_provider,
                guardrail_json_response=guardrail_json_response,
                request_data=request_data,
                guardrail_status=status,
                start_time=start_time.timestamp(),
                end_time=datetime.now().timestamp(),
                duration=(datetime.now() - start_time).total_seconds(),
                masked_entity_count=masked_entity_count,
                guardrail_run_id=log_context.get("guardrail_run_id"),
                event_type=log_context.get("guardrail_event"),
                input_source=log_context.get("input_source"),
                usage_action=(
                    "flagged"
                    if status == "success" and isinstance(analyze_results, list) and len(analyze_results) > 0
                    else None
                ),
                enforcement_mode="observe" if self.logging_only else "enforce",
                analysis_cache=self._analysis_cache_info(text, presidio_config, request_data),
            )

    async def async_pre_call_hook(
        self,
        user_api_key_dict: UserAPIKeyAuth,
        cache: DualCache,
        data: dict,
        call_type: str,
    ):
        started: Final = time.monotonic()
        with analysis_request_scope(
            tenant_scope=f"team:{user_api_key_dict.team_id}"
            if user_api_key_dict is not None and user_api_key_dict.team_id
            else None,
            max_concurrency=self.presidio_max_parallel_requests,
            redis_cache=getattr(cache, "redis_cache", None),
        ) as context:
            try:
                return await asyncio.wait_for(
                    self._native_pre_call(user_api_key_dict, cache, data, call_type), context.remaining()
                )
            except asyncio.TimeoutError:
                self._analysis_cache.counters["timeout"] += 1
                self._analysis_cache.counters["fail_closed"] += 1
                raise _PresidioServiceError("Presidio pre-call deadline exceeded") from None
            finally:
                self._analysis_cache.observe("guardrail_total", time.monotonic() - started)

    @staticmethod
    def _content_texts(content: object) -> tuple[str, ...]:
        if isinstance(content, str):
            return (content,)
        if not isinstance(content, list):
            return ()
        return tuple(
            text for block in content if isinstance(block, Mapping) and isinstance(text := block.get("text"), str)
        )

    async def _native_pre_call(
        self,
        user_api_key_dict: UserAPIKeyAuth,
        cache: DualCache,
        data: dict,
        call_type: str,
    ):
        """
        - Check if request turned off pii
            - Check if user allowed to turn off pii (key permissions -> 'allow_pii_controls')

        - Take the request data
        - Call /analyze -> get the results
        - Call /anonymize w/ the analyze results -> get the redacted text

        For multiple messages in /chat/completions, we'll need to call them in parallel.
        """
        # Respect the configured event hook. In `logging_only` mode (and any config that
        # excludes pre_call) the live request must not be masked - masking is applied to a
        # copy at logging time via `async_logging_hook`. Without this gate the request sent
        # to the model would carry anonymization tokens and the response would echo them.
        if (
            self.should_run_guardrail(
                data=data,
                event_type=GuardrailEventHooks.pre_call,
            )
            is not True
        ):
            return data

        try:
            content_safety: Final = data.get("content_safety", None)
            verbose_proxy_logger.debug("content_safety: %s", content_safety)
            presidio_config: Final = self.get_presidio_settings_from_request_data(data)
            messages: Final = data.get("messages", None)
            if messages is None:
                return data
            tasks: Final = []
            task_mappings: list[tuple[int, int | None]] = []  # Track (message_index, content_index) for each task
            context = current_analysis_context()
            semaphore = (
                context.semaphore if context is not None else asyncio.Semaphore(self.presidio_max_parallel_requests)
            )

            fragments: Final = tuple(
                fragment for message in messages for fragment in self._content_texts(message.get("content"))
            )
            await self._prepare_analysis(fragments, presidio_config, data)
            for msg_idx, m in enumerate(messages):
                content = m.get("content", None)
                if content is None:
                    continue
                if isinstance(content, str):
                    tasks.append(
                        self._check_pii_with_limit(
                            semaphore=semaphore,
                            text=content,
                            output_parse_pii=self.output_parse_pii,
                            presidio_config=presidio_config,
                            request_data=data,
                        )
                    )
                    task_mappings.append((msg_idx, None))  # None indicates string content
                elif isinstance(content, list):
                    for content_idx, c in enumerate(content):
                        text_str = c.get("text", None)
                        if text_str is None:
                            continue
                        tasks.append(
                            self._check_pii_with_limit(
                                semaphore=semaphore,
                                text=text_str,
                                output_parse_pii=self.output_parse_pii,
                                presidio_config=presidio_config,
                                request_data=data,
                            )
                        )
                        task_mappings.append((msg_idx, int(content_idx)))

            responses = await self._bounded_checks(tasks)
            first_exception: Exception | None = None

            # Map responses back to the correct message and content item
            for task_idx, r in enumerate(responses):
                if isinstance(r, Exception):
                    if first_exception is None:
                        first_exception = r
                    continue
                mapping = task_mappings[task_idx]
                msg_idx = mapping[0]
                content_idx_optional = mapping[1]
                content = messages[msg_idx].get("content", None)
                if content is None:
                    continue
                if isinstance(content, str) and content_idx_optional is None:
                    messages[msg_idx]["content"] = r  # replace content with redacted string
                elif isinstance(content, list) and content_idx_optional is not None:
                    messages[msg_idx]["content"][content_idx_optional]["text"] = r

            if first_exception is not None:
                raise first_exception

            data["messages"] = self._canonicalize_reversible_token_order(messages, data)
            return data
        except Exception as e:
            raise e

    def logging_hook(self, kwargs: dict, result: Any, call_type: str) -> tuple[dict, Any]:
        from concurrent.futures import ThreadPoolExecutor

        def run_in_new_loop():
            """Run the coroutine in a new event loop within this thread."""
            new_loop: Final = asyncio.new_event_loop()
            try:
                asyncio.set_event_loop(new_loop)
                return new_loop.run_until_complete(
                    self.async_logging_hook(kwargs=kwargs, result=result, call_type=call_type)
                )
            finally:
                new_loop.close()
                asyncio.set_event_loop(None)

        try:
            # First, try to get the current event loop
            _ = asyncio.get_running_loop()
            # If we're already in an event loop, run in a separate thread
            # to avoid nested event loop issues
            with ThreadPoolExecutor(max_workers=1) as executor:
                future: Final = executor.submit(run_in_new_loop)
                return future.result()

        except RuntimeError:
            # No running event loop, we can safely run in this thread
            return run_in_new_loop()

    @staticmethod
    def _sync_standard_logging_object(
        logged_kwargs: dict[str, object], translation: object, sync_messages: bool
    ) -> None:
        if sync_messages:
            logging_fields: Final[Mapping[str, object]] = logged_kwargs
            if "proxy_server_request" in logging_fields:
                logged_kwargs["proxy_server_request"] = _OPTIONAL_PresidioPIIMasking._masked_logging_request_snapshot(
                    logging_fields["proxy_server_request"], logging_fields
                )
            parameter_fields: Final = _OPTIONAL_PresidioPIIMasking._logging_mapping(
                logging_fields.get("litellm_params")
            )
            if parameter_fields is not None and "proxy_server_request" in parameter_fields:
                logged_kwargs["litellm_params"] = MappingProxyType(
                    {
                        **parameter_fields,
                        "proxy_server_request": _OPTIONAL_PresidioPIIMasking._masked_logging_request_snapshot(
                            parameter_fields["proxy_server_request"], logging_fields
                        ),
                    }
                ).copy()
        standard_logging_object = logged_kwargs.get("standard_logging_object")
        if not isinstance(standard_logging_object, dict):
            return

        get_structured_messages = getattr(translation, "get_structured_messages", None)
        if sync_messages and callable(get_structured_messages):
            structured_messages = get_structured_messages(logged_kwargs)
            if structured_messages is not None:
                standard_logging_object["messages"] = copy.deepcopy(structured_messages)

        metadata: Final = _OPTIONAL_PresidioPIIMasking._logging_mapping(
            logged_kwargs.get("metadata") or logged_kwargs.get("litellm_metadata")
        )
        if metadata is None:
            return
        guardrail_information: Final = metadata.get("standard_logging_guardrail_information")
        if guardrail_information is not None:
            standard_logging_object["guardrail_information"] = copy.deepcopy(guardrail_information)

    @staticmethod
    def _logging_mapping(value: object) -> Mapping[str, object] | None:
        return cast(Mapping[str, object], value) if isinstance(value, dict) else None

    @staticmethod
    def _masked_logging_request_snapshot(
        snapshot: object,
        logged_kwargs: Mapping[str, object],
    ) -> object:
        snapshot_mapping: Final = _OPTIONAL_PresidioPIIMasking._logging_mapping(snapshot)
        if snapshot_mapping is None:
            return snapshot
        body_mapping: Final = _OPTIONAL_PresidioPIIMasking._logging_mapping(snapshot_mapping.get("body"))
        if body_mapping is None:
            return snapshot
        content_fields: Final = frozenset(("messages", "input", "instructions", "tools"))
        masked_body: Final = MappingProxyType(
            {
                key: copy.deepcopy(logged_kwargs[key])
                if key in content_fields and key in logged_kwargs
                else _OPTIONAL_PresidioPIIMasking._logging_metadata_without_tokens(value)
                if key in ("metadata", "litellm_metadata")
                else value
                for key, value in body_mapping.items()
                if key != "pii_tokens"
            }
        ).copy()
        return MappingProxyType({**snapshot_mapping, "body": masked_body}).copy()

    @staticmethod
    def _logging_metadata_without_tokens(value: object) -> object:
        metadata: Final = _OPTIONAL_PresidioPIIMasking._logging_mapping(value)
        if metadata is None:
            return value
        return MappingProxyType({key: item for key, item in metadata.items() if key != "pii_tokens"}).copy()

    async def async_logging_hook(self, kwargs: dict, result: Any, call_type: str) -> tuple[dict, Any]:
        """
        Masks the input and output before logging to langfuse, datadog, etc.
        """
        from litellm.llms import load_guardrail_translation_mappings

        try:
            normalized_call_type = CallTypes(call_type)
        except ValueError:
            return kwargs, result

        translation_class = load_guardrail_translation_mappings().get(normalized_call_type)
        if translation_class is None or normalized_call_type not in {
            CallTypes.completion,
            CallTypes.acompletion,
            CallTypes.responses,
            CallTypes.aresponses,
        }:
            return kwargs, result

        logged_kwargs = dict[str, object](kwargs)
        for field in (
            "messages",
            "input",
            "instructions",
            "tools",
            "metadata",
            "litellm_metadata",
            "async_complete_streaming_response",
            "standard_logging_object",
        ):
            if field in kwargs:
                logged_kwargs[field] = copy.deepcopy(kwargs[field])
        logged_result = copy.deepcopy(result)
        translation = translation_class()
        logging_obj = kwargs.get("litellm_logging_obj")

        if self.presidio_filter_scope in ("input", "both"):
            logged_kwargs = await translation.process_input_messages(
                data=logged_kwargs,
                guardrail_to_apply=self,
                litellm_logging_obj=logging_obj,
            )
            self._sync_standard_logging_object(logged_kwargs, translation, sync_messages=True)

        if self.presidio_filter_scope == "input":
            return logged_kwargs, logged_result

        complete_stream = logged_kwargs.get("async_complete_streaming_response")
        standard_logging_object = logged_kwargs.get("standard_logging_object")
        standard_response = (
            standard_logging_object.get("response") if isinstance(standard_logging_object, dict) else None
        )
        output_to_audit = (
            complete_stream
            if complete_stream is not None
            else logged_result
            if logged_result is not None
            else standard_response
        )
        if output_to_audit is None:
            return logged_kwargs, logged_result
        if isinstance(output_to_audit, list):
            audited_output = await translation.process_output_streaming_response(
                responses_so_far=output_to_audit,
                guardrail_to_apply=self,
                litellm_logging_obj=logging_obj,
                request_data=logged_kwargs,
            )
        else:
            audited_output = await translation.process_output_response(
                response=output_to_audit,
                guardrail_to_apply=self,
                litellm_logging_obj=logging_obj,
                request_data=logged_kwargs,
            )

        audited_output = await self._audit_extended_output_fields(audited_output, logged_kwargs)

        if complete_stream is not None:
            logged_kwargs["async_complete_streaming_response"] = audited_output
        elif logged_result is not None:
            logged_result = audited_output

        if isinstance(standard_logging_object, dict):
            standard_logging_object["response"] = self._serialize_responses_api_response(audited_output)

        self._sync_standard_logging_object(logged_kwargs, translation, sync_messages=False)

        return logged_kwargs, logged_result

    async def async_post_call_success_hook(
        self,
        data: dict,
        user_api_key_dict: UserAPIKeyAuth,
        response: ModelResponse | EmbeddingResponse | ImageResponse,
    ):
        """
        Output parse the response object to replace the masked tokens with user sent values
        """
        verbose_proxy_logger.debug(
            "PII Masking Args: self.output_parse_pii=%s; type of response=%s", self.output_parse_pii, type(response)
        )

        if self.apply_to_output is True:
            if self._is_anthropic_message_response(response):
                return await self._process_anthropic_response_for_pii(
                    response=cast(dict, response), request_data=data, mode="mask"
                )
            return await self._mask_output_response(response=response, request_data=data)

        if self.output_parse_pii is False and litellm.output_parse_pii is False:
            return response

        self._preserve_masked_response_for_logging(
            response=response,
            logging_obj=data.get("litellm_logging_obj"),
        )

        if isinstance(response, ModelResponse) and not isinstance(
            response.choices[0], StreamingChoices
        ):  # /chat/completions requests
            await self._process_response_for_pii(
                response=response,
                request_data=data,
                mode="unmask",
            )
        elif self._is_anthropic_message_response(response):
            await self._process_anthropic_response_for_pii(
                response=cast(dict, response), request_data=data, mode="unmask"
            )
        return response

    @staticmethod
    def _unmask_pii_text(text: str, pii_tokens: dict[str, str]) -> str:
        """
        Replace PII tokens in *text* with their original values.

        Includes a fallback for tokens that were truncated by ``max_tokens``:
        if the *end* of ``text`` matches the *beginning* of a token and the
        overlap is long enough, the truncated suffix is replaced with the
        original value.  The minimum overlap length is
        ``min(20, len(token) // 2)`` to reduce the risk of false positives
        when multiple tokens share a common prefix.
        """
        for token, original_text in pii_tokens.items():
            if token in text:
                text = text.replace(token, original_text)
            else:
                # FALLBACK: Handle truncated tokens (token cut off by max_tokens)
                # Only check at the very end of the text.
                min_overlap = min(20, len(token) // 2)
                for i in range(max(0, len(text) - len(token)), len(text)):
                    sub = text[i:]
                    if token.startswith(sub) and len(sub) >= min_overlap:
                        text = text[:i] + original_text
                        break
        return text

    @classmethod
    def _get_restorable_pii_tokens(
        cls,
        request_data: dict,
    ) -> dict[str, str]:
        metadata = (request_data.get("metadata") or {}) if request_data else {}
        pii_tokens: dict[str, str] = metadata.get("pii_tokens", {})
        pii_token_sources = metadata.get("pii_token_sources")
        if not isinstance(pii_token_sources, dict):
            return pii_tokens
        return {
            token: original_text
            for token, original_text in pii_tokens.items()
            if isinstance(pii_token_sources.get(token), dict)
            and pii_token_sources[token].get("scope") in cls._RESTORABLE_INPUT_SCOPES
        }

    @staticmethod
    def _preserve_masked_response_for_logging(
        response: Any,
        logging_obj: "LiteLLMLoggingObj | None",
    ) -> None:
        if response is not None and logging_obj is not None:
            logging_obj.set_deferred_logging_result(copy.deepcopy(response))

    @staticmethod
    def _is_anthropic_message_response(
        response: ModelResponse | EmbeddingResponse | ImageResponse | dict[str, object],
    ) -> bool:
        """Check if the response is an Anthropic native message dict."""
        return (
            isinstance(response, dict)
            and response.get("type") == "message"
            and isinstance(response.get("content"), list)
        )

    async def _process_anthropic_response_for_pii(
        self,
        response: dict,
        request_data: dict,
        mode: Literal["mask", "unmask"],
    ) -> dict:
        """
        Process an Anthropic native message dict for PII masking/unmasking.
        Handles content blocks with type == "text".
        """
        pii_tokens = self._get_restorable_pii_tokens(request_data)
        if not pii_tokens and mode == "unmask":
            verbose_proxy_logger.debug("No pii_tokens in metadata for Anthropic response unmask")
        presidio_config: Final = self.get_presidio_settings_from_request_data(request_data or {})

        content: Final = response.get("content")
        if not isinstance(content, list):
            return response

        for block in content:
            if not isinstance(block, dict) or block.get("type") != "text":
                continue
            text_value = block.get("text")
            if text_value is None:
                continue
            if mode == "unmask":
                block["text"] = self._unmask_pii_text(text_value, pii_tokens)
            elif mode == "mask":
                block["text"] = await self.check_pii(
                    text=text_value,
                    output_parse_pii=False,
                    presidio_config=presidio_config,
                    request_data=request_data,
                )

        return response

    @staticmethod
    def _response_field(container: object, field: str) -> object:
        if isinstance(container, dict):
            return container.get(field)
        return getattr(container, field, None)

    @staticmethod
    def _set_response_field(container: object, field: str, value: object) -> None:
        if isinstance(container, dict):
            container[field] = value
            return
        setattr(container, field, value)

    @classmethod
    def _is_responses_api_response(cls, value: object) -> bool:
        if isinstance(value, ResponsesAPIResponse):
            return True
        object_type = cls._response_field(value, "object")
        output = cls._response_field(value, "output")
        return object_type == "response" or (isinstance(output, list) and cls._response_field(value, "choices") is None)

    @classmethod
    def _get_responses_api_response(cls, value: object) -> object | None:
        if cls._is_responses_api_response(value):
            return value
        nested_response = cls._response_field(value, "response")
        return nested_response if cls._is_responses_api_response(nested_response) else None

    @staticmethod
    def _serialize_responses_api_response(response: object) -> object:
        if isinstance(response, ResponsesAPIResponse):
            return response.model_dump()
        return copy.deepcopy(response)

    async def _mask_responses_copy_for_logging(
        self,
        value: object,
        request_data: dict,
    ) -> tuple[object, object | None]:
        if isinstance(value, list):
            masked_events = copy.deepcopy(value)
            contains_responses_event = False
            for event in masked_events:
                event_type = self._response_field(event, "type")
                if not isinstance(event_type, str) or not event_type.startswith("response."):
                    continue
                contains_responses_event = True
                nested_response = self._get_responses_api_response(event)
                if nested_response is not None:
                    await self._process_responses_api_response_for_pii(nested_response, request_data)
                await self._mask_responses_payload_field(event, "delta", request_data)
                await self._mask_responses_payload_field(event, "text", request_data)
                await self._mask_responses_payload_field(event, "arguments", request_data)
                await self._mask_responses_payload_field(event, "input", request_data)
                await self._mask_responses_payload_field(event, "output", request_data)
                await self._mask_responses_payload_field(event, "error", request_data)
                item = self._response_field(event, "item")
                if item is not None:
                    await self._mask_responses_blocks(self._response_field(item, "content"), request_data)
                    await self._mask_responses_blocks(self._response_field(item, "summary"), request_data)
                    await self._mask_responses_payload_field(item, "arguments", request_data)
                    await self._mask_responses_payload_field(item, "input", request_data)
                    await self._mask_responses_payload_field(item, "output", request_data)
            if contains_responses_event:
                return masked_events, masked_events

        response = self._get_responses_api_response(value)
        if response is None:
            return value, None
        masked_value = copy.deepcopy(value)
        masked_response = self._get_responses_api_response(masked_value)
        if masked_response is None:
            return value, None
        await self._process_responses_api_response_for_pii(masked_response, request_data)
        return masked_value, masked_response

    async def _mask_responses_text_field(
        self,
        container: object,
        field: str,
        request_data: dict,
    ) -> None:
        value = self._response_field(container, field)
        if not isinstance(value, str) or not value:
            return
        presidio_config = self.get_presidio_settings_from_request_data(request_data or {})
        masked = await self.check_pii(
            text=value,
            output_parse_pii=False,
            presidio_config=presidio_config,
            request_data=request_data,
        )
        self._set_response_field(container, field, masked)

    async def _mask_responses_payload(self, value: object, request_data: dict) -> object:
        if isinstance(value, str):
            if not value:
                return value
            presidio_config = self.get_presidio_settings_from_request_data(request_data or {})
            return await self.check_pii(
                text=value,
                output_parse_pii=False,
                presidio_config=presidio_config,
                request_data=request_data,
            )
        if isinstance(value, list):
            for index, item in enumerate(value):
                value[index] = await self._mask_responses_payload(item, request_data)
            return value
        if isinstance(value, dict):
            for key, item in value.items():
                value[key] = await self._mask_responses_payload(item, request_data)
        return value

    async def _mask_responses_payload_field(
        self,
        container: object,
        field: str,
        request_data: dict,
    ) -> None:
        value = self._response_field(container, field)
        if value is not None:
            self._set_response_field(container, field, await self._mask_responses_payload(value, request_data))

    async def _mask_responses_blocks(self, value: object, request_data: dict) -> None:
        if isinstance(value, list):
            for block in value:
                await self._mask_responses_text_field(block, "text", request_data)
                await self._mask_responses_text_field(block, "refusal", request_data)

    async def _process_responses_api_response_for_pii(
        self,
        response: object,
        request_data: dict,
        include_primary_content: bool = True,
    ) -> object:
        output = self._response_field(response, "output")
        if isinstance(output, list):
            for output_item in output:
                if include_primary_content:
                    await self._mask_responses_blocks(self._response_field(output_item, "content"), request_data)
                await self._mask_responses_blocks(self._response_field(output_item, "summary"), request_data)
                await self._mask_responses_payload_field(output_item, "reasoning_content", request_data)
                await self._mask_responses_blocks(self._response_field(output_item, "reasoning_items"), request_data)
                await self._mask_responses_payload_field(output_item, "arguments", request_data)
                await self._mask_responses_payload_field(output_item, "input", request_data)
                await self._mask_responses_payload_field(output_item, "output", request_data)
        reasoning = self._response_field(response, "reasoning")
        if reasoning is not None:
            await self._mask_responses_blocks(self._response_field(reasoning, "content"), request_data)
            await self._mask_responses_blocks(self._response_field(reasoning, "summary"), request_data)
        if isinstance(response, dict):
            await self._mask_responses_text_field(response, "output_text", request_data)
        if self._response_field(response, "error") is not None:
            await self._mask_responses_payload_field(response, "error", request_data)
        return response

    async def _audit_extended_output_fields(self, response: object, request_data: dict) -> object:
        responses_response = self._get_responses_api_response(response)
        if responses_response is not None:
            await self._process_responses_api_response_for_pii(
                responses_response,
                request_data,
                include_primary_content=False,
            )
            return response
        if isinstance(response, list):
            for event in response:
                nested_response = self._get_responses_api_response(event)
                if nested_response is not None:
                    await self._process_responses_api_response_for_pii(
                        nested_response,
                        request_data,
                        include_primary_content=False,
                    )
                for field in ("delta", "text", "arguments", "input", "output", "error"):
                    await self._mask_responses_payload_field(event, field, request_data)
                item = self._response_field(event, "item")
                if item is not None:
                    await self._mask_responses_blocks(self._response_field(item, "content"), request_data)
                    await self._mask_responses_blocks(self._response_field(item, "summary"), request_data)
                    for field in ("arguments", "input", "output"):
                        await self._mask_responses_payload_field(item, field, request_data)
            return response
        if not isinstance(response, ModelResponse):
            return response
        for choice in response.choices:
            message = getattr(choice, "message", None)
            if message is None:
                continue
            for field in ("reasoning_content", "thinking_blocks", "reasoning_items"):
                await self._mask_responses_payload_field(message, field, request_data)
        return response

    async def _process_response_for_pii(
        self,
        response: ModelResponse,
        request_data: dict,
        mode: Literal["mask", "unmask"],
    ) -> ModelResponse:
        """
        Helper to recursively process a ModelResponse for PII.
        Handles all choices and tool calls.
        """
        pii_tokens = self._get_restorable_pii_tokens(request_data)
        if not pii_tokens and mode == "unmask":
            verbose_proxy_logger.debug("No pii_tokens found in request_data['metadata'] — nothing to unmask")
        presidio_config: Final = self.get_presidio_settings_from_request_data(request_data or {})

        for choice in response.choices:
            message = getattr(choice, "message", None)
            if message is None:
                continue

            # 1. Process content
            content = getattr(message, "content", None)
            if isinstance(content, str):
                if mode == "unmask":
                    message.content = self._unmask_pii_text(content, pii_tokens)
                elif mode == "mask":
                    message.content = await self.check_pii(
                        text=content,
                        output_parse_pii=False,
                        presidio_config=presidio_config,
                        request_data=request_data,
                    )
            elif isinstance(content, list):
                for item in content:
                    if not isinstance(item, dict):
                        continue
                    text_value = item.get("text")
                    if text_value is None:
                        continue
                    if mode == "unmask":
                        item["text"] = self._unmask_pii_text(text_value, pii_tokens)
                    elif mode == "mask":
                        item["text"] = await self.check_pii(
                            text=text_value,
                            output_parse_pii=False,
                            presidio_config=presidio_config,
                            request_data=request_data,
                        )

            # 2. Process tool calls
            tool_calls = getattr(message, "tool_calls", None)
            if tool_calls:
                for tool_call in tool_calls:
                    function = getattr(tool_call, "function", None)
                    if function and hasattr(function, "arguments"):
                        args = function.arguments
                        if isinstance(args, str):
                            if mode == "unmask":
                                function.arguments = self._unmask_pii_text(args, pii_tokens)
                            elif mode == "mask":
                                function.arguments = await self.check_pii(
                                    text=args,
                                    output_parse_pii=False,
                                    presidio_config=presidio_config,
                                    request_data=request_data,
                                )

            # 3. Process legacy function calls
            function_call = getattr(message, "function_call", None)
            if function_call and hasattr(function_call, "arguments"):
                args = function_call.arguments
                if isinstance(args, str):
                    if mode == "unmask":
                        function_call.arguments = self._unmask_pii_text(args, pii_tokens)
                    elif mode == "mask":
                        function_call.arguments = await self.check_pii(
                            text=args,
                            output_parse_pii=False,
                            presidio_config=presidio_config,
                            request_data=request_data,
                        )
        return response

    async def _mask_output_response(
        self,
        response: ModelResponse | EmbeddingResponse | ImageResponse | ResponsesAPIResponse | dict,
        request_data: dict,
    ):
        """
        Apply Presidio masking on model responses (non-streaming).
        """

        responses_response = self._get_responses_api_response(response)
        if responses_response is not None:
            return await self._process_responses_api_response_for_pii(responses_response, request_data)

        if not isinstance(response, ModelResponse):
            return response

        # skip streaming here; handled in async_post_call_streaming_iterator_hook
        if isinstance(response, ModelResponseStream):
            return response

        await self._process_response_for_pii(
            response=response,
            request_data=request_data,
            mode="mask",
        )
        return response

    async def _stream_apply_output_masking(
        self,
        response: AsyncIterable[object],
        request_data: dict,
    ) -> AsyncGenerator[object, None]:
        states: dict[tuple[object, ...], _StreamingPiiState] = {}
        async for chunk in response:
            if isinstance(chunk, bytes):
                raise _PresidioServiceError("Presidio cannot safely inspect raw streaming bytes")
            if isinstance(chunk, ModelResponseStream):
                async for masked_chunk in self._mask_chat_stream_chunk(chunk, states, request_data):
                    yield masked_chunk
                continue
            event_type = self._response_field(chunk, "type")
            if not isinstance(event_type, str):
                raise _PresidioServiceError("Presidio received an unsupported streaming event")
            async for masked_event in self._mask_responses_stream_event(chunk, event_type, states, request_data):
                yield masked_event
        async for masked_chunk in self._flush_stream_states(states, request_data):
            yield masked_chunk

    async def _mask_stream_text(
        self,
        key: tuple[object, ...],
        text: str,
        states: dict[tuple[object, ...], _StreamingPiiState],
        request_data: dict,
    ) -> str:
        state = states.setdefault(key, _StreamingPiiState())
        pending = state.pending + text
        presidio_config = self.get_presidio_settings_from_request_data(request_data or {})
        masked = await self.check_pii(
            text=pending,
            output_parse_pii=False,
            presidio_config=presidio_config,
            request_data=request_data,
        )
        if len(pending) <= self._STREAM_PII_HOLDBACK_CHARS:
            state.pending = pending
            return ""
        suffix = pending[-self._STREAM_PII_HOLDBACK_CHARS :]
        if not masked.endswith(suffix):
            state.pending = pending
            return ""
        released = masked[: -self._STREAM_PII_HOLDBACK_CHARS]
        state.pending = suffix
        state.emitted += released
        return released

    async def _flush_stream_state(
        self,
        key: tuple[object, ...],
        states: dict[tuple[object, ...], _StreamingPiiState],
        request_data: dict,
    ) -> object | None:
        state = states.pop(key, None)
        if state is None:
            return None
        presidio_config = self.get_presidio_settings_from_request_data(request_data or {})
        masked = await self.check_pii(
            text=state.pending,
            output_parse_pii=False,
            presidio_config=presidio_config,
            request_data=request_data,
        )
        state.emitted += masked
        if not masked or state.template is None:
            return None
        chunk = copy.deepcopy(state.template)
        if key[0] == "chat" and isinstance(chunk, ModelResponseStream):
            self._set_chat_stream_text(chunk, key, masked)
        else:
            if self._response_field(chunk, "event_id") is not None:
                self._set_response_field(chunk, "event_id", f"guardrail-{uuid4()}")
            self._set_response_field(chunk, "delta", masked)
        return chunk

    async def _flush_stream_states(
        self,
        states: dict[tuple[object, ...], _StreamingPiiState],
        request_data: dict,
        predicate: Callable[[tuple[object, ...]], bool] | None = None,
    ) -> AsyncGenerator[object, None]:
        keys = tuple(states)
        for key in keys:
            if predicate is not None and not predicate(key):
                continue
            chunk = await self._flush_stream_state(key, states, request_data)
            if chunk is not None:
                yield chunk

    @staticmethod
    def _chat_stream_fields(chunk: ModelResponseStream) -> list[tuple[tuple[object, ...], str]]:
        fields: list[tuple[tuple[object, ...], str]] = []
        for choice in chunk.choices:
            delta = choice.delta
            choice_index = choice.index
            for field in ("content", "reasoning_content", "refusal"):
                value = getattr(delta, field, None)
                if isinstance(value, str) and value:
                    fields.append((("chat", choice_index, field), value))
            function_call = getattr(delta, "function_call", None)
            arguments = getattr(function_call, "arguments", None)
            if isinstance(arguments, str) and arguments:
                fields.append((("chat", choice_index, "function_call"), arguments))
            for tool_call in getattr(delta, "tool_calls", None) or []:
                arguments = getattr(getattr(tool_call, "function", None), "arguments", None)
                if isinstance(arguments, str) and arguments:
                    tool_index = tool_call.index
                    fields.append((("chat", choice_index, "tool_call", tool_index), arguments))
        return fields

    @classmethod
    def _set_chat_stream_text(cls, chunk: ModelResponseStream, key: tuple[object, ...], text: str) -> None:
        choice = cls._chat_stream_choice(chunk, cast(int, key[1]))
        field = cast(str, key[2])
        if field in {"content", "reasoning_content", "refusal"}:
            setattr(choice.delta, field, text)
            return
        if field == "function_call":
            function_call = getattr(choice.delta, "function_call", None)
            if function_call is not None:
                function_call.arguments = text
            return
        tool_index = cast(int, key[3])
        for tool_call in getattr(choice.delta, "tool_calls", None) or []:
            if tool_call.index == tool_index:
                tool_call.function.arguments = text
                return

    @staticmethod
    def _chat_stream_choice(chunk: ModelResponseStream, choice_index: int) -> StreamingChoices:
        return next(choice for choice in chunk.choices if choice.index == choice_index)

    @staticmethod
    def _clear_chat_stream_text(chunk: ModelResponseStream) -> None:
        for choice in chunk.choices:
            delta = choice.delta
            for field in ("content", "reasoning_content", "refusal"):
                if isinstance(getattr(delta, field, None), str):
                    setattr(delta, field, "")
            function_call = getattr(delta, "function_call", None)
            if isinstance(getattr(function_call, "arguments", None), str):
                function_call.arguments = ""
            for tool_call in getattr(delta, "tool_calls", None) or []:
                function = getattr(tool_call, "function", None)
                if isinstance(getattr(function, "arguments", None), str):
                    function.arguments = ""

    async def _mask_chat_stream_chunk(
        self,
        chunk: ModelResponseStream,
        states: dict[tuple[object, ...], _StreamingPiiState],
        request_data: dict,
    ) -> AsyncGenerator[ModelResponseStream, None]:
        finished_choices = frozenset(choice.index for choice in chunk.choices if choice.finish_reason is not None)
        fields = self._chat_stream_fields(chunk)
        for key, text in fields:
            self._set_chat_stream_text(chunk, key, await self._mask_stream_text(key, text, states, request_data))
        for key, _ in fields:
            template = copy.deepcopy(chunk)
            self._clear_chat_stream_text(template)
            for choice in template.choices:
                choice.finish_reason = None
            states[key].template = template
        if finished_choices:
            async for flushed in self._flush_stream_states(
                states,
                request_data,
                lambda key: len(key) > 1 and key[0] == "chat" and key[1] in finished_choices,
            ):
                yield cast(ModelResponseStream, flushed)
        yield chunk

    @staticmethod
    def _responses_stream_key(event: object, event_type: str) -> tuple[object, ...]:
        family = event_type.removesuffix(".delta").removesuffix(".done")
        return (
            "responses",
            family,
            _OPTIONAL_PresidioPIIMasking._response_field(event, "item_id"),
            _OPTIONAL_PresidioPIIMasking._response_field(event, "output_index"),
            _OPTIONAL_PresidioPIIMasking._response_field(event, "content_index"),
            _OPTIONAL_PresidioPIIMasking._response_field(event, "summary_index"),
        )

    async def _mask_responses_stream_event(
        self,
        event: object,
        event_type: str,
        states: dict[tuple[object, ...], _StreamingPiiState],
        request_data: dict,
    ) -> AsyncGenerator[object, None]:
        delta_types = frozenset(
            (
                "response.output_text.delta",
                "response.refusal.delta",
                "response.reasoning_summary_text.delta",
                "response.reasoning_text.delta",
                "response.function_call_arguments.delta",
                "response.mcp_call_arguments.delta",
                "response.code_interpreter_call_code.delta",
            )
        )
        done_fields = {
            "response.output_text.done": "text",
            "response.refusal.done": "refusal",
            "response.reasoning_summary_text.done": "text",
            "response.reasoning_text.done": "text",
            "response.function_call_arguments.done": "arguments",
            "response.mcp_call_arguments.done": "arguments",
            "response.code_interpreter_call_code.done": "code",
        }
        key = self._responses_stream_key(event, event_type)
        if event_type in delta_types:
            delta = self._response_field(event, "delta")
            if not isinstance(delta, str):
                raise _PresidioServiceError("Presidio received a text delta without text")
            masked = await self._mask_stream_text(key, delta, states, request_data)
            self._set_response_field(event, "delta", masked)
            template = copy.deepcopy(event)
            self._set_response_field(template, "delta", "")
            states[key].template = template
            yield event
            return
        if event_type in done_fields:
            state = states.get(key)
            flushed = await self._flush_stream_state(key, states, request_data)
            if flushed is not None:
                yield flushed
            if state is not None:
                self._set_response_field(event, done_fields[event_type], state.emitted)
            else:
                state_text = self._response_field(event, done_fields[event_type])
                if not isinstance(state_text, str):
                    yield event
                    return
                presidio_config = self.get_presidio_settings_from_request_data(request_data or {})
                masked = await self.check_pii(state_text, False, presidio_config, request_data)
                self._set_response_field(event, done_fields[event_type], masked)
            yield event
            return
        if event_type in {
            "response.completed",
            "response.failed",
            "response.incomplete",
            "response.created",
            "response.in_progress",
            "response.queued",
            "response.done",
        }:
            async for flushed in self._flush_stream_states(states, request_data):
                yield flushed
            nested_response = self._response_field(event, "response")
            if nested_response is not None:
                await self._process_responses_api_response_for_pii(nested_response, request_data)
            yield event
            return
        if event_type in {"response.output_item.added", "response.output_item.done"}:
            item = self._response_field(event, "item")
            if item is not None:
                await self._mask_responses_blocks(self._response_field(item, "content"), request_data)
                await self._mask_responses_blocks(self._response_field(item, "summary"), request_data)
                for field in ("reasoning_content", "arguments", "input", "output"):
                    await self._mask_responses_payload_field(item, field, request_data)
            yield event
            return
        if event_type in {
            "response.content_part.added",
            "response.content_part.done",
            "response.reasoning_summary_part.added",
            "response.reasoning_summary_part.done",
        }:
            part = self._response_field(event, "part")
            if part is not None:
                await self._mask_responses_text_field(part, "text", request_data)
                await self._mask_responses_text_field(part, "refusal", request_data)
            yield event
            return
        if event_type == "response.output_text.annotation.added":
            await self._mask_responses_payload_field(event, "annotation", request_data)
            yield event
            return
        if event_type.startswith("response.") or event_type == "error":
            for field in ("delta", "text", "arguments", "input", "output", "error"):
                value = self._response_field(event, field)
                if value is not None:
                    raise _PresidioServiceError(f"Presidio does not support text-bearing event {event_type}")
            yield event
            return
        raise _PresidioServiceError(f"Presidio does not support streaming event {event_type}")

    @staticmethod
    def _unmask_sse_bytes_chunk(chunk: bytes, pii_tokens: dict[str, str]) -> bytes:
        try:
            text: Final = chunk.decode("utf-8")
        except UnicodeDecodeError:
            return chunk

        result_lines: Final[list[str]] = []
        for line in text.split("\n"):
            line = line.rstrip("\r")
            if line.startswith("data: ") and line != "data: [DONE]":
                raw_json = line[6:]
                try:
                    event = json.loads(raw_json)
                    delta = event.get("delta") if isinstance(event, dict) else None
                    if (
                        isinstance(delta, dict)
                        and event.get("type") == "content_block_delta"
                        and delta.get("type") == "text_delta"
                        and isinstance(delta.get("text"), str)
                    ):
                        unmasked = _OPTIONAL_PresidioPIIMasking._unmask_pii_text(delta["text"], pii_tokens)
                        if unmasked != delta["text"]:
                            event["delta"]["text"] = unmasked
                            line = "data: " + json.dumps(event, ensure_ascii=False)
                except (json.JSONDecodeError, KeyError, TypeError):
                    pass
            result_lines.append(line)

        return "\n".join(result_lines).encode("utf-8")

    def _unmask_responses_api_completed_chunk(self, chunk: Any, pii_tokens: dict[str, str]) -> None:
        """
        Unmask PII tokens in-place for a ``response.completed`` Responses API event.

        The chunk carries a ``response`` attribute (ResponsesAPIResponse) whose
        ``output`` list holds message items.  Each item has a ``content`` list of
        blocks; text blocks expose a ``.text`` string attribute.  We walk the tree
        and replace every PII token with its original value.
        """
        response_obj: Final = getattr(chunk, "response", None)
        if response_obj is None:
            return

        output: Final = getattr(response_obj, "output", None) or []
        for output_item in output:
            content = getattr(output_item, "content", None) or []
            for content_block in content:
                if isinstance(content_block, dict):
                    if isinstance(content_block.get("text"), str):
                        content_block["text"] = self._unmask_pii_text(content_block["text"], pii_tokens)
                elif hasattr(content_block, "text") and isinstance(content_block.text, str):
                    content_block.text = self._unmask_pii_text(content_block.text, pii_tokens)

    async def _stream_pii_unmasking(
        self,
        response: Any,
        request_data: dict,
    ) -> AsyncGenerator[ModelResponseStream | bytes, None]:
        """Apply PII unmasking to streaming output (output_parse_pii=True path)."""
        from litellm.llms.base_llm.base_model_iterator import (
            convert_model_response_to_streaming,
        )
        from litellm.main import stream_chunk_builder
        from litellm.types.utils import ModelResponse

        pii_tokens = self._get_restorable_pii_tokens(request_data)

        remaining_chunks: list[ModelResponseStream] = []
        saw_non_chat_chunk = False
        try:
            async for chunk in response:
                if isinstance(chunk, ModelResponseStream):
                    if saw_non_chat_chunk:
                        yield chunk
                    else:
                        remaining_chunks.append(chunk)
                elif isinstance(chunk, bytes):
                    if pii_tokens:
                        yield self._unmask_sse_bytes_chunk(chunk, pii_tokens)
                    else:
                        yield chunk
                    continue
                else:
                    # /v1/responses events: unmask response.completed text in-place.
                    # A mixed stream can't be reassembled, so flush buffered chat
                    # chunks in order before passthrough instead of dropping them.
                    if remaining_chunks and not saw_non_chat_chunk:
                        for buffered_chunk in remaining_chunks:
                            yield buffered_chunk
                        remaining_chunks = []
                    chunk_type = getattr(chunk, "type", None)
                    if chunk_type == "response.completed" and pii_tokens:
                        self._unmask_responses_api_completed_chunk(chunk, pii_tokens)
                    saw_non_chat_chunk = True
                    yield chunk

            if saw_non_chat_chunk:
                return

            if not remaining_chunks:
                return

            assembled_model_response: Final = stream_chunk_builder(
                chunks=remaining_chunks, messages=request_data.get("messages")
            )

            if not isinstance(assembled_model_response, ModelResponse):
                for chunk in remaining_chunks:
                    yield chunk
                return

            self._preserve_usage_from_last_chunk(assembled_model_response, remaining_chunks)

            await self._process_response_for_pii(
                response=assembled_model_response,
                request_data=request_data,
                mode="unmask",
            )

            mock_response_stream: Final = convert_model_response_to_streaming(assembled_model_response)
            yield mock_response_stream

        except Exception as e:
            verbose_proxy_logger.error("Error in PII streaming processing: %s", e)
            for chunk in remaining_chunks:
                yield chunk

    async def async_post_call_streaming_iterator_hook(
        self,
        user_api_key_dict: UserAPIKeyAuth,
        response: Any,
        request_data: dict,
    ) -> AsyncGenerator[ModelResponseStream | bytes, None]:
        """
        Process streaming response chunks to unmask PII tokens when needed.

        Note: the return type includes `bytes` because Anthropic native SSE
        streaming sends raw bytes chunks that pass through untransformed.
        The base class declares ModelResponseStream only.
        """
        if self.apply_to_output:
            async for chunk in self._stream_apply_output_masking(response, request_data):
                yield chunk
            return

        pii_tokens = self._get_restorable_pii_tokens(request_data)
        if not pii_tokens and request_data:
            verbose_proxy_logger.debug("No pii_tokens in request_data['metadata'] for streaming unmask path")
        if not (self.output_parse_pii and pii_tokens):
            async for chunk in response:
                yield chunk
            return

        async for chunk in self._stream_pii_unmasking(response, request_data):
            yield chunk

    @staticmethod
    def _preserve_usage_from_last_chunk(
        assembled_model_response: ModelResponse,
        chunks: list[ModelResponseStream],
    ) -> None:
        """Copy usage metadata from the last chunk when stream_chunk_builder misses it."""
        if not getattr(assembled_model_response, "usage", None) and chunks:
            last_chunk_usage: Final = getattr(chunks[-1], "usage", None)
            if last_chunk_usage:
                setattr(assembled_model_response, "usage", last_chunk_usage)

    def get_presidio_settings_from_request_data(self, data: dict) -> PresidioPerRequestConfig | None:
        if "metadata" in data:
            _metadata: Final = data.get("metadata", None)
            if _metadata is None:
                return None
            _guardrail_config: Final = _metadata.get("guardrail_config")
            if _guardrail_config:
                _presidio_config: Final = PresidioPerRequestConfig(**_guardrail_config)
                return _presidio_config

        return None

    def print_verbose(self, print_statement):
        try:
            verbose_proxy_logger.debug(print_statement)
            if litellm.set_verbose:
                print(print_statement)  # noqa: T201
        except Exception:
            pass

    @log_guardrail_information
    async def apply_guardrail(
        self,
        inputs: GenericGuardrailAPIInputs,
        request_data: dict[str, object],
        input_type: Literal["request", "response"],
        logging_obj: "LiteLLMLoggingObj | None" = None,
    ) -> GenericGuardrailAPIInputs:
        started: Final = time.monotonic()
        with analysis_request_scope(max_concurrency=self.presidio_max_parallel_requests) as context:
            try:
                return await asyncio.wait_for(
                    self._apply_guardrail(inputs, request_data, input_type, logging_obj), context.remaining()
                )
            except asyncio.TimeoutError:
                self._analysis_cache.counters["timeout"] += 1
                self._analysis_cache.counters["fail_closed"] += 1
                raise _PresidioServiceError("Presidio pre-call deadline exceeded") from None
            finally:
                self._analysis_cache.observe("guardrail_total", time.monotonic() - started)

    @staticmethod
    def _tool_arguments(function: Mapping[str, object]) -> str:
        arguments: Final = function.get("arguments")
        if not isinstance(arguments, str):
            raise _PresidioServiceError("Presidio tool arguments must be text")
        return arguments

    async def _apply_guardrail(
        self,
        inputs: "GenericGuardrailAPIInputs",
        request_data: dict[str, object],
        input_type: Literal["request", "response"],
        logging_obj: "LiteLLMLoggingObj | None" = None,
    ) -> "GenericGuardrailAPIInputs":
        """
        UI will call this function to check:
            1. If the connection to the guardrail is working
            2. When Testing the guardrail with some text, this function will be called with the input text and returns a text after applying the guardrail
        """
        texts = inputs.get("texts", [])
        text_sources = inputs.get("text_sources", [])
        guardrail_run_id = str(uuid4())
        guardrail_event = (
            GuardrailEventHooks.logging_only
            if self.logging_only
            else GuardrailEventHooks.pre_call
            if input_type == "request"
            else GuardrailEventHooks.post_call
        )

        # When input_type is "response" and pii_tokens are available,
        # unmask the text instead of masking it.
        pii_tokens = self._get_restorable_pii_tokens(request_data)

        should_unmask_response = (
            input_type == "response" and bool(pii_tokens) and self.output_parse_pii and not self.apply_to_output
        )
        if should_unmask_response:
            self._preserve_masked_response_for_logging(
                response=request_data.get("response"),
                logging_obj=logging_obj,
            )

        tool_call_functions: list[tuple[int, dict]] = []
        tool_calls = inputs.get("tool_calls")
        if isinstance(tool_calls, list):
            for tool_call_index, tool_call in enumerate(tool_calls):
                if not isinstance(tool_call, dict):
                    continue
                function = tool_call.get("function")
                if isinstance(function, dict) and isinstance(function.get("arguments"), str):
                    tool_call_functions.append((tool_call_index, function))

        if should_unmask_response:
            inputs["texts"] = [self._unmask_pii_text(text, pii_tokens) for text in texts]
            for _, function in tool_call_functions:
                arguments = self._tool_arguments(function)
                function["arguments"] = self._unmask_pii_text(arguments, pii_tokens)
        else:
            context = current_analysis_context()
            semaphore = (
                context.semaphore if context is not None else asyncio.Semaphore(self.presidio_max_parallel_requests)
            )
            check_texts: Final = tuple(texts) + tuple(
                self._tool_arguments(function) for _, function in tool_call_functions
            )
            await self._prepare_analysis(
                check_texts,
                None,
                request_data,
                log_contexts=tuple(
                    PresidioLogContext(
                        guardrail_run_id=guardrail_run_id,
                        guardrail_event=guardrail_event,
                        input_source=text_sources[index]
                        if index < len(text_sources)
                        else GuardrailInputSource(
                            type="request" if input_type == "request" else "response", path=f"texts[{index}]"
                        ),
                    )
                    for index in range(len(texts))
                )
                + tuple(
                    PresidioLogContext(
                        guardrail_run_id=guardrail_run_id,
                        guardrail_event=guardrail_event,
                        input_source=GuardrailInputSource(
                            type="tool_call", path=f"tool_calls[{index}].function.arguments"
                        ),
                    )
                    for index, _ in tool_call_functions
                ),
            )
            tasks = []
            for text_index, text in enumerate(texts):
                input_source: GuardrailInputSource = (
                    text_sources[text_index]
                    if text_index < len(text_sources)
                    else {
                        "type": "request" if input_type == "request" else "response",
                        "path": f"texts[{text_index}]",
                    }
                )
                tasks.append(
                    self._check_pii_with_limit(
                        semaphore=semaphore,
                        text=text,
                        output_parse_pii=self._should_create_reversible_tokens(
                            self.output_parse_pii,
                            input_source,
                        ),
                        presidio_config=None,
                        request_data=request_data,
                        log_context={
                            "guardrail_run_id": guardrail_run_id,
                            "guardrail_event": guardrail_event,
                            "input_source": input_source,
                        },
                    )
                )

            for tool_call_index, function in tool_call_functions:
                arguments = self._tool_arguments(function)
                tasks.append(
                    self._check_pii_with_limit(
                        semaphore=semaphore,
                        text=arguments,
                        output_parse_pii=self.output_parse_pii,
                        presidio_config=None,
                        request_data=request_data,
                        log_context={
                            "guardrail_run_id": guardrail_run_id,
                            "guardrail_event": guardrail_event,
                            "input_source": {
                                "type": "tool_call",
                                "path": f"tool_calls[{tool_call_index}].function.arguments",
                            },
                        },
                    )
                )

            responses = await self._bounded_checks(tasks)
            if tasks:
                # ContextVar updates made inside gather tasks do not propagate
                # back to this parent task. Tell the outer logging decorator
                # that each real Presidio check already recorded its own entry.
                self.mark_guardrail_information_recorded()
            first_exception = next((result for result in responses if isinstance(result, Exception)), None)
            if first_exception is not None:
                for original_text, result in sorted(
                    zip(check_texts, responses, strict=True), key=lambda item: len(item[0]), reverse=True
                ):
                    if isinstance(result, str) and result != original_text:
                        self._sanitize_blocked_content_for_logging(
                            request_data=request_data,
                            sensitive_text=original_text,
                            masked_text=result,
                            redact_fragmented_responses=False,
                        )
                raise first_exception

            text_count = len(texts)
            inputs["texts"] = [cast(str, result) for result in responses[:text_count]]
            for (_, function), result in zip(tool_call_functions, responses[text_count:], strict=True):
                function["arguments"] = cast(str, result)
        if input_type == "request" and not should_unmask_response:
            inputs = cast(
                GenericGuardrailAPIInputs,
                self._canonicalize_reversible_token_order(inputs, request_data),
            )
        return inputs

    def _set_pii_policy(
        self,
        entities: dict[PiiEntityType | str, PiiAction] | None,
        thresholds: dict[PiiEntityType | str, float] | None,
        deny_list: list[PiiEntityType | str] | None,
    ) -> None:
        self.pii_entities_config: dict[PiiEntityType | str, PiiAction] = entities or {}
        self.presidio_score_thresholds: dict[PiiEntityType | str, float] = thresholds or {}
        self.presidio_entities_deny_list: list[PiiEntityType | str] = deny_list or []

    def update_in_memory_litellm_params(self, litellm_params: LitellmParams) -> None:
        """
        Update the guardrails litellm params in memory
        """
        for key in litellm_params.model_fields_set:
            setattr(self, key, getattr(litellm_params, key))
        self.unreachable_fallback = (
            litellm_params.unreachable_fallback
            if "unreachable_fallback" in litellm_params.model_fields_set
            else "fail_closed"
        )
        if "presidio_max_parallel_requests" in litellm_params.model_fields_set:
            self.presidio_max_parallel_requests = litellm_params.presidio_max_parallel_requests
        self._analysis_cache = AnalysisCache(
            AnalysisCacheConfig.from_env().with_guardrail_overrides(
                litellm_params.presidio_analysis_cache_enabled,
                litellm_params.presidio_analysis_cache_ttl_seconds,
            ),
            redis_cache=self._analysis_cache.redis_cache,
        )
        self._set_pii_policy(self.pii_entities_config, self.presidio_score_thresholds, self.presidio_entities_deny_list)
        self.presidio_language = self.presidio_language or "en"
        self.presidio_filter_scope = self.presidio_filter_scope or "both"
        self.presidio_analyze_chunk_size_bytes = self._coerce_analyze_chunk_size(self.presidio_analyze_chunk_size_bytes)
