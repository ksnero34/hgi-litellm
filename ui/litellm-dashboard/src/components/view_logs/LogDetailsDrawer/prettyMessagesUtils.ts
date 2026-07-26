/**
 * Utility functions for parsing and formatting messages for pretty view
 */

import { ParsedMessage, ParsedMessages, RoleStyle } from "./prettyMessagesTypes";

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

  requestMessageList.forEach((msg: any) => {
    requestMessages.push({
      role: msg.role || "user",
      content: parseMessageContent(msg.content),
      toolCallId: msg.tool_call_id,
    });
  });

  // Parse response message
  let responseMessage: ParsedMessage | null = null;
  const responseMsg = response?.choices?.[0]?.message;

  const responseOutputMessages = Array.isArray(response?.output)
    ? response.output.filter((item: any) => item?.type === "message")
    : [];
  const responseOutputContent = responseOutputMessages.map((item: any) => parseMessageContent(item.content)).join("\n");

  if (responseMsg) {
    responseMessage = {
      role: responseMsg.role || "assistant",
      content: responseMsg.content || "",
      toolCalls: parseToolCalls(responseMsg.tool_calls),
    };
  } else if (responseOutputContent) {
    responseMessage = {
      role: responseOutputMessages[0]?.role || "assistant",
      content: responseOutputContent,
    };
  }

  return { requestMessages, responseMessage };
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
const parseMessageContent = (content: any): string => {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    // Handle content arrays (vision API format)
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (isDisplayTextBlockType(item.type) && typeof item.text === "string") return item.text;
        if (item.type === "reasoning_text") return "";
        if (item.type === "image_url") return "[Image]";
        return JSON.stringify(item);
      })
      .filter(Boolean)
      .join("\n");
  }

  // Fallback to JSON string for complex content
  return JSON.stringify(content);
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
      arguments: Record<string, any>;
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
const parseToolArguments = (args: any): Record<string, any> => {
  if (!args) return {};

  if (typeof args === "string") {
    try {
      return JSON.parse(args);
    } catch {
      return { raw: args };
    }
  }

  return args;
};
