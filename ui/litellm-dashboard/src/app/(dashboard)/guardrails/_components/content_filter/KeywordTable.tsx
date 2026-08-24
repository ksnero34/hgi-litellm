import { Trash2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import React from "react";
import { useTranslation } from "react-i18next";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ACTION_ITEMS } from "./action_options";

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
  const { t } = useTranslation();
  const actionItems = ACTION_ITEMS.map((item) => ({
    ...item,
    label: t(item.value === "BLOCK" ? "safety.contentFilter.block" : "safety.contentFilter.mask"),
  }));
  const columns: ColumnDef<BlockedWord>[] = [
    {
      header: t("safety.contentFilter.keyword"),
      accessorKey: "keyword",
    },
    {
      header: t("safety.contentFilter.action"),
      accessorKey: "action",
      size: 150,
      cell: ({ row }) => (
        <Select
          items={actionItems}
          value={row.original.action}
          onValueChange={(value: string | null) => value && onActionChange(row.original.id, "action", value)}
        >
          <SelectTrigger size="sm" className="w-[120px]" aria-label={t("safety.contentFilter.action")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {actionItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      header: t("safety.contentFilter.descriptionOptional"),
      accessorKey: "description",
      cell: ({ row }) => row.original.description || "-",
    },
    {
      header: "",
      id: "actions",
      size: 100,
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => onRemove(row.original.id)}>
          <Trash2 />
          {t("safety.contentFilter.delete")}
        </Button>
      ),
    },
  ];

  if (keywords.length === 0) {
    return <div className="py-10 text-center text-muted-foreground">{t("safety.contentFilter.noKeywords")}</div>;
  }

  return <DataTable data={keywords} columns={columns} getRowId={(row) => row.id} size="compact" />;
};

export default KeywordTable;
