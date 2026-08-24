/**
 * Utility functions for parsing and formatting messages for pretty view
 */

import {
  MessageRole,
  ParsedMessage,
  ParsedMessages,
  RequestPayload,
  ResponsePayload,
  RoleStyle,
  ToolCall,
} from "./prettyMessagesTypes";
import { parseResponsesPretty } from "./responsesPrettyUtils";

/**
 * Role color styles for message cards - minimal, professional design
 * Color only used for labels and left border accent
 */
export const ROLE_STYLES: Record<string, RoleStyle> = {
  system: {
    background: "transparent",
    borderColor: "#8c8c8c",
    label: "SYSTEM",
    labelColor: "#8c8c8c",
  },
  user: {
    background: "transparent",
    borderColor: "#1677ff",
    label: "USER",
    labelColor: "#1677ff",
  },
  assistant: {
    background: "transparent",
    borderColor: "#52c41a",
    label: "ASSISTANT",
    labelColor: "#52c41a",
  },
  tool: {
    background: "transparent",
    borderColor: "#fa8c16",
    label: "TOOL RESULT",
    labelColor: "#fa8c16",
  },
};

type UnknownRecord = Record<string, unknown>;
type ResponsesToolCallRecord = UnknownRecord & { type: "function_call" | "custom_tool_call" };

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

const ROLES: readonly MessageRole[] = ["system", "user", "assistant", "tool"];

const toRole = (value: unknown, fallback: MessageRole): MessageRole => {
  if (value === "developer") return "system";
  if (value === "function") return "tool";
  return ROLES.includes(value as MessageRole) ? (value as MessageRole) : fallback;
};

const classifyRequest = (request: unknown): RequestPayload => {
  if (Array.isArray(request)) return { kind: "chat", messages: request };
  if (!isRecord(request)) return { kind: "unknown" };
  if (Array.isArray(request.messages)) return { kind: "chat", messages: request.messages };
  const { input } = request;
  if (typeof input === "string" || Array.isArray(input)) {
    return { kind: "responses", instructions: asString(request.instructions), input };
  }
  return { kind: "unknown" };
};

const classifyResponse = (response: unknown): ResponsePayload => {
  if (!isRecord(response)) return { kind: "unknown" };
  if (Array.isArray(response.choices)) return { kind: "chat", choices: response.choices };
  if (Array.isArray(response.output)) return { kind: "responses", output: response.output };
  return { kind: "unknown" };
};

const isResponsesToolCallRecord = (item: unknown): item is ResponsesToolCallRecord =>
  isRecord(item) && (item.type === "function_call" || item.type === "custom_tool_call");

/**
 * Parse request messages and response message from log data
 */
export const parseMessages = (request: unknown, response: unknown): ParsedMessages => {
  const responsePayload = classifyResponse(response);
  const responseMessage = parseResponseMessage(responsePayload);
  const responsesPretty = parseResponsesPretty(response);
  const chatItems = responseMessage
    ? [
        { kind: "message" as const, content: responseMessage.content },
        ...(responseMessage.toolCalls ?? []).map((tool) => ({
          kind: "tool_call" as const,
          toolType: "function" as const,
          tool,
        })),
      ]
    : [];

  return {
    requestMessages: parseRequestMessages(classifyRequest(request)),
    responseMessage,
    responseItems: responsesPretty?.responseItems ?? chatItems,
    responseState: responsesPretty?.responseState ?? null,
  };
};

const parseRequestMessages = (payload: RequestPayload): ParsedMessage[] => {
  switch (payload.kind) {
    case "chat":
      return payload.messages.map(parseChatMessage);
    case "responses": {
      const instructions: ParsedMessage[] = payload.instructions
        ? [{ role: "system", content: payload.instructions }]
        : [];
      const input: ParsedMessage[] =
        typeof payload.input === "string"
          ? [{ role: "user", content: payload.input }]
          : payload.input.flatMap(parseResponsesInputItem);
      return [...instructions, ...input];
    }
    case "unknown":
      return [];
  }
};

const parseResponseMessage = (payload: ResponsePayload): ParsedMessage | null => {
  switch (payload.kind) {
    case "chat": {
      const choice = payload.choices[0];
      const message = isRecord(choice) ? choice.message : undefined;
      if (!isRecord(message)) return null;
      return {
        role: toRole(message.role, "assistant"),
        content: parseMessageContent(message.content),
        toolCalls: parseChatToolCalls(message.tool_calls),
      };
    }
    case "responses": {
      const content = payload.output
        .filter((item): item is UnknownRecord => isRecord(item) && item.type === "message")
        .map((item) => parseMessageContent(item.content))
        .filter((text) => text.length > 0)
        .join("\n");
      const toolCalls = payload.output.filter(isResponsesToolCallRecord).map(parseResponsesToolCall);
      if (content.length === 0 && toolCalls.length === 0) return null;
      return { role: "assistant", content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
    }
    case "unknown":
      return null;
  }
};

const parseChatMessage = (message: unknown): ParsedMessage => {
  if (!isRecord(message)) return { role: "user", content: parseMessageContent(message) };
  return {
    role: toRole(message.role, "user"),
    content: parseMessageContent(message.content),
    toolCalls: parseChatToolCalls(message.tool_calls),
    toolCallId: typeof message.tool_call_id === "string" ? message.tool_call_id : undefined,
  };
};

const parseResponsesInputItem = (item: unknown): ParsedMessage[] => {
  if (typeof item === "string") return [{ role: "user", content: item }];
  if (!isRecord(item)) return [];
  if (item.type === "function_call" || item.type === "custom_tool_call") {
    return [{ role: "assistant", content: "", toolCalls: [parseResponsesToolCall(item)] }];
  }
  if (item.type === "function_call_output" || item.type === "custom_tool_call_output") {
    return [
      {
        role: "tool",
        content: parseMessageContent(item.output ?? item.content),
        toolCallId: asString(item.call_id) || asString(item.id),
      },
    ];
  }
  if (item.type === "reasoning") return [];
  if (item.type === "input_text") {
    return [{ role: "user", content: asString(item.text) }];
  }
  if ("role" in item || "content" in item) {
    return [{ role: toRole(item.role, "user"), content: parseMessageContent(item.content) }];
  }
  return [];
};

const parseResponsesToolCall = (item: UnknownRecord): ToolCall => ({
  id: asString(item.call_id) || asString(item.id),
  name:
    item.type === "custom_tool_call" ? "custom_tool" : asString(item.name) || asString(item.function_name) || "unknown",
  arguments:
    item.type === "custom_tool_call"
      ? { input: item.input ?? item.arguments ?? "" }
      : parseToolArguments(item.arguments),
});

/**
 * Parse message content - handle strings and content arrays (for vision, etc.)
 */
const parseMessageContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  if (Array.isArray(content)) return content.map(parseContentPart).join("\n");
  return JSON.stringify(content);
};

const parseContentPart = (part: unknown): string => {
  if (typeof part === "string") return part;
  if (!isRecord(part)) return JSON.stringify(part);
  switch (part.type) {
    case "text":
    case "input_text":
    case "output_text":
      return asString(part.text);
    case "refusal":
      return asString(part.refusal);
    case "reasoning_text":
      return "";
    case "image_url":
    case "input_image":
      return "[Image]";
    case "input_file":
      return "[File]";
    case "input_audio":
      return "[Audio]";
    default:
      return JSON.stringify(part);
  }
};

/**
 * Parse tool calls from response message
 */
const parseChatToolCalls = (toolCalls: unknown): ToolCall[] | undefined => {
  if (!Array.isArray(toolCalls)) return undefined;
  return toolCalls.map((toolCall) => {
    const call = isRecord(toolCall) ? toolCall : {};
    const fn = isRecord(call.function) ? call.function : {};
    return {
      id: asString(call.id),
      name: asString(fn.name) || "unknown",
      arguments: parseToolArguments(fn.arguments),
    };
  });
};

/**
 * Parse tool arguments - handle both string and object formats
 */
const parseToolArguments = (args: unknown): Record<string, unknown> => {
  if (!args) return {};
  if (typeof args === "string") {
    try {
      const parsed: unknown = JSON.parse(args);
      return isRecord(parsed) ? parsed : { raw: args };
    } catch {
      return { raw: args };
    }
  }
  return isRecord(args) ? args : {};
};
