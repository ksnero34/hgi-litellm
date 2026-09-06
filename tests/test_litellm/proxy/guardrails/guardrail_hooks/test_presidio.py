"""
Unit tests for Presidio PII Masking Guardrail
Tests PII detection and masking for different message formats
"""

import asyncio
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import litellm
from litellm.caching.caching import DualCache
from litellm.exceptions import BlockedPiiEntityError
from litellm.litellm_core_utils.litellm_logging import Logging
from litellm.proxy._types import UserAPIKeyAuth
from litellm.proxy.guardrails.guardrail_hooks.presidio import (
    _OPTIONAL_PresidioPIIMasking,
    _PresidioServiceError,
)
from litellm.types.guardrails import LitellmParams, PiiAction, PiiEntityType
from litellm.types.llms.openai import ResponsesAPIResponse
from litellm.types.utils import Choices, Message, ModelResponse


@pytest.mark.asyncio
async def test_virtual_key_logging_only_invokes_presidio_from_async_success_handler():
    presidio = _OPTIONAL_PresidioPIIMasking(
        guardrail_name="virtual-key-presidio",
        default_on=False,
        logging_only=True,
        presidio_filter_scope="input",
        mock_testing=True,
    )
    presidio.check_pii = AsyncMock(return_value="<PERSON>")
    logging = Logging(
        model="gpt-4o",
        messages=[{"role": "user", "content": "홍길동"}],
        stream=False,
        call_type="completion",
        start_time=1.0,
        litellm_call_id="virtual-key-logging-only",
        function_id="virtual-key-logging-only",
    )
    logging.model_call_details["litellm_params"]["metadata"] = {
        "guardrails": ["virtual-key-presidio"],
    }
    logging.model_call_details["messages"] = [{"role": "user", "content": "홍길동"}]
    response = ModelResponse(
        model="gpt-4o",
        choices=[
            Choices(
                index=0,
                message=Message(role="assistant", content="안녕하세요"),
            )
        ],
    )

    with patch.object(logging, "get_combined_callback_list", return_value=[presidio]):
        await logging.async_success_handler(
            result=response,
            start_time=1.0,
            end_time=2.0,
            cache_hit=False,
        )

    presidio.check_pii.assert_awaited_once()
    assert response.choices[0].message.content == "안녕하세요"


@pytest.mark.asyncio
async def test_policy_logging_only_invokes_presidio_with_policy_attribution():
    from litellm.proxy.litellm_pre_call_utils import (
        _add_guardrails_from_policies_in_metadata,
    )
    from litellm.proxy.policy_engine.policy_registry import get_policy_registry
    from litellm.types.proxy.policy_engine import Policy, PolicyGuardrails

    registry = get_policy_registry()
    original_policies = registry._policies
    original_initialized = registry._initialized
    registry._policies = {
        "team-audit-policy": Policy(
            guardrails=PolicyGuardrails(add=["policy-presidio"]),
        )
    }
    registry._initialized = True
    request_data = {
        "model": "gpt-4o",
        "messages": [{"role": "user", "content": "홍길동"}],
        "metadata": {},
    }

    try:
        _add_guardrails_from_policies_in_metadata(
            key_metadata={},
            team_metadata={"policies": ["team-audit-policy"]},
            data=request_data,
            metadata_variable_name="metadata",
        )

        presidio = _OPTIONAL_PresidioPIIMasking(
            guardrail_name="policy-presidio",
            default_on=False,
            logging_only=True,
            presidio_filter_scope="input",
            mock_testing=True,
        )
        presidio.analyze_text = AsyncMock(
            return_value=[
                {
                    "entity_type": "PERSON",
                    "start": 0,
                    "end": 3,
                    "score": 0.99,
                }
            ]
        )
        presidio.anonymize_text = AsyncMock(return_value="<PERSON>")
        logging = Logging(
            model="gpt-4o",
            messages=request_data["messages"],
            stream=False,
            call_type="completion",
            start_time=1.0,
            litellm_call_id="policy-logging-only",
            function_id="policy-logging-only",
        )
        logging.model_call_details["litellm_params"]["metadata"] = request_data["metadata"]
        logging.model_call_details["messages"] = request_data["messages"]
        response = ModelResponse(
            model="gpt-4o",
            choices=[
                Choices(
                    index=0,
                    message=Message(role="assistant", content="안녕하세요"),
                )
            ],
        )

        with patch.object(logging, "get_combined_callback_list", return_value=[presidio]):
            await logging.async_success_handler(
                result=response,
                start_time=1.0,
                end_time=2.0,
                cache_hit=False,
            )

        presidio.analyze_text.assert_awaited_once()
        guardrail_information = logging.model_call_details["metadata"]["standard_logging_guardrail_information"]
        assert guardrail_information[0]["usage_action"] == "flagged"
        assert guardrail_information[0]["enforcement_mode"] == "observe"
        assert guardrail_information[0]["policy_names"] == ["team-audit-policy"]
    finally:
        registry._policies = original_policies
        registry._initialized = original_initialized


def _make_mock_session_iterator(json_response, status=200, content_type="application/json", text_response=""):
    """Create a mock _get_session_iterator that yields a session returning json_response."""

    @asynccontextmanager
    async def mock_iterator():
        class MockResponse:
            def __init__(self):
                self.status = status
                self.content_type = content_type
                self.headers = {"Content-Type": content_type}

            async def text(self):
                if text_response:
                    return text_response
                import json

                try:
                    return json.dumps(json_response)
                except Exception:
                    return str(json_response)

            async def json(self):
                return json_response

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

        class MockSession:
            def post(self, *args, **kwargs):
                self.last_kwargs = kwargs
                return MockResponse()

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

        yield MockSession()

    return mock_iterator


@pytest.fixture
def presidio_guardrail():
    """Create a Presidio guardrail instance for testing"""
    return _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        output_parse_pii=False,
        pii_entities_config={
            PiiEntityType.CREDIT_CARD: PiiAction.MASK,
            PiiEntityType.EMAIL_ADDRESS: PiiAction.MASK,
            PiiEntityType.PHONE_NUMBER: PiiAction.MASK,
        },
    )


@pytest.fixture
def mock_user_api_key():
    """Create a mock user API key auth object"""
    return UserAPIKeyAuth(
        api_key="test_key",
        user_id="test_user",
    )


@pytest.fixture
def mock_cache():
    """Create a mock cache object"""
    return MagicMock(spec=DualCache)


@pytest.mark.asyncio
async def test_multimodal_message_format_completion_call_type(presidio_guardrail, mock_user_api_key, mock_cache):
    """
    Test Presidio PII masking with multimodal message format (content as list)
    for completion call type.

    Tests the message format:
    {
        "role": "user",
        "content": [
            {
                "type": "text",
                "text": "My credit card number is 4111-1111-1111-1111..."
            }
        ]
    }
    """
    # Prepare test data with multimodal message format
    test_data = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "My credit card number is 4111-1111-1111-1111, my email is test@example.com, and my phone is 555-123-4567",
                    }
                ],
            }
        ],
        "model": "gpt-4",
    }

    # Mock the check_pii method to return redacted text
    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        # Simulate PII detection and masking
        redacted_text = text
        redacted_text = redacted_text.replace("4111-1111-1111-1111", "[CREDIT_CARD]")
        redacted_text = redacted_text.replace("test@example.com", "[EMAIL]")
        redacted_text = redacted_text.replace("555-123-4567", "[PHONE]")
        return redacted_text

    presidio_guardrail.check_pii = mock_check_pii

    # Call the async_pre_call_hook with call_type="completion"
    result = await presidio_guardrail.async_pre_call_hook(
        user_api_key_dict=mock_user_api_key,
        cache=mock_cache,
        data=test_data,
        call_type="completion",
    )

    # Verify that PII was masked in the text field
    assert result is not None
    assert "messages" in result
    assert len(result["messages"]) == 1

    message = result["messages"][0]
    assert "content" in message
    assert isinstance(message["content"], list)
    assert len(message["content"]) == 1

    content_item = message["content"][0]
    assert content_item["type"] == "text"
    assert "[CREDIT_CARD]" in content_item["text"]
    assert "[EMAIL]" in content_item["text"]
    assert "[PHONE]" in content_item["text"]

    # Verify original PII is not present
    assert "4111-1111-1111-1111" not in content_item["text"]
    assert "test@example.com" not in content_item["text"]
    assert "555-123-4567" not in content_item["text"]


@pytest.mark.asyncio
async def test_multimodal_message_format_anthropic_messages_call_type(
    presidio_guardrail, mock_user_api_key, mock_cache
):
    """
    Test Presidio PII masking with multimodal message format (content as list)
    for anthropic_messages call type.

    Tests the same message format but with anthropic_messages call type.
    """
    # Prepare test data with multimodal message format
    test_data = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "My credit card number is 4111-1111-1111-1111, my email is test@example.com, and my phone is 555-123-4567",
                    }
                ],
            }
        ],
        "model": "claude-3-opus-20240229",
    }

    # Mock the check_pii method to return redacted text
    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        # Simulate PII detection and masking
        redacted_text = text
        redacted_text = redacted_text.replace("4111-1111-1111-1111", "[CREDIT_CARD]")
        redacted_text = redacted_text.replace("test@example.com", "[EMAIL]")
        redacted_text = redacted_text.replace("555-123-4567", "[PHONE]")
        return redacted_text

    presidio_guardrail.check_pii = mock_check_pii

    # Call the async_pre_call_hook with call_type="anthropic_messages"
    result = await presidio_guardrail.async_pre_call_hook(
        user_api_key_dict=mock_user_api_key,
        cache=mock_cache,
        data=test_data,
        call_type="anthropic_messages",
    )

    # Verify that PII was masked in the text field
    assert result is not None
    assert "messages" in result
    assert len(result["messages"]) == 1

    message = result["messages"][0]
    assert "content" in message
    assert isinstance(message["content"], list)
    assert len(message["content"]) == 1

    content_item = message["content"][0]
    assert content_item["type"] == "text"
    assert "[CREDIT_CARD]" in content_item["text"]
    assert "[EMAIL]" in content_item["text"]
    assert "[PHONE]" in content_item["text"]

    # Verify original PII is not present
    assert "4111-1111-1111-1111" not in content_item["text"]
    assert "test@example.com" not in content_item["text"]
    assert "555-123-4567" not in content_item["text"]


@pytest.mark.asyncio
async def test_multimodal_message_multiple_content_items(presidio_guardrail, mock_user_api_key, mock_cache):
    """
    Test Presidio PII masking with multiple content items in the content list.
    """
    # Prepare test data with multiple content items
    test_data = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "My credit card is 4111-1111-1111-1111",
                    },
                    {
                        "type": "text",
                        "text": "My email is test@example.com",
                    },
                ],
            }
        ],
        "model": "gpt-4",
    }

    # Mock the check_pii method
    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        redacted_text = text
        redacted_text = redacted_text.replace("4111-1111-1111-1111", "[CREDIT_CARD]")
        redacted_text = redacted_text.replace("test@example.com", "[EMAIL]")
        return redacted_text

    presidio_guardrail.check_pii = mock_check_pii

    # Call the async_pre_call_hook
    result = await presidio_guardrail.async_pre_call_hook(
        user_api_key_dict=mock_user_api_key,
        cache=mock_cache,
        data=test_data,
        call_type="completion",
    )

    # Verify both content items were processed
    assert result is not None
    message = result["messages"][0]
    content_items = message["content"]

    assert len(content_items) == 2
    assert "[CREDIT_CARD]" in content_items[0]["text"]
    assert "[EMAIL]" in content_items[1]["text"]


@pytest.mark.asyncio
async def test_mixed_string_and_list_content(presidio_guardrail, mock_user_api_key, mock_cache):
    """
    Test Presidio PII masking with mixed string and list content formats.
    """
    # Prepare test data with mixed content formats
    test_data = {
        "messages": [
            {
                "role": "user",
                "content": "My credit card is 4111-1111-1111-1111",
            },
            {
                "role": "assistant",
                "content": "I can help you with that.",
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "My email is test@example.com",
                    }
                ],
            },
        ],
        "model": "gpt-4",
    }

    # Mock the check_pii method
    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        redacted_text = text
        redacted_text = redacted_text.replace("4111-1111-1111-1111", "[CREDIT_CARD]")
        redacted_text = redacted_text.replace("test@example.com", "[EMAIL]")
        return redacted_text

    presidio_guardrail.check_pii = mock_check_pii

    # Call the async_pre_call_hook
    result = await presidio_guardrail.async_pre_call_hook(
        user_api_key_dict=mock_user_api_key,
        cache=mock_cache,
        data=test_data,
        call_type="completion",
    )

    # Verify all messages were processed correctly
    assert result is not None
    messages = result["messages"]

    # First message (string content)
    assert isinstance(messages[0]["content"], str)
    assert "[CREDIT_CARD]" in messages[0]["content"]

    # Second message (string content, no PII)
    assert isinstance(messages[1]["content"], str)
    assert messages[1]["content"] == "I can help you with that."

    # Third message (list content)
    assert isinstance(messages[2]["content"], list)
    assert "[EMAIL]" in messages[2]["content"][0]["text"]


@pytest.mark.asyncio
async def test_content_list_without_text_field(presidio_guardrail, mock_user_api_key, mock_cache):
    """
    Test Presidio PII masking gracefully handles content items without text field
    (e.g., image content items).
    """
    # Prepare test data with image content (no text field)
    test_data = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": "https://example.com/image.jpg"},
                    },
                    {
                        "type": "text",
                        "text": "What's in this image? My email is test@example.com",
                    },
                ],
            }
        ],
        "model": "gpt-4-vision",
    }

    # Mock the check_pii method
    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        redacted_text = text.replace("test@example.com", "[EMAIL]")
        return redacted_text

    presidio_guardrail.check_pii = mock_check_pii

    # Call the async_pre_call_hook
    result = await presidio_guardrail.async_pre_call_hook(
        user_api_key_dict=mock_user_api_key,
        cache=mock_cache,
        data=test_data,
        call_type="completion",
    )

    # Verify that image content is preserved and text content is processed
    assert result is not None
    content_items = result["messages"][0]["content"]

    assert len(content_items) == 2
    # Image content should remain unchanged
    assert content_items[0]["type"] == "image_url"
    assert content_items[0]["image_url"]["url"] == "https://example.com/image.jpg"

    # Text content should be redacted
    assert content_items[1]["type"] == "text"
    assert "[EMAIL]" in content_items[1]["text"]


@pytest.mark.asyncio
async def test_empty_messages(presidio_guardrail, mock_user_api_key, mock_cache):
    """
    Test that Presidio handles empty messages gracefully.
    """
    test_data = {
        "messages": [],
        "model": "gpt-4",
    }

    # Call the async_pre_call_hook
    result = await presidio_guardrail.async_pre_call_hook(
        user_api_key_dict=mock_user_api_key,
        cache=mock_cache,
        data=test_data,
        call_type="completion",
    )

    # Should return data unchanged
    assert result == test_data


@pytest.mark.asyncio
async def test_no_messages_field(presidio_guardrail, mock_user_api_key, mock_cache):
    """
    Test that Presidio handles missing messages field gracefully.
    """
    test_data = {
        "model": "gpt-4",
        "prompt": "This is a completion request",
    }

    # Call the async_pre_call_hook
    result = await presidio_guardrail.async_pre_call_hook(
        user_api_key_dict=mock_user_api_key,
        cache=mock_cache,
        data=test_data,
        call_type="completion",
    )

    # Should return data unchanged
    assert result == test_data


@pytest.mark.asyncio
async def test_logging_hook_multimodal_message_format(presidio_guardrail):
    """
    Test Presidio async_logging_hook with multimodal message format for completion call type.
    This hook is used to mask PII before logging to external services.
    """
    # Prepare kwargs with multimodal message format
    test_kwargs = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "My credit card number is 4111-1111-1111-1111, my email is test@example.com",
                    }
                ],
            }
        ],
        "model": "gpt-4",
    }

    # Mock result
    mock_result = {"choices": [{"message": {"content": "Response"}}]}

    # Mock the check_pii method
    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        redacted_text = text
        redacted_text = redacted_text.replace("4111-1111-1111-1111", "[CREDIT_CARD]")
        redacted_text = redacted_text.replace("test@example.com", "[EMAIL]")
        return redacted_text

    presidio_guardrail.check_pii = mock_check_pii

    # Call the async_logging_hook
    result_kwargs, result_response = await presidio_guardrail.async_logging_hook(
        kwargs=test_kwargs,
        result=mock_result,
        call_type="completion",
    )

    # Verify that PII was masked in the kwargs
    assert result_kwargs is not None
    assert "messages" in result_kwargs
    message = result_kwargs["messages"][0]
    content_item = message["content"][0]

    assert "[CREDIT_CARD]" in content_item["text"]
    assert "[EMAIL]" in content_item["text"]
    assert "4111-1111-1111-1111" not in content_item["text"]
    assert "test@example.com" not in content_item["text"]


@pytest.mark.asyncio
async def test_logging_hook_multiple_content_items(presidio_guardrail):
    """
    Test Presidio async_logging_hook with multiple content items in a single message.
    """
    test_kwargs = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "My credit card is 4111-1111-1111-1111",
                    },
                    {
                        "type": "text",
                        "text": "My email is test@example.com",
                    },
                ],
            }
        ],
        "model": "gpt-4",
    }

    mock_result = {"choices": [{"message": {"content": "Response"}}]}

    # Mock the check_pii method
    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        redacted_text = text
        redacted_text = redacted_text.replace("4111-1111-1111-1111", "[CREDIT_CARD]")
        redacted_text = redacted_text.replace("test@example.com", "[EMAIL]")
        return redacted_text

    presidio_guardrail.check_pii = mock_check_pii

    # Call the async_logging_hook
    result_kwargs, result_response = await presidio_guardrail.async_logging_hook(
        kwargs=test_kwargs,
        result=mock_result,
        call_type="completion",
    )

    # Verify both content items were processed
    message = result_kwargs["messages"][0]
    content_items = message["content"]

    assert len(content_items) == 2
    assert "[CREDIT_CARD]" in content_items[0]["text"]
    assert "[EMAIL]" in content_items[1]["text"]


@pytest.mark.asyncio
async def test_logging_hook_masks_the_response_too(presidio_guardrail):
    """
    Regression: async_logging_hook only masked kwargs["messages"] (the request) and
    left `result` (the model's response) completely untouched, so in `logging_only`
    mode any PII in the assistant's reply was logged to langfuse/datadog/etc. in the
    clear. The hook's own docstring promises masking "before logging" for both input
    and output.
    """

    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        return text.replace("4111-1111-1111-1111", "[CREDIT_CARD]")

    presidio_guardrail.check_pii = mock_check_pii

    test_kwargs = {
        "messages": [{"role": "user", "content": "hello"}],
        "model": "gpt-4",
    }
    response = ModelResponse(
        id="1",
        object="chat.completion",
        created=0,
        model="gpt-test",
        choices=[
            Choices(
                message=Message(
                    role="assistant",
                    content="Sure, your card is 4111-1111-1111-1111",
                ),
                index=0,
                finish_reason="stop",
            )
        ],
    )

    _, result_response = await presidio_guardrail.async_logging_hook(
        kwargs=test_kwargs,
        result=response,
        call_type="completion",
    )

    assert "[CREDIT_CARD]" in result_response.choices[0].message.content
    assert "4111-1111-1111-1111" not in result_response.choices[0].message.content


@pytest.mark.asyncio
async def test_logging_only_does_not_mask_pre_call_request(mock_user_api_key, mock_cache):
    """
    A guardrail configured with `logging_only` must only mask PII for logs/traces,
    never for the request sent to the model. `async_pre_call_hook` should leave the
    request untouched so the model receives (and replies based on) the real input.

    Regression test for the case where the pre-call hook masked the live request,
    causing the model's response to contain anonymization tokens (e.g. <PERSON>)
    instead of the real output.
    """
    presidio_guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        logging_only=True,
        pii_entities_config={PiiEntityType.PHONE_NUMBER: PiiAction.MASK},
    )

    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        return text.replace("555-123-4567", "[PHONE]")

    presidio_guardrail.check_pii = mock_check_pii

    original_text = "My phone is 555-123-4567"
    test_data = {
        "messages": [{"role": "user", "content": original_text}],
        "model": "gpt-4",
    }

    result = await presidio_guardrail.async_pre_call_hook(
        user_api_key_dict=mock_user_api_key,
        cache=mock_cache,
        data=test_data,
        call_type="completion",
    )

    # The live request must be unchanged: PII reaches the model intact.
    assert result["messages"][0]["content"] == original_text
    assert "[PHONE]" not in result["messages"][0]["content"]


@pytest.mark.asyncio
async def test_logging_only_syncs_masked_request_and_guardrail_information_to_standard_logging_object():
    class DetectingPresidio(_OPTIONAL_PresidioPIIMasking):
        async def analyze_text(self, text, presidio_config, request_data):
            return [{"entity_type": "EMAIL_ADDRESS", "start": 0, "end": len(text), "score": 0.99}]

        async def anonymize_text(
            self,
            text,
            analyze_results,
            output_parse_pii,
            masked_entity_count,
            request_data=None,
        ):
            return text.replace("person@example.com", "[EMAIL]")

    presidio = DetectingPresidio(
        mock_testing=True,
        logging_only=True,
        presidio_filter_scope="input",
        pii_entities_config={PiiEntityType.EMAIL_ADDRESS: PiiAction.MASK},
    )
    original_messages = [{"role": "user", "content": "Email person@example.com"}]
    kwargs = {
        "messages": original_messages,
        "metadata": {},
        "standard_logging_object": {
            "messages": original_messages,
            "guardrail_information": None,
        },
    }

    logged_kwargs, _ = await presidio.async_logging_hook(
        kwargs=kwargs,
        result={"choices": [{"message": {"content": "response"}}]},
        call_type="acompletion",
    )

    assert kwargs["messages"][0]["content"] == "Email person@example.com"
    standard_logging_object = logged_kwargs["standard_logging_object"]
    assert standard_logging_object["messages"][0]["content"] == "Email [EMAIL]"
    guardrail_information = standard_logging_object["guardrail_information"]
    assert guardrail_information
    assert guardrail_information[-1]["usage_action"] == "flagged"
    assert guardrail_information[-1]["enforcement_mode"] == "observe"
    assert guardrail_information[-1]["guardrail_event"] == "logging_only"
    assert guardrail_information[-1]["guardrail_mode"] == "logging_only"


@pytest.mark.asyncio
async def test_logging_only_masks_responses_api_output_without_mutating_live_response():
    presidio = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        logging_only=True,
        pii_entities_config={PiiEntityType.EMAIL_ADDRESS: PiiAction.MASK},
    )

    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        return text.replace("SECRET", "[MASKED]")

    presidio.check_pii = mock_check_pii
    response = {
        "object": "response",
        "status": "completed",
        "output_text": "SECRET root",
        "output": [
            {
                "type": "reasoning",
                "content": [{"type": "reasoning_text", "text": "SECRET reasoning"}],
                "summary": [{"type": "summary_text", "text": "SECRET summary"}],
            },
            {
                "type": "message",
                "content": [{"type": "output_text", "text": "SECRET answer"}],
            },
            {
                "type": "function_call",
                "arguments": '{"token":"SECRET"}',
            },
            {
                "type": "function_call_output",
                "output": {"result": "SECRET tool output"},
            },
        ],
        "error": {"message": "SECRET provider error"},
    }
    kwargs = {"standard_logging_object": {"response": response}}

    logged_kwargs, logged_result = await presidio.async_logging_hook(
        kwargs=kwargs,
        result=response,
        call_type="aresponses",
    )

    assert response["output"][0]["content"][0]["text"] == "SECRET reasoning"
    assert logged_result["output"][0]["content"][0]["text"] == "[MASKED] reasoning"
    assert logged_result["output"][0]["summary"][0]["text"] == "[MASKED] summary"
    assert logged_result["output"][1]["content"][0]["text"] == "[MASKED] answer"
    assert logged_result["output"][2]["arguments"] == '{"token":"[MASKED]"}'
    assert logged_result["output"][3]["output"]["result"] == "[MASKED] tool output"
    assert logged_result["output_text"] == "[MASKED] root"
    assert logged_result["error"]["message"] == "[MASKED] provider error"
    assert logged_kwargs["standard_logging_object"]["response"] == logged_result


@pytest.mark.asyncio
async def test_logging_only_masks_completed_stream_response_for_logging():
    presidio = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        logging_only=True,
        pii_entities_config={PiiEntityType.EMAIL_ADDRESS: PiiAction.MASK},
    )

    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        return text.replace("SECRET", "[MASKED]")

    presidio.check_pii = mock_check_pii
    completed_response = {
        "object": "response",
        "output": [
            {
                "type": "reasoning",
                "content": [{"type": "reasoning_text", "text": "SECRET stream reasoning"}],
            }
        ],
    }
    kwargs = {
        "async_complete_streaming_response": completed_response,
        "standard_logging_object": {},
    }

    logged_kwargs, _ = await presidio.async_logging_hook(
        kwargs=kwargs,
        result=None,
        call_type="aresponses",
    )

    assert completed_response["output"][0]["content"][0]["text"] == "SECRET stream reasoning"
    masked_stream = logged_kwargs["async_complete_streaming_response"]
    assert masked_stream["output"][0]["content"][0]["text"] == "[MASKED] stream reasoning"
    assert logged_kwargs["standard_logging_object"]["response"] == masked_stream

    raw_events = [
        {"type": "response.reasoning_text.delta", "delta": "SECRET raw reasoning"},
        {"type": "response.output_text.delta", "delta": "SECRET raw output"},
        {"type": "response.output_text.done", "text": "SECRET final output"},
        {"type": "response.function_call_arguments.done", "arguments": '{"value":"SECRET"}'},
    ]
    raw_kwargs = {"standard_logging_object": {}}

    raw_logged_kwargs, raw_logged_result = await presidio.async_logging_hook(
        kwargs=raw_kwargs,
        result=raw_events,
        call_type="aresponses",
    )

    assert raw_events[0]["delta"] == "SECRET raw reasoning"
    assert raw_logged_result[0]["delta"] == "[MASKED] raw reasoning"
    assert raw_logged_result[1]["delta"] == "[MASKED] raw output"
    assert raw_logged_kwargs["standard_logging_object"]["response"] == raw_logged_result
    assert raw_logged_result[2]["text"] == "[MASKED] final output"
    assert raw_logged_result[3]["arguments"] == '{"value":"[MASKED]"}'


@pytest.mark.asyncio
async def test_logging_only_audits_standard_response_when_result_is_missing():
    presidio = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        logging_only=True,
        pii_entities_config={PiiEntityType.EMAIL_ADDRESS: PiiAction.MASK},
    )

    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        return text.replace("SECRET", "[MASKED]")

    presidio.check_pii = mock_check_pii
    kwargs = {
        "standard_logging_object": {
            "response": {
                "object": "response",
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": "SECRET answer"}],
                    }
                ],
            }
        }
    }

    logged_kwargs, logged_result = await presidio.async_logging_hook(
        kwargs=kwargs,
        result=None,
        call_type="aresponses",
    )

    assert logged_result is None
    logged_response = logged_kwargs["standard_logging_object"]["response"]
    assert logged_response["output"][0]["content"][0]["text"] == "[MASKED] answer"


@pytest.mark.asyncio
async def test_apply_to_output_masks_responses_api_response(mock_user_api_key):
    presidio = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        apply_to_output=True,
        pii_entities_config={PiiEntityType.EMAIL_ADDRESS: PiiAction.MASK},
    )

    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        return text.replace("SECRET", "[MASKED]")

    presidio.check_pii = mock_check_pii
    response = {
        "object": "response",
        "output": [{"type": "message", "content": [{"type": "output_text", "text": "SECRET answer"}]}],
    }

    result = await presidio.async_post_call_success_hook(
        data={},
        user_api_key_dict=mock_user_api_key,
        response=response,
    )

    assert result["output"][0]["content"][0]["text"] == "[MASKED] answer"

    typed_response = ResponsesAPIResponse(
        id="resp_presidio",
        created_at=0,
        output=[
            {
                "type": "message",
                "id": "msg_presidio",
                "status": "completed",
                "role": "assistant",
                "content": [
                    {
                        "type": "output_text",
                        "text": "SECRET typed answer",
                        "annotations": [],
                    }
                ],
            }
        ],
    )
    typed_result = await presidio.async_post_call_success_hook(
        data={},
        user_api_key_dict=mock_user_api_key,
        response=typed_response,
    )

    assert typed_result.output_text == "[MASKED] typed answer"


@pytest.mark.asyncio
async def test_presidio_sets_guardrail_information_in_request_data():
    """
    Test that Presidio populates guardrail information into request_data metadata.

    This validates that add_standard_logging_guardrail_information_to_request_data
    correctly sets the guardrail information that will be used for logging.
    """
    presidio = _OPTIONAL_PresidioPIIMasking(
        guardrail_name="test_presidio",
        output_parse_pii=True,
        mock_testing=True,
    )

    request_data = {
        "messages": [{"role": "user", "content": "Test"}],
        "model": "gpt-4o",
        "metadata": {},
    }

    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        assert request_data is not None

        presidio.add_standard_logging_guardrail_information_to_request_data(
            guardrail_provider="presidio",
            guardrail_json_response=[],
            request_data=request_data,
            guardrail_status="success",
            start_time=1234567890.0,
            end_time=1234567891.0,
            duration=1.0,
            masked_entity_count={"EMAIL_ADDRESS": 1, "PERSON": 1},
        )

        return text

    with patch.object(presidio, "check_pii", mock_check_pii):
        await presidio.apply_guardrail(
            inputs={"texts": ["Test message"]},
            request_data=request_data,
            input_type="request",
        )

    assert "metadata" in request_data
    assert "standard_logging_guardrail_information" in request_data["metadata"]

    guardrail_info_list = request_data["metadata"]["standard_logging_guardrail_information"]
    assert isinstance(guardrail_info_list, list)
    assert len(guardrail_info_list) > 0

    guardrail_info = guardrail_info_list[0]
    assert "masked_entity_count" in guardrail_info
    assert guardrail_info["masked_entity_count"]["EMAIL_ADDRESS"] == 1
    assert guardrail_info["masked_entity_count"]["PERSON"] == 1


@pytest.mark.asyncio
async def test_presidio_logs_input_source_event_and_run_id():
    presidio = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        guardrail_name="test_presidio",
        output_parse_pii=True,
        mock_redacted_text={"text": "masked"},
    )
    request_data = {"metadata": {}}
    inputs = {
        "texts": ["system text", "user text"],
        "text_sources": [
            {
                "type": "message",
                "message_index": 0,
                "role": "system",
                "content_index": None,
                "path": "messages[0].content",
                "scope": "system_prompt",
            },
            {
                "type": "message",
                "message_index": 1,
                "role": "user",
                "content_index": 0,
                "path": "messages[1].content[0].text",
                "scope": "current_user_prompt",
            },
        ],
    }

    await presidio.apply_guardrail(
        inputs=inputs,
        request_data=request_data,
        input_type="request",
    )

    entries = request_data["metadata"]["standard_logging_guardrail_information"]
    assert len(entries) == 2
    assert entries[0]["guardrail_run_id"] == entries[1]["guardrail_run_id"]
    assert entries[0]["guardrail_event"] == "pre_call"
    assert entries[1]["input_source"] == inputs["text_sources"][1]


@pytest.mark.asyncio
async def test_logging_only_records_request_and_response_audits_as_logging_only():
    presidio = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        guardrail_name="test_presidio",
        logging_only=True,
        mock_redacted_text={"text": "masked"},
    )
    request_data = {"metadata": {}}

    await presidio.apply_guardrail(
        inputs={"texts": ["request text"]},
        request_data=request_data,
        input_type="request",
    )
    await presidio.apply_guardrail(
        inputs={"texts": ["response text"]},
        request_data=request_data,
        input_type="response",
    )

    entries = request_data["metadata"]["standard_logging_guardrail_information"]
    assert [entry["guardrail_event"] for entry in entries] == [
        "logging_only",
        "logging_only",
    ]
    assert [entry["guardrail_mode"] for entry in entries] == [
        "logging_only",
        "logging_only",
    ]
    assert [entry["input_source"]["type"] for entry in entries] == [
        "request",
        "response",
    ]


@pytest.mark.asyncio
async def test_request_data_flows_to_apply_guardrail():
    """
    Test that request_data is correctly passed to apply_guardrail method.

    This validates the fix where guardrail translation handler passes data
    as request_data to apply_guardrail so guardrails can store metadata for logging.
    """
    presidio = _OPTIONAL_PresidioPIIMasking(
        guardrail_name="test_presidio",
        output_parse_pii=True,
        mock_testing=True,
    )

    request_data = {
        "messages": [{"role": "user", "content": "Test message"}],
        "model": "gpt-4o",
        "metadata": {},
    }

    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        assert request_data is not None, "request_data should be passed to check_pii"
        assert "metadata" in request_data, "request_data should have metadata"

        request_data.setdefault("metadata", {})
        request_data["metadata"]["test_flag"] = "passed_correctly"

        return text

    with patch.object(presidio, "check_pii", mock_check_pii):
        await presidio.apply_guardrail(
            inputs={"texts": ["Test message"]},
            request_data=request_data,
            input_type="request",
        )

        assert "metadata" in request_data
        assert request_data["metadata"].get("test_flag") == "passed_correctly"


@pytest.mark.asyncio
async def test_output_masking_apply_to_output_only(mock_user_api_key):
    """
    Ensure output masking runs when apply_to_output is enabled.
    """

    presidio = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        apply_to_output=True,
        pii_entities_config={PiiEntityType.CREDIT_CARD: PiiAction.MASK},
    )

    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        return text.replace("4111-1111-1111-1111", "[CREDIT_CARD]")

    presidio.check_pii = mock_check_pii

    response = ModelResponse(
        id="1",
        object="chat.completion",
        created=0,
        model="gpt-test",
        choices=[
            Choices(
                message=Message(
                    role="assistant",
                    content="Card is 4111-1111-1111-1111",
                ),
                index=0,
                finish_reason="stop",
            )
        ],
    )

    result = await presidio.async_post_call_success_hook(
        data={},
        user_api_key_dict=mock_user_api_key,
        response=response,
    )

    assert "[CREDIT_CARD]" in result.choices[0].message.content
    assert "4111-1111-1111-1111" not in result.choices[0].message.content


@pytest.mark.asyncio
async def test_output_scan_runs_before_reversible_token_restore(mock_user_api_key):
    from litellm.llms.openai.chat.guardrail_translation.handler import (
        OpenAIChatCompletionsHandler,
    )

    scanner = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        guardrail_name="test_presidio",
        apply_to_output=True,
        mock_redacted_text={
            "text": "Hello <KR_PERSON_1>; generated <KR_RRN>",
        },
    )
    token_restorer = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        guardrail_name="test_presidio",
        output_parse_pii=True,
        event_hook="post_call",
    )
    response = ModelResponse(
        choices=[
            Choices(
                message=Message(
                    role="assistant",
                    content="Hello <KR_PERSON_1>; generated 900101-1234567",
                ),
                index=0,
                finish_reason="stop",
            )
        ]
    )
    request_data = {
        "metadata": {"pii_tokens": {"<KR_PERSON_1>": "홍길동"}},
    }
    logging_obj = MagicMock()
    handler = OpenAIChatCompletionsHandler()

    await handler.process_output_response(
        response=response,
        guardrail_to_apply=scanner,
        litellm_logging_obj=logging_obj,
        user_api_key_dict=mock_user_api_key,
        request_data=request_data,
    )
    result = await handler.process_output_response(
        response=response,
        guardrail_to_apply=token_restorer,
        litellm_logging_obj=logging_obj,
        user_api_key_dict=mock_user_api_key,
        request_data=request_data,
    )

    assert result.choices[0].message.content == "Hello 홍길동; generated <KR_RRN>"
    logged_response = logging_obj.set_deferred_logging_result.call_args.args[0]
    assert logged_response.choices[0].message.content == ("Hello <KR_PERSON_1>; generated <KR_RRN>")
    entries = request_data["metadata"]["standard_logging_guardrail_information"]
    assert entries
    assert all(entry["guardrail_event"] == "post_call" for entry in entries)


@pytest.mark.asyncio
async def test_presidio_filter_scope_initializer(monkeypatch):
    """
    Ensure initializer respects presidio_filter_scope for input/output/both.
    """

    created = []

    class DummyGuardrail:
        def __init__(
            self,
            apply_to_output: bool = False,
            event_hook=None,
            output_parse_pii: bool = False,
            logging_only: bool = False,
            presidio_filter_scope: str = "both",
            expand_event_hook_for_output_processing: bool = True,
            unreachable_fallback: str = "fail_closed",
            **kwargs,
        ):
            self.apply_to_output = apply_to_output
            self.event_hook = event_hook
            self.output_parse_pii = output_parse_pii
            self.expand_event_hook_for_output_processing = expand_event_hook_for_output_processing
            self.logging_only = logging_only
            self.presidio_filter_scope = presidio_filter_scope
            self.unreachable_fallback = unreachable_fallback
            created.append(self)

        def update_in_memory_litellm_params(self, litellm_params):
            pass

    class DummyManager:
        def __init__(self):
            self.added = []

        def add_litellm_callback(self, cb):
            self.added.append(cb)

    mgr = DummyManager()
    monkeypatch.setattr(litellm, "logging_callback_manager", mgr, raising=False)
    import litellm.proxy.guardrails.guardrail_hooks.presidio as presidio_mod
    import litellm.proxy.guardrails.guardrail_initializers as gi

    monkeypatch.setattr(presidio_mod, "_OPTIONAL_PresidioPIIMasking", DummyGuardrail, raising=False)
    monkeypatch.setattr(gi, "_OPTIONAL_PresidioPIIMasking", DummyGuardrail, raising=False)

    # input-only
    created.clear()
    from litellm.proxy.guardrails.guardrail_initializers import initialize_presidio

    params_input = LitellmParams(guardrail="presidio", mode="pre_call", presidio_filter_scope="input")
    guardrail_dict = {"guardrail_name": "g1"}
    cb = initialize_presidio(params_input, guardrail_dict)
    assert cb is created[0]
    assert created[0].apply_to_output is False
    assert created[0].unreachable_fallback == "fail_closed"

    created.clear()
    params_logging_only = LitellmParams(
        guardrail="presidio",
        mode="logging_only",
        presidio_filter_scope="both",
    )
    cb = initialize_presidio(params_logging_only, guardrail_dict)
    assert cb is created[0]
    assert len(created) == 1
    assert created[0].logging_only is True
    assert created[0].event_hook == "logging_only"
    assert created[0].apply_to_output is False
    assert created[0].presidio_filter_scope == "both"

    # output-only
    created.clear()
    params_output = LitellmParams(guardrail="presidio", mode="pre_call", presidio_filter_scope="output")
    cb = initialize_presidio(params_output, guardrail_dict)
    assert len(created) == 1
    assert created[0].apply_to_output is True

    # both -> expect two callbacks (input + output)
    created.clear()
    params_both = LitellmParams(guardrail="presidio", mode="pre_call", presidio_filter_scope="both")
    cb = initialize_presidio(params_both, guardrail_dict)
    assert len(created) == 2
    assert any(not c.apply_to_output for c in created)
    assert any(c.apply_to_output for c in created)

    created.clear()
    params_reversible = LitellmParams(
        guardrail="presidio",
        mode=["pre_call", "post_call"],
        output_parse_pii=True,
        presidio_filter_scope="both",
    )
    initialize_presidio(params_reversible, guardrail_dict)
    assert len(created) == 3
    assert created[0].apply_to_output is False
    assert created[0].output_parse_pii is True
    assert created[0].event_hook == "pre_call"
    assert created[0].expand_event_hook_for_output_processing is False
    assert created[1].apply_to_output is True
    assert created[1].output_parse_pii is False
    assert created[1].event_hook == "post_call"
    assert created[2].apply_to_output is False
    assert created[2].output_parse_pii is True
    assert created[2].event_hook == "post_call"

    created.clear()
    params_composite = LitellmParams(
        guardrail="presidio",
        mode=["post_call", "logging_only"],
        presidio_filter_scope="both",
    )
    initialize_presidio(params_composite, guardrail_dict)
    assert len(created) == 2
    assert created[0].apply_to_output is True
    assert created[0].logging_only is False
    assert created[1].apply_to_output is False
    assert created[1].logging_only is True
    assert created[1].event_hook == "logging_only"

    created.clear()
    params_fail_closed = LitellmParams(
        guardrail="presidio",
        mode="pre_call",
        presidio_filter_scope="input",
        unreachable_fallback="fail_closed",
    )
    initialize_presidio(params_fail_closed, guardrail_dict)
    assert created[0].unreachable_fallback == "fail_closed"


@pytest.mark.asyncio
async def test_empty_content_handling(presidio_guardrail, mock_user_api_key, mock_cache):
    """
    Test that Presidio handles empty content gracefully.

    This is common in tool/function calling where assistant messages have
    empty content but include tool_calls.

    Bug fix: Previously crashed with:
    TypeError: argument after ** must be a mapping, not str
    """
    test_data = {
        "messages": [
            {"role": "user", "content": "What is 2+2?"},
            {
                "role": "assistant",
                "content": "",  # Empty content - common in tool calls
                "tool_calls": [
                    {
                        "id": "call_123",
                        "type": "function",
                        "function": {
                            "name": "calculator",
                            "arguments": '{"a":2,"b":2}',
                        },
                    }
                ],
            },
            {"role": "tool", "tool_call_id": "call_123", "content": "4"},
        ],
        "model": "gpt-4",
    }

    # Mock check_pii to simulate PII processing without needing Presidio API
    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        # Empty text returns as-is (this is what our fix ensures)
        return text

    presidio_guardrail.check_pii = mock_check_pii

    # This should not raise an exception
    result = await presidio_guardrail.async_pre_call_hook(
        user_api_key_dict=mock_user_api_key,
        cache=mock_cache,
        data=test_data,
        call_type="completion",
    )

    assert result is not None
    assert "messages" in result
    # Verify messages are preserved
    assert len(result["messages"]) == 3


@pytest.mark.asyncio
async def test_whitespace_only_content(presidio_guardrail, mock_user_api_key, mock_cache):
    """
    Test that Presidio handles whitespace-only content gracefully.

    Whitespace-only content should be treated the same as empty content.
    """
    test_data = {
        "messages": [
            {"role": "user", "content": "   "},  # Whitespace only
            {"role": "assistant", "content": "\n\t  "},  # Tabs and newlines
            {"role": "user", "content": "Real question here"},
        ],
        "model": "gpt-4",
    }

    # Mock check_pii to simulate PII processing
    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        return text

    presidio_guardrail.check_pii = mock_check_pii

    result = await presidio_guardrail.async_pre_call_hook(
        user_api_key_dict=mock_user_api_key,
        cache=mock_cache,
        data=test_data,
        call_type="completion",
    )

    assert result is not None
    assert len(result["messages"]) == 3


@pytest.mark.asyncio
async def test_analyze_text_with_empty_string():
    """
    Test analyze_text method directly with empty string.

    Should return empty list without making API call to Presidio.
    """
    presidio = _OPTIONAL_PresidioPIIMasking(
        presidio_analyzer_api_base="http://test:5002/",
        presidio_anonymizer_api_base="http://test:5001/",
        output_parse_pii=False,
    )

    # Test with empty string - should return immediately without API call
    result = await presidio.analyze_text(
        text="",
        presidio_config=None,
        request_data={},
    )
    assert result == [], "Empty text should return empty list"

    # Test with whitespace only - should return immediately
    result = await presidio.analyze_text(
        text="   \n\t   ",
        presidio_config=None,
        request_data={},
    )
    assert result == [], "Whitespace-only text should return empty list"


@pytest.mark.asyncio
async def test_analyze_text_error_dict_handling():
    """
    Test that analyze_text handles error dict responses from Presidio API.

    Presidio error dictionaries must fail closed.
    """
    presidio = _OPTIONAL_PresidioPIIMasking(
        presidio_analyzer_api_base="http://mock-presidio:5002/",
        presidio_anonymizer_api_base="http://mock-presidio:5001/",
        output_parse_pii=False,
    )

    with patch.object(
        presidio,
        "_get_session_iterator",
        _make_mock_session_iterator({"error": "No text provided"}),
    ):
        with pytest.raises(_PresidioServiceError, match="Presidio PII analysis failed"):
            await presidio.analyze_text(
                text="some text",
                presidio_config=None,
                request_data={},
            )


@pytest.mark.asyncio
async def test_analyze_text_string_response_handling():
    """
    Test that analyze_text handles string responses from Presidio API.

    Presidio string errors must fail closed without exposing response bodies.
    """
    presidio = _OPTIONAL_PresidioPIIMasking(
        presidio_analyzer_api_base="http://mock-presidio:5002/",
        presidio_anonymizer_api_base="http://mock-presidio:5001/",
        output_parse_pii=False,
    )

    with patch.object(
        presidio,
        "_get_session_iterator",
        _make_mock_session_iterator("Internal Server Error"),
    ):
        with pytest.raises(_PresidioServiceError, match="Presidio PII analysis failed"):
            await presidio.analyze_text(
                text="some text",
                presidio_config=None,
                request_data={},
            )


@pytest.mark.asyncio
async def test_analyze_text_invalid_response_raises_when_block_configured():
    """
    When pii_entities_config has BLOCK and Presidio returns invalid response,
    should report the analyzer failure rather than silently treating it as no detection.
    """
    presidio = _OPTIONAL_PresidioPIIMasking(
        presidio_analyzer_api_base="http://mock-presidio:5002/",
        presidio_anonymizer_api_base="http://mock-presidio:5001/",
        output_parse_pii=False,
        pii_entities_config={PiiEntityType.CREDIT_CARD: PiiAction.BLOCK},
    )

    with patch.object(
        presidio,
        "_get_session_iterator",
        _make_mock_session_iterator("Internal Server Error"),
    ):
        with pytest.raises(
            _PresidioServiceError,
            match="Presidio PII analysis failed",
        ) as exc_info:
            await presidio.analyze_text(
                text="some text",
                presidio_config=None,
                request_data={},
            )
    assert "Internal Server Error" not in str(exc_info.value)


@pytest.mark.asyncio
async def test_analyze_text_invalid_response_raises_when_mask_configured():
    """
    When pii_entities_config has MASK and Presidio returns invalid response,
    should report the analyzer failure because PII masking is expected.
    """
    presidio = _OPTIONAL_PresidioPIIMasking(
        presidio_analyzer_api_base="http://mock-presidio:5002/",
        presidio_anonymizer_api_base="http://mock-presidio:5001/",
        output_parse_pii=False,
        pii_entities_config={PiiEntityType.CREDIT_CARD: PiiAction.MASK},
    )

    with patch.object(
        presidio,
        "_get_session_iterator",
        _make_mock_session_iterator("Internal Server Error"),
    ):
        with pytest.raises(
            _PresidioServiceError,
            match="Presidio PII analysis failed",
        ) as exc_info:
            await presidio.analyze_text(
                text="some text",
                presidio_config=None,
                request_data={},
            )
    assert "Internal Server Error" not in str(exc_info.value)


@pytest.mark.asyncio
async def test_check_pii_defaults_to_fail_closed_when_presidio_is_unavailable():
    presidio = _OPTIONAL_PresidioPIIMasking(
        presidio_analyzer_api_base="http://mock-presidio:5002/",
        presidio_anonymizer_api_base="http://mock-presidio:5001/",
        pii_entities_config={PiiEntityType.CREDIT_CARD: PiiAction.MASK},
    )
    request_data = {}

    with patch.object(
        presidio,
        "_get_session_iterator",
        _make_mock_session_iterator(
            {"error": "unavailable"},
            status=503,
            text_response="unavailable",
        ),
    ):
        with pytest.raises(_PresidioServiceError, match="Presidio PII analysis failed"):
            await presidio.check_pii(
                text="4111-1111-1111-1111",
                output_parse_pii=False,
                presidio_config=None,
                request_data=request_data,
            )

    guardrail_entries = request_data["metadata"]["standard_logging_guardrail_information"]
    assert guardrail_entries[-1]["guardrail_status"] == "guardrail_failed_to_respond"
    assert guardrail_entries[-1]["enforcement_mode"] == "enforce"


@pytest.mark.asyncio
async def test_check_pii_can_explicitly_fail_closed_when_presidio_is_unavailable():
    presidio = _OPTIONAL_PresidioPIIMasking(
        presidio_analyzer_api_base="http://mock-presidio:5002/",
        presidio_anonymizer_api_base="http://mock-presidio:5001/",
        pii_entities_config={PiiEntityType.CREDIT_CARD: PiiAction.MASK},
        unreachable_fallback="fail_closed",
    )

    with patch.object(
        presidio,
        "_get_session_iterator",
        _make_mock_session_iterator(
            {"error": "unavailable"},
            status=503,
            text_response="unavailable",
        ),
    ):
        with pytest.raises(_PresidioServiceError, match="Presidio PII analysis failed"):
            await presidio.check_pii(
                text="4111-1111-1111-1111",
                output_parse_pii=False,
                presidio_config=None,
                request_data={},
            )


@pytest.mark.asyncio
async def test_blocked_pii_is_masked_in_request_response_and_logging_payloads():
    class BlockingPresidio(_OPTIONAL_PresidioPIIMasking):
        async def analyze_text(self, text, presidio_config, request_data):
            email = "person@example.com"
            start = text.index(email)
            return [
                {
                    "entity_type": "EMAIL_ADDRESS",
                    "start": start,
                    "end": start + len(email),
                    "score": 0.99,
                }
            ]

    sensitive_text = "Email person@example.com"
    response = ModelResponse(
        model="gpt-4o",
        choices=[Choices(index=0, message=Message(role="assistant", content=sensitive_text))],
    )
    logging_obj = MagicMock()
    logging_obj.model_call_details = {
        "additional_args": {"complete_input_dict": {"messages": [{"role": "user", "content": sensitive_text}]}},
        "raw_request_typed_dict": {"raw_request_body": {"messages": [{"content": sensitive_text}]}},
        "litellm_params": {
            "metadata": {"raw_request": f"curl --data '{sensitive_text}'"},
            "proxy_server_request": {
                "body": {"messages": [{"role": "user", "content": sensitive_text}]},
            },
        },
        "messages": [{"role": "user", "content": sensitive_text}],
        "original_response": response.model_copy(deep=True),
        "standard_logging_object": {
            "messages": [{"role": "user", "content": sensitive_text}],
            "response": response.model_copy(deep=True),
        },
    }
    request_data = {
        "messages": [{"role": "user", "content": sensitive_text}],
        "metadata": {"raw_request": f"curl --data '{sensitive_text}'"},
        "proxy_server_request": {
            "body": {"messages": [{"role": "user", "content": sensitive_text}]},
        },
        "response": response,
        "litellm_logging_obj": logging_obj,
    }
    presidio = BlockingPresidio(
        mock_testing=True,
        pii_entities_config={PiiEntityType.EMAIL_ADDRESS: PiiAction.BLOCK},
    )

    with pytest.raises(BlockedPiiEntityError):
        await presidio.check_pii(
            text=sensitive_text,
            output_parse_pii=False,
            presidio_config=None,
            request_data=request_data,
        )

    assert request_data["messages"][0]["content"] == "Email <EMAIL_ADDRESS>"
    assert request_data["proxy_server_request"]["body"]["messages"][0]["content"] == "Email <EMAIL_ADDRESS>"
    assert (
        logging_obj.model_call_details["litellm_params"]["proxy_server_request"]["body"]["messages"][0]["content"]
        == "Email <EMAIL_ADDRESS>"
    )
    assert request_data["response"].choices[0].message.content == "[REDACTED BY PRESIDIO]"
    assert "person@example.com" not in str(logging_obj.model_call_details)
    guardrail_entries = request_data["metadata"]["standard_logging_guardrail_information"]
    assert guardrail_entries[-1]["guardrail_status"] == "guardrail_intervened"
    assert guardrail_entries[-1]["masked_entity_count"] == {"EMAIL_ADDRESS": 1}


@pytest.mark.asyncio
async def test_blocked_request_still_masks_pii_detected_in_another_message(mock_user_api_key, mock_cache):
    class MixedActionPresidio(_OPTIONAL_PresidioPIIMasking):
        async def analyze_text(self, text, presidio_config, request_data):
            detections = []
            for entity_type, value in (
                ("CREDIT_CARD", "4111-1111-1111-1111"),
                ("EMAIL_ADDRESS", "person@example.com"),
            ):
                if value in text:
                    start = text.index(value)
                    detections.append(
                        {
                            "entity_type": entity_type,
                            "start": start,
                            "end": start + len(value),
                            "score": 0.99,
                        }
                    )
            return detections

        async def anonymize_text(
            self,
            text,
            analyze_results,
            output_parse_pii,
            masked_entity_count,
            request_data=None,
        ):
            return text.replace("person@example.com", "<EMAIL_ADDRESS>")

    data = {
        "model": "gpt-4o",
        "messages": [
            {"role": "user", "content": "Card 4111-1111-1111-1111"},
            {"role": "user", "content": "Email person@example.com"},
        ],
    }
    presidio = MixedActionPresidio(
        mock_testing=True,
        event_hook="pre_call",
        default_on=True,
        pii_entities_config={
            PiiEntityType.CREDIT_CARD: PiiAction.BLOCK,
            PiiEntityType.EMAIL_ADDRESS: PiiAction.MASK,
        },
    )

    with pytest.raises(BlockedPiiEntityError):
        await presidio.async_pre_call_hook(
            user_api_key_dict=mock_user_api_key,
            cache=mock_cache,
            data=data,
            call_type="completion",
        )

    assert data["messages"][0]["content"] == "Card <CREDIT_CARD>"
    assert data["messages"][1]["content"] == "Email <EMAIL_ADDRESS>"


@pytest.mark.asyncio
async def test_blocked_pii_split_across_stream_chunks_is_redacted_from_logging_payloads():
    class BlockingPresidio(_OPTIONAL_PresidioPIIMasking):
        async def analyze_text(self, text, presidio_config, request_data):
            email = "person@example.com"
            start = text.index(email)
            return [
                {
                    "entity_type": "EMAIL_ADDRESS",
                    "start": start,
                    "end": start + len(email),
                    "score": 0.99,
                }
            ]

    sensitive_text = "Email person@example.com"
    request_data = {
        "responses": [
            {"model": "gpt-4o", "choices": [{"delta": {"content": "Email person@"}}]},
            {"model": "gpt-4o", "choices": [{"delta": {"content": "example.com"}}]},
        ],
        "complete_streaming_response": {
            "model": "gpt-4o",
            "choices": [{"message": {"content": sensitive_text}}],
        },
        "complete_response": {
            "model": "gpt-4o",
            "choices": [{"message": {"content": sensitive_text}}],
        },
    }
    presidio = BlockingPresidio(
        mock_testing=True,
        pii_entities_config={PiiEntityType.EMAIL_ADDRESS: PiiAction.BLOCK},
    )

    with pytest.raises(BlockedPiiEntityError):
        await presidio.check_pii(
            text=sensitive_text,
            output_parse_pii=False,
            presidio_config=None,
            request_data=request_data,
        )

    assert request_data["responses"][0]["model"] == "gpt-4o"
    assert request_data["responses"][0]["choices"][0]["delta"]["content"] == "[REDACTED BY PRESIDIO]"
    assert request_data["responses"][1]["choices"][0]["delta"]["content"] == "[REDACTED BY PRESIDIO]"
    assert "person@example.com" not in str(request_data["complete_streaming_response"])
    assert "person@example.com" not in str(request_data["complete_response"])


@pytest.mark.asyncio
async def test_check_pii_fails_closed_when_presidio_anonymizer_is_unavailable():
    class AnalyzerOnlyPresidio(_OPTIONAL_PresidioPIIMasking):
        async def analyze_text(self, text, presidio_config, request_data):
            return [{"entity_type": "EMAIL_ADDRESS", "start": 0, "end": len(text), "score": 0.99}]

        async def _post_presidio_anonymize(self, text, analyze_results):
            raise asyncio.TimeoutError

    presidio = AnalyzerOnlyPresidio(
        mock_testing=True,
        pii_entities_config={PiiEntityType.EMAIL_ADDRESS: PiiAction.MASK},
    )
    request_data = {}

    with pytest.raises(Exception, match="Presidio PII anonymization failed"):
        await presidio.check_pii(
            text="person@example.com",
            output_parse_pii=False,
            presidio_config=None,
            request_data=request_data,
        )

    guardrail_entries = request_data["metadata"]["standard_logging_guardrail_information"]
    assert guardrail_entries[-1]["guardrail_status"] == "guardrail_failed_to_respond"


@pytest.mark.asyncio
async def test_logging_only_records_detected_pii_as_flagged():
    class DetectingPresidio(_OPTIONAL_PresidioPIIMasking):
        async def analyze_text(self, text, presidio_config, request_data):
            return [{"entity_type": "EMAIL_ADDRESS", "start": 0, "end": len(text), "score": 0.99}]

        async def anonymize_text(
            self,
            text,
            analyze_results,
            output_parse_pii,
            masked_entity_count,
            request_data=None,
        ):
            return text

    presidio = DetectingPresidio(
        mock_testing=True,
        logging_only=True,
        pii_entities_config={PiiEntityType.EMAIL_ADDRESS: PiiAction.MASK},
    )
    request_data = {}

    result = await presidio.check_pii(
        text="person@example.com",
        output_parse_pii=False,
        presidio_config=None,
        request_data=request_data,
    )

    assert result == "person@example.com"
    guardrail_entries = request_data["metadata"]["standard_logging_guardrail_information"]
    assert guardrail_entries[-1]["usage_action"] == "flagged"
    assert guardrail_entries[-1]["enforcement_mode"] == "observe"


@pytest.mark.asyncio
async def test_pre_call_masking_records_detected_pii_as_flagged():
    class DetectingPresidio(_OPTIONAL_PresidioPIIMasking):
        async def analyze_text(self, text, presidio_config, request_data):
            return [{"entity_type": "EMAIL_ADDRESS", "start": 0, "end": len(text), "score": 0.99}]

        async def anonymize_text(
            self,
            text,
            analyze_results,
            output_parse_pii,
            masked_entity_count,
            request_data=None,
        ):
            masked_entity_count["EMAIL_ADDRESS"] = 1
            return "[EMAIL]"

    presidio = DetectingPresidio(
        mock_testing=True,
        event_hook="pre_call",
        pii_entities_config={PiiEntityType.EMAIL_ADDRESS: PiiAction.MASK},
    )
    request_data = {}

    result = await presidio.check_pii(
        text="person@example.com",
        output_parse_pii=False,
        presidio_config=None,
        request_data=request_data,
    )

    assert result == "[EMAIL]"
    guardrail_entries = request_data["metadata"]["standard_logging_guardrail_information"]
    assert guardrail_entries[-1]["usage_action"] == "flagged"
    assert guardrail_entries[-1]["enforcement_mode"] == "enforce"


@pytest.mark.asyncio
async def test_analyze_text_list_with_non_dict_items():
    """
    Test that analyze_text rejects incomplete analysis results.

    When Presidio returns a list containing strings (malformed response),
    the entire analysis must fail closed.
    """
    presidio = _OPTIONAL_PresidioPIIMasking(
        presidio_analyzer_api_base="http://mock-presidio:5002/",
        presidio_anonymizer_api_base="http://mock-presidio:5001/",
        output_parse_pii=False,
    )

    json_response = [
        {"entity_type": "PERSON", "start": 0, "end": 5, "score": 0.9},
        "invalid_string_item",
        {"entity_type": "EMAIL", "start": 10, "end": 25, "score": 0.85},
    ]
    with patch.object(presidio, "_get_session_iterator", _make_mock_session_iterator(json_response)):
        with pytest.raises(_PresidioServiceError, match="Presidio PII analysis failed"):
            await presidio.analyze_text(
                text="some text",
                presidio_config=None,
                request_data={},
            )


@pytest.mark.asyncio
async def test_tool_calling_complete_scenario(presidio_guardrail, mock_user_api_key, mock_cache):
    """
    Test complete tool calling scenario with PII in user message.

    This tests the real-world scenario where:
    1. User provides a query with PII
    2. Assistant responds with empty content + tool_calls
    3. Tool provides response
    4. Assistant provides final answer
    """
    test_data = {
        "messages": [
            {
                "role": "user",
                "content": "My email is john.doe@example.com. Can you look up my account?",
            },
            {
                "role": "assistant",
                "content": "",  # Empty - tool call
                "tool_calls": [
                    {
                        "id": "call_abc",
                        "type": "function",
                        "function": {"name": "lookup_account", "arguments": "{}"},
                    }
                ],
            },
            {"role": "tool", "tool_call_id": "call_abc", "content": "Account found"},
            {"role": "assistant", "content": "I found your account information."},
        ],
        "model": "gpt-4",
    }

    # Mock check_pii to simulate PII masking
    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        if "john.doe@example.com" in text:
            return text.replace("john.doe@example.com", "[EMAIL]")
        return text

    presidio_guardrail.check_pii = mock_check_pii

    result = await presidio_guardrail.async_pre_call_hook(
        user_api_key_dict=mock_user_api_key,
        cache=mock_cache,
        data=test_data,
        call_type="completion",
    )

    assert result is not None
    # Verify PII was masked in user message
    assert "[EMAIL]" in result["messages"][0]["content"]
    assert "john.doe@example.com" not in result["messages"][0]["content"]
    # Verify other messages preserved
    assert len(result["messages"]) == 4


def test_filter_drops_low_score_detection():
    """
    Detections below the configured score threshold should be removed.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        presidio_score_thresholds={PiiEntityType.CREDIT_CARD: 0.8},
    )
    analyze_results = [{"entity_type": PiiEntityType.CREDIT_CARD, "score": 0.7, "start": 0, "end": 4}]

    filtered = guardrail.filter_analyze_results_by_score(analyze_results)
    assert filtered == []


def test_filter_preserves_high_score_detection():
    """
    Detections meeting the score threshold should be preserved.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        presidio_score_thresholds={PiiEntityType.CREDIT_CARD: 0.8},
    )
    analyze_results = [{"entity_type": PiiEntityType.CREDIT_CARD, "score": 0.9, "start": 0, "end": 4}]

    filtered = guardrail.filter_analyze_results_by_score(analyze_results)
    assert len(filtered) == 1
    assert filtered[0]["entity_type"] == PiiEntityType.CREDIT_CARD


def test_no_thresholds_returns_all():
    """
    With no thresholds configured, all detections are kept.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(mock_testing=True)
    analyze_results = [
        {"entity_type": PiiEntityType.CREDIT_CARD, "score": 0.1, "start": 0, "end": 4},
        {
            "entity_type": PiiEntityType.EMAIL_ADDRESS,
            "score": 0.2,
            "start": 5,
            "end": 9,
        },
    ]

    filtered = guardrail.filter_analyze_results_by_score(analyze_results)
    assert len(filtered) == 2


def test_entity_specific_threshold_only_applies_to_that_entity():
    """
    Entity-specific thresholds do not affect other entity types.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        presidio_score_thresholds={PiiEntityType.CREDIT_CARD: 0.8},
    )
    analyze_results = [
        {"entity_type": PiiEntityType.CREDIT_CARD, "score": 0.7, "start": 0, "end": 4},
        {
            "entity_type": PiiEntityType.EMAIL_ADDRESS,
            "score": 0.1,
            "start": 5,
            "end": 9,
        },
    ]

    filtered = guardrail.filter_analyze_results_by_score(analyze_results)
    # CREDIT_CARD is filtered, EMAIL_ADDRESS is kept because no threshold
    assert len(filtered) == 1
    assert filtered[0]["entity_type"] == PiiEntityType.EMAIL_ADDRESS


def test_filter_uses_default_all_threshold():
    """
    Default ALL threshold applies to any entity without a specific override.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        presidio_score_thresholds={"ALL": 0.75},
    )
    analyze_results = [
        {"entity_type": PiiEntityType.CREDIT_CARD, "score": 0.7, "start": 0, "end": 4},
        {
            "entity_type": PiiEntityType.EMAIL_ADDRESS,
            "score": 0.8,
            "start": 5,
            "end": 9,
        },
    ]

    filtered = guardrail.filter_analyze_results_by_score(analyze_results)
    assert len(filtered) == 1
    assert filtered[0]["entity_type"] == PiiEntityType.EMAIL_ADDRESS


def test_entity_specific_overrides_default_threshold():
    """
    Entity-specific threshold should override the ALL default.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        presidio_score_thresholds={
            "ALL": 0.8,
            PiiEntityType.CREDIT_CARD: 0.6,
        },
    )
    analyze_results = [
        {"entity_type": PiiEntityType.CREDIT_CARD, "score": 0.65, "start": 0, "end": 4},
        {
            "entity_type": PiiEntityType.EMAIL_ADDRESS,
            "score": 0.75,
            "start": 5,
            "end": 9,
        },
    ]

    filtered = guardrail.filter_analyze_results_by_score(analyze_results)
    # CREDIT_CARD passes due to override, EMAIL_ADDRESS dropped by ALL threshold
    assert len(filtered) == 1
    assert filtered[0]["entity_type"] == PiiEntityType.CREDIT_CARD


@pytest.mark.asyncio
async def test_anonymize_skips_when_no_detections_after_filter():
    """
    When all detections are filtered out, anonymize_text should return the original text.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        presidio_score_thresholds={PiiEntityType.CREDIT_CARD: 0.8},
    )
    masked_entity_count = {}
    text = "4111"

    filtered = guardrail.filter_analyze_results_by_score(
        [{"entity_type": PiiEntityType.CREDIT_CARD, "score": 0.7, "start": 0, "end": 4}]
    )

    result = await guardrail.anonymize_text(
        text=text,
        analyze_results=filtered,
        output_parse_pii=False,
        masked_entity_count=masked_entity_count,
    )

    assert result == text
    assert masked_entity_count == {}


def test_blocking_respects_threshold_filter():
    """
    Entities filtered out by score should not trigger blocking, but high-score detections should.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        pii_entities_config={PiiEntityType.CREDIT_CARD: PiiAction.BLOCK},
        presidio_score_thresholds={PiiEntityType.CREDIT_CARD: 0.9},
    )

    low_score_results = [{"entity_type": PiiEntityType.CREDIT_CARD, "score": 0.7, "start": 0, "end": 4}]
    filtered = guardrail.filter_analyze_results_by_score(low_score_results)
    guardrail.raise_exception_if_blocked_entities_detected(filtered)

    high_score_results = [{"entity_type": PiiEntityType.CREDIT_CARD, "score": 0.95, "start": 0, "end": 4}]
    filtered_high = guardrail.filter_analyze_results_by_score(high_score_results)
    with pytest.raises(BlockedPiiEntityError):
        guardrail.raise_exception_if_blocked_entities_detected(filtered_high)


@pytest.mark.parametrize("numbered_entity_type", ["KORNAME2", "KORNAME_2"])
def test_numbered_entity_uses_base_block_action_and_threshold(numbered_entity_type):
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        pii_entities_config={"KORNAME": PiiAction.BLOCK},
        presidio_score_thresholds={"KORNAME": 0.9},
    )

    low_score_results = [{"entity_type": "KORNAME1", "score": 0.8, "start": 0, "end": 3}]
    assert guardrail.filter_analyze_results_by_score(low_score_results) == []

    high_score_results = [{"entity_type": numbered_entity_type, "score": 0.95, "start": 0, "end": 3}]
    filtered_results = guardrail.filter_analyze_results_by_score(high_score_results)
    with pytest.raises(BlockedPiiEntityError):
        guardrail.raise_exception_if_blocked_entities_detected(filtered_results)


def test_update_in_memory_applies_score_thresholds():
    """
    update_in_memory_litellm_params should refresh score thresholds.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(mock_testing=True)
    assert guardrail.presidio_score_thresholds == {}

    params = LitellmParams(
        guardrail="presidio",
        mode="pre_call",
        presidio_score_thresholds={PiiEntityType.CREDIT_CARD: 0.85},
    )
    guardrail.update_in_memory_litellm_params(params)

    assert guardrail.presidio_score_thresholds == {PiiEntityType.CREDIT_CARD: 0.85}


@pytest.mark.asyncio
async def test_get_session_iterator_thread_safety(presidio_guardrail):
    """
    Test that _get_session_iterator yields:
    1. The shared session when in the main thread.
    2. A loop-bound cached session when in a background thread (reused per loop for efficiency).
    """
    import threading

    import aiohttp

    # 1. Main Thread Case
    # We are in the "main thread" relative to the guardrail initialization
    async with presidio_guardrail._get_session_iterator() as session:
        assert isinstance(session, aiohttp.ClientSession)
        assert session is presidio_guardrail._http_session
        shared_session_id = id(session)

    # 2. Background Thread Case
    # Define a helper function to run in a thread
    def thread_target(loop, result_future):
        async def run_in_loop():
            # This runs in the thread's loop
            async with presidio_guardrail._get_session_iterator() as session:
                return session, id(session)

        try:
            # Create a new loop for this thread to run async code
            new_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(new_loop)
            session_obj, session_id = new_loop.run_until_complete(run_in_loop())
            result_future.set_result((session_obj, session_id))
            new_loop.close()
        except Exception as e:
            result_future.set_exception(e)

    # Run the background thread test
    bg_future = asyncio.Future()
    t = threading.Thread(target=thread_target, args=(asyncio.get_running_loop(), bg_future))
    t.start()
    t.join()

    bg_session, bg_session_id = await bg_future

    # Assertions
    # The background session should be DIFFERENT from the shared session
    assert bg_session_id != shared_session_id
    # The shared session should still be open (not closed by the background thread)
    assert not presidio_guardrail._http_session.closed
    # The background session should be cached in _loop_sessions and remain open for reuse
    # (Changed behavior: no longer closes immediately, cached per loop for efficiency)
    assert not bg_session.closed, "Background session should remain open for reuse"


from litellm.types.utils import ModelResponseStream


@pytest.mark.asyncio
async def test_apply_to_output_streaming_with_bytes_chunks_fails_closed(mock_user_api_key):
    """
    Raw bytes cannot be inspected as typed streaming output and must fail closed.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        apply_to_output=True,
        mock_redacted_text={"text": "redacted"},
    )

    async def mock_stream():
        yield b'data: {"id":"chatcmpl-1"}\n\n'  # raw bytes
        yield ModelResponseStream(
            id="chatcmpl-1",
            choices=[],
            created=1,
            model="gpt-4",
            object="chat.completion.chunk",
            system_fingerprint=None,
        )  # proper chunk

    with pytest.raises(Exception, match="cannot safely inspect raw streaming bytes"):
        async for _ in guardrail.async_post_call_streaming_iterator_hook(
            user_api_key_dict=mock_user_api_key,
            response=mock_stream(),
            request_data={},
        ):
            pass


def test_entity_deny_list_filters_detections():
    """
    Verify presidio_entities_deny_list removes matching entity types.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        presidio_entities_deny_list=["US_DRIVER_LICENSE"],
    )

    results = [
        {"entity_type": "US_DRIVER_LICENSE", "start": 0, "end": 2, "score": 0.6},
        {"entity_type": "CREDIT_CARD", "start": 10, "end": 26, "score": 0.95},
    ]

    filtered = guardrail.filter_analyze_results_by_score(results)

    assert len(filtered) == 1
    assert filtered[0]["entity_type"] == "CREDIT_CARD"


def test_deny_list_and_score_threshold_combined():
    """
    Verify deny list + score threshold work together correctly.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        presidio_entities_deny_list=["US_DRIVER_LICENSE"],
        presidio_score_thresholds={"ALL": 0.8},
    )

    results = [
        {"entity_type": "US_DRIVER_LICENSE", "start": 0, "end": 2, "score": 0.95},
        {"entity_type": "CREDIT_CARD", "start": 10, "end": 26, "score": 0.6},
        {"entity_type": "EMAIL_ADDRESS", "start": 30, "end": 50, "score": 0.9},
    ]

    filtered = guardrail.filter_analyze_results_by_score(results)

    # US_DRIVER_LICENSE excluded by deny list (even though score > 0.8)
    # CREDIT_CARD excluded by score threshold (0.6 < 0.8)
    # EMAIL_ADDRESS passes both filters
    assert len(filtered) == 1
    assert filtered[0]["entity_type"] == "EMAIL_ADDRESS"


@pytest.mark.asyncio
async def test_analyze_text_non_json_content_type_fail_closed():
    """
    Test that analyze_text raises when Presidio health
    endpoint returns text/html and fail-closed is enabled.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        presidio_analyzer_api_base="http://test-analyzer/",
        presidio_anonymizer_api_base="http://test-anonymizer/",
        pii_entities_config={"PERSON": PiiAction.BLOCK},
        mock_testing=False,
    )

    mock_iterator = _make_mock_session_iterator(
        json_response=None,
        status=200,
        content_type="text/html; charset=utf-8",
        text_response="Presidio Analyzer service is up.",
    )

    with patch.object(guardrail, "_get_session_iterator", mock_iterator):
        with pytest.raises(
            _PresidioServiceError,
            match="Presidio PII analysis failed",
        ) as exc_info:
            await guardrail.analyze_text(
                text="Hello world",
                presidio_config=None,
                request_data={},
            )
        assert "Presidio Analyzer service is up." not in str(exc_info.value)


@pytest.mark.asyncio
async def test_analyze_text_non_json_content_type_fails_closed_without_entity_policy():
    """
    Test that non-JSON analysis fails closed without an entity policy.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        presidio_analyzer_api_base="http://test-analyzer/",
        presidio_anonymizer_api_base="http://test-anonymizer/",
        mock_testing=False,
    )

    mock_iterator = _make_mock_session_iterator(
        json_response=None,
        status=200,
        content_type="text/html; charset=utf-8",
        text_response="Presidio Analyzer service is up.",
    )

    with patch.object(guardrail, "_get_session_iterator", mock_iterator):
        with pytest.raises(_PresidioServiceError, match="Presidio PII analysis failed"):
            await guardrail.analyze_text(
                text="Hello world",
                presidio_config=None,
                request_data={},
            )


@pytest.mark.asyncio
async def test_analyze_text_http_error_status():
    """
    Test that analyze_text handles 5xx HTTP errors properly.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        presidio_analyzer_api_base="http://test-analyzer/",
        presidio_anonymizer_api_base="http://test-anonymizer/",
        pii_entities_config={"PERSON": PiiAction.BLOCK},
        mock_testing=False,
    )

    mock_iterator = _make_mock_session_iterator(
        json_response=None,
        status=500,
        content_type="text/plain",
        text_response="Internal Server Error",
    )

    with patch.object(guardrail, "_get_session_iterator", mock_iterator):
        with pytest.raises(_PresidioServiceError, match="Presidio PII analysis failed") as exc_info:
            await guardrail.analyze_text(
                text="Hello world",
                presidio_config=None,
                request_data={},
            )
        assert "Internal Server Error" not in str(exc_info.value)


@pytest.mark.asyncio
async def test_anonymize_text_non_json_content_type():
    """
    Test that anonymize_text raises Exception for non-JSON responses.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        presidio_analyzer_api_base="http://test-analyzer/",
        presidio_anonymizer_api_base="http://test-anonymizer/",
        mock_testing=False,
    )

    mock_iterator = _make_mock_session_iterator(
        json_response=None,
        status=200,
        content_type="text/html",
        text_response="Presidio Anonymizer service is up.",
    )

    with patch.object(guardrail, "_get_session_iterator", mock_iterator):
        with pytest.raises(Exception, match="Presidio anonymizer returned non-JSON content"):
            await guardrail.anonymize_text(
                text="Hello world",
                analyze_results=[{"start": 0, "end": 5, "entity_type": "PERSON"}],
                output_parse_pii=False,
                masked_entity_count={},
            )


@pytest.mark.asyncio
async def test_anonymize_text_http_error_status():
    """
    Test that anonymize_text raises Exception on HTTP error.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        presidio_analyzer_api_base="http://test-analyzer/",
        presidio_anonymizer_api_base="http://test-anonymizer/",
        mock_testing=False,
    )

    mock_iterator = _make_mock_session_iterator(
        json_response=None,
        status=502,
        content_type="text/plain",
        text_response="Bad Gateway",
    )

    with patch.object(guardrail, "_get_session_iterator", mock_iterator):
        with pytest.raises(Exception, match="Presidio anonymizer returned HTTP 502"):
            await guardrail.anonymize_text(
                text="Hello world",
                analyze_results=[{"start": 0, "end": 5, "entity_type": "PERSON"}],
                output_parse_pii=False,
                masked_entity_count={},
            )


@pytest.mark.asyncio
async def test_pii_tokens_stored_in_metadata_not_top_level(presidio_guardrail):
    """
    Regression test: pii_tokens must be stored in data['metadata']['pii_tokens'],
    NOT in data['pii_tokens']. Storing at the top level leaks the field to LLM
    providers like Anthropic, which reject unknown fields with
    'pii_tokens: Extra inputs are not permitted'.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        output_parse_pii=True,
        pii_entities_config={
            PiiEntityType.PERSON: PiiAction.MASK,
            PiiEntityType.PHONE_NUMBER: PiiAction.MASK,
        },
    )

    mock_user_api_key = UserAPIKeyAuth(api_key="test-key")
    mock_cache = DualCache()

    test_data = {
        "messages": [{"role": "user", "content": "My name is John and my phone is 555-123-4567"}],
        "model": "claude-haiku-4-5-20251001",
        "metadata": {},
    }

    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        # Simulate PII masking with token storage (mimics real anonymize_text behavior)
        if request_data is not None and output_parse_pii:
            if "metadata" not in request_data:
                request_data["metadata"] = {}
            if "pii_tokens" not in request_data["metadata"]:
                request_data["metadata"]["pii_tokens"] = {}
            pii_tokens = request_data["metadata"]["pii_tokens"]
            seq = len(pii_tokens) + 1
            token = f"<PERSON_{seq}>"
            pii_tokens[token] = "John"
            text = text.replace("John", token)
        return text

    guardrail.check_pii = mock_check_pii

    result = await guardrail.async_pre_call_hook(
        user_api_key_dict=mock_user_api_key,
        cache=mock_cache,
        data=test_data,
        call_type="completion",
    )

    # pii_tokens must NOT be at the top level of data (would leak to providers)
    assert "pii_tokens" not in result, (
        "pii_tokens must not be a top-level key in request data — "
        "it would leak to LLM providers and cause 'Extra inputs are not permitted' errors"
    )

    # pii_tokens must be inside metadata (safe from provider leakage)
    assert "metadata" in result
    assert "pii_tokens" in result["metadata"]
    assert len(result["metadata"]["pii_tokens"]) > 0


@pytest.mark.asyncio
async def test_pii_tokens_in_metadata_used_for_unmasking():
    """
    Regression test: _process_response_for_pii must read pii_tokens from
    data['metadata']['pii_tokens'] and correctly unmask the response.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        output_parse_pii=True,
    )

    token_key = "<PERSON_1>"
    request_data = {
        "model": "claude-haiku-4-5-20251001",
        "metadata": {"pii_tokens": {token_key: "John"}},
    }

    response = ModelResponse(
        choices=[
            Choices(
                message=Message(
                    role="assistant",
                    content=f"Hello {token_key}, how can I help you?",
                ),
                index=0,
                finish_reason="stop",
            )
        ]
    )

    await guardrail._process_response_for_pii(
        response=response,
        request_data=request_data,
        mode="unmask",
    )

    assert response.choices[0].message.content == "Hello John, how can I help you?"


@pytest.mark.asyncio
async def test_unmasking_preserves_masked_response_for_deferred_logging():
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        output_parse_pii=True,
    )
    logging_obj = MagicMock()
    request_data = {
        "metadata": {"pii_tokens": {"<KOR_NAME_1>": "홍길동"}},
    }
    response = ModelResponse(
        choices=[
            Choices(
                message=Message(
                    role="assistant",
                    content="안녕하세요 <KOR_NAME_1>님",
                ),
                index=0,
                finish_reason="stop",
            )
        ]
    )

    request_data["response"] = response
    result = await guardrail.apply_guardrail(
        inputs={"texts": ["안녕하세요 <KOR_NAME_1>님"]},
        request_data=request_data,
        input_type="response",
        logging_obj=logging_obj,
    )

    logged_response = logging_obj.set_deferred_logging_result.call_args.args[0]
    assert logged_response is not response
    assert logged_response.choices[0].message.content == "안녕하세요 <KOR_NAME_1>님"
    assert result["texts"] == ["안녕하세요 홍길동님"]


@pytest.mark.parametrize(
    "initial_hook",
    ["pre_call", "during_call", "pre_mcp_call"],
)
def test_event_hook_auto_expansion_for_all_string_hooks(initial_hook):
    """
    Regression test: when output_parse_pii is True, the guardrail must add
    'post_call' to event_hook regardless of the initial string hook value,
    not just when it's 'pre_call'.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        output_parse_pii=True,
        event_hook=initial_hook,
    )
    assert isinstance(guardrail.event_hook, list)
    assert initial_hook in guardrail.event_hook
    assert "post_call" in guardrail.event_hook


def test_event_hook_no_expansion_when_already_post_call():
    """post_call alone should stay as-is — no expansion needed."""
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        output_parse_pii=True,
        event_hook="post_call",
    )
    # Should remain a string "post_call", not expanded to a list
    assert guardrail.event_hook == "post_call"


@pytest.mark.asyncio
async def test_metadata_none_does_not_crash():
    """
    Regression test: if metadata is explicitly None in request_data,
    the guardrail must not crash with TypeError on the write or read path.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        output_parse_pii=True,
    )

    token_key = "<PERSON_1>"
    # metadata explicitly None — must not crash
    request_data = {
        "model": "gpt-3.5-turbo",
        "metadata": None,
    }

    response = ModelResponse(
        choices=[
            Choices(
                message=Message(
                    role="assistant",
                    content=f"Hello {token_key}, how can I help you?",
                ),
                index=0,
                finish_reason="stop",
            )
        ]
    )

    # Should not raise TypeError
    await guardrail._process_response_for_pii(
        response=response,
        request_data=request_data,
        mode="unmask",
    )

    # No pii_tokens to unmask, so content stays as-is
    assert response.choices[0].message.content == f"Hello {token_key}, how can I help you?"


# ---------------------------------------------------------------------------
# Tests for sequential-numbered token unmasking in _unmask_pii_text
# ---------------------------------------------------------------------------


def test_unmask_exact_match_with_sequential_tokens():
    """
    Normal unmasking: LLM echoes numbered tokens verbatim → original PII restored.
    """
    from litellm.proxy.guardrails.guardrail_hooks.presidio import (
        _OPTIONAL_PresidioPIIMasking,
    )

    pii_tokens = {
        "<PERSON_1>": "John Smith",
        "<PHONE_NUMBER_1>": "555-123-4567",
    }
    text = "Hello <PERSON_1>, your number is <PHONE_NUMBER_1>."
    result = _OPTIONAL_PresidioPIIMasking._unmask_pii_text(text, pii_tokens)
    assert result == "Hello John Smith, your number is 555-123-4567."


def test_unmask_multiple_same_entity_type():
    """
    Two phone numbers get distinct numbered tokens and unmask correctly.
    """
    from litellm.proxy.guardrails.guardrail_hooks.presidio import (
        _OPTIONAL_PresidioPIIMasking,
    )

    pii_tokens = {
        "<PHONE_NUMBER_1>": "555-111-0000",
        "<PHONE_NUMBER_2>": "555-222-0000",
    }
    text = "Call <PHONE_NUMBER_1> or <PHONE_NUMBER_2>."
    result = _OPTIONAL_PresidioPIIMasking._unmask_pii_text(text, pii_tokens)
    assert result == "Call 555-111-0000 or 555-222-0000."


def test_unmask_graceful_degradation():
    """
    If the LLM doesn't echo the token back, the numbered label stays
    in the output — clean and readable, not garbage hex.
    """
    from litellm.proxy.guardrails.guardrail_hooks.presidio import (
        _OPTIONAL_PresidioPIIMasking,
    )

    pii_tokens = {
        "<PERSON_1>": "John",
    }
    # LLM paraphrased instead of echoing the token
    text = "I see you provided a name."
    result = _OPTIONAL_PresidioPIIMasking._unmask_pii_text(text, pii_tokens)
    # No change — no garbage, just clean text
    assert result == text


# ---------------------------------------------------------------------------
# Fix 1: Position bug — reverse sort + original text coordinates
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_anonymize_text_multiple_items_position_correctness():
    """
    Regression test: when multiple PII items exist, coordinates reference the
    ORIGINAL text. Processing in reverse order prevents coordinate drift.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        presidio_analyzer_api_base="http://test-analyzer/",
        presidio_anonymizer_api_base="http://test-anonymizer/",
        mock_testing=False,
    )

    # "Call John at 555-123-4567"
    #   "John" at [5:9], "555-123-4567" at [13:25]
    anonymizer_response = {
        "text": "Call <PERSON> at <PHONE_NUMBER>",
        "items": [
            {
                "start": 5,
                "end": 9,
                "entity_type": "PERSON",
                "text": "<PERSON>",
                "operator": "replace",
            },
            {
                "start": 13,
                "end": 25,
                "entity_type": "PHONE_NUMBER",
                "text": "<PHONE_NUMBER>",
                "operator": "replace",
            },
        ],
    }

    mock_iterator = _make_mock_session_iterator(anonymizer_response)

    request_data = {"metadata": {}}
    with patch.object(guardrail, "_get_session_iterator", mock_iterator):
        result = await guardrail.anonymize_text(
            text="Call John at 555-123-4567",
            analyze_results=[
                {"start": 5, "end": 9, "entity_type": "PERSON", "score": 0.9},
                {"start": 13, "end": 25, "entity_type": "PHONE_NUMBER", "score": 0.95},
            ],
            output_parse_pii=True,
            masked_entity_count={},
            request_data=request_data,
        )

    pii_tokens = request_data["metadata"]["pii_tokens"]

    # Verify tokens captured the correct ORIGINAL text values
    person_token = [k for k in pii_tokens if "PERSON" in k][0]
    phone_token = [k for k in pii_tokens if "PHONE" in k][0]
    assert pii_tokens[person_token] == "John"
    assert pii_tokens[phone_token] == "555-123-4567"

    # Verify both PII values are masked in the result
    assert "John" not in result
    assert "555-123-4567" not in result


# ---------------------------------------------------------------------------
# Fix 2: Anthropic native dict response handling
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_anthropic_native_response_unmasking():
    """
    Anthropic native dict responses (type='message') should be unmasked
    when output_parse_pii is enabled.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        output_parse_pii=True,
    )

    request_data = {
        "model": "claude-3-haiku",
        "metadata": {
            "pii_tokens": {
                "<PERSON_1>": "John Smith",
                "<PHONE_NUMBER_1>": "555-123-4567",
            }
        },
    }

    anthropic_response = {
        "type": "message",
        "id": "msg_123",
        "model": "claude-3-haiku",
        "role": "assistant",
        "content": [
            {
                "type": "text",
                "text": "Hello <PERSON_1>, your number is <PHONE_NUMBER_1>.",
            }
        ],
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 10, "output_tokens": 20},
    }

    mock_user_api_key = UserAPIKeyAuth(api_key="test-key")

    result = await guardrail.async_post_call_success_hook(
        data=request_data,
        user_api_key_dict=mock_user_api_key,
        response=anthropic_response,
    )

    assert result["content"][0]["text"] == ("Hello John Smith, your number is 555-123-4567.")


@pytest.mark.asyncio
async def test_anthropic_native_response_masking():
    """
    Anthropic native dict responses should be masked when
    apply_to_output is enabled.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        apply_to_output=True,
    )

    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        return text.replace("John Smith", "[PERSON]").replace("555-123-4567", "[PHONE]")

    guardrail.check_pii = mock_check_pii

    anthropic_response = {
        "type": "message",
        "id": "msg_123",
        "model": "claude-3-haiku",
        "role": "assistant",
        "content": [{"type": "text", "text": "Hello John Smith, call 555-123-4567."}],
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 10, "output_tokens": 20},
    }

    mock_user_api_key = UserAPIKeyAuth(api_key="test-key")

    result = await guardrail.async_post_call_success_hook(
        data={},
        user_api_key_dict=mock_user_api_key,
        response=anthropic_response,
    )

    assert "[PERSON]" in result["content"][0]["text"]
    assert "[PHONE]" in result["content"][0]["text"]
    assert "John Smith" not in result["content"][0]["text"]


@pytest.mark.asyncio
async def test_anthropic_native_response_non_text_blocks_untouched():
    """
    Non-text blocks (tool_use, thinking) in Anthropic responses
    should be left untouched during unmasking.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        output_parse_pii=True,
    )

    request_data = {
        "model": "claude-3-haiku",
        "metadata": {"pii_tokens": {"<PERSON_1>": "John"}},
    }

    anthropic_response = {
        "type": "message",
        "id": "msg_123",
        "content": [
            {"type": "text", "text": "Hello <PERSON_1>"},
            {
                "type": "tool_use",
                "id": "call_1",
                "name": "search",
                "input": {"q": "test"},
            },
        ],
        "role": "assistant",
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 10, "output_tokens": 20},
    }

    mock_user_api_key = UserAPIKeyAuth(api_key="test-key")

    result = await guardrail.async_post_call_success_hook(
        data=request_data,
        user_api_key_dict=mock_user_api_key,
        response=anthropic_response,
    )

    assert result["content"][0]["text"] == "Hello John"
    assert result["content"][1]["type"] == "tool_use"
    assert result["content"][1]["name"] == "search"


# ---------------------------------------------------------------------------
# Fix 3: Anthropic native SSE streaming — bytes passthrough
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_apply_to_output_streaming_bytes_chunks_fail_closed():
    """
    Raw native SSE must not bypass apply_to_output inspection.
    """

    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        apply_to_output=True,
    )

    byte_chunk = b'data: {"type":"content_block_delta","delta":{"text":"Hello"}}\n\n'

    async def mock_stream():
        yield byte_chunk

    mock_user_api_key = UserAPIKeyAuth(api_key="test-key")
    with pytest.raises(Exception, match="cannot safely inspect raw streaming bytes"):
        async for _ in guardrail.async_post_call_streaming_iterator_hook(
            user_api_key_dict=mock_user_api_key,
            response=mock_stream(),
            request_data={},
        ):
            pass


@pytest.mark.asyncio
async def test_streaming_unmask_path_bytes_passthrough():
    """
    Bytes chunks in the unmasking path should also pass through.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        output_parse_pii=True,
    )

    byte_chunk = b'data: {"type":"content_block_delta"}\n\n'
    request_data = {
        "metadata": {"pii_tokens": {"<PERSON_1>": "John"}},
    }

    async def mock_stream():
        yield byte_chunk

    mock_user_api_key = UserAPIKeyAuth(api_key="test-key")
    chunks = []
    async for chunk in guardrail.async_post_call_streaming_iterator_hook(
        user_api_key_dict=mock_user_api_key,
        response=mock_stream(),
        request_data=request_data,
    ):
        chunks.append(chunk)

    assert len(chunks) == 1
    assert chunks[0] == byte_chunk


@pytest.mark.asyncio
async def test_apply_to_output_streaming_text_event_without_delta_fails_closed():
    """
    Text-bearing Responses events with an invalid shape must fail closed.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        apply_to_output=True,
    )

    class FakeResponsesEvent:
        def __init__(self, event_type: str):
            self.type = event_type

    events = [
        FakeResponsesEvent("response.created"),
        FakeResponsesEvent("response.output_text.delta"),
        FakeResponsesEvent("response.completed"),
    ]

    async def mock_stream():
        for event in events:
            yield event

    mock_user_api_key = UserAPIKeyAuth(api_key="test-key")
    with pytest.raises(Exception, match="text delta without text"):
        async for _ in guardrail.async_post_call_streaming_iterator_hook(
            user_api_key_dict=mock_user_api_key,
            response=mock_stream(),
            request_data={},
        ):
            pass


@pytest.mark.asyncio
async def test_apply_to_output_streaming_mixed_chunks_flushes_and_warns():
    """
    Known chat and Responses lifecycle events can coexist without masking bypass.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        apply_to_output=True,
    )

    class FakeResponsesEvent:
        def __init__(self, event_type: str):
            self.type = event_type

    model_chunk = ModelResponseStream(
        id="chatcmpl-mixed-1",
        choices=[],
        created=1,
        model="gpt-4",
        object="chat.completion.chunk",
        system_fingerprint=None,
    )
    response_completed = FakeResponsesEvent("response.completed")

    async def mock_stream():
        yield model_chunk
        yield response_completed

    mock_user_api_key = UserAPIKeyAuth(api_key="test-key")
    received = []
    async for chunk in guardrail.async_post_call_streaming_iterator_hook(
        user_api_key_dict=mock_user_api_key,
        response=mock_stream(),
        request_data={},
    ):
        received.append(chunk)

    assert received == [model_chunk, response_completed]


# ---------------------------------------------------------------------------
# Fix 4: apply_guardrail unmask path for input_type="response"
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_apply_guardrail_unmask_on_response():
    """
    When input_type is 'response' and pii_tokens exist, apply_guardrail
    should unmask text instead of masking it.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        guardrail_name="test_presidio",
        output_parse_pii=True,
        mock_testing=True,
    )

    request_data = {
        "model": "gpt-4o",
        "metadata": {
            "pii_tokens": {
                "<PERSON_1>": "John Smith",
                "<PHONE_NUMBER_1>": "555-123-4567",
            }
        },
    }

    inputs = {
        "texts": [
            "Hello <PERSON_1>, your number is <PHONE_NUMBER_1>.",
        ]
    }

    result = await guardrail.apply_guardrail(
        inputs=inputs,
        request_data=request_data,
        input_type="response",
    )

    assert result["texts"][0] == "Hello John Smith, your number is 555-123-4567."


@pytest.mark.asyncio
async def test_apply_guardrail_masks_on_request():
    """
    When input_type is 'request', apply_guardrail should mask as before.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        guardrail_name="test_presidio",
        output_parse_pii=True,
        mock_testing=True,
    )

    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        return text.replace("John Smith", "<PERSON>")

    guardrail.check_pii = mock_check_pii

    result = await guardrail.apply_guardrail(
        inputs={"texts": ["Hello John Smith"]},
        request_data={"model": "gpt-4o", "metadata": {}},
        input_type="request",
    )

    assert "<PERSON>" in result["texts"][0]
    assert "John Smith" not in result["texts"][0]


@pytest.mark.asyncio
async def test_apply_to_output_streaming_bytes_only_fails_closed():
    """
    A bytes-only apply_to_output stream must fail closed.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        apply_to_output=True,
    )

    byte_chunks = [
        b'data: {"type":"content_block_delta","delta":{"text":"Hello"}}\n\n',
        b'data: {"type":"content_block_delta","delta":{"text":" world"}}\n\n',
    ]

    async def mock_stream():
        for b in byte_chunks:
            yield b

    mock_user_api_key = UserAPIKeyAuth(api_key="test-key")

    with pytest.raises(Exception, match="cannot safely inspect raw streaming bytes"):
        async for _ in guardrail.async_post_call_streaming_iterator_hook(
            user_api_key_dict=mock_user_api_key,
            response=mock_stream(),
            request_data={},
        ):
            pass


@pytest.mark.asyncio
async def test_apply_to_output_chat_stream_masks_pii_split_across_chunks():
    guardrail = _OPTIONAL_PresidioPIIMasking(mock_testing=True, apply_to_output=True)
    prefix = "x" * 129

    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        return text.replace("alice@example.com", "[EMAIL]")

    guardrail.check_pii = mock_check_pii
    chunks = [
        ModelResponseStream(
            id="chatcmpl-pii",
            choices=[{"index": 0, "delta": {"content": prefix + "alice@"}}],
            created=1,
            model="gpt-4",
            object="chat.completion.chunk",
        ),
        ModelResponseStream(
            id="chatcmpl-pii",
            choices=[{"index": 0, "delta": {"content": "example.com"}}],
            created=1,
            model="gpt-4",
            object="chat.completion.chunk",
        ),
        ModelResponseStream(
            id="chatcmpl-pii",
            choices=[{"index": 0, "delta": {}, "finish_reason": "stop"}],
            created=1,
            model="gpt-4",
            object="chat.completion.chunk",
        ),
    ]

    async def mock_stream():
        for chunk in chunks:
            yield chunk

    received = []
    async for chunk in guardrail.async_post_call_streaming_iterator_hook(
        user_api_key_dict=UserAPIKeyAuth(api_key="test-key"),
        response=mock_stream(),
        request_data={},
    ):
        received.append(chunk)

    content = "".join(
        choice.delta.content or "" for chunk in received for choice in chunk.choices if hasattr(choice.delta, "content")
    )
    assert content == prefix + "[EMAIL]"
    assert "alice@example.com" not in content
    assert len(received) == 4


@pytest.mark.asyncio
async def test_apply_to_output_chat_stream_flushes_text_before_finish_reason():
    guardrail = _OPTIONAL_PresidioPIIMasking(mock_testing=True, apply_to_output=True)

    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        return text.replace("alice@example.com", "[EMAIL]")

    guardrail.check_pii = mock_check_pii

    async def mock_stream():
        yield ModelResponseStream(
            id="chatcmpl-pii",
            choices=[
                {
                    "index": 0,
                    "delta": {"content": "alice@example.com"},
                    "finish_reason": "stop",
                }
            ],
            created=1,
            model="gpt-4",
            object="chat.completion.chunk",
        )

    received = [
        chunk
        async for chunk in guardrail.async_post_call_streaming_iterator_hook(
            user_api_key_dict=UserAPIKeyAuth(api_key="test-key"),
            response=mock_stream(),
            request_data={},
        )
    ]

    assert received[0].choices[0].delta.content == "[EMAIL]"
    assert received[0].choices[0].finish_reason is None
    assert received[1].choices[0].delta.content == ""
    assert received[1].choices[0].finish_reason == "stop"


@pytest.mark.asyncio
async def test_apply_to_output_responses_stream_masks_each_logical_stream():
    guardrail = _OPTIONAL_PresidioPIIMasking(mock_testing=True, apply_to_output=True)
    prefix = "x" * 129

    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        return text.replace("alice@example.com", "[EMAIL]")

    guardrail.check_pii = mock_check_pii
    events = [
        {
            "type": "response.output_text.delta",
            "item_id": "item-1",
            "output_index": 0,
            "content_index": 0,
            "delta": prefix + "alice@",
        },
        {
            "type": "response.output_text.delta",
            "item_id": "item-1",
            "output_index": 0,
            "content_index": 0,
            "delta": "example.com",
        },
        {
            "type": "response.output_text.done",
            "item_id": "item-1",
            "output_index": 0,
            "content_index": 0,
            "text": prefix + "alice@example.com",
        },
    ]

    async def mock_stream():
        for event in events:
            yield event

    received = []
    async for event in guardrail.async_post_call_streaming_iterator_hook(
        user_api_key_dict=UserAPIKeyAuth(api_key="test-key"),
        response=mock_stream(),
        request_data={},
    ):
        received.append(event)

    deltas = "".join(event.get("delta", "") for event in received)
    assert deltas == prefix + "[EMAIL]"
    assert received[-1]["text"] == prefix + "[EMAIL]"
    assert "alice@example.com" not in str(received)


def test_presidio_requires_guardrailed_previous_response_history():
    assert _OPTIONAL_PresidioPIIMasking.requires_guardrailed_previous_response_history is True


@pytest.mark.asyncio
async def test_apply_to_output_responses_output_item_done_masks_nested_fields():
    guardrail = _OPTIONAL_PresidioPIIMasking(mock_testing=True, apply_to_output=True)

    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        return text.replace("SECRET", "[MASKED]")

    guardrail.check_pii = mock_check_pii
    event = {
        "type": "response.output_item.done",
        "output_index": 0,
        "item": {
            "content": [{"type": "output_text", "text": "SECRET content"}],
            "summary": [{"type": "summary_text", "text": "SECRET summary"}],
            "reasoning_content": "SECRET reasoning",
            "arguments": '{"value":"SECRET"}',
            "input": {"query": "SECRET input"},
            "output": {"result": "SECRET output"},
        },
    }

    async def mock_stream():
        yield event

    received = []
    async for chunk in guardrail.async_post_call_streaming_iterator_hook(
        user_api_key_dict=UserAPIKeyAuth(api_key="test-key"),
        response=mock_stream(),
        request_data={},
    ):
        received.append(chunk)

    assert "SECRET" not in str(received)
    item = received[0]["item"]
    assert item["content"][0]["text"] == "[MASKED] content"
    assert item["summary"][0]["text"] == "[MASKED] summary"
    assert item["arguments"] == '{"value":"[MASKED]"}'
    assert item["input"]["query"] == "[MASKED] input"
    assert item["output"]["result"] == "[MASKED] output"


@pytest.mark.asyncio
async def test_apply_to_output_response_done_masks_nested_output():
    guardrail = _OPTIONAL_PresidioPIIMasking(mock_testing=True, apply_to_output=True)

    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        return text.replace("alice@example.com", "[EMAIL]")

    guardrail.check_pii = mock_check_pii

    async def mock_stream():
        yield {
            "type": "response.done",
            "response": {
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": "alice@example.com"}],
                    }
                ]
            },
        }

    received = [
        event
        async for event in guardrail.async_post_call_streaming_iterator_hook(
            user_api_key_dict=UserAPIKeyAuth(api_key="test-key"),
            response=mock_stream(),
            request_data={},
        )
    ]

    assert received[0]["response"]["output"][0]["content"][0]["text"] == "[EMAIL]"


@pytest.mark.asyncio
async def test_apply_to_output_responses_annotation_masks_nested_text():
    guardrail = _OPTIONAL_PresidioPIIMasking(mock_testing=True, apply_to_output=True)

    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        return text.replace("alice@example.com", "[EMAIL]")

    guardrail.check_pii = mock_check_pii

    async def mock_stream():
        yield {
            "type": "response.output_text.annotation.added",
            "annotation": {"type": "text_annotation", "text": "Contact alice@example.com"},
        }

    received = [
        event
        async for event in guardrail.async_post_call_streaming_iterator_hook(
            user_api_key_dict=UserAPIKeyAuth(api_key="test-key"),
            response=mock_stream(),
            request_data={},
        )
    ]

    assert received[0]["annotation"]["text"] == "Contact [EMAIL]"


@pytest.mark.asyncio
async def test_apply_to_output_responses_code_delta_masks_split_pii():
    guardrail = _OPTIONAL_PresidioPIIMasking(mock_testing=True, apply_to_output=True)

    async def mock_check_pii(text, output_parse_pii, presidio_config, request_data):
        return text.replace("alice@example.com", "[EMAIL]")

    guardrail.check_pii = mock_check_pii

    async def mock_stream():
        yield {
            "type": "response.code_interpreter_call_code.delta",
            "event_id": "event-1",
            "item_id": "code-1",
            "output_index": 0,
            "delta": "alice@",
        }
        yield {
            "type": "response.code_interpreter_call_code.delta",
            "event_id": "event-2",
            "item_id": "code-1",
            "output_index": 0,
            "delta": "example.com",
        }
        yield {
            "type": "response.code_interpreter_call_code.done",
            "item_id": "code-1",
            "output_index": 0,
            "code": "alice@example.com",
        }

    received = [
        event
        async for event in guardrail.async_post_call_streaming_iterator_hook(
            user_api_key_dict=UserAPIKeyAuth(api_key="test-key"),
            response=mock_stream(),
            request_data={},
        )
    ]

    assert "".join(event.get("delta", "") for event in received) == "[EMAIL]"
    delta_event_ids = [event["event_id"] for event in received if "delta" in event]
    assert len(delta_event_ids) == len(set(delta_event_ids))
    assert received[-1]["code"] == "[EMAIL]"


@pytest.mark.asyncio
async def test_output_parse_pii_streaming_responses_events_passthrough(
    mock_user_api_key,
):
    """
    Regression test: when output_parse_pii=True and pii_tokens exist, /v1/responses
    streaming events must pass through instead of being dropped.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        output_parse_pii=True,
    )

    response_events = [
        {"type": "response.created", "response": {"id": "resp_1"}},
        {"type": "response.output_text.delta", "delta": "Hello"},
        {
            "type": "response.completed",
            "response": {"id": "resp_1", "status": "completed"},
        },
    ]

    async def mock_stream():
        for event in response_events:
            yield event

    collected = []
    async for chunk in guardrail.async_post_call_streaming_iterator_hook(
        user_api_key_dict=mock_user_api_key,
        response=mock_stream(),
        request_data={
            "metadata": {
                "pii_tokens": {"<EMAIL_ADDRESS_1>": "john@example.com"},
            }
        },
    ):
        collected.append(chunk)

    assert collected == response_events


@pytest.mark.asyncio
async def test_output_parse_pii_streaming_responses_completed_event_unmasked(
    mock_user_api_key,
):
    """
    When output_parse_pii=True, a /v1/responses ``response.completed`` event
    (a Pydantic ResponseCompletedEvent, as produced in production) must have its
    output text unmasked in-place before being forwarded to the client.
    """
    from litellm.types.llms.openai import (
        ResponseCompletedEvent,
        ResponsesAPIResponse,
        ResponsesAPIStreamEvents,
    )
    from litellm.types.responses.main import GenericResponseOutputItem, OutputText

    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        output_parse_pii=True,
    )

    completed_event = ResponseCompletedEvent(
        type=ResponsesAPIStreamEvents.RESPONSE_COMPLETED,
        response=ResponsesAPIResponse(
            id="resp_1",
            created_at=1,
            output=[
                GenericResponseOutputItem(
                    type="message",
                    id="msg_1",
                    status="completed",
                    role="assistant",
                    content=[
                        OutputText(
                            type="output_text",
                            text="Reach me at <EMAIL_ADDRESS_1> today.",
                            annotations=[],
                        )
                    ],
                )
            ],
            parallel_tool_calls=False,
            tool_choice="auto",
            tools=[],
        ),
    )

    async def mock_stream():
        yield completed_event

    collected = []
    async for chunk in guardrail.async_post_call_streaming_iterator_hook(
        user_api_key_dict=mock_user_api_key,
        response=mock_stream(),
        request_data={
            "metadata": {
                "pii_tokens": {"<EMAIL_ADDRESS_1>": "john@example.com"},
            }
        },
    ):
        collected.append(chunk)

    assert collected == [completed_event]
    assert collected[0].response.output[0].content[0].text == "Reach me at john@example.com today."


@pytest.mark.asyncio
async def test_output_parse_pii_streaming_mixed_chunks_flushes_buffered(
    mock_user_api_key,
):
    """
    Regression test: when output_parse_pii=True and a stream mixes buffered
    ModelResponseStream chunks with a /v1/responses event, the buffered chat
    chunks must still be forwarded (in order) instead of being dropped at the
    saw_non_chat_chunk early return.
    """
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        output_parse_pii=True,
    )

    class FakeResponsesEvent:
        def __init__(self, event_type: str):
            self.type = event_type

    model_chunk = ModelResponseStream(
        id="chatcmpl-mixed-unmask-1",
        choices=[],
        created=1,
        model="gpt-4",
        object="chat.completion.chunk",
        system_fingerprint=None,
    )
    response_completed = FakeResponsesEvent("response.completed")

    async def mock_stream():
        yield model_chunk
        yield response_completed

    collected = []
    async for chunk in guardrail.async_post_call_streaming_iterator_hook(
        user_api_key_dict=mock_user_api_key,
        response=mock_stream(),
        request_data={
            "metadata": {
                "pii_tokens": {"<EMAIL_ADDRESS_1>": "john@example.com"},
            }
        },
    ):
        collected.append(chunk)

    assert collected == [model_chunk, response_completed]


@pytest.mark.asyncio
async def test_anonymize_text_uses_correct_positions_no_parse_pii():
    """
    Regression test for anonymizer offset bug (fixes #24160).

    The Presidio anonymizer returns items with start/end positions that
    reference the *anonymized output* text, not the original input text.
    When output_parse_pii is False, anonymize_text must return
    redacted_text["text"] directly instead of manually splicing the
    original text using those positions, which produces garbled output
    with remnants of original PII data.
    """
    original_text = "My name is John Smith, my email is john@example.com, phone 555-867-5309"
    # Positions as returned by the analyzer (reference original text)
    analyze_results = [
        {"end": 51, "entity_type": "EMAIL_ADDRESS", "score": 1.0, "start": 35},
        {"end": 21, "entity_type": "PERSON", "score": 0.85, "start": 11},
        {"end": 71, "entity_type": "PHONE_NUMBER", "score": 0.75, "start": 59},
    ]
    # Anonymizer response — positions reference the *anonymized* text
    anonymizer_response = {
        "text": "My name is <PERSON>, my email is <EMAIL_ADDRESS>, phone <PHONE_NUMBER>",
        "items": [
            {
                "start": 56,
                "end": 70,
                "entity_type": "PHONE_NUMBER",
                "text": "<PHONE_NUMBER>",
                "operator": "replace",
            },
            {
                "start": 33,
                "end": 48,
                "entity_type": "EMAIL_ADDRESS",
                "text": "<EMAIL_ADDRESS>",
                "operator": "replace",
            },
            {
                "start": 11,
                "end": 19,
                "entity_type": "PERSON",
                "text": "<PERSON>",
                "operator": "replace",
            },
        ],
    }

    guardrail = _OPTIONAL_PresidioPIIMasking(
        presidio_analyzer_api_base="http://test-analyzer/",
        presidio_anonymizer_api_base="http://test-anonymizer/",
        mock_testing=False,
    )

    mock_iterator = _make_mock_session_iterator(
        json_response=anonymizer_response,
    )

    masked_entity_count = {}
    with patch.object(guardrail, "_get_session_iterator", mock_iterator):
        result = await guardrail.anonymize_text(
            text=original_text,
            analyze_results=analyze_results,
            output_parse_pii=False,
            masked_entity_count=masked_entity_count,
        )

    expected = "My name is <PERSON>, my email is <EMAIL_ADDRESS>, phone <PHONE_NUMBER>"
    assert result == expected, (
        f"anonymize_text produced garbled output with PII remnants.\nExpected: {expected!r}\nGot:      {result!r}"
    )
    assert masked_entity_count == {
        "PERSON": 1,
        "EMAIL_ADDRESS": 1,
        "PHONE_NUMBER": 1,
    }


@pytest.mark.asyncio
async def test_anonymize_text_uses_correct_positions_with_parse_pii():
    """
    Regression test for anonymizer offset bug with output_parse_pii=True
    (fixes #24160).

    When output_parse_pii is True, anonymize_text must use positions from
    analyze_results (which reference the original text) to build numbered
    tokens and the pii_tokens mapping, not positions from anonymizer items
    (which reference the anonymized output text).
    """
    original_text = "My name is John Smith, my email is john@example.com, phone 555-867-5309"
    analyze_results = [
        {"end": 51, "entity_type": "EMAIL_ADDRESS", "score": 1.0, "start": 35},
        {"end": 21, "entity_type": "PERSON", "score": 0.85, "start": 11},
        {"end": 71, "entity_type": "PHONE_NUMBER", "score": 0.75, "start": 59},
    ]
    anonymizer_response = {
        "text": "My name is <PERSON>, my email is <EMAIL_ADDRESS>, phone <PHONE_NUMBER>",
        "items": [
            {
                "start": 56,
                "end": 70,
                "entity_type": "PHONE_NUMBER",
                "text": "<PHONE_NUMBER>",
                "operator": "replace",
            },
            {
                "start": 33,
                "end": 48,
                "entity_type": "EMAIL_ADDRESS",
                "text": "<EMAIL_ADDRESS>",
                "operator": "replace",
            },
            {
                "start": 11,
                "end": 19,
                "entity_type": "PERSON",
                "text": "<PERSON>",
                "operator": "replace",
            },
        ],
    }

    guardrail = _OPTIONAL_PresidioPIIMasking(
        presidio_analyzer_api_base="http://test-analyzer/",
        presidio_anonymizer_api_base="http://test-anonymizer/",
        mock_testing=False,
        output_parse_pii=True,
    )

    mock_iterator = _make_mock_session_iterator(
        json_response=anonymizer_response,
    )

    masked_entity_count = {}
    request_data = {"metadata": {}}
    with patch.object(guardrail, "_get_session_iterator", mock_iterator):
        result = await guardrail.anonymize_text(
            text=original_text,
            analyze_results=analyze_results,
            output_parse_pii=True,
            masked_entity_count=masked_entity_count,
            request_data=request_data,
        )

    # Result must not contain any remnants of original PII
    assert "John" not in result
    assert "john@example.com" not in result
    assert "555-867-5309" not in result

    # pii_tokens must map numbered tokens back to correct original values
    pii_tokens = request_data["metadata"]["pii_tokens"]
    token_values = set(pii_tokens.values())
    assert "John Smith" in token_values
    assert "john@example.com" in token_values
    assert "555-867-5309" in token_values

    # Tokens must be numbered in left-to-right order of appearance:
    # PERSON (pos 11) → _1, EMAIL_ADDRESS (pos 35) → _2, PHONE_NUMBER (pos 59) → _3
    assert pii_tokens.get("<PERSON_1>") == "John Smith"
    assert pii_tokens.get("<EMAIL_ADDRESS_2>") == "john@example.com"
    assert pii_tokens.get("<PHONE_NUMBER_3>") == "555-867-5309"


def test_numbered_presidio_entities_use_base_label_for_reversible_tokens():
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        pii_entities_config={"KORNAME": PiiAction.MASK},
    )
    request_data = {"metadata": {}}
    masked_entity_count = {}

    result = guardrail._finalize_presidio_anonymize_numbered_tokens(
        text="Kim Lee",
        analyze_results=[
            {"entity_type": "KORNAME1", "start": 0, "end": 3},
            {"entity_type": "KORNAME2", "start": 4, "end": 7},
        ],
        request_data=request_data,
        masked_entity_count=masked_entity_count,
    )

    assert result == "<KORNAME_1> <KORNAME_2>"
    assert request_data["metadata"]["pii_tokens"] == {
        "<KORNAME_1>": "Kim",
        "<KORNAME_2>": "Lee",
    }
    assert masked_entity_count == {"KORNAME": 2}


def test_numbered_presidio_entities_remain_unique_across_messages():
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        pii_entities_config={
            "KOR_NAME": PiiAction.MASK,
            "RSNO": PiiAction.MASK,
        },
    )
    request_data = {"metadata": {}}
    masked_entity_count = {}

    first = guardrail._finalize_presidio_anonymize_numbered_tokens(
        text="홍길동 900101-1234567",
        analyze_results=[
            {"entity_type": "KOR_NAME", "start": 0, "end": 3},
            {"entity_type": "RSNO", "start": 4, "end": 18},
        ],
        request_data=request_data,
        masked_entity_count=masked_entity_count,
    )
    second = guardrail._finalize_presidio_anonymize_numbered_tokens(
        text="김철수 880202-2345678",
        analyze_results=[
            {"entity_type": "KOR_NAME", "start": 0, "end": 3},
            {"entity_type": "RSNO", "start": 4, "end": 18},
        ],
        request_data=request_data,
        masked_entity_count=masked_entity_count,
    )

    assert first == "<KOR_NAME_1> <RSNO_2>"
    assert second == "<KOR_NAME_3> <RSNO_4>"
    assert request_data["metadata"]["pii_tokens"] == {
        "<KOR_NAME_1>": "홍길동",
        "<RSNO_2>": "900101-1234567",
        "<KOR_NAME_3>": "김철수",
        "<RSNO_4>": "880202-2345678",
    }
    assert guardrail._unmask_pii_text(first, request_data["metadata"]["pii_tokens"]) == "홍길동 900101-1234567"
    assert guardrail._unmask_pii_text(second, request_data["metadata"]["pii_tokens"]) == "김철수 880202-2345678"


def test_reversible_tokens_are_canonicalized_in_final_input_order():
    guardrail = _OPTIONAL_PresidioPIIMasking(mock_testing=True)
    request_data = {
        "metadata": {
            # Simulate independently analyzed segments completing in reverse order.
            "pii_tokens": {
                "<ACTNO_1>": "222-22",
                "<PERSON_2>": "Alice",
            },
            "pii_token_sources": {
                "<ACTNO_1>": {"scope": "current_user_context"},
                "<PERSON_2>": {"scope": "current_user_prompt"},
            },
        }
    }
    inputs = {
        "texts": [
            "First Alice is <PERSON_2>",
            "Then account <ACTNO_1>",
            "Non-restorable <ACTNO> and caller text <ACTNO_999>",
        ]
    }

    result = guardrail._canonicalize_reversible_token_order(inputs, request_data)

    assert result == {
        "texts": [
            "First Alice is <PERSON_1>",
            "Then account <ACTNO_2>",
            "Non-restorable <ACTNO> and caller text <ACTNO_999>",
        ]
    }
    assert request_data["metadata"]["pii_tokens"] == {
        "<ACTNO_2>": "222-22",
        "<PERSON_1>": "Alice",
    }
    assert request_data["metadata"]["pii_token_sources"] == {
        "<ACTNO_2>": {"scope": "current_user_context"},
        "<PERSON_1>": {"scope": "current_user_prompt"},
    }


def test_reversible_token_canonicalization_preserves_unreferenced_request_mapping():
    guardrail = _OPTIONAL_PresidioPIIMasking(mock_testing=True)
    request_data = {
        "metadata": {
            "pii_tokens": {
                "<ACTNO_1>": "hidden-provider-input",
                "<PERSON_2>": "Alice",
            }
        }
    }

    result = guardrail._canonicalize_reversible_token_order(
        {"texts": ["Hello <PERSON_2>"]},
        request_data,
    )

    assert result == {"texts": ["Hello <PERSON_1>"]}
    assert request_data["metadata"]["pii_tokens"] == {
        "<ACTNO_2>": "hidden-provider-input",
        "<PERSON_1>": "Alice",
    }


@pytest.mark.asyncio
async def test_parallel_pre_call_renumbers_tokens_by_message_order():
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        guardrail_name="ordered-presidio",
        event_hook="pre_call",
        default_on=True,
        output_parse_pii=True,
    )

    async def complete_out_of_order(text, output_parse_pii, presidio_config, request_data):
        if text == "first":
            await asyncio.sleep(0.01)
        pii_tokens = request_data.setdefault("metadata", {}).setdefault("pii_tokens", {})
        entity = "PERSON" if text == "first" else "ACTNO"
        token = f"<{entity}_{len(pii_tokens) + 1}>"
        pii_tokens[token] = text
        return token

    guardrail.check_pii = complete_out_of_order
    data = {
        "metadata": {},
        "messages": [
            {"role": "user", "content": "first"},
            {"role": "user", "content": "second"},
        ],
    }

    result = await guardrail.async_pre_call_hook(
        user_api_key_dict=UserAPIKeyAuth(api_key="test-key"),
        cache=DualCache(),
        data=data,
        call_type="acompletion",
    )

    assert result["messages"] == [
        {"role": "user", "content": "<PERSON_1>"},
        {"role": "user", "content": "<ACTNO_2>"},
    ]
    assert result["metadata"]["pii_tokens"] == {
        "<ACTNO_2>": "second",
        "<PERSON_1>": "first",
    }


@pytest.mark.asyncio
async def test_apply_guardrail_limits_parallel_checks_and_preserves_input_order():
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        presidio_max_parallel_requests=2,
    )
    active_checks = 0
    max_active_checks = 0

    async def track_parallelism(text, output_parse_pii, presidio_config, request_data):
        nonlocal active_checks, max_active_checks
        active_checks += 1
        max_active_checks = max(max_active_checks, active_checks)
        await asyncio.sleep(0.01)
        active_checks -= 1
        return f"masked:{text}"

    guardrail.check_pii = track_parallelism
    inputs = {
        "texts": ["first", "second", "third"],
        "tool_calls": [
            {
                "type": "function",
                "function": {"name": "lookup", "arguments": "fourth"},
            }
        ],
    }

    result = await guardrail.apply_guardrail(
        inputs=inputs,
        request_data={"metadata": {}},
        input_type="request",
    )

    assert max_active_checks == 2
    assert result["texts"] == ["masked:first", "masked:second", "masked:third"]
    assert result["tool_calls"][0]["function"]["arguments"] == "masked:fourth"


@pytest.mark.parametrize("invalid_limit", [0, 65, True])
def test_presidio_rejects_invalid_parallel_request_limit(invalid_limit):
    with pytest.raises(ValueError, match="presidio_max_parallel_requests must be between 1 and 64"):
        _OPTIONAL_PresidioPIIMasking(
            mock_testing=True,
            presidio_max_parallel_requests=invalid_limit,
        )


@pytest.mark.asyncio
async def test_apply_guardrail_masks_tool_call_arguments():
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        mock_redacted_text={"text": '{"name":"<KOR_NAME>","rsno":"<RSNO>"}'},
        pii_entities_config={
            "KOR_NAME": PiiAction.MASK,
            "RSNO": PiiAction.MASK,
        },
    )
    inputs = {
        "texts": [],
        "tool_calls": [
            {
                "type": "function",
                "function": {
                    "name": "lookup",
                    "arguments": '{"name":"홍길동","rsno":"900101-1234567"}',
                },
            }
        ],
    }

    result = await guardrail.apply_guardrail(
        inputs=inputs,
        request_data={"metadata": {}},
        input_type="request",
    )

    assert result["tool_calls"][0]["function"]["arguments"] == '{"name":"<KOR_NAME>","rsno":"<RSNO>"}'


def test_numbered_placeholders_are_excluded_from_pii_analysis():
    text = "Name <KR_PERSON_1>, RRN 900101-1234567"

    analysis_text = _OPTIONAL_PresidioPIIMasking._text_for_pii_analysis(text)

    assert len(analysis_text) == len(text)
    assert "<KR_PERSON_1>" not in analysis_text
    assert "900101-1234567" in analysis_text


@pytest.mark.parametrize(
    ("scope", "expected"),
    [
        ("system_prompt", False),
        ("environment_context", False),
        ("tool_result", False),
        ("current_user_prompt", True),
        ("current_user_context", True),
        ("conversation_history", True),
    ],
)
def test_reversible_tokens_are_limited_to_restorable_scopes(scope, expected):
    input_source = {"scope": scope}

    result = _OPTIONAL_PresidioPIIMasking._should_create_reversible_tokens(
        True,
        input_source,
    )

    assert result is expected


def test_numbered_tokens_store_their_input_source():
    from litellm.proxy.guardrails.guardrail_hooks.presidio import (
        _PRESIDIO_LOG_CONTEXT,
    )

    guardrail = _OPTIONAL_PresidioPIIMasking(mock_testing=True)
    request_data = {"metadata": {}}
    input_source = {
        "type": "message",
        "role": "user",
        "path": "messages[1].content[0].text",
        "scope": "current_user_prompt",
    }
    context_token = _PRESIDIO_LOG_CONTEXT.set({"input_source": input_source})
    try:
        result = guardrail._finalize_presidio_anonymize_numbered_tokens(
            text="홍길동",
            analyze_results=[
                {
                    "entity_type": "KR_PERSON",
                    "start": 0,
                    "end": 3,
                    "score": 1.0,
                }
            ],
            request_data=request_data,
            masked_entity_count={},
        )
    finally:
        _PRESIDIO_LOG_CONTEXT.reset(context_token)

    assert result == "<KR_PERSON_1>"
    assert request_data["metadata"]["pii_token_sources"]["<KR_PERSON_1>"] == input_source


@pytest.mark.asyncio
async def test_unmasking_only_restores_tokens_from_restorable_input_scopes():
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        output_parse_pii=True,
    )
    request_data = {
        "metadata": {
            "pii_tokens": {
                "<KR_PERSON_1>": "system-secret",
                "<KR_PERSON_11>": "홍길동",
                "<KR_BANK_ACCOUNT_13>": "environment-secret",
            },
            "pii_token_sources": {
                "<KR_PERSON_1>": {"scope": "system_prompt"},
                "<KR_PERSON_11>": {"scope": "current_user_prompt"},
                "<KR_BANK_ACCOUNT_13>": {"scope": "environment_context"},
            },
        }
    }
    inputs = {"texts": ["Wrong <KR_PERSON_1>; right <KR_PERSON_11>; env <KR_BANK_ACCOUNT_13>"]}

    result = await guardrail.apply_guardrail(
        inputs=inputs,
        request_data=request_data,
        input_type="response",
    )

    assert result["texts"] == ["Wrong <KR_PERSON_1>; right 홍길동; env <KR_BANK_ACCOUNT_13>"]


@pytest.mark.asyncio
async def test_apply_to_output_takes_precedence_over_existing_reversible_tokens():
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        mock_redacted_text={"text": "<KOR_NAME>"},
        apply_to_output=True,
    )
    inputs = {"texts": ["홍길동"]}

    result = await guardrail.apply_guardrail(
        inputs=inputs,
        request_data={
            "metadata": {
                "pii_tokens": {"<KOR_NAME_1>": "홍길동"},
            }
        },
        input_type="response",
    )

    assert result["texts"] == ["<KOR_NAME>"]


def test_unmask_sse_bytes_chunk_replaces_text_delta():
    import json

    pii_tokens = {"<PERSON_1>": "Bobby"}
    event = {
        "type": "content_block_delta",
        "index": 0,
        "delta": {"type": "text_delta", "text": "Hello <PERSON_1>, how are you?"},
    }
    chunk = ("data: " + json.dumps(event) + "\n\n").encode("utf-8")

    result = _OPTIONAL_PresidioPIIMasking._unmask_sse_bytes_chunk(chunk, pii_tokens)

    decoded = result.decode("utf-8")
    parsed = json.loads(decoded.split("data: ", 1)[1].strip())
    assert parsed["delta"]["text"] == "Hello Bobby, how are you?"


def test_unmask_sse_bytes_chunk_ignores_non_text_delta():
    import json

    pii_tokens = {"<PERSON_1>": "Bobby"}

    # message_start event — no delta
    event = {"type": "message_start", "message": {"id": "msg_01", "role": "assistant"}}
    chunk = ("data: " + json.dumps(event) + "\n\n").encode("utf-8")
    result = _OPTIONAL_PresidioPIIMasking._unmask_sse_bytes_chunk(chunk, pii_tokens)
    assert result == chunk

    # input_json_delta — should not be touched
    event2 = {
        "type": "content_block_delta",
        "index": 1,
        "delta": {"type": "input_json_delta", "partial_json": '{"name": "<PERSON_1>"}'},
    }
    chunk2 = ("data: " + json.dumps(event2) + "\n\n").encode("utf-8")
    result2 = _OPTIONAL_PresidioPIIMasking._unmask_sse_bytes_chunk(chunk2, pii_tokens)
    assert result2 == chunk2


def test_unmask_sse_bytes_chunk_handles_malformed_json():
    chunk = b"data: {not valid json}\n\n"
    result = _OPTIONAL_PresidioPIIMasking._unmask_sse_bytes_chunk(chunk, {"<PERSON_1>": "Bobby"})
    assert result == chunk


def test_unmask_sse_bytes_chunk_handles_unicode_decode_error():
    chunk = b"\xff\xfe invalid utf-8"
    result = _OPTIONAL_PresidioPIIMasking._unmask_sse_bytes_chunk(chunk, {"<PERSON_1>": "Bobby"})
    assert result == chunk


def test_unmask_sse_bytes_chunk_non_ascii_pii_not_escaped():
    import json

    pii_tokens = {"<PERSON_1>": "José"}
    event = {
        "type": "content_block_delta",
        "index": 0,
        "delta": {"type": "text_delta", "text": "Hello <PERSON_1>!"},
    }
    chunk = ("data: " + json.dumps(event) + "\n\n").encode("utf-8")

    result = _OPTIONAL_PresidioPIIMasking._unmask_sse_bytes_chunk(chunk, pii_tokens)

    decoded = result.decode("utf-8")
    assert "Jos\\u" not in decoded
    parsed = json.loads(decoded.split("data: ", 1)[1].strip())
    assert parsed["delta"]["text"] == "Hello José!"


def test_unmask_sse_bytes_chunk_handles_crlf_line_endings():
    import json

    pii_tokens = {"<PERSON_1>": "Bobby"}
    event = {
        "type": "content_block_delta",
        "index": 0,
        "delta": {"type": "text_delta", "text": "Hi <PERSON_1>!"},
    }
    crlf_chunk = ("data: " + json.dumps(event) + "\r\ndata: [DONE]\r\n").encode("utf-8")

    result = _OPTIONAL_PresidioPIIMasking._unmask_sse_bytes_chunk(crlf_chunk, pii_tokens)

    decoded = result.decode("utf-8")
    parsed = json.loads(decoded.split("data: ", 1)[1].split("\n")[0].strip())
    assert parsed["delta"]["text"] == "Hi Bobby!"
    assert "data: [DONE]" in decoded


@pytest.mark.asyncio
async def test_stream_pii_unmasking_unmaskes_bytes_chunks(mock_user_api_key):
    import json

    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        output_parse_pii=True,
    )

    pii_tokens = {"<PERSON_1>": "Bobby"}
    request_data = {"metadata": {"pii_tokens": pii_tokens}}

    def _make_sse_chunk(text: str) -> bytes:
        event = {
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "text_delta", "text": text},
        }
        return ("data: " + json.dumps(event) + "\n\n").encode("utf-8")

    async def mock_stream():
        yield _make_sse_chunk("Hello <PERSON_1>!")
        yield _make_sse_chunk(" How can I help?")

    chunks = []
    async for chunk in guardrail._stream_pii_unmasking(mock_stream(), request_data):
        chunks.append(chunk)

    assert len(chunks) == 2
    first = chunks[0].decode("utf-8")
    first_event = json.loads(first.split("data: ", 1)[1].strip())
    assert first_event["delta"]["text"] == "Hello Bobby!"

    second = chunks[1].decode("utf-8")
    second_event = json.loads(second.split("data: ", 1)[1].strip())
    assert second_event["delta"]["text"] == " How can I help?"


@pytest.mark.asyncio
async def test_stream_pii_unmasking_passthrough_when_no_tokens(mock_user_api_key):
    guardrail = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        output_parse_pii=True,
    )

    raw_chunk = b"data: {}\n\n"
    request_data: dict = {"metadata": {}}

    async def mock_stream():
        yield raw_chunk

    chunks = []
    async for chunk in guardrail._stream_pii_unmasking(mock_stream(), request_data):
        chunks.append(chunk)

    assert chunks == [raw_chunk]


# ---------------------------------------------------------------------------
# Chunked /analyze tests (LIT-4785)
# Oversized texts must be split into overlapping chunks before /analyze, with
# per-chunk offsets remapped onto the original text.
# ---------------------------------------------------------------------------

CHUNK_MARKER_ONE = "4111-0001"
CHUNK_MARKER_TWO = "4111-0002"


def _make_marker_session_iterator(
    recorded_analyze_payloads,
    analyzer_body_limit_bytes=None,
    recorded_anonymize_payloads=None,
):
    """Mock session behaving like a real Presidio pair.

    /analyze returns a CREDIT_CARD detection for every ``4111-NNNN`` marker in
    the posted text (chunk-local offsets, like the real analyzer). When
    ``analyzer_body_limit_bytes`` is set, oversized /analyze bodies get the
    HTTP 413 from LIT-4785. /anonymize replaces the given spans in the posted
    text.
    """
    import json as json_module
    import re as re_module

    @asynccontextmanager
    async def mock_iterator():
        class MockResponse:
            def __init__(self, status, body):
                self.status = status
                self.content_type = "application/json"
                self.headers = {"Content-Type": "application/json"}
                self._body = body

            async def text(self):
                return json_module.dumps(self._body)

            async def json(self):
                return self._body

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

        class MockSession:
            def post(self, url, json=None, headers=None):
                payload = json
                if url.endswith("analyze"):
                    recorded_analyze_payloads.append(payload)
                    text = payload["text"]
                    if analyzer_body_limit_bytes is not None and len(text.encode("utf-8")) > analyzer_body_limit_bytes:
                        return MockResponse(
                            413,
                            {
                                "error": "Request body too large. /analyze accepts at most "
                                f"{analyzer_body_limit_bytes} bytes; larger documents must be "
                                "chunked by the caller."
                            },
                        )
                    results = [
                        {
                            "entity_type": "CREDIT_CARD",
                            "start": m.start(),
                            "end": m.end(),
                            "score": 1.0,
                        }
                        for m in re_module.finditer(r"4111-\d{4}", text)
                    ]
                    return MockResponse(200, results)
                if recorded_anonymize_payloads is not None:
                    recorded_anonymize_payloads.append(payload)
                text = payload["text"]
                items = sorted(payload["analyzer_results"], key=lambda r: r["start"], reverse=True)
                for r in items:
                    text = text[: r["start"]] + "<" + r["entity_type"] + ">" + text[r["end"] :]
                return MockResponse(
                    200,
                    {
                        "text": text,
                        "items": [{"entity_type": r["entity_type"]} for r in items],
                    },
                )

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

        yield MockSession()

    return mock_iterator


def _chunking_guardrail(chunk_size_bytes=100, **kwargs):
    return _OPTIONAL_PresidioPIIMasking(
        presidio_analyzer_api_base="http://test-analyzer/",
        presidio_anonymizer_api_base="http://test-anonymizer/",
        presidio_analyze_chunk_size_bytes=chunk_size_bytes,
        mock_testing=False,
        **kwargs,
    )


def _oversized_marker_text():
    """~258-char text with markers in the 1st and 3rd 100-byte chunk."""
    filler = "x" * 60
    return filler + CHUNK_MARKER_ONE + filler + filler + CHUNK_MARKER_TWO + filler


def test_split_text_for_analysis_offsets_and_byte_budget():
    text = " ".join(f"word{i}" for i in range(200))
    chunks = _OPTIONAL_PresidioPIIMasking._split_text_for_analysis(text=text, chunk_size_bytes=100, overlap_chars=20)
    assert len(chunks) > 1
    for offset, chunk in chunks:
        assert len(chunk.encode("utf-8")) <= 100
        assert text[offset : offset + len(chunk)] == chunk
    assert chunks[0][0] == 0
    assert chunks[-1][0] + len(chunks[-1][1]) == len(text)
    for (prev_off, prev_chunk), (next_off, _) in zip(chunks, chunks[1:]):
        # consecutive chunks overlap (or at least touch) and make progress
        assert next_off <= prev_off + len(prev_chunk)
        assert next_off > prev_off


def test_split_text_for_analysis_multibyte_characters():
    text = "émoji🙂 çafé " * 120
    chunks = _OPTIONAL_PresidioPIIMasking._split_text_for_analysis(text=text, chunk_size_bytes=64, overlap_chars=8)
    assert len(chunks) > 1
    for offset, chunk in chunks:
        assert len(chunk.encode("utf-8")) <= 64
        assert text[offset : offset + len(chunk)] == chunk
    assert chunks[-1][0] + len(chunks[-1][1]) == len(text)


def test_split_text_for_analysis_under_budget_returns_single_chunk():
    text = "short text"
    chunks = _OPTIONAL_PresidioPIIMasking._split_text_for_analysis(text=text, chunk_size_bytes=100, overlap_chars=20)
    assert chunks == [(0, text)]


@pytest.mark.asyncio
async def test_analyze_text_single_call_when_under_limit():
    guardrail = _chunking_guardrail(chunk_size_bytes=10_000)
    payloads = []
    text = f"my card is {CHUNK_MARKER_ONE} thanks"
    with patch.object(guardrail, "_get_session_iterator", _make_marker_session_iterator(payloads)):
        results = await guardrail.analyze_text(text=text, presidio_config=None, request_data={})
    assert len(payloads) == 1
    assert payloads[0]["text"] == text
    assert len(results) == 1
    assert text[results[0]["start"] : results[0]["end"]] == CHUNK_MARKER_ONE


@pytest.mark.asyncio
async def test_analyze_text_chunks_oversized_text_and_remaps_offsets():
    """Regression test for LIT-4785.

    The mock analyzer rejects bodies over 100 bytes with HTTP 413 (like the
    reporter's deployment): on unfixed code the single oversized /analyze call
    fails closed; with chunking every call stays under the limit and the
    detections come back with offsets remapped onto the original text.
    The duplicate detection from the overlap region must be deduplicated.
    """
    guardrail = _chunking_guardrail(
        chunk_size_bytes=100,
        pii_entities_config={"CREDIT_CARD": PiiAction.MASK},
    )
    payloads = []
    text = _oversized_marker_text()
    with patch.object(
        guardrail,
        "_get_session_iterator",
        _make_marker_session_iterator(payloads, analyzer_body_limit_bytes=100),
    ):
        results = await guardrail.analyze_text(text=text, presidio_config=None, request_data={})
    assert len(payloads) > 1
    for payload in payloads:
        assert len(payload["text"].encode("utf-8")) <= 100
    assert [text[r["start"] : r["end"]] for r in results] == [
        CHUNK_MARKER_ONE,
        CHUNK_MARKER_TWO,
    ]


@pytest.mark.asyncio
async def test_check_pii_masks_oversized_text_with_chunking():
    guardrail = _chunking_guardrail(
        chunk_size_bytes=100,
        pii_entities_config={"CREDIT_CARD": PiiAction.MASK},
    )
    analyze_payloads = []
    anonymize_payloads = []
    text = _oversized_marker_text()
    with patch.object(
        guardrail,
        "_get_session_iterator",
        _make_marker_session_iterator(
            analyze_payloads,
            analyzer_body_limit_bytes=100,
            recorded_anonymize_payloads=anonymize_payloads,
        ),
    ):
        masked = await guardrail.check_pii(text=text, output_parse_pii=False, presidio_config=None, request_data={})
    assert CHUNK_MARKER_ONE not in masked
    assert CHUNK_MARKER_TWO not in masked
    assert masked.count("<CREDIT_CARD>") == 2
    # anonymize still receives the full text with globally remapped offsets
    assert len(anonymize_payloads) == 1
    assert anonymize_payloads[0]["text"] == text


@pytest.mark.asyncio
async def test_output_parse_pii_numbered_tokens_across_chunks():
    """Numbered tokens slice the ORIGINAL text at the remapped offsets; a
    chunk-local offset would store the wrong substring in pii_tokens and
    corrupt the later unmask."""
    guardrail = _chunking_guardrail(
        chunk_size_bytes=100,
        pii_entities_config={"CREDIT_CARD": PiiAction.MASK},
        output_parse_pii=True,
    )
    payloads = []
    request_data = {}
    text = _oversized_marker_text()
    with patch.object(
        guardrail,
        "_get_session_iterator",
        _make_marker_session_iterator(payloads, analyzer_body_limit_bytes=100),
    ):
        masked = await guardrail.check_pii(
            text=text,
            output_parse_pii=True,
            presidio_config=None,
            request_data=request_data,
        )
    assert masked.count("<CREDIT_CARD_1>") == 1
    assert masked.count("<CREDIT_CARD_2>") == 1
    pii_tokens = request_data["metadata"]["pii_tokens"]
    assert pii_tokens["<CREDIT_CARD_1>"] == CHUNK_MARKER_ONE
    assert pii_tokens["<CREDIT_CARD_2>"] == CHUNK_MARKER_TWO


@pytest.mark.asyncio
async def test_analyze_text_chunked_failure_stays_fail_closed():
    """If one chunk still fails, the chunked path raises exactly like a single
    failing /analyze call (fail closed when PII protection is configured)."""
    guardrail = _chunking_guardrail(
        chunk_size_bytes=100,
        pii_entities_config={"CREDIT_CARD": PiiAction.MASK},
    )
    payloads = []
    text = _oversized_marker_text()
    with patch.object(
        guardrail,
        "_get_session_iterator",
        # every chunk is rejected: limit below the chunk size
        _make_marker_session_iterator(payloads, analyzer_body_limit_bytes=10),
    ):
        with pytest.raises(_PresidioServiceError, match="Presidio PII analysis failed"):
            await guardrail.analyze_text(text=text, presidio_config=None, request_data={})


def test_presidio_analyze_chunk_size_default_and_validation():
    from litellm.constants import DEFAULT_PRESIDIO_ANALYZE_CHUNK_SIZE_BYTES

    guardrail = _OPTIONAL_PresidioPIIMasking(mock_testing=True)
    assert guardrail.presidio_analyze_chunk_size_bytes == DEFAULT_PRESIDIO_ANALYZE_CHUNK_SIZE_BYTES

    nonpositive = _OPTIONAL_PresidioPIIMasking(mock_testing=True, presidio_analyze_chunk_size_bytes=-5)
    assert nonpositive.presidio_analyze_chunk_size_bytes == DEFAULT_PRESIDIO_ANALYZE_CHUNK_SIZE_BYTES

    custom = _OPTIONAL_PresidioPIIMasking(mock_testing=True, presidio_analyze_chunk_size_bytes=1234)
    assert custom.presidio_analyze_chunk_size_bytes == 1234


def test_update_in_memory_applies_analyze_chunk_size():
    guardrail = _OPTIONAL_PresidioPIIMasking(mock_testing=True)
    params = LitellmParams(
        guardrail="presidio",
        mode="pre_call",
        presidio_analyze_chunk_size_bytes=99_000,
    )
    guardrail.update_in_memory_litellm_params(params)
    assert guardrail.presidio_analyze_chunk_size_bytes == 99_000


def test_merge_drops_truncated_same_type_fragment_from_overlap():
    """A boundary entity seen truncated by chunk 1 and whole by chunk 2 must
    merge to the single full span; keeping both overlapping spans corrupts the
    numbered-token rewriter and double-counts entities."""
    truncated = {"entity_type": "IP_ADDRESS", "start": 10, "end": 21, "score": 0.6}
    full_local = {"entity_type": "IP_ADDRESS", "start": 5, "end": 18, "score": 0.95}
    merged = _OPTIONAL_PresidioPIIMasking._merge_chunked_analyze_results(
        text_chunks=[(0, "x" * 21), (5, "x" * 25)],
        chunk_results=[[truncated], [full_local]],
    )
    assert len(merged) == 1
    assert (merged[0]["start"], merged[0]["end"]) == (10, 23)
    assert merged[0]["score"] == 0.95


def test_merge_exact_duplicate_keeps_higher_score():
    low = {"entity_type": "EMAIL_ADDRESS", "start": 3, "end": 9, "score": 0.4}
    high = {"entity_type": "EMAIL_ADDRESS", "start": 0, "end": 6, "score": 0.9}
    merged = _OPTIONAL_PresidioPIIMasking._merge_chunked_analyze_results(
        text_chunks=[(0, "x" * 9), (3, "x" * 9)],
        chunk_results=[[low], [high]],
    )
    assert len(merged) == 1
    assert merged[0]["score"] == 0.9


def test_merge_preserves_cross_type_overlap():
    """Single-call Presidio returns overlapping detections of DIFFERENT types
    (e.g. URL inside EMAIL_ADDRESS); the chunk merge must not drop those."""
    email = {"entity_type": "EMAIL_ADDRESS", "start": 0, "end": 20, "score": 1.0}
    url = {"entity_type": "URL", "start": 5, "end": 20, "score": 0.5}
    merged = _OPTIONAL_PresidioPIIMasking._merge_chunked_analyze_results(
        text_chunks=[(0, "x" * 25)],
        chunk_results=[[email, url]],
    )
    assert len(merged) == 2


def test_update_in_memory_coerces_invalid_chunk_size():
    from litellm.constants import DEFAULT_PRESIDIO_ANALYZE_CHUNK_SIZE_BYTES

    guardrail = _OPTIONAL_PresidioPIIMasking(mock_testing=True, presidio_analyze_chunk_size_bytes=99_000)
    params = LitellmParams(
        guardrail="presidio",
        mode="pre_call",
        presidio_analyze_chunk_size_bytes=-1,
    )
    guardrail.update_in_memory_litellm_params(params)
    assert guardrail.presidio_analyze_chunk_size_bytes == DEFAULT_PRESIDIO_ANALYZE_CHUNK_SIZE_BYTES


def test_split_text_handles_chunk_size_below_char_width():
    chunks = _OPTIONAL_PresidioPIIMasking._split_text_for_analysis(
        text="\U0001f642\U0001f642", chunk_size_bytes=3, overlap_chars=8
    )
    assert all(chunk for _, chunk in chunks)
    assert chunks[-1][0] + len(chunks[-1][1]) == 2


@pytest.mark.asyncio
async def test_tiny_chunk_size_with_multibyte_text_terminates():
    """chunk_size below one character's UTF-8 width must not recurse forever;
    the constructor floors the value to the widest character width."""
    guardrail = _chunking_guardrail(chunk_size_bytes=1)
    assert guardrail.presidio_analyze_chunk_size_bytes == 4
    payloads = []
    with patch.object(guardrail, "_get_session_iterator", _make_marker_session_iterator(payloads)):
        results = await guardrail.analyze_text(
            text="\U0001f642\U0001f642\U0001f642ab", presidio_config=None, request_data={}
        )
    assert results == []
    assert len(payloads) >= 2


@pytest.mark.asyncio
async def test_chunked_analyze_concurrency_is_bounded():
    from litellm.constants import PRESIDIO_ANALYZE_CHUNK_CONCURRENCY

    guardrail = _chunking_guardrail(chunk_size_bytes=10)
    state = {"active": 0, "peak": 0}

    @asynccontextmanager
    async def mock_iterator():
        class MockResponse:
            status = 200
            content_type = "application/json"
            headers = {"Content-Type": "application/json"}

            async def text(self):
                return "[]"

            async def json(self):
                state["active"] += 1
                state["peak"] = max(state["peak"], state["active"])
                await asyncio.sleep(0.005)
                state["active"] -= 1
                return []

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

        class MockSession:
            def post(self, url, json=None, headers=None):
                return MockResponse()

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

        yield MockSession()

    with patch.object(guardrail, "_get_session_iterator", mock_iterator):
        await guardrail.analyze_text(
            text="".join(f"{index:04d}" for index in range(100)), presidio_config=None, request_data={}
        )
    assert state["peak"] >= 2
    assert state["peak"] <= PRESIDIO_ANALYZE_CHUNK_CONCURRENCY


def test_split_text_accounts_for_json_body_expansion():
    """Non-ASCII text expands under JSON escaping; the budget must apply to the
    serialized form or a chunk can still exceed the analyzer body limit."""
    import json as json_module

    text = "これは個人情報テストです。" * 200  # 3-byte UTF-8 chars, 6-byte escapes
    budget = 1000
    chunks = _OPTIONAL_PresidioPIIMasking._split_text_for_analysis(text=text, chunk_size_bytes=budget, overlap_chars=8)
    assert len(chunks) > 1
    for offset, chunk in chunks:
        assert len(json_module.dumps(chunk).encode("utf-8")) - 2 <= budget
        assert text[offset : offset + len(chunk)] == chunk
    # full coverage: last chunk reaches the end of the text
    last_offset, last_chunk = chunks[-1]
    assert last_offset + len(last_chunk) == len(text)


@pytest.mark.asyncio
async def test_chunked_analyze_applies_score_threshold_before_merge():
    """A below-threshold long span must not win overlap resolution against an
    above-threshold detection of the same type (it would then be dropped by the
    downstream threshold filter, leaving the entity unmasked)."""
    guardrail = _chunking_guardrail(
        chunk_size_bytes=100,
        presidio_score_thresholds={"CREDIT_CARD": 0.6},
    )
    marker_text = "x" * 40 + CHUNK_MARKER_ONE + "x" * 80  # single chunked text

    @asynccontextmanager
    async def mock_iterator():
        class MockResponse:
            status = 200
            content_type = "application/json"
            headers = {"Content-Type": "application/json"}

            def __init__(self, body):
                self._body = body

            async def text(self):
                import json as json_module

                return json_module.dumps(self._body)

            async def json(self):
                return self._body

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

        class MockSession:
            def post(self, url, json=None, headers=None):
                text = json["text"]
                idx = text.find(CHUNK_MARKER_ONE)
                if idx == -1:
                    return MockResponse([])
                return MockResponse(
                    [
                        # long, below-threshold span engulfing the marker
                        {
                            "entity_type": "CREDIT_CARD",
                            "start": max(idx - 5, 0),
                            "end": idx + len(CHUNK_MARKER_ONE) + 5,
                            "score": 0.3,
                        },
                        # the true, above-threshold detection
                        {
                            "entity_type": "CREDIT_CARD",
                            "start": idx,
                            "end": idx + len(CHUNK_MARKER_ONE),
                            "score": 0.9,
                        },
                    ]
                )

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

        yield MockSession()

    with patch.object(guardrail, "_get_session_iterator", mock_iterator):
        results = await guardrail.analyze_text(text=marker_text, presidio_config=None, request_data={})
    kept = [r for r in results if r.get("entity_type") == "CREDIT_CARD"]
    assert any(r.get("score") == 0.9 for r in kept), kept
    assert all(r.get("score") != 0.3 for r in kept), kept


@pytest.mark.asyncio
async def test_chunk_fanout_bound_is_shared_across_concurrent_calls():
    """The chunk semaphore is per event loop and instance, so several oversized
    blocks analyzed concurrently share ONE bound instead of getting 8 each."""
    from litellm.constants import PRESIDIO_ANALYZE_CHUNK_CONCURRENCY

    guardrail = _chunking_guardrail(chunk_size_bytes=10)
    state = {"active": 0, "peak": 0}

    @asynccontextmanager
    async def mock_iterator():
        class MockResponse:
            status = 200
            content_type = "application/json"
            headers = {"Content-Type": "application/json"}

            async def text(self):
                return "[]"

            async def json(self):
                state["active"] += 1
                state["peak"] = max(state["peak"], state["active"])
                await asyncio.sleep(0.005)
                state["active"] -= 1
                return []

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

        class MockSession:
            def post(self, url, json=None, headers=None):
                return MockResponse()

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

        yield MockSession()

    with patch.object(guardrail, "_get_session_iterator", mock_iterator):
        await asyncio.gather(
            *(
                guardrail.analyze_text(
                    text="".join(f"{index:04d}" for index in range(100)), presidio_config=None, request_data={}
                )
                for _ in range(4)
            )
        )
    assert state["peak"] >= 2
    assert state["peak"] <= PRESIDIO_ANALYZE_CHUNK_CONCURRENCY


@pytest.mark.asyncio
async def test_chunk_prefetch_cache_reuse_keeps_raw_offsets_and_current_policy():
    from litellm.proxy.guardrails.guardrail_hooks.presidio_analysis_cache import AnalysisCache, AnalysisCacheConfig
    from litellm.proxy.guardrails.guardrail_hooks.presidio_analysis_context import analysis_request_scope

    cache = AnalysisCache(
        AnalysisCacheConfig(
            enabled=True,
            complete_analysis_verified=True,
            secret="synthetic-key-for-local-cache-test-only",
            key_version="test",
            analysis_version="synthetic-chunk-v1",
        )
    )
    guardrail = _chunking_guardrail(chunk_size_bytes=100, presidio_analysis_cache=cache)
    text = _oversized_marker_text()
    payloads = []
    with patch.object(guardrail, "_get_session_iterator", _make_marker_session_iterator(payloads)):
        with analysis_request_scope(tenant_scope="synthetic-tenant"):
            await guardrail._prepare_analysis((text, text), None, {})
            prefetched = len(payloads)
            first = await guardrail.analyze_text(text, None, {})
            assert len(payloads) == prefetched
        with analysis_request_scope(tenant_scope="synthetic-tenant"):
            second = await guardrail.analyze_text(text, None, {})
            assert second == first
            assert len(payloads) == prefetched
        guardrail.presidio_score_thresholds = {"CREDIT_CARD": 1.01}
        with analysis_request_scope(tenant_scope="synthetic-tenant"):
            assert await guardrail.analyze_text(text, None, {}) == []
            assert len(payloads) == prefetched
    assert prefetched > 1
    assert all(payload["text"] != text for payload in payloads)
    assert {text[item["start"] : item["end"]] for item in first} == {CHUNK_MARKER_ONE, CHUNK_MARKER_TWO}


@pytest.mark.asyncio
async def test_chunk_semaphore_queue_respects_request_deadline():
    import time

    from litellm.constants import PRESIDIO_ANALYZE_CHUNK_CONCURRENCY
    from litellm.proxy.guardrails.guardrail_hooks.presidio_analysis_context import analysis_request_scope

    guardrail = _chunking_guardrail(chunk_size_bytes=100)
    semaphore = guardrail._get_chunk_semaphore()
    for _ in range(PRESIDIO_ANALYZE_CHUNK_CONCURRENCY):
        await semaphore.acquire()
    try:
        with analysis_request_scope() as context:
            context.deadline = time.monotonic() + 0.03
            started = time.monotonic()
            with pytest.raises(_PresidioServiceError, match="TimeoutError"):
                await guardrail.analyze_text(_oversized_marker_text(), None, {})
            assert time.monotonic() - started < 0.3
    finally:
        for _ in range(PRESIDIO_ANALYZE_CHUNK_CONCURRENCY):
            semaphore.release()


@pytest.mark.parametrize("last_offset", [None, 14])
def test_chunk_merge_preserves_partial_and_chained_overlap_coverage(last_offset):
    import copy

    chunks = [(0, "x" * 10), (8, "x" * 8)]
    results = [
        [{"start": 0, "end": 10, "entity_type": "PERSON", "score": 0.8}],
        [{"start": 0, "end": 8, "entity_type": "PERSON", "score": 0.9}],
    ]
    if last_offset is not None:
        chunks.append((last_offset, "x" * 8))
        results.append([{"start": 0, "end": 8, "entity_type": "PERSON", "score": 0.7}])
    original = copy.deepcopy(results)
    merged = _OPTIONAL_PresidioPIIMasking._merge_chunked_analyze_results(chunks, results)
    assert merged == [{"start": 0, "end": 16 if last_offset is None else 22, "entity_type": "PERSON", "score": 0.9}]
    assert results == original


@pytest.mark.asyncio
async def test_close_session_releases_chunk_loop_references():
    guardrail = _chunking_guardrail()
    guardrail._get_chunk_semaphore()
    assert guardrail._loop_chunk_semaphores
    await guardrail._close_http_session()
    assert not guardrail._loop_chunk_semaphores


def test_presidio_cache_constructor_and_live_update(monkeypatch):
    for name, value in {
        "ENABLED": "true",
        "COMPLETE_ANALYSIS_VERIFIED": "true",
        "HMAC_SECRET": "synthetic-secret-for-constructor-over-32-bytes",
        "KEY_VERSION": "k1",
        "ANALYSIS_VERSION": "synthetic-v1",
        "TTL_SECONDS": "123",
    }.items():
        monkeypatch.setenv("PRESIDIO_ANALYSIS_CACHE_" + name, value)
    callback = _OPTIONAL_PresidioPIIMasking(
        mock_testing=True,
        presidio_analysis_cache_enabled=False,
        presidio_language="ko",
        presidio_analyze_chunk_size_bytes=1024,
        pii_entities_config={"PERSON": PiiAction.BLOCK},
    )
    assert not callback._analysis_cache.config.enabled
    callback.update_in_memory_litellm_params(
        LitellmParams(
            guardrail="presidio",
            mode="pre_call",
            presidio_analysis_cache_enabled=True,
            presidio_analysis_cache_ttl_seconds=60,
        )
    )
    assert callback._analysis_cache.config.safe_to_enable
    assert callback._analysis_cache.config.ttl_seconds == 60
    old_cache = callback._analysis_cache
    injected_redis = MagicMock()
    old_cache.redis_cache = injected_redis
    callback.update_in_memory_litellm_params(LitellmParams(guardrail="presidio", mode="pre_call"))
    assert callback._analysis_cache is not old_cache
    assert callback._analysis_cache.redis_cache is injected_redis
    assert callback._analysis_cache.config.enabled
    assert callback._analysis_cache.config.ttl_seconds == 123
    assert callback.presidio_language == "ko"
    assert callback.presidio_analyze_chunk_size_bytes == 1024
    assert callback.pii_entities_config == {"PERSON": PiiAction.BLOCK}
    callback.update_in_memory_litellm_params(
        LitellmParams(
            guardrail="presidio",
            mode="pre_call",
            presidio_language=None,
            presidio_analyze_chunk_size_bytes=None,
            pii_entities_config=None,
            presidio_score_thresholds=None,
            presidio_entities_deny_list=None,
        )
    )
    assert callback.presidio_language == "en"
    assert callback.presidio_analyze_chunk_size_bytes > 0
    assert callback.pii_entities_config == {}
    assert callback.presidio_score_thresholds == {}
    assert callback.presidio_entities_deny_list == []


@pytest.mark.parametrize(
    ("mode", "expected_count"),
    [("pre_call", 3), ("post_call", 3), ("logging_only", 1), (["pre_call", "post_call", "logging_only"], 4)],
)
def test_presidio_cache_initializer_all_callbacks(monkeypatch, mode, expected_count):
    from litellm.proxy.guardrails.guardrail_initializers import initialize_presidio

    monkeypatch.setenv("PRESIDIO_ANALYSIS_CACHE_ENABLED", "true")
    guardrail_name = "synthetic-cache-initializer"

    def registered_callbacks():
        return tuple(
            callback
            for callback in litellm.logging_callback_manager.get_custom_loggers_for_type(_OPTIONAL_PresidioPIIMasking)
            if callback.guardrail_name == guardrail_name
        )

    try:
        primary = initialize_presidio(
            LitellmParams(
                guardrail="presidio",
                mode=mode,
                output_parse_pii=True,
                presidio_analyzer_api_base="http://127.0.0.1:1",
                presidio_anonymizer_api_base="http://127.0.0.1:1",
                presidio_analysis_cache_enabled=False,
                presidio_analysis_cache_ttl_seconds=77,
            ),
            {"guardrail_name": guardrail_name},
        )
        callbacks = registered_callbacks()
        assert len(callbacks) == expected_count
        assert primary in callbacks
        for callback in callbacks:
            assert callback._analysis_cache.config.enabled is False
            assert callback._analysis_cache.config.ttl_seconds == 77
    finally:
        for callback in registered_callbacks():
            litellm.logging_callback_manager.remove_callback_from_all_lists(callback)
