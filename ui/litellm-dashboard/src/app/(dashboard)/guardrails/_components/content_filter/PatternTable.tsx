import React from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ACTION_ITEMS } from "./action_options";
import InlineSelect from "./InlineSelect";

interface Pattern {
  id: string;
  type: "prebuilt" | "custom";
  name: string;
  display_name?: string;
  pattern?: string;
  action: "BLOCK" | "MASK";
}

interface PatternTableProps {
  patterns: Pattern[];
  onActionChange: (id: string, action: "BLOCK" | "MASK") => void;
  onRemove: (id: string) => void;
}

const getPatternTypeLabel = (isKorean: boolean, type: Pattern["type"], t: (key: string) => string) => {
  if (isKorean) {
    return t(type === "prebuilt" ? "safety.contentFilter.prebuilt" : "safety.contentFilter.custom");
  }
  return type === "prebuilt" ? "Prebuilt" : "Custom";
};

const PatternTable: React.FC<PatternTableProps> = ({ patterns, onActionChange, onRemove }) => {
  const { t, i18n } = useTranslation();
  const isKorean = i18n.resolvedLanguage?.startsWith("ko") ?? false;
  const actionItems = isKorean
    ? ACTION_ITEMS.map((item) => ({
        ...item,
        label: t(item.value === "BLOCK" ? "safety.contentFilter.block" : "safety.contentFilter.mask"),
      }))
    : ACTION_ITEMS;
  if (patterns.length === 0) {
    return (
      <div className="py-10 text-center text-muted-foreground">
        {isKorean ? t("safety.contentFilter.noPatterns") : "No patterns added."}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table data-slot="table" className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium">
              {isKorean ? t("safety.contentFilter.type") : "Type"}
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium">
              {isKorean ? t("safety.contentFilter.patternName") : "Pattern name"}
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium">
              {isKorean ? t("safety.contentFilter.regex") : "Regex pattern"}
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium">
              {isKorean ? t("safety.contentFilter.action") : "Action"}
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium" />
          </tr>
        </thead>
        <tbody>
          {patterns.map((pattern) => (
            <tr key={pattern.id} className="border-t border-border align-top">
              <td className="px-3 py-2">
                <Badge variant="secondary">{getPatternTypeLabel(isKorean, pattern.type, t)}</Badge>
              </td>
              <td className="px-3 py-2">{pattern.display_name || pattern.name}</td>
              <td className="px-3 py-2">
                {pattern.pattern ? (
                  <code className="rounded-sm bg-muted px-1 py-0.5 text-xs">{pattern.pattern.substring(0, 40)}...</code>
                ) : (
                  "-"
                )}
              </td>
              <td className="px-3 py-2">
                <InlineSelect
                  ariaLabel={isKorean ? t("safety.contentFilter.action") : "Action"}
                  value={pattern.action}
                  options={actionItems}
                  className="w-[120px] justify-between"
                  onChange={(value) => onActionChange(pattern.id, value)}
                />
              </td>
              <td className="px-3 py-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-muted"
                  onClick={() => onRemove(pattern.id)}
                >
                  <Trash2 className="size-4" />
                  {isKorean ? t("safety.contentFilter.delete") : "Delete"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default PatternTable;
