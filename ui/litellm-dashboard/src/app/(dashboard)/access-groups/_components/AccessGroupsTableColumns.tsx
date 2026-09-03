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

import { AccessGroup } from "./types";

interface AccessGroupsCopy {
  id: string;
  name: string;
  resources: string;
  created: string;
  updated: string;
  models: string;
  mcpServers: string;
  agents: string;
  openActions: string;
  delete: string;
  actions: string;
}

interface ResourceTone {
  icon: typeof Layers;
  className: string;
}

const RESOURCE_TONES: Record<"models" | "mcpServers" | "agents", ResourceTone> = {
  models: { icon: Layers, className: "bg-info/10 text-info ring-blue-600/20" },
  mcpServers: { icon: Server, className: "bg-info/10 text-info ring-cyan-600/20" },
  agents: {
    icon: Bot,
    className:
      "bg-purple-50 text-purple-700 ring-purple-600/20 dark:bg-purple-950 dark:text-purple-300 dark:ring-purple-400/30",
  },
};

function ResourcesCell({ group, copy }: { group: AccessGroup; copy: AccessGroupsCopy }) {
  const items = [
    {
      key: "models" as const,
      label: copy.models,
      count: group.modelIds.length,
    },
    {
      key: "mcpServers" as const,
      label: copy.mcpServers,
      count: group.mcpServerIds.length,
    },
    {
      key: "agents" as const,
      label: copy.agents,
      count: group.agentIds.length,
    },
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
  copy,
}: {
  group: AccessGroup;
  onDeleteClick: (group: AccessGroup) => void;
  copy: AccessGroupsCopy;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={copy.openActions}
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
          {copy.delete}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface AccessGroupsTableColumnsDeps {
  copy: AccessGroupsCopy;
  canModify: boolean;
  onGroupClick: (id: string) => void;
  onDeleteClick: (group: AccessGroup) => void;
}

export const getAccessGroupsTableColumns = ({
  copy,
  canModify,
  onGroupClick,
  onDeleteClick,
}: AccessGroupsTableColumnsDeps): ColumnDef<AccessGroup>[] => {
  const columns: ColumnDef<AccessGroup>[] = [
    {
      id: "id",
      accessorKey: "id",
      meta: { title: copy.id },
      header: copy.id,
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
      meta: { title: copy.name },
      header: ({ column }) => <DataTableSortHeader column={column} title={copy.name} />,
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
      meta: { title: copy.resources },
      header: copy.resources,
      size: 220,
      enableSorting: false,
      cell: ({ row }) => <ResourcesCell group={row.original} copy={copy} />,
    },
    {
      id: "createdAt",
      accessorKey: "createdAt",
      meta: { title: copy.created },
      header: ({ column }) => <DataTableSortHeader column={column} title={copy.created} />,
      size: 150,
      enableSorting: true,
      sortingFn: "datetime",
      cell: ({ row }) => <DateCell value={row.original.createdAt} precision="date" />,
    },
    {
      id: "updatedAt",
      accessorKey: "updatedAt",
      meta: { title: copy.updated },
      header: copy.updated,
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
      meta: { className: "text-right", headerClassName: "text-right" },
      header: () => <span className="sr-only">{copy.actions}</span>,
      size: 64,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <AccessGroupRowActions group={row.original} onDeleteClick={onDeleteClick} copy={copy} />
        </div>
      ),
    },
  ];
};
