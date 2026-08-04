"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Bot, Layers, MoreHorizontal, Server, Trash2 } from "lucide-react";

import { DataTableSortHeader } from "@/components/shared/DataTable";
import { DateCell, IdentityCell } from "@/components/shared/table_cells";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cva.config";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { AccessGroup } from "./types";

interface ResourceTone {
  icon: typeof Layers;
  className: string;
}

const RESOURCE_TONES: Record<"models" | "mcpServers" | "agents", ResourceTone> = {
  models: { icon: Layers, className: "bg-blue-50 text-blue-700 ring-blue-600/20" },
  mcpServers: { icon: Server, className: "bg-cyan-50 text-cyan-700 ring-cyan-600/20" },
  agents: { icon: Bot, className: "bg-purple-50 text-purple-700 ring-purple-600/20" },
};

function ResourcesCell({ group }: { group: AccessGroup }) {
  const { t } = useTranslation();
  const items = [
    { key: "models" as const, label: t("identityAdmin.organization.models"), count: group.modelIds.length },
    { key: "mcpServers" as const, label: t("identityAdmin.accessGroups.mcpServers"), count: group.mcpServerIds.length },
    { key: "agents" as const, label: t("identityAdmin.accessGroups.agents"), count: group.agentIds.length },
  ];

  return (
    <div className="flex items-center gap-1.5">
      {items.map((item) => {
        const tone = RESOURCE_TONES[item.key];
        const Icon = tone.icon;
        return (
          <span
            key={item.key}
            title={`${item.count} ${item.label}`}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset [&_svg]:size-3.5",
              tone.className,
            )}
          >
            <Icon />
            <span className="tabular-nums">{item.count}</span>
          </span>
        );
      })}
    </div>
  );
}

function AccessGroupRowActions({
  group,
  onDeleteClick,
}: {
  group: AccessGroup;
  onDeleteClick: (group: AccessGroup) => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("identityAdmin.accessGroups.openActions")}
        data-testid={`access-group-actions-${group.id}`}
        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "text-muted-foreground")}
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          variant="destructive"
          data-testid="access-group-action-delete"
          onClick={() => onDeleteClick(group)}
        >
          <Trash2 />
          {t("identityAdmin.accessGroups.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface AccessGroupsTableColumnsDeps {
  translator: TFunction;
  canModify: boolean;
  onGroupClick: (id: string) => void;
  onDeleteClick: (group: AccessGroup) => void;
}

export const getAccessGroupsTableColumns = ({
  translator,
  canModify,
  onGroupClick,
  onDeleteClick,
}: AccessGroupsTableColumnsDeps): ColumnDef<AccessGroup>[] => {
  const columns: ColumnDef<AccessGroup>[] = [
    {
      id: "id",
      accessorKey: "id",
      meta: { title: translator("identityAdmin.accessGroups.id") },
      header: translator("identityAdmin.accessGroups.id"),
      size: 200,
      enableSorting: false,
      cell: ({ row }) => (
        <IdentityCell
          title={row.original.id}
          titleClassName="font-mono text-xs font-normal"
          onClick={() => onGroupClick(row.original.id)}
        />
      ),
    },
    {
      id: "name",
      accessorKey: "name",
      meta: { title: translator("identityAdmin.accessGroups.name") },
      header: ({ column }) => (
        <DataTableSortHeader column={column} title={translator("identityAdmin.accessGroups.name")} />
      ),
      size: 220,
      enableSorting: true,
      cell: ({ row }) => {
        const name = row.original.name;
        return (
          <span className="block max-w-72 truncate text-sm font-medium" title={name}>
            {name || "-"}
          </span>
        );
      },
    },
    {
      id: "resources",
      meta: { title: translator("identityAdmin.accessGroups.resources") },
      header: translator("identityAdmin.accessGroups.resources"),
      size: 220,
      enableSorting: false,
      cell: ({ row }) => <ResourcesCell group={row.original} />,
    },
    {
      id: "createdAt",
      accessorKey: "createdAt",
      meta: { title: translator("identityAdmin.accessGroups.created") },
      header: ({ column }) => (
        <DataTableSortHeader column={column} title={translator("identityAdmin.accessGroups.created")} />
      ),
      size: 150,
      enableSorting: true,
      sortingFn: "datetime",
      cell: ({ row }) => <DateCell value={row.original.createdAt} precision="date" />,
    },
    {
      id: "updatedAt",
      accessorKey: "updatedAt",
      meta: { title: translator("identityAdmin.accessGroups.updated") },
      header: translator("identityAdmin.accessGroups.updated"),
      size: 150,
      enableSorting: false,
      cell: ({ row }) => <DateCell value={row.original.updatedAt} precision="date" />,
    },
  ];

  if (!canModify) {
    return columns;
  }

  return [
    ...columns,
    {
      id: "actions",
      meta: {
        title: translator("identityAdmin.users.actions"),
        className: "text-right",
        headerClassName: "text-right",
      },
      header: () => <span className="sr-only">{translator("identityAdmin.users.actions")}</span>,
      size: 64,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <AccessGroupRowActions group={row.original} onDeleteClick={onDeleteClick} />
        </div>
      ),
    },
  ];
};
