/**
 * OutputCard - Displays output message with token count and cost
 * Datadog-style: header with icon/metrics, content below
 */

import { useState } from "react";
import { Typography } from "antd";
import MessageManager from "@/components/molecules/message_manager";
import { ParsedMessage, ParsedResponseItem, ParsedResponseState } from "./prettyMessagesTypes";
import { SectionHeader } from "./SectionHeader";
import { ResponseItemsView } from "./ResponseItemsView";

const { Text } = Typography;

interface OutputCardProps {
  message: ParsedMessage | null;
  responseItems?: ParsedResponseItem[];
  responseState?: ParsedResponseState | null;
  completionTokens?: number;
  outputCost?: number;
}

export function OutputCard({
  message,
  responseItems,
  responseState = null,
  completionTokens,
  outputCost,
}: OutputCardProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const normalizedItems = responseItems ?? (message ? [{ kind: "message" as const, content: message.content }] : []);

  const handleCopy = () => {
    if (normalizedItems.length === 0 && !responseState) return;

    const content =
      normalizedItems.length === 1 && normalizedItems[0].kind === "message" && !responseState
        ? normalizedItems[0].content
        : JSON.stringify({ items: normalizedItems, state: responseState }, null, 2);
    navigator.clipboard.writeText(content);
    MessageManager.success("Output copied");
  };

  if (normalizedItems.length === 0 && !responseState) {
    return (
      <div
        style={{
          border: "1px solid #f0f0f0",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        <SectionHeader
          type="output"
          tokens={completionTokens}
          cost={outputCost}
          onCopy={handleCopy}
          isCollapsed={isCollapsed}
          onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
        />
        <div
          style={{
            maxHeight: isCollapsed ? "0px" : "10000px",
            overflow: "hidden",
            transition: "max-height 0.3s ease-out, opacity 0.3s ease-out",
            opacity: isCollapsed ? 0 : 1,
          }}
        >
          <div style={{ padding: "12px 16px" }}>
            <Text type="secondary" style={{ fontSize: 13, fontStyle: "italic" }}>
              No response data available
            </Text>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        border: "1px solid #f0f0f0",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      {/* Datadog-style Header */}
      <SectionHeader
        type="output"
        tokens={completionTokens}
        cost={outputCost}
        onCopy={handleCopy}
        isCollapsed={isCollapsed}
        onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
      />

      {/* Content */}
      <div
        style={{
          maxHeight: isCollapsed ? "0px" : "10000px",
          overflow: "hidden",
          transition: "max-height 0.3s ease-out, opacity 0.3s ease-out",
          opacity: isCollapsed ? 0 : 1,
        }}
      >
        <div style={{ padding: "12px 16px" }}>
          <ResponseItemsView items={normalizedItems} state={responseState} />
        </div>
      </div>
    </div>
  );
}
