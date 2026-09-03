"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Copy, KeyRound, Layers, MoreHorizontal, Pencil, Trash2, Users } from "lucide-react";
import type { TFunction } from "i18next";
import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { DataTableSortHeader } from "@/components/shared/DataTable";
import { DateCell, IdentityCell, SpendBudgetCell } from "@/components/shared/table_cells";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cva.config";
import { copyToClipboard, formatNumberWithCommas } from "@/utils/dataUtils";

import { Team } from "../key_team_helpers/key_list";
import { Organization } from "../networking";

interface ResourceTone {
  icon: typeof Users;
  className: string;
}

const RESOURCE_TONES: Record<"members" | "models" | "keys", ResourceTone> = {
  members: {
    icon: Users,
    className:
      "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-400/30",
  },
  models: { icon: Layers, className: "bg-info/10 text-info ring-sky-600/20" },
  keys: { icon: KeyRound, className: "bg-success/10 text-success ring-emerald-600/20" },
};

const teamMemberCount = (team: Team): number => team.members_count ?? team.members_with_roles?.length ?? 0;
const teamModelCount = (team: Team): number => team.models?.length ?? 0;
const teamKeyCount = (team: Team): number => team.keys_count ?? team.keys?.length ?? 0;

function ResourcesCell({ team }: { team: Team }) {
  const { t } = useTranslation();
  const items = [
    {
      key: "members" as const,
      label: t("access.teams.resources.members", { defaultValue: "Members" }),
      title: t("access.teams.resources.membersCount", {
        count: teamMemberCount(team),
        defaultValue: "{{count}} members",
      }),
      count: teamMemberCount(team),
    },
    {
      key: "models" as const,
      label: t("access.teams.resources.models", { defaultValue: "Models" }),
      title: t("access.teams.resources.modelsCount", { count: teamModelCount(team), defaultValue: "{{count}} models" }),
      count: teamModelCount(team),
    },
    {
      key: "keys" as const,
      label: t("access.teams.resources.keys", { defaultValue: "Keys" }),
      title: t("access.teams.resources.keysCount", { count: teamKeyCount(team), defaultValue: "{{count}} keys" }),
      count: teamKeyCount(team),
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
            title={item.title}
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

function RateLimitLine({ label, value }: { label: string; value: number | null }) {
  const { t } = useTranslation();
  return (
    <div>
      <span className="text-[10px] font-semibold text-muted-foreground">{label} </span>
      <span className="tabular-nums">
        {value != null ? formatNumberWithCommas(value) : t("access.common.unlimited", { defaultValue: "Unlimited" })}
      </span>
    </div>
  );
}

interface TeamRowActionsProps {
  team: Team;
  canManage: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  translator: TFunction;
  onEditTeam: (team: Team) => void;
  onDeleteTeam: (team: Team) => void;
}

function TeamRowActions({
  team,
  canManage,
  isOpen,
  onOpenChange,
  translator,
  onEditTeam,
  onDeleteTeam,
}: TeamRowActionsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) {
        return;
      }
      onOpenChange(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen, onOpenChange]);

  const handleCopy = () => {
    void copyToClipboard(
      team.team_id,
      translator("access.teams.notifications.idCopied", { defaultValue: "Team ID copied" }),
    );
    onOpenChange(false);
  };

  return (
    <div ref={containerRef} className="relative" data-row-click-exempt>
      <button
        type="button"
        aria-label={translator("access.teams.actions.open", { defaultValue: "Open team actions" })}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        data-testid={`team-actions-${team.team_id}`}
        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "text-muted-foreground")}
        onClick={(event) => {
          event.stopPropagation();
          onOpenChange(!isOpen);
        }}
      >
        <MoreHorizontal className="size-4" />
      </button>
      <div
        role="menu"
        aria-hidden={!isOpen}
        data-row-click-exempt
        hidden={!isOpen}
        className="mt-1 flex min-w-44 flex-col rounded-md bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      >
        {canManage && (
          <button
            type="button"
            role="menuitem"
            data-testid="team-action-edit"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              onOpenChange(false);
              onEditTeam(team);
            }}
          >
            <Pencil className="size-4" />
            {translator("access.teams.actions.edit", { defaultValue: "Edit team" })}
          </button>
        )}
        <button
          type="button"
          role="menuitem"
          data-testid="team-action-copy"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
          onClick={handleCopy}
        >
          <Copy className="size-4" />
          {translator("access.teams.actions.copyId", { defaultValue: "Copy team ID" })}
        </button>
        {canManage && (
          <>
            <div className="-mx-1 my-1 h-px bg-border" />
            <button
              type="button"
              role="menuitem"
              data-testid="team-action-delete"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
              onClick={() => {
                onOpenChange(false);
                onDeleteTeam(team);
              }}
            >
              <Trash2 className="size-4" />
              {translator("access.teams.actions.delete", { defaultValue: "Delete team" })}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

interface TeamTableColumnsDeps {
  organizations: Organization[];
  userRole: string | null;
  openTeamId: string | null;
  onOpenTeamIdChange: (teamId: string | null) => void;
  onSelectTeam: (team: Team) => void;
  onEditTeam: (team: Team) => void;
  onDeleteTeam: (team: Team) => void;
  t: TFunction;
}

export const getTeamTableColumns = ({
  organizations,
  userRole,
  openTeamId,
  onOpenTeamIdChange,
  onSelectTeam,
  onEditTeam,
  onDeleteTeam,
  t,
}: TeamTableColumnsDeps): ColumnDef<Team>[] => {
  const canManage = userRole === "Admin";

  return [
    {
      id: "team_alias",
      accessorKey: "team_alias",
      meta: {
        title: t("access.teams.columns.team", { defaultValue: "Team" }),
        renderSkeleton: () => (
          <div className="flex flex-col gap-2 py-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3.5 w-24 opacity-65" />
          </div>
        ),
      },
      header: ({ column }) => (
        <DataTableSortHeader
          column={column}
          title={t("access.teams.columns.team", { defaultValue: "Team" })}
          variant="header-cycle"
        />
      ),
      size: 260,
      enableSorting: true,
      cell: ({ row }) => {
        const team = row.original;
        const hasAlias = Boolean(team.team_alias);
        return (
          <IdentityCell
            title={team.team_alias || team.team_id}
            subtitle={hasAlias ? team.team_id : undefined}
            onClick={() => onSelectTeam(team)}
          />
        );
      },
    },
    {
      id: "organization_alias",
      accessorKey: "organization_id",
      meta: { title: t("access.teams.columns.organization", { defaultValue: "Organization" }) },
      header: t("access.teams.columns.organization", { defaultValue: "Organization" }),
      size: 160,
      enableSorting: false,
      cell: (info) => {
        const orgId = info.getValue() as string | null;
        if (!orgId)
          return <span className="text-muted-foreground">{t("access.common.none", { defaultValue: "—" })}</span>;
        const org = organizations.find((o) => o.organization_id === orgId);
        const displayValue = org?.organization_alias || orgId;
        const width = info.cell.column.getSize();
        return (
          <span className="block truncate text-sm" style={{ maxWidth: width }} title={displayValue}>
            {displayValue}
          </span>
        );
      },
    },
    {
      id: "resources",
      meta: {
        title: t("access.teams.columns.resources", { defaultValue: "Resources" }),
        renderSkeleton: () => (
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-6 w-12 rounded-md" />
            <Skeleton className="h-6 w-12 rounded-md" />
            <Skeleton className="h-6 w-12 rounded-md opacity-65" />
          </div>
        ),
      },
      header: t("access.teams.columns.resources", { defaultValue: "Resources" }),
      size: 210,
      enableSorting: false,
      cell: ({ row }) => <ResourcesCell team={row.original} />,
    },
    {
      id: "spend",
      accessorKey: "spend",
      meta: { title: t("access.teams.columns.spendBudget", { defaultValue: "Spend / Budget" }), skeleton: "meter" },
      header: t("access.teams.columns.spendBudget", { defaultValue: "Spend / Budget" }),
      size: 200,
      enableSorting: false,
      cell: ({ row }) => (
        <SpendBudgetCell
          spend={row.original.spend}
          maxBudget={row.original.max_budget}
          spendDecimals={2}
          budgetDecimals={2}
        />
      ),
    },
    {
      id: "created_at",
      accessorKey: "created_at",
      meta: { title: t("access.teams.columns.created", { defaultValue: "Created" }) },
      header: ({ column }) => (
        <DataTableSortHeader
          column={column}
          title={t("access.teams.columns.created", { defaultValue: "Created" })}
          variant="header-cycle"
        />
      ),
      size: 130,
      enableSorting: true,
      cell: (info) => <DateCell value={info.getValue() as string | null} precision="date" />,
    },
    {
      id: "members",
      meta: { title: t("access.teams.columns.members", { defaultValue: "Members" }) },
      header: t("access.teams.columns.members", { defaultValue: "Members" }),
      size: 110,
      enableSorting: false,
      cell: ({ row }) => <span className="text-sm tabular-nums">{teamMemberCount(row.original)}</span>,
    },
    {
      id: "models",
      meta: { title: t("access.teams.columns.models", { defaultValue: "Models" }) },
      header: t("access.teams.columns.models", { defaultValue: "Models" }),
      size: 100,
      enableSorting: false,
      cell: ({ row }) => <span className="text-sm tabular-nums">{teamModelCount(row.original)}</span>,
    },
    {
      id: "rate_limits",
      meta: { title: t("access.teams.columns.rateLimits", { defaultValue: "Rate Limits" }), skeleton: "twoLine" },
      header: t("access.teams.columns.rateLimits", { defaultValue: "Rate Limits" }),
      size: 140,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="text-xs leading-tight">
          <RateLimitLine label="TPM" value={row.original.tpm_limit} />
          <RateLimitLine label="RPM" value={row.original.rpm_limit} />
        </div>
      ),
    },
    {
      id: "updated_at",
      accessorKey: "updated_at",
      meta: { title: t("access.teams.columns.updated", { defaultValue: "Updated" }) },
      header: t("access.teams.columns.updated", { defaultValue: "Updated" }),
      size: 130,
      enableSorting: false,
      cell: (info) => (
        <DateCell
          value={info.getValue() as string | null}
          precision="date"
          fallback={t("access.common.never", { defaultValue: "Never" })}
        />
      ),
    },
    {
      id: "actions",
      meta: { className: "text-right", headerClassName: "text-right" },
      header: () => <span className="sr-only">{t("access.teams.columns.actions", { defaultValue: "Actions" })}</span>,
      size: 60,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <TeamRowActions
            team={row.original}
            canManage={canManage}
            isOpen={openTeamId === row.original.team_id}
            onOpenChange={(open) => onOpenTeamIdChange(open ? row.original.team_id : null)}
            translator={t}
            onEditTeam={onEditTeam}
            onDeleteTeam={onDeleteTeam}
          />
        </div>
      ),
    },
  ];
};

export const TEAM_TABLE_HIDDEN_COLUMNS: Record<string, boolean> = {
  members: false,
  models: false,
  rate_limits: false,
  updated_at: false,
};
