/**
 * Type definitions for pretty messages view
 */

export interface ParsedMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

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
