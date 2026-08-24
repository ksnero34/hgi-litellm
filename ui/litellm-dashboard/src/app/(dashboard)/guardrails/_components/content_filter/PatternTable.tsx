import React from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/shared/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ACTION_ITEMS } from "./action_options";

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

const PatternTable: React.FC<PatternTableProps> = ({ patterns, onActionChange, onRemove }) => {
  const { t } = useTranslation();
  const actionItems = ACTION_ITEMS.map((item) => ({
    ...item,
    label: t(item.value === "BLOCK" ? "safety.contentFilter.block" : "safety.contentFilter.mask"),
  }));
  const columns: ColumnDef<Pattern>[] = [
    {
      header: t("safety.contentFilter.type"),
      accessorKey: "type",
      size: 100,
      cell: ({ row }) => (
        <Badge variant="secondary">
          {t(row.original.type === "prebuilt" ? "safety.contentFilter.prebuilt" : "safety.contentFilter.custom")}
        </Badge>
      ),
    },
    {
      header: t("safety.contentFilter.patternName"),
      accessorKey: "name",
      cell: ({ row }) => row.original.display_name || row.original.name,
    },
    {
      header: t("safety.contentFilter.regex"),
      accessorKey: "pattern",
      cell: ({ row }) =>
        row.original.pattern ? (
          <code className="rounded-sm bg-muted px-1 py-0.5 text-xs">{row.original.pattern.substring(0, 40)}...</code>
        ) : (
          "-"
        ),
    },
    {
      header: t("safety.contentFilter.action"),
      accessorKey: "action",
      size: 150,
      cell: ({ row }) => (
        <Select
          items={actionItems}
          value={row.original.action}
          onValueChange={(value: string | null) => value && onActionChange(row.original.id, value as "BLOCK" | "MASK")}
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

  if (patterns.length === 0) {
    return <div className="py-10 text-center text-muted-foreground">{t("safety.contentFilter.noPatterns")}</div>;
  }

  return <DataTable data={patterns} columns={columns} getRowId={(row) => row.id} size="compact" />;
};

export default PatternTable;
