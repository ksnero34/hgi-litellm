"""
OpenAI Responses API Handler for Unified Guardrails

This module provides a class-based handler for OpenAI Responses API format.
The class methods can be overridden for custom behavior.

Pattern Overview:
-----------------
1. Extract text content from input/output (both string and list formats)
2. Create async tasks to apply guardrails to each text segment
3. Track mappings to know where each response belongs
4. Apply guardrail responses back to the original structure

Responses API Format:
---------------------
Input: Union[str, List[Dict]] where each dict has:
  - role: str
  - content: Union[str, List[Dict]] (can have text items)
  - type: str (e.g., "message")

Output: response.output is List[GenericResponseOutputItem] where each has:
  - type: str (e.g., "message")
  - id: str
  - status: str
  - role: str
  - content: List[OutputText] where OutputText has:
    - type: str (e.g., "output_text")
    - text: str
"""

import copy
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any, Final, Literal, cast

from openai.types.responses.response_function_tool_call import ResponseFunctionToolCall
from pydantic import BaseModel

from litellm._logging import verbose_proxy_logger
from litellm.completion_extras.litellm_responses_transformation.transformation import (
    OpenAiResponsesToChatCompletionStreamIterator,
)
from litellm.exceptions import GuardrailRaisedException
from litellm.llms.base_llm.guardrail_translation.base_translation import BaseTranslation
from litellm.llms.base_llm.guardrail_translation.utils import effective_skip_system_message_for_guardrail
from litellm.llms.openai.chat.guardrail_translation.handler import get_guardrail_input_scope
from litellm.responses.litellm_completion_transformation.transformation import (
    LiteLLMCompletionResponsesConfig,
)
from litellm.types.llms.openai import (
    AllMessageValues,
    ChatCompletionToolCallChunk,
    ChatCompletionToolParam,
    ResponsesAPIStreamEvents,
)
from litellm.types.responses.main import (
    GenericResponseOutputItem,
    OutputFunctionToolCall,
    OutputText,
)
from litellm.types.utils import GenericGuardrailAPIInputs, GuardrailInputSource

if TYPE_CHECKING:
    from litellm.integrations.custom_guardrail import CustomGuardrail
    from litellm.responses.litellm_completion_transformation.transformation import (
        ChatCompletionSession,
    )
    from litellm.types.llms.openai import ResponseInputParam
    from litellm.types.utils import ResponsesAPIResponse

InputTextMapping = tuple[int, Literal["content", "output", "arguments"], int | None]


class OpenAIResponsesHandler(BaseTranslation):
    """
    Handler for processing OpenAI Responses API with guardrails.

    This class provides methods to:
    1. Process input (pre-call hook)
    2. Process output response (post-call hook)

    Methods can be overridden to customize behavior for different message formats.
    """

    def __init__(
        self,
        previous_response_loader: Callable[[str], Awaitable["ChatCompletionSession"]] | None = None,
    ) -> None:
        self._previous_response_loader = previous_response_loader

    def get_structured_messages(self, data: dict) -> list[AllMessageValues] | None:
        """
        Convert Responses API request data to OpenAI-spec structured messages.

        Transforms `input` (string or ResponseInputParam) and optional
        `instructions` into chat completion messages.
        """
        input_data: Final = data.get("input")
        if input_data is None:
            return None
        messages: Final = LiteLLMCompletionResponsesConfig.transform_responses_api_input_to_messages(
            input=input_data,
            responses_api_request=data,
        )
        return cast(list[AllMessageValues], messages) if messages else None

    async def _get_previous_response_messages(
        self,
        data: dict,
        litellm_logging_obj: Any | None,
    ) -> list[AllMessageValues]:
        previous_response_id = data.get("previous_response_id")
        if not isinstance(previous_response_id, str) or not previous_response_id:
            return []

        cached_id = getattr(litellm_logging_obj, "_guardrail_previous_response_id", None)
        cached_messages = getattr(litellm_logging_obj, "_guardrail_previous_response_messages", None)
        if cached_id == previous_response_id and isinstance(cached_messages, list):
            return copy.deepcopy(cached_messages)

        from litellm.responses.litellm_completion_transformation.session_handler import (
            ResponsesSessionHandler,
        )

        loader = (
            self._previous_response_loader
            or ResponsesSessionHandler.get_chat_completion_message_history_for_previous_response_id
        )
        session = await loader(previous_response_id)
        messages = cast(list[AllMessageValues], session.get("messages") or [])
        if litellm_logging_obj is not None:
            setattr(litellm_logging_obj, "_guardrail_previous_response_id", previous_response_id)
            setattr(litellm_logging_obj, "_guardrail_previous_response_messages", copy.deepcopy(messages))
        return messages

    async def _process_previous_response_messages(
        self,
        data: dict,
        guardrail_to_apply: "CustomGuardrail",
        litellm_logging_obj: Any | None,
    ) -> None:
        previous_response_id = data.get("previous_response_id")
        if not isinstance(previous_response_id, str) or not previous_response_id:
            return

        requires_history = bool(getattr(guardrail_to_apply, "requires_guardrailed_previous_response_history", False))
        if not requires_history:
            return

        try:
            messages = await self._get_previous_response_messages(data, litellm_logging_obj)
        except Exception as exc:
            raise GuardrailRaisedException(
                guardrail_name=guardrail_to_apply.guardrail_name,
                message="Unable to inspect previous Responses API history",
            ) from exc
        if not messages:
            raise GuardrailRaisedException(
                guardrail_name=guardrail_to_apply.guardrail_name,
                message="Unable to inspect previous Responses API history",
            )

        from litellm.llms.openai.chat.guardrail_translation.handler import (
            OpenAIChatCompletionsHandler,
        )

        history_data = {
            "messages": copy.deepcopy(messages),
            "model": data.get("model"),
            "metadata": copy.deepcopy(data.get("metadata") or {}),
            "litellm_metadata": copy.deepcopy(data.get("litellm_metadata") or {}),
        }
        processed = await OpenAIChatCompletionsHandler().process_input_messages(
            data=history_data,
            guardrail_to_apply=guardrail_to_apply,
            litellm_logging_obj=litellm_logging_obj,
        )
        if processed.get("messages") != messages:
            guardrail_to_apply.handle_sensitive_data_detection(
                request_data=data,
                detection_info={"source": "previous_response_history"},
            )

    async def process_input_messages(
        self,
        data: dict,
        guardrail_to_apply: "CustomGuardrail",
        litellm_logging_obj: Any | None = None,
    ) -> Any:
        """
        Process input by applying guardrails to text content.

        Handles both string input and list of message objects.
        """
        input_data: Final[str | ResponseInputParam | None] = data.get("input")
        tools_to_check: Final[list[ChatCompletionToolParam]] = []
        await self._process_previous_response_messages(data, guardrail_to_apply, litellm_logging_obj)
        if input_data is None:
            return data

        await self._process_instructions(data, guardrail_to_apply, litellm_logging_obj)

        structured_messages: Final = self.get_structured_messages(data)

        # Handle simple string input
        if isinstance(input_data, str):
            inputs = GenericGuardrailAPIInputs(
                texts=[input_data],
                text_sources=[
                    GuardrailInputSource(
                        type="input",
                        role="user",
                        path="input",
                        scope="current_user_prompt",
                    )
                ],
            )
            original_tools: list[dict[str, Any]] = []

            # Extract and transform tools if present
            if "tools" in data and data["tools"]:
                original_tools = list(data["tools"])
                self._extract_and_transform_tools(data["tools"], tools_to_check)
                if tools_to_check:
                    inputs["tools"] = tools_to_check
            if structured_messages:
                inputs["structured_messages"] = structured_messages
            # Include model information if available
            model = data.get("model")
            if model:
                inputs["model"] = model

            guardrailed_inputs = await guardrail_to_apply.apply_guardrail(
                inputs=inputs,
                request_data=data,
                input_type="request",
                logging_obj=litellm_logging_obj,
            )
            guardrailed_texts = guardrailed_inputs.get("texts", [])
            data["input"] = guardrailed_texts[0] if guardrailed_texts else input_data
            self._apply_guardrailed_tools_to_data(data, original_tools, guardrailed_inputs.get("tools"))
            verbose_proxy_logger.debug("OpenAI Responses API: Processed string input")
            return data

        # Handle list input (ResponseInputParam)
        if not isinstance(input_data, list):
            return data

        texts_to_check: Final[list[str]] = []
        images_to_check: Final[list[str]] = []
        task_mappings: Final[list[InputTextMapping]] = []
        original_tools_list: Final[list[dict[str, Any]]] = list(data.get("tools") or [])

        # Step 1: Extract all text content, images, and tools
        for msg_idx, message in enumerate(input_data):
            self._extract_input_text_and_images(
                message=message,
                msg_idx=msg_idx,
                texts_to_check=texts_to_check,
                images_to_check=images_to_check,
                task_mappings=task_mappings,
            )

        # Extract and transform tools if present
        if "tools" in data and data["tools"]:
            self._extract_and_transform_tools(data["tools"], tools_to_check)

        # Step 2: Apply guardrail to all texts in batch
        if texts_to_check:
            inputs = GenericGuardrailAPIInputs(texts=texts_to_check)
            latest_user_message_index = next(
                (
                    message_index
                    for message_index in range(len(input_data) - 1, -1, -1)
                    if isinstance(input_data[message_index], dict) and input_data[message_index].get("role") == "user"
                ),
                None,
            )
            inputs["text_sources"] = [
                self._input_source(
                    input_data=input_data,
                    mapping=mapping,
                    text=texts_to_check[text_index],
                    latest_user_message_index=latest_user_message_index,
                )
                for text_index, mapping in enumerate(task_mappings)
            ]
            if images_to_check:
                inputs["images"] = images_to_check
            if tools_to_check:
                inputs["tools"] = tools_to_check
            if structured_messages:
                inputs["structured_messages"] = structured_messages
            # Include model information if available
            model = data.get("model")
            if model:
                inputs["model"] = model
            guardrailed_inputs = await guardrail_to_apply.apply_guardrail(
                inputs=inputs,
                request_data=data,
                input_type="request",
                logging_obj=litellm_logging_obj,
            )

            guardrailed_texts = guardrailed_inputs.get("texts", [])
            self._apply_guardrailed_tools_to_data(
                data,
                original_tools_list,
                guardrailed_inputs.get("tools"),
            )

            # Step 3: Map guardrail responses back to original input structure
            await self._apply_guardrail_responses_to_input(
                messages=input_data,
                responses=guardrailed_texts,
                task_mappings=task_mappings,
            )

        verbose_proxy_logger.debug("OpenAI Responses API: Processed input messages: %s", input_data)

        return data

    async def _process_instructions(
        self,
        data: dict,
        guardrail_to_apply: "CustomGuardrail",
        litellm_logging_obj: Any | None,
    ) -> None:
        instructions = data.get("instructions")
        if not isinstance(instructions, str) or effective_skip_system_message_for_guardrail(guardrail_to_apply):
            return
        instruction_inputs = GenericGuardrailAPIInputs(
            texts=[instructions],
            text_sources=[
                GuardrailInputSource(
                    type="instruction",
                    role="developer",
                    path="instructions",
                    scope="system_prompt",
                )
            ],
        )
        guardrailed_instruction = await guardrail_to_apply.apply_guardrail(
            inputs=instruction_inputs,
            request_data=data,
            input_type="request",
            logging_obj=litellm_logging_obj,
        )
        instruction_texts = guardrailed_instruction.get("texts", [])
        if instruction_texts:
            data["instructions"] = instruction_texts[0]

    def _input_source(
        self,
        input_data: list[Any],
        mapping: InputTextMapping,
        text: str,
        latest_user_message_index: int | None,
    ) -> GuardrailInputSource:
        message_index, field, content_index = mapping
        message = input_data[message_index]
        role = str(message.get("role") or "unknown") if isinstance(message, dict) else "unknown"
        item_type = message.get("type") if isinstance(message, dict) else None
        scope = (
            "tool_result"
            if item_type == "function_call_output"
            else get_guardrail_input_scope(
                role=role,
                message_index=message_index,
                content_index=content_index,
                text=text,
                latest_user_message_index=latest_user_message_index,
            )
        )
        path = f"input[{message_index}].{field}"
        if content_index is not None:
            path = f"{path}[{content_index}].text"
        return GuardrailInputSource(
            type=str(item_type or "message"),
            message_index=message_index,
            role=role,
            content_index=content_index,
            path=path,
            scope=scope,
        )

    def extract_request_tool_names(self, data: dict) -> list[str]:
        """Extract tool names from Responses API request (tools[].name for function
        and custom, tools[].server_label for mcp)."""
        names: Final[list[str]] = []
        for tool in data.get("tools") or []:
            if not isinstance(tool, dict):
                continue
            if tool.get("type") in ("function", "custom") and tool.get("name"):
                names.append(str(tool["name"]))
            elif tool.get("type") == "mcp" and tool.get("server_label"):
                names.append(str(tool["server_label"]))
        return names

    def _extract_and_transform_tools(
        self,
        tools: list[dict[str, Any]],
        tools_to_check: list[ChatCompletionToolParam],
    ) -> None:
        """
        Extract and transform tools from Responses API format to Chat Completion format.

        Uses the LiteLLM transformation function to convert Responses API tools
        to Chat Completion tools that can be passed to guardrails.
        """
        if tools is not None and isinstance(tools, list):
            # Transform Responses API tools to Chat Completion tools
            (
                transformed_tools,
                _,
            ) = LiteLLMCompletionResponsesConfig.transform_responses_api_tools_to_chat_completion_tools(tools)
            tools_to_check.extend(cast(list[ChatCompletionToolParam], transformed_tools))

    def _remap_tools_to_responses_api_format(self, guardrailed_tools: list[Any]) -> list[dict[str, Any]]:
        """
        Remap guardrail-returned tools (Chat Completion format) back to
        Responses API request tool format.
        """
        return LiteLLMCompletionResponsesConfig.transform_chat_completion_tool_params_to_responses_api_tools(
            guardrailed_tools
        )

    def _merge_tools_after_guardrail(
        self,
        original_tools: list[dict[str, Any]],
        remapped: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """
        Merge remapped guardrailed tools with original tools that were not sent
        to the guardrail (e.g. web_search, web_search_preview), preserving order.
        Tools a guardrail appended (``remapped`` longer than ``original_tools``)
        have no original slot and are kept so an injected tool is not dropped.
        """
        if not original_tools:
            return remapped
        result: Final[list[dict[str, Any]]] = []
        j = 0
        for tool in original_tools:
            if isinstance(tool, dict) and tool.get("type") in (
                "web_search",
                "web_search_preview",
            ):
                result.append(tool)
            else:
                if j < len(remapped):
                    result.append(remapped[j])
                    j += 1
        # Keep guardrail-appended tools that matched no original slot above.
        result.extend(remapped[j:])
        return result

    def _apply_guardrailed_tools_to_data(
        self,
        data: dict,
        original_tools: list[dict[str, Any]],
        guardrailed_tools: list[Any] | None,
    ) -> None:
        """Remap guardrailed tools to Responses API format and merge with original, then set data['tools']."""
        if guardrailed_tools is not None:
            remapped: Final = self._remap_tools_to_responses_api_format(guardrailed_tools)
            data["tools"] = self._merge_tools_after_guardrail(original_tools, remapped)

    def _extract_input_text_and_images(
        self,
        message: Any,  # Can be Dict[str, Any] or ResponseInputParam
        msg_idx: int,
        texts_to_check: list[str],
        images_to_check: list[str],
        task_mappings: list[InputTextMapping],
    ) -> None:
        """
        Extract text content and images from an input message.

        Override this method to customize text/image extraction logic.
        """
        if not isinstance(message, dict):
            return

        if message.get("type") == "function_call_output":
            self._extract_input_text_field(
                message=message,
                msg_idx=msg_idx,
                field="output",
                texts_to_check=texts_to_check,
                task_mappings=task_mappings,
            )
            return

        if message.get("type") == "function_call":
            arguments = message.get("arguments")
            if isinstance(arguments, str):
                texts_to_check.append(arguments)
                task_mappings.append((msg_idx, "arguments", None))
            return

        content: Final = message.get("content", None)
        if content is None:
            return
        self._extract_input_text_field(
            message=message,
            msg_idx=msg_idx,
            field="content",
            texts_to_check=texts_to_check,
            task_mappings=task_mappings,
            images_to_check=images_to_check,
        )

    def _extract_input_text_field(
        self,
        message: dict[str, Any],
        msg_idx: int,
        field: Literal["content", "output"],
        texts_to_check: list[str],
        task_mappings: list[InputTextMapping],
        images_to_check: list[str] | None = None,
    ) -> None:
        content = message.get(field)
        if isinstance(content, str):
            texts_to_check.append(content)
            task_mappings.append((msg_idx, field, None))

        elif isinstance(content, list):
            for content_idx, content_item in enumerate(content):
                if isinstance(content_item, dict):
                    text_str = content_item.get("text", None)
                    if text_str is not None:
                        texts_to_check.append(text_str)
                        task_mappings.append((msg_idx, field, int(content_idx)))

                    if images_to_check is not None and content_item.get("type") == "image_url":
                        image_url = content_item.get("image_url", {})
                        if isinstance(image_url, dict):
                            url = image_url.get("url")
                            if url:
                                images_to_check.append(url)

    async def _apply_guardrail_responses_to_input(
        self,
        messages: Any,  # Can be List[Dict[str, Any]] or ResponseInputParam
        responses: list[str],
        task_mappings: list[InputTextMapping],
    ) -> None:
        """
        Apply guardrail responses back to input messages.

        Override this method to customize how responses are applied.
        """
        for task_idx, guardrail_response in enumerate(responses):
            mapping = task_mappings[task_idx]
            msg_idx = cast(int, mapping[0])
            field = mapping[1]
            content_idx_optional = cast(int | None, mapping[2])

            content = messages[msg_idx].get(field, None)
            if content is None:
                continue

            if isinstance(content, str) and content_idx_optional is None:
                messages[msg_idx][field] = guardrail_response

            elif isinstance(content, list) and content_idx_optional is not None:
                if isinstance(messages[msg_idx][field][content_idx_optional], dict):
                    messages[msg_idx][field][content_idx_optional]["text"] = guardrail_response

    async def process_output_response(
        self,
        response: "ResponsesAPIResponse",
        guardrail_to_apply: "CustomGuardrail",
        litellm_logging_obj: Any | None = None,
        user_api_key_dict: Any | None = None,
        request_data: dict | None = None,
    ) -> Any:
        """
        Process output response by applying guardrails to text content and tool calls.

        Args:
            response: LiteLLM ResponsesAPIResponse object
            guardrail_to_apply: The guardrail instance to apply
            litellm_logging_obj: Optional logging object
            user_api_key_dict: User API key metadata to pass to guardrails

        Returns:
            Modified response with guardrail applied to content

        Response Format Support:
            - response.output is a list of output items
            - Each output item can be:
              * GenericResponseOutputItem with a content list of OutputText objects
              * ResponseFunctionToolCall with tool call data
            - Each OutputText object has a text field
        """

        texts_to_check: Final[list[str]] = []
        images_to_check: Final[list[str]] = []
        tool_calls_to_check: Final[list[ChatCompletionToolCallChunk]] = []
        task_mappings: Final[list[tuple[int, int]]] = []
        # Track (output_item_index, content_index) for each text

        # Handle both dict and Pydantic object responses
        if isinstance(response, dict):
            response_output = response.get("output", [])
        elif hasattr(response, "output"):
            response_output = response.output or []
        else:
            verbose_proxy_logger.debug("OpenAI Responses API: No output found in response")
            return response

        if not response_output:
            verbose_proxy_logger.debug("OpenAI Responses API: Empty output in response")
            return response

        # Step 1: Extract all text content and tool calls from response output
        for output_idx, output_item in enumerate(response_output):
            self._extract_output_text_and_images(
                output_item=output_item,
                output_idx=output_idx,
                texts_to_check=texts_to_check,
                images_to_check=images_to_check,
                task_mappings=task_mappings,
                tool_calls_to_check=tool_calls_to_check,
            )

        # Step 2: Apply guardrail to all texts in batch
        if texts_to_check or tool_calls_to_check:
            # Use the real request_data if provided (proxy path), otherwise
            # create a standalone dict (SDK / direct-call path).
            if request_data is None:
                request_data = {"response": response}
            else:
                if "response" not in request_data:
                    request_data["response"] = response

            # Add user API key metadata with prefixed keys
            if "litellm_metadata" not in request_data and "metadata" not in request_data:
                user_metadata: Final = self.transform_user_api_key_dict_to_metadata(user_api_key_dict)
                if user_metadata:
                    request_data["litellm_metadata"] = user_metadata

            inputs: Final = GenericGuardrailAPIInputs(texts=texts_to_check)
            inputs["text_sources"] = [
                GuardrailInputSource(
                    type="response",
                    message_index=output_index,
                    content_index=content_index,
                    path=f"output[{output_index}].content[{content_index}].text",
                    scope="other",
                )
                for output_index, content_index in task_mappings
            ]
            if images_to_check:
                inputs["images"] = images_to_check
            if tool_calls_to_check:
                inputs["tool_calls"] = tool_calls_to_check
            # Include model information from the response if available
            response_model = None
            if isinstance(response, dict):
                response_model = response.get("model")
            elif hasattr(response, "model"):
                response_model = getattr(response, "model", None)
            if response_model:
                inputs["model"] = response_model

            guardrailed_inputs: Final = await guardrail_to_apply.apply_guardrail(
                inputs=inputs,
                request_data=request_data,
                input_type="response",
                logging_obj=litellm_logging_obj,
            )

            guardrailed_texts: Final = guardrailed_inputs.get("texts", [])

            # Step 3: Map guardrail responses back to original response structure
            await self._apply_guardrail_responses_to_output(
                response=response,
                responses=guardrailed_texts,
                task_mappings=task_mappings,
            )

        verbose_proxy_logger.debug("OpenAI Responses API: Processed output response: %s", response)

        return response

    async def process_output_streaming_response(
        self,
        responses_so_far: list[Any],
        guardrail_to_apply: "CustomGuardrail",
        litellm_logging_obj: Any | None = None,
        user_api_key_dict: Any | None = None,
        request_data: dict | None = None,
    ) -> list[Any]:
        """
        Process output streaming response by applying guardrails to text content.

        Mirrors the Chat Completions handler pattern: extract text from the final
        chunk, apply the guardrail, then write the result back in-place so the
        caller sees the modified content (e.g. PII tokens replaced).

        For ``response.completed`` events (the normal end-of-stream signal) we
        use the same per-item extraction + task-mapping approach as
        ``process_output_response`` so that unmasking / blocking works correctly
        for every output item.
        """
        if not responses_so_far:
            return responses_so_far

        final_chunk: Final = responses_so_far[-1]
        # Accept both plain dicts and Pydantic models (BaseLiteLLMOpenAIResponseObject
        # exposes a .get() shim, so all the .get() calls below work for both).
        if not (isinstance(final_chunk, dict) or hasattr(final_chunk, "get")):
            return responses_so_far

        # ------------------------------------------------------------------ #
        # Case 1: response.completed — full response is available in the      #
        # final chunk; iterate output items, apply guardrail, write back.     #
        # ------------------------------------------------------------------ #
        if final_chunk.get("type") == "response.completed":
            response_obj: Final = final_chunk.get("response") or {}
            if not hasattr(response_obj, "get"):
                return responses_so_far
            outputs: Final[list[Any]] = response_obj.get("output") or []

            texts_to_check: Final[list[str]] = []
            tool_calls_to_check: Final[list[ChatCompletionToolCallChunk]] = []
            task_mappings: Final[list[tuple[int, int]]] = []

            for output_idx, output_item in enumerate(outputs):
                self._extract_output_text_and_images(
                    output_item=output_item,
                    output_idx=output_idx,
                    texts_to_check=texts_to_check,
                    images_to_check=[],
                    task_mappings=task_mappings,
                    tool_calls_to_check=tool_calls_to_check,
                )

            if texts_to_check or tool_calls_to_check:
                if request_data is None:
                    request_data = {}
                if "response" not in request_data:
                    request_data["response"] = response_obj
                if "litellm_metadata" not in request_data and "metadata" not in request_data:
                    user_metadata: Final = self.transform_user_api_key_dict_to_metadata(user_api_key_dict)
                    if user_metadata:
                        request_data["litellm_metadata"] = user_metadata

                inputs = GenericGuardrailAPIInputs(texts=texts_to_check)
                if tool_calls_to_check:
                    inputs["tool_calls"] = cast(list[ChatCompletionToolCallChunk], tool_calls_to_check)
                response_model = response_obj.get("model")
                if response_model:
                    inputs["model"] = response_model

                guardrailed_inputs: Final = await guardrail_to_apply.apply_guardrail(
                    inputs=inputs,
                    request_data=request_data,
                    input_type="response",
                    logging_obj=litellm_logging_obj,
                )

                guardrailed_texts: Final = guardrailed_inputs.get("texts", [])

                # Write guardrailed texts back into the output items in-place.
                # final_chunk is a reference into responses_so_far so this
                # mutates the list that the caller holds.
                await self._apply_guardrail_responses_to_output(
                    response=response_obj,
                    responses=guardrailed_texts,
                    task_mappings=task_mappings,
                )

            return responses_so_far

        # ------------------------------------------------------------------ #
        # Case 2: response.output_item.done — extract tool calls only.        #
        # ------------------------------------------------------------------ #
        if final_chunk.get("type") == "response.output_item.done":
            model_response_stream: Final = (
                OpenAiResponsesToChatCompletionStreamIterator.translate_responses_chunk_to_openai_stream(final_chunk)
            )
            tool_calls: Final = model_response_stream.choices[0].delta.tool_calls
            if tool_calls:
                inputs = GenericGuardrailAPIInputs()
                inputs["tool_calls"] = cast(list[ChatCompletionToolCallChunk], tool_calls)
                if hasattr(model_response_stream, "model") and model_response_stream.model:
                    inputs["model"] = model_response_stream.model
                await guardrail_to_apply.apply_guardrail(
                    inputs=inputs,
                    request_data=request_data if request_data is not None else {},
                    input_type="response",
                    logging_obj=litellm_logging_obj,
                )
            return responses_so_far

        # ------------------------------------------------------------------ #
        # Fallback: apply guardrail to the accumulated text string.           #
        # No structured write-back is possible here; guardrails that only     #
        # need to block/flag (not rewrite) still work correctly.             #
        # ------------------------------------------------------------------ #
        string_so_far: Final = self.get_streaming_string_so_far(responses_so_far)
        if string_so_far:
            fallback_inputs: Final = GenericGuardrailAPIInputs(texts=[string_so_far])
            response_model = (
                final_chunk.get("response", {}).get("model") if isinstance(final_chunk.get("response"), dict) else None
            )
            if response_model:
                fallback_inputs["model"] = response_model
            await guardrail_to_apply.apply_guardrail(
                inputs=fallback_inputs,
                request_data=request_data if request_data is not None else {},
                input_type="response",
                logging_obj=litellm_logging_obj,
            )
        return responses_so_far

    def _check_streaming_has_ended(self, responses_so_far: list[Any]) -> bool:
        """
        Check if the streaming has ended.
        """
        if not responses_so_far:
            return False
        terminal_types: Final = {
            ResponsesAPIStreamEvents.RESPONSE_COMPLETED.value,
            ResponsesAPIStreamEvents.RESPONSE_FAILED.value,
            ResponsesAPIStreamEvents.RESPONSE_INCOMPLETE.value,
        }
        return responses_so_far[-1].get("type") in terminal_types

    def get_streaming_string_so_far(self, responses_so_far: list[Any]) -> str:
        """
        Get the string so far from the responses so far.
        """
        return "".join([response.get("text", "") for response in responses_so_far])

    def _has_text_content(self, response: "ResponsesAPIResponse") -> bool:
        """
        Check if response has any text content to process.

        Override this method to customize text content detection.
        """
        if not hasattr(response, "output") or response.output is None:
            return False

        for output_item in response.output:
            if isinstance(output_item, BaseModel):
                try:
                    generic_response_output_item = GenericResponseOutputItem.model_validate(output_item.model_dump())
                    if generic_response_output_item.content:
                        output_item = generic_response_output_item
                except Exception:
                    continue
            if isinstance(output_item, (GenericResponseOutputItem, dict)):
                content = (
                    output_item.content
                    if isinstance(output_item, GenericResponseOutputItem)
                    else output_item.get("content", [])
                )
                if content:
                    for content_item in content:
                        # Check if it's an OutputText with text
                        if isinstance(content_item, OutputText):
                            if content_item.text:
                                return True
                        elif isinstance(content_item, dict):
                            if content_item.get("text"):
                                return True
        return False

    def _extract_output_text_and_images(
        self,
        output_item: Any,
        output_idx: int,
        texts_to_check: list[str],
        images_to_check: list[str],
        task_mappings: list[tuple[int, int]],
        tool_calls_to_check: list[ChatCompletionToolCallChunk] | None = None,
    ) -> None:
        """
        Extract text content, images, and tool calls from a response output item.

        Override this method to customize text/image/tool extraction logic.
        """

        # Check if this is a tool call (OutputFunctionToolCall)
        if isinstance(output_item, OutputFunctionToolCall) or (
            isinstance(output_item, BaseModel)
            and hasattr(output_item, "type")
            and getattr(output_item, "type") == "function_call"
        ):
            if tool_calls_to_check is not None:
                tool_call_dict = (
                    LiteLLMCompletionResponsesConfig.convert_response_function_tool_call_to_chat_completion_tool_call(
                        tool_call_item=output_item,
                        index=output_idx,
                    )
                )
                tool_calls_to_check.append(cast(ChatCompletionToolCallChunk, tool_call_dict))
            return
        elif isinstance(output_item, dict) and output_item.get("type") == "function_call":
            # Handle dict representation of tool call
            if tool_calls_to_check is not None:
                # Convert dict to ResponseFunctionToolCall for processing
                try:
                    tool_call_obj: Final = ResponseFunctionToolCall(**output_item)
                    tool_call_dict = LiteLLMCompletionResponsesConfig.convert_response_function_tool_call_to_chat_completion_tool_call(
                        tool_call_item=tool_call_obj,
                        index=output_idx,
                    )
                    tool_calls_to_check.append(cast(ChatCompletionToolCallChunk, tool_call_dict))
                except Exception:
                    pass
            return

        # Handle both GenericResponseOutputItem and dict
        content: list[OutputText] | list[dict] | None = None
        if isinstance(output_item, BaseModel):
            try:
                output_item_dump: Final = output_item.model_dump()
                generic_response_output_item: Final = GenericResponseOutputItem.model_validate(output_item_dump)
                if generic_response_output_item.content:
                    content = generic_response_output_item.content
            except Exception:
                # Try to extract content directly from output_item if validation fails
                if hasattr(output_item, "content") and output_item.content:
                    content = output_item.content
                else:
                    return
        elif isinstance(output_item, dict):
            content = output_item.get("content", [])
        else:
            return

        if not content:
            return

        verbose_proxy_logger.debug("OpenAI Responses API: Processing output item: %s", output_item)

        # Iterate through content items (list of OutputText objects)
        for content_idx, content_item in enumerate(content):
            # Handle both OutputText objects and dicts
            if isinstance(content_item, OutputText):
                text_content = content_item.text
            elif isinstance(content_item, dict):
                text_content = content_item.get("text")
            else:
                continue

            if text_content:
                texts_to_check.append(text_content)
                task_mappings.append((output_idx, int(content_idx)))

    async def _apply_guardrail_responses_to_output(
        self,
        response: "ResponsesAPIResponse | dict[Any, Any]",
        responses: list[str],
        task_mappings: list[tuple[int, int]],
    ) -> None:
        """
        Apply guardrail responses back to output response.

        Override this method to customize how responses are applied.
        """
        # Handle both dict and Pydantic object responses
        if isinstance(response, dict):
            response_output = response.get("output", [])
        elif hasattr(response, "output"):
            response_output = response.output or []
        else:
            return

        for task_idx, guardrail_response in enumerate(responses):
            mapping = task_mappings[task_idx]
            output_idx = cast(int, mapping[0])
            content_idx = cast(int, mapping[1])

            if output_idx >= len(response_output):
                continue

            output_item = response_output[output_idx]

            # Handle both GenericResponseOutputItem, BaseModel, and dict
            if isinstance(output_item, GenericResponseOutputItem):
                if output_item.content and content_idx < len(output_item.content):
                    content_item = output_item.content[content_idx]
                    if isinstance(content_item, OutputText):
                        content_item.text = guardrail_response
                    elif isinstance(content_item, dict):
                        content_item["text"] = guardrail_response
            elif isinstance(output_item, BaseModel):
                # Handle other Pydantic models by converting to GenericResponseOutputItem
                try:
                    generic_item = GenericResponseOutputItem.model_validate(output_item.model_dump())
                    if generic_item.content and content_idx < len(generic_item.content):
                        content_item = generic_item.content[content_idx]
                        if isinstance(content_item, OutputText):
                            content_item.text = guardrail_response
                            # Update the original response output
                            if hasattr(output_item, "content") and output_item.content:
                                original_content = output_item.content[content_idx]
                                if hasattr(original_content, "text"):
                                    original_content.text = guardrail_response
                except Exception:
                    pass
            elif isinstance(output_item, dict):
                content = output_item.get("content", [])
                if content and content_idx < len(content):
                    if isinstance(content[content_idx], dict):
                        content[content_idx]["text"] = guardrail_response
                    elif hasattr(content[content_idx], "text"):
                        content[content_idx].text = guardrail_response
