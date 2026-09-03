import React from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ACTION_ITEMS, SEVERITY_ITEMS } from "./action_options";
import InlineSelect from "./InlineSelect";

interface ContentCategory {
  id: string;
  category: string;
  display_name: string;
  action: "BLOCK" | "MASK";
  severity_threshold: "high" | "medium" | "low";
}

interface CategoryTableProps {
  categories: ContentCategory[];
  onActionChange?: (id: string, action: "BLOCK" | "MASK") => void;
  onSeverityChange?: (id: string, severity: "high" | "medium" | "low") => void;
  onRemove?: (id: string) => void;
  readOnly?: boolean;
}

const CategoryTable: React.FC<CategoryTableProps> = ({
  categories,
  onActionChange,
  onSeverityChange,
  onRemove,
  readOnly = false,
}) => {
  const { t, i18n } = useTranslation();
  const isKorean = i18n.resolvedLanguage?.startsWith("ko") ?? false;
  const actionItems = isKorean
    ? ACTION_ITEMS.map((item) => ({
        ...item,
        label: t(item.value === "BLOCK" ? "safety.contentFilter.block" : "safety.contentFilter.mask"),
      }))
    : ACTION_ITEMS;
  const severityItems = isKorean
    ? SEVERITY_ITEMS.map((item) => ({
        ...item,
        label: t(`safety.contentFilter.${item.value}`),
      }))
    : SEVERITY_ITEMS;
  if (categories.length === 0) {
    return (
      <div className="py-10 text-center text-muted-foreground">
        {isKorean ? t("safety.contentFilter.noCategories") : "No categories configured."}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table data-slot="table" className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium">
              {isKorean ? t("safety.contentFilter.category") : "Category"}
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium">
              {isKorean ? t("safety.contentFilter.severityThreshold") : "Severity Threshold"}
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium">
              {isKorean ? t("safety.contentFilter.action") : "Action"}
            </th>
            {!readOnly && <th className="px-3 py-2 text-left text-xs font-medium" />}
          </tr>
        </thead>
        <tbody>
          {categories.map((category) => (
            <tr key={category.id} className="border-t border-border align-top">
              <td className="px-3 py-2">
                <div>
                  <span className="font-semibold">{category.display_name}</span>
                  {category.display_name !== category.category && (
                    <div className="text-xs text-muted-foreground">{category.category}</div>
                  )}
                </div>
              </td>
              <td className="px-3 py-2">
                {readOnly ? (
                  <Badge variant={category.severity_threshold === "high" ? "destructive" : "secondary"}>
                    {category.severity_threshold.toUpperCase()}
                  </Badge>
                ) : (
                  <InlineSelect
                    ariaLabel={isKorean ? t("safety.contentFilter.severityThreshold") : "Severity Threshold"}
                    value={category.severity_threshold}
                    options={severityItems}
                    className="w-[150px] justify-between"
                    onChange={(value) => onSeverityChange?.(category.id, value)}
                  />
                )}
              </td>
              <td className="px-3 py-2">
                {readOnly ? (
                  <Badge variant={category.action === "BLOCK" ? "destructive" : "secondary"}>{category.action}</Badge>
                ) : (
                  <InlineSelect
                    ariaLabel={isKorean ? t("safety.contentFilter.action") : "Action"}
                    value={category.action}
                    options={actionItems}
                    className="w-[120px] justify-between"
                    onChange={(value) => onActionChange?.(category.id, value)}
                  />
                )}
              </td>
              {!readOnly && (
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-muted"
                    onClick={() => onRemove?.(category.id)}
                  >
                    <Trash2 className="size-4" />
                    {isKorean ? t("safety.contentFilter.delete") : "Delete"}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default CategoryTable;
