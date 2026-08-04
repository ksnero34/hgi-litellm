"use client";

import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, UserPlus } from "lucide-react";

import { DataTableSortHeader } from "@/components/shared/DataTable";
import { IdentityCell, ModelsCell } from "@/components/shared/table_cells";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cva.config";

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export interface AvailableTeam {
  team_id: string;
  team_alias: string;
  description?: string;
  models: string[];
  members_with_roles: { user_id?: string; user_email?: string; role: string }[];
}

function AvailableTeamRowActions({
  team,
  onJoinTeam,
  translator,
}: {
  team: AvailableTeam;
  onJoinTeam: (teamId: string) => void;
  translator: TranslateFn;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={translator("access.teams.actions.open", { defaultValue: "Open team actions" })}
        data-testid={`available-team-actions-${team.team_id}`}
        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "text-muted-foreground")}
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem data-testid="available-team-action-join" onClick={() => onJoinTeam(team.team_id)}>
          <UserPlus />
          {translator("access.teams.actions.join", { defaultValue: "Join Team" })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface AvailableTeamsTableColumnsDeps {
  onJoinTeam: (teamId: string) => void;
  translator: TranslateFn;
}

export const getAvailableTeamsTableColumns = ({
  onJoinTeam,
  translator,
}: AvailableTeamsTableColumnsDeps): ColumnDef<AvailableTeam>[] => [
  {
    id: "team_alias",
    accessorKey: "team_alias",
    meta: { title: translator("access.teams.columns.teamName", { defaultValue: "Team Name" }) },
    header: ({ column }) => (
      <DataTableSortHeader
        column={column}
        title={translator("access.teams.columns.teamName", { defaultValue: "Team Name" })}
      />
    ),
    size: 220,
    enableSorting: true,
    cell: ({ row }) => (
      <IdentityCell title={row.original.team_alias} className="max-w-72" titleClassName="font-medium" />
    ),
  },
  {
    id: "description",
    accessorKey: "description",
    meta: { title: translator("access.teams.columns.description", { defaultValue: "Description" }) },
    header: translator("access.teams.columns.description", { defaultValue: "Description" }),
    size: 280,
    enableSorting: false,
    cell: ({ row }) => {
      const description = row.original.description;
      return (
        <span className="block max-w-72 truncate text-sm text-muted-foreground" title={description || undefined}>
          {description ||
            translator("access.teams.available.noDescription", { defaultValue: "No description available" })}
        </span>
      );
    },
  },
  {
    id: "members",
    accessorFn: (team) => team.members_with_roles.length,
    meta: { title: translator("access.teams.columns.members", { defaultValue: "Members" }) },
    header: ({ column }) => (
      <DataTableSortHeader
        column={column}
        title={translator("access.teams.columns.members", { defaultValue: "Members" })}
      />
    ),
    size: 120,
    enableSorting: true,
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {translator("access.teams.available.memberCount", {
          count: row.original.members_with_roles.length,
          defaultValue: "{{count}} members",
        })}
      </span>
    ),
  },
  {
    id: "models",
    meta: { title: translator("access.teams.columns.models", { defaultValue: "Models" }) },
    header: translator("access.teams.columns.models", { defaultValue: "Models" }),
    size: 260,
    enableSorting: false,
    cell: ({ row }) => <ModelsCell models={row.original.models} />,
  },
  {
    id: "actions",
    meta: { className: "text-right", headerClassName: "text-right" },
    header: () => (
      <span className="sr-only">{translator("access.teams.columns.actions", { defaultValue: "Actions" })}</span>
    ),
    size: 64,
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <AvailableTeamRowActions team={row.original} onJoinTeam={onJoinTeam} translator={translator} />
      </div>
    ),
  },
];
