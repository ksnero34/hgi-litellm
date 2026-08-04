"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { GitBranch, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { DataTableSortHeader } from "@/components/shared/DataTable";
import { IdentityCell, ModelsCell } from "@/components/shared/table_cells";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { i18n } from "@/i18n/i18n";
import { cn } from "@/lib/cva.config";

import { formatStrategyLabel } from "./strategy";
import type { RoutingGroup } from "./types";

const ROUTING_STRATEGY_LABEL_KEYS: Record<string, string> = {
  "simple-shuffle": "observabilityExtra.routingGroups.strategy.simpleShuffle",
  "least-busy": "observabilityExtra.routingGroups.strategy.leastBusy",
  "usage-based-routing": "observabilityExtra.routingGroups.strategy.usageBased",
  "latency-based-routing": "observabilityExtra.routingGroups.strategy.latencyBased",
};

const getStrategyLabel = (strategy: string, t: (key: string, options?: Record<string, unknown>) => string): string => {
  const key = ROUTING_STRATEGY_LABEL_KEYS[strategy];
  return key ? t(key) : formatStrategyLabel(strategy);
};

interface RoutingGroupRowActionsProps {
  group: RoutingGroup;
  onEdit: (group: RoutingGroup) => void;
  onDelete: (group: RoutingGroup) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function RoutingGroupRowActions({ group, onEdit, onDelete, t }: RoutingGroupRowActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("observabilityExtra.routingGroups.openActionsFor", { name: group.group_name })}
        data-testid={`routing-group-actions-${group.group_name}`}
        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "text-muted-foreground")}
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem data-testid="routing-group-action-edit" onClick={() => onEdit(group)}>
          <Pencil />
          {t("observabilityExtra.routingGroups.edit")}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          data-testid="routing-group-action-delete"
          onClick={() => onDelete(group)}
        >
          <Trash2 />
          {t("observabilityExtra.routingGroups.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface RoutingGroupsTableColumnsDeps {
  onEdit: (group: RoutingGroup) => void;
  onDelete: (group: RoutingGroup) => void;
  onToggleUsage: (group: RoutingGroup) => void;
  t?: (key: string, options?: Record<string, unknown>) => string;
}

export const getRoutingGroupsTableColumns = ({
  onEdit,
  onDelete,
  onToggleUsage,
  t: translate,
}: RoutingGroupsTableColumnsDeps): ColumnDef<RoutingGroup>[] => {
  const t = translate ?? ((key: string, options?: Record<string, unknown>) => i18n.t(key, options));

  return [
    {
      id: "group_name",
      accessorKey: "group_name",
      meta: { title: t("observabilityExtra.routingGroups.columns.groupName"), skeleton: "text" },
      header: ({ column }) => (
        <DataTableSortHeader column={column} title={t("observabilityExtra.routingGroups.columns.groupName")} />
      ),
      size: 240,
      enableSorting: true,
      cell: ({ row }) => (
        <IdentityCell
          title={row.original.group_name}
          className="max-w-60"
          onClick={() => onToggleUsage(row.original)}
        />
      ),
    },
    {
      id: "models",
      meta: { title: t("observabilityExtra.routingGroups.columns.models"), skeleton: "chips" },
      header: t("observabilityExtra.routingGroups.columns.models"),
      size: 320,
      enableSorting: false,
      cell: ({ row }) => <ModelsCell models={row.original.models} />,
    },
    {
      id: "routing_strategy",
      accessorKey: "routing_strategy",
      meta: { title: t("observabilityExtra.routingGroups.columns.strategy"), skeleton: "text" },
      header: ({ column }) => (
        <DataTableSortHeader column={column} title={t("observabilityExtra.routingGroups.columns.strategy")} />
      ),
      size: 180,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5 text-sm">
          <GitBranch className="size-4 shrink-0 text-muted-foreground" />
          {getStrategyLabel(row.original.routing_strategy, t)}
        </span>
      ),
    },
    {
      id: "actions",
      meta: { className: "text-right", headerClassName: "text-right" },
      header: () => <span className="sr-only">{t("observabilityExtra.routingGroups.columns.actions")}</span>,
      size: 64,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <RoutingGroupRowActions group={row.original} onEdit={onEdit} onDelete={onDelete} t={t} />
        </div>
      ),
    },
  ];
};
