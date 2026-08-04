import { Typography } from "antd";
import { useTranslation } from "react-i18next";
import { ParsedResponseItem, ParsedResponseState } from "./prettyMessagesTypes";
import { CollapsibleMessage } from "./CollapsibleMessage";
import { SimpleMessageBlock } from "./SimpleMessageBlock";

const { Text } = Typography;

interface ResponseItemsViewProps {
  items: ParsedResponseItem[];
  state: ParsedResponseState | null;
}

const responseStatusTranslationKeys: Record<string, string> = {
  completed: "observability.logs.response_status_value.completed",
  failed: "observability.logs.response_status_value.failed",
  incomplete: "observability.logs.response_status_value.incomplete",
  in_progress: "observability.logs.response_status_value.in_progress",
  queued: "observability.logs.response_status_value.queued",
  cancelled: "observability.logs.response_status_value.cancelled",
  canceled: "observability.logs.response_status_value.cancelled",
};

export function ResponseItemsView({ items, state }: ResponseItemsViewProps) {
  const { t } = useTranslation();
  const statusTranslationKey = state?.status ? responseStatusTranslationKeys[state.status] : undefined;
  const statusLabel = statusTranslationKey ? t(statusTranslationKey) : state?.status;

  return (
    <div>
      {state && (
        <div style={{ marginBottom: 12, display: "grid", gap: 4 }}>
          {state.status && (
            <Text type="secondary">
              {t("observability.logs.response_status")}: {statusLabel}
            </Text>
          )}
          {state.error && (
            <Text type="danger">
              {t("observability.logs.response_error")}: {state.error}
            </Text>
          )}
          {state.incompleteReason && (
            <Text type="warning">
              {t("observability.logs.incomplete_reason")}: {state.incompleteReason}
            </Text>
          )}
        </div>
      )}
      {items.map((item, index) => {
        switch (item.kind) {
          case "message":
            return <SimpleMessageBlock key={`message-${index}`} label="ASSISTANT" content={item.content} />;
          case "reasoning":
            return (
              <div key={`reasoning-${index}`}>
                {item.summary && (
                  <CollapsibleMessage label={t("observability.logs.reasoning_summary")} content={item.summary} />
                )}
                <CollapsibleMessage label={t("observability.logs.reasoning")} content={item.content} />
              </div>
            );
          case "tool_call":
            return (
              <SimpleMessageBlock
                key={`tool-call-${index}`}
                label={
                  item.toolType === "custom"
                    ? t("observability.logs.custom_tool_call")
                    : t("observability.logs.function_call")
                }
                toolCalls={[item.tool]}
              />
            );
          case "tool_output":
            return (
              <SimpleMessageBlock
                key={`tool-output-${index}`}
                label={`${t("observability.logs.tool_output")} ${item.callId}`.trim()}
                content={item.content}
              />
            );
          case "unknown":
            return <CollapsibleMessage key={`unknown-${index}`} label={item.itemType} content={item.content} />;
        }
      })}
    </div>
  );
}
