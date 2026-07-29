/**
 * Utility functions for parsing and formatting messages for pretty view
 */

import { ParsedMessage, ParsedMessages, RoleStyle } from "./prettyMessagesTypes";
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

/**
 * Parse request messages and response message from log data
 */
export const parseMessages = (request: any, response: any): ParsedMessages => {
  // Parse request messages. `request` is either the raw request body
  // ({ messages: [...] }) or, when prompts come from cold storage, the bare
  // messages array itself.
  const requestMessages: ParsedMessage[] = [];

  const requestMessageList = getRequestMessageList(request);

  requestMessageList.forEach((item) => {
    const message = parseRequestMessage(item);
    if (message) requestMessages.push(message);
  });

  // Parse response message
  let responseMessage: ParsedMessage | null = null;
  const responseMsg = response?.choices?.[0]?.message;

  if (responseMsg) {
    responseMessage = {
      role: responseMsg.role || "assistant",
      content: responseMsg.content || "",
      toolCalls: parseToolCalls(responseMsg.tool_calls),
    };
  }

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
    requestMessages,
    responseMessage,
    responseItems: responsesPretty?.responseItems ?? chatItems,
    responseState: responsesPretty?.responseState ?? null,
  };
};

const parseRequestMessage = (value: unknown): ParsedMessage | null => {
  if (typeof value === "string") return { role: "user", content: value };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const item = value as Record<string, unknown>;
  const itemType = typeof item.type === "string" ? item.type : "";
  const role =
    item.role === "system" || item.role === "user" || item.role === "assistant" || item.role === "tool"
      ? item.role
      : "user";
  let callId = "";
  if (typeof item.call_id === "string") {
    callId = item.call_id;
  } else if (typeof item.id === "string") {
    callId = item.id;
  }

  if (itemType === "function_call" || itemType === "custom_tool_call") {
    let name = "unknown";
    if (typeof item.name === "string") {
      name = item.name;
    } else if (itemType === "custom_tool_call") {
      name = "custom_tool";
    }
    const args =
      itemType === "custom_tool_call"
        ? { input: item.input ?? item.arguments ?? "" }
        : parseToolArguments(item.arguments);
    return {
      role: "assistant",
      content: "",
      toolCalls: [{ id: callId, name, arguments: args }],
    };
  }

  if (itemType === "function_call_output" || itemType === "custom_tool_call_output") {
    return {
      role: "tool",
      content: parseMessageContent(item.output ?? item.content),
      toolCallId: callId,
    };
  }

  return {
    role,
    content: parseMessageContent(item.content),
    toolCallId: typeof item.tool_call_id === "string" ? item.tool_call_id : undefined,
  };
};

const getRequestMessageList = (request: unknown): unknown[] => {
  if (Array.isArray(request)) return request;
  if (typeof request !== "object" || request === null) return [];
  const requestObject = request as Record<string, unknown>;
  if (Array.isArray(requestObject.messages)) return requestObject.messages;
  if (Array.isArray(requestObject.input)) {
    const input = requestObject.input;
    return input.every(isResponsesContentBlock) ? [{ role: "user", content: input }] : input;
  }
  if (typeof requestObject.input === "string") return [{ role: "user", content: requestObject.input }];
  return [];
};

const isResponsesContentBlock = (item: unknown): boolean => {
  if (typeof item !== "object" || item === null) return false;
  const itemType = (item as Record<string, unknown>).type;
  switch (itemType) {
    case "text":
    case "input_text":
    case "input_image":
    case "input_file":
      return true;
    default:
      return false;
  }
};

const isDisplayTextBlockType = (itemType: unknown): boolean => {
  switch (itemType) {
    case "text":
    case "input_text":
    case "output_text":
      return true;
    default:
      return false;
  }
};

/**
 * Parse message content - handle strings and content arrays (for vision, etc.)
 */
const parseMessageContent = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    // Handle content arrays (vision API format)
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item !== "object" || item === null) return "";
        const contentItem = item as Record<string, unknown>;
        if (isDisplayTextBlockType(contentItem.type) && typeof contentItem.text === "string") {
          return contentItem.text;
        }
        if (contentItem.type === "reasoning_text") return "";
        if (contentItem.type === "image_url") return "[Image]";
        return JSON.stringify(contentItem);
      })
      .filter(Boolean)
      .join("\n");
  }

  // Fallback to JSON string for complex content
  return content === undefined || content === null ? "" : JSON.stringify(content) ?? String(content);
};

/**
 * Parse tool calls from response message
 */
const parseToolCalls = (
  toolCalls: any[],
):
  | Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }>
  | undefined => {
  if (!toolCalls || !Array.isArray(toolCalls)) return undefined;

  return toolCalls.map((tc) => ({
    id: tc.id || "",
    name: tc.function?.name || "unknown",
    arguments: parseToolArguments(tc.function?.arguments),
  }));
};

/**
 * Parse tool arguments - handle both string and object formats
 */
const parseToolArguments = (args: unknown): Record<string, unknown> => {
  if (!args) return {};

  if (typeof args === "string") {
    try {
      return JSON.parse(args);
    } catch {
      return { raw: args };
    }
  }

  return typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
};
