/**
 * Type definitions for pretty messages view
 */

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ParsedMessage {
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export type RequestPayload =
  | { kind: "chat"; messages: readonly unknown[] }
  | { kind: "responses"; instructions: string; input: string | readonly unknown[] }
  | { kind: "unknown" };

export type ResponsePayload =
  | { kind: "chat"; choices: readonly unknown[] }
  | { kind: "responses"; output: readonly unknown[] }
  | { kind: "unknown" };

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ParsedMessages {
  requestMessages: ParsedMessage[];
  responseMessage: ParsedMessage | null;
  responseItems: ParsedResponseItem[];
  responseState: ParsedResponseState | null;
}

export type ParsedResponseItem =
  | { kind: "message"; content: string }
  | { kind: "reasoning"; content: string; summary: string }
  | { kind: "tool_call"; tool: ToolCall; toolType: "function" | "custom" }
  | { kind: "tool_output"; callId: string; content: string }
  | { kind: "unknown"; itemType: string; content: string };

export interface ParsedResponseState {
  status?: string;
  error?: string;
  incompleteReason?: string;
}

export interface RoleStyle {
  background: string;
  borderColor: string;
  label: string;
  labelColor: string;
}
