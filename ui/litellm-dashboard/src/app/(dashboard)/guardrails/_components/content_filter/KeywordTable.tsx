import { Trash2 } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ACTION_ITEMS } from "./action_options";
import InlineSelect from "./InlineSelect";

interface BlockedWord {
  id: string;
  keyword: string;
  action: "BLOCK" | "MASK";
  description?: string;
}

interface KeywordTableProps {
  keywords: BlockedWord[];
  onActionChange: (id: string, field: string, value: any) => void;
  onRemove: (id: string) => void;
}

const KeywordTable: React.FC<KeywordTableProps> = ({ keywords, onActionChange, onRemove }) => {
  const { t, i18n } = useTranslation();
  const isKorean = i18n.resolvedLanguage?.startsWith("ko") ?? false;
  const actionItems = isKorean
    ? ACTION_ITEMS.map((item) => ({
        ...item,
        label: t(item.value === "BLOCK" ? "safety.contentFilter.block" : "safety.contentFilter.mask"),
      }))
    : ACTION_ITEMS;
  if (keywords.length === 0) {
    return (
      <div className="py-10 text-center text-muted-foreground">
        {isKorean ? t("safety.contentFilter.noKeywords") : "No keywords added."}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table data-slot="table" className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium">
              {isKorean ? t("safety.contentFilter.keyword") : "Keyword"}
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium">
              {isKorean ? t("safety.contentFilter.action") : "Action"}
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium">
              {isKorean ? t("safety.contentFilter.descriptionOptional") : "Description"}
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium" />
          </tr>
        </thead>
        <tbody>
          {keywords.map((keyword) => (
            <tr key={keyword.id} className="border-t border-border align-top">
              <td className="px-3 py-2">{keyword.keyword}</td>
              <td className="px-3 py-2">
                <InlineSelect
                  ariaLabel={isKorean ? t("safety.contentFilter.action") : "Action"}
                  value={keyword.action}
                  options={actionItems}
                  className="w-[120px] justify-between"
                  onChange={(value) => onActionChange(keyword.id, "action", value)}
                />
              </td>
              <td className="px-3 py-2">{keyword.description || "-"}</td>
              <td className="px-3 py-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-muted"
                  onClick={() => onRemove(keyword.id)}
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

export default KeywordTable;
