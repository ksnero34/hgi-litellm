import { ParsedResponseItem, ParsedResponseState, ToolCall } from "./prettyMessagesTypes";

type JsonObject = Record<string, unknown>;

export interface ResponsesPrettyResult {
  responseItems: ParsedResponseItem[];
  responseState: ParsedResponseState | null;
}

export const parseResponsesPretty = (response: unknown): ResponsesPrettyResult | null => {
  if (Array.isArray(response)) return parseSseEvents(response);
  const responseObject = asObject(response);
  if (!isResponsesObject(responseObject)) return null;
  return parseResponseObject(responseObject);
};

const parseResponseObject = (response: JsonObject): ResponsesPrettyResult => {
  const output = Array.isArray(response.output) ? response.output : [];
  const responseItems = output.flatMap(parseOutputItem);
  const rootOutputText = asString(response.output_text);
  const hasMessageText = responseItems.some((item) => item.kind === "message" && item.content.length > 0);
  const itemsWithFallback =
    !hasMessageText && rootOutputText
      ? [...responseItems, { kind: "message" as const, content: rootOutputText }]
      : responseItems;

  if (itemsWithFallback.length > 0) {
    return { responseItems: itemsWithFallback, responseState: parseResponseState(response) };
  }

  const fallback = safeStringify(response);
  const responseState = parseResponseState(response);
  if (Array.isArray(response.output)) {
    return { responseItems: [], responseState };
  }
  return {
    responseItems: responseState
      ? []
      : [{ kind: "unknown", itemType: asString(response.object) || "response", content: fallback }],
    responseState,
  };
};

const parseOutputItem = (value: unknown): ParsedResponseItem[] => {
  const item = asObject(value);
  if (!item) return [{ kind: "unknown", itemType: "unknown", content: safeStringify(value) }];

  switch (item.type) {
    case "message":
      return parseMessageItem(item);
    case "reasoning":
      return [
        {
          kind: "reasoning",
          content: extractText(item.content, new Set(["reasoning_text", "text"])),
          summary: extractText(item.summary, new Set(["summary_text", "reasoning_summary_text", "text"])),
        },
      ];
    case "function_call":
      return [{ kind: "tool_call", toolType: "function", tool: parseFunctionCall(item) }];
    case "custom_tool_call":
      return [{ kind: "tool_call", toolType: "custom", tool: parseCustomToolCall(item) }];
    case "function_call_output":
    case "custom_tool_call_output":
      return [
        {
          kind: "tool_output",
          callId: asString(item.call_id ?? item.id),
          content: toDisplayText(item.output ?? item.content),
        },
      ];
    default:
      return [
        {
          kind: "unknown",
          itemType: asString(item.type) || "unknown",
          content: safeStringify(item),
        },
      ];
  }
};

const parseMessageItem = (item: JsonObject): ParsedResponseItem[] => {
  const content = Array.isArray(item.content) ? item.content : [item.content];
  const messageText = extractText(content, new Set(["output_text", "text", "refusal"]));
  const reasoningText = extractText(content, new Set(["reasoning_text"]));
  const knownTypes = new Set(["output_text", "text", "refusal", "reasoning_text"]);
  const unknownBlocks = content.flatMap((block) => {
    const blockObject = asObject(block);
    if (!blockObject || knownTypes.has(asString(blockObject.type))) return [];
    return [
      { kind: "unknown" as const, itemType: asString(blockObject.type) || "content", content: safeStringify(block) },
    ];
  });
  return [
    ...(reasoningText ? [{ kind: "reasoning" as const, content: reasoningText, summary: "" }] : []),
    ...(messageText ? [{ kind: "message" as const, content: messageText }] : []),
    ...unknownBlocks,
  ];
};

const parseFunctionCall = (item: JsonObject): ToolCall => ({
  id: asString(item.call_id ?? item.id),
  name: asString(item.name) || "unknown",
  arguments: parseArguments(item.arguments),
});

const parseCustomToolCall = (item: JsonObject): ToolCall => ({
  id: asString(item.call_id ?? item.id),
  name: asString(item.name) || "custom_tool",
  arguments: { input: item.input ?? item.arguments ?? "" },
});

const parseArguments = (value: unknown): Record<string, unknown> => {
  if (isObject(value)) return value;
  if (typeof value !== "string") return value === undefined || value === null ? {} : { value };
  try {
    const parsed: unknown = JSON.parse(value);
    return isObject(parsed) ? parsed : { value: parsed };
  } catch {
    return { raw: value };
  }
};

const parseResponseState = (response: JsonObject): ParsedResponseState | null => {
  const status = asString(response.status);
  const errorObject = asObject(response.error);
  const incompleteObject = asObject(response.incomplete_details);
  const error = errorObject ? asString(errorObject.message) || safeStringify(errorObject) : "";
  const incompleteReason = incompleteObject ? asString(incompleteObject.reason) || safeStringify(incompleteObject) : "";
  if (!status && !error && !incompleteReason) return null;
  return {
    status: status || undefined,
    error: error || undefined,
    incompleteReason: incompleteReason || undefined,
  };
};

const parseSseEvents = (values: unknown[]): ResponsesPrettyResult | null => {
  const events = values.map(unwrapEvent).filter((event): event is JsonObject => event !== null);
  if (!events.some((event) => asString(event.type).startsWith("response.") || event.type === "error")) return null;

  const terminalResponse = [...events].reverse().find((event) => {
    const eventType = asString(event.type);
    return terminalEventTypes.has(eventType) && isObject(event.response);
  });
  if (terminalResponse && isObject(terminalResponse.response)) return parseResponseObject(terminalResponse.response);

  const outputText =
    collectDeltas(events, "response.output_text.delta") ||
    collectEventField(events, "response.output_text.done", "text");
  const reasoningText =
    collectDeltas(events, "response.reasoning_text.delta") ||
    collectEventField(events, "response.reasoning_text.done", "text");
  const reasoningSummary =
    collectDeltas(events, "response.reasoning_summary_text.delta") ||
    collectEventField(events, "response.reasoning_summary_text.done", "text");
  const doneItems = collectOutputItems(events, "response.output_item.done");
  const addedItems = collectOutputItems(events, "response.output_item.added");
  const streamItems = (doneItems.length > 0 ? doneItems : addedItems).flatMap(parseOutputItem);
  const functionArguments = collectDeltas(events, "response.function_call_arguments.delta");
  const customInput = collectDeltas(events, "response.custom_tool_call_input.delta");
  if (streamItems.length === 1 && streamItems[0].kind === "tool_call") {
    streamItems[0].tool.arguments =
      streamItems[0].toolType === "custom"
        ? { input: customInput }
        : parseArguments(functionArguments || streamItems[0].tool.arguments);
  }
  const responseItems: ParsedResponseItem[] = [
    ...(reasoningText || reasoningSummary
      ? [{ kind: "reasoning" as const, content: reasoningText, summary: reasoningSummary }]
      : []),
    ...streamItems,
    ...(outputText ? [{ kind: "message" as const, content: outputText }] : []),
  ];
  const terminalEvent = [...events]
    .reverse()
    .find((event) => terminalEventTypes.has(asString(event.type)) || event.type === "error");
  const terminalType = asString(terminalEvent?.type);
  const state = terminalEvent
    ? parseResponseState({
        status: terminalType.startsWith("response.") ? terminalType.slice("response.".length) : "failed",
        error: terminalEvent.error,
        incomplete_details: terminalEvent.incomplete_details,
      })
    : null;
  if (responseItems.length > 0 || state) return { responseItems, responseState: state };
  return { responseItems: [{ kind: "unknown", itemType: "sse", content: safeStringify(values) }], responseState: null };
};

const unwrapEvent = (value: unknown): JsonObject | null => {
  const event = asObject(value);
  if (!event) return null;
  if (isObject(event.data)) return event.data;
  if (typeof event.data === "string") {
    try {
      const parsed: unknown = JSON.parse(event.data);
      if (isObject(parsed)) return parsed;
    } catch {
      return event;
    }
  }
  return event;
};

const collectDeltas = (events: JsonObject[], eventType: string): string =>
  events
    .filter((event) => event.type === eventType)
    .map((event) => asString(event.delta))
    .join("");

const extractText = (value: unknown, acceptedTypes: ReadonlySet<string>): string => {
  let parts: unknown[] = [];
  if (Array.isArray(value)) {
    parts = value;
  } else if (value !== undefined && value !== null) {
    parts = [value];
  }
  return parts
    .map((part) => {
      if (typeof part === "string") return part;
      const partObject = asObject(part);
      if (!partObject || !acceptedTypes.has(asString(partObject.type))) return "";
      return asString(partObject.text ?? partObject.refusal);
    })
    .filter(Boolean)
    .join("\n");
};

const toDisplayText = (value: unknown): string => (typeof value === "string" ? value : safeStringify(value));

const safeStringify = (value: unknown): string => {
  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized ?? String(value ?? "");
  } catch {
    try {
      return String(value);
    } catch {
      return "[Unserializable value]";
    }
  }
};

const asObject = (value: unknown): JsonObject | null => (isObject(value) ? value : null);
const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const isResponsesObject = (value: JsonObject | null): value is JsonObject => {
  if (!value) return false;
  const hasResponseObjectType = value.object === "response";
  const hasOutputItems = Array.isArray(value.output);
  const hasRootOutputText = "output_text" in value;
  return hasResponseObjectType || hasOutputItems || hasRootOutputText;
};

const terminalEventTypes = new Set(["response.completed", "response.incomplete", "response.failed"]);

const collectEventField = (events: JsonObject[], eventType: string, field: string): string =>
  events
    .filter((event) => event.type === eventType)
    .map((event) => asString(event[field]))
    .join("");

const collectOutputItems = (events: JsonObject[], eventType: string): JsonObject[] =>
  events.flatMap((event) => (event.type === eventType && isObject(event.item) ? [event.item] : []));
