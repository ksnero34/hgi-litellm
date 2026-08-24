/**
 * OutputCard - Displays output message with token count and cost
 * Datadog-style: header with icon/metrics, content below
 */

import { useState } from "react";
import MessageManager from "@/components/molecules/message_manager";
import { COLOR_BORDER } from "./constants";
import { ParsedMessage, ParsedResponseItem, ParsedResponseState } from "./prettyMessagesTypes";
import { SectionHeader } from "./SectionHeader";
import { ResponseItemsView } from "./ResponseItemsView";

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

  return (
    <div className="overflow-hidden rounded-md" style={{ border: `1px solid ${COLOR_BORDER}` }}>
      <SectionHeader
        type="output"
        tokens={completionTokens}
        cost={outputCost}
        onCopy={handleCopy}
        isCollapsed={isCollapsed}
        onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
      />

      <div
        className="overflow-hidden transition-[max-height,opacity] duration-300 ease-out"
        style={{ maxHeight: isCollapsed ? "0px" : "10000px", opacity: isCollapsed ? 0 : 1 }}
      >
        <div className="px-4 py-3">
          {normalizedItems.length > 0 || responseState ? (
            <ResponseItemsView items={normalizedItems} state={responseState} />
          ) : (
            <span className="text-[13px] text-muted-foreground italic">No response data available</span>
          )}
        </div>
      </div>
    </div>
  );
}
