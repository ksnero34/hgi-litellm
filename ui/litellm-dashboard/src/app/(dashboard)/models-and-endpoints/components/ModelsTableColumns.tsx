"use client";

import { ColumnDef } from "@tanstack/react-table";
import type { TFunction } from "i18next";
import { Copy, Info, Loader2, Pencil, RefreshCw, Trash2 } from "lucide-react";

import { ProviderLogo } from "@/components/molecules/models/ProviderLogo";
import { ModelData } from "@/components/model_dashboard/types";
import { DataTableSortHeader } from "@/components/shared/DataTable";
import { CellTooltip, DateCell, formatCellDate, IdCell, StatusBadge } from "@/components/shared/table_cells";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Switch } from "@/components/ui/switch";
import { getDisplayModelName } from "@/components/view_model/model_name_display";
import { copyToClipboard } from "@/utils/dataUtils";

export const MODEL_ID_COLUMN_ID = "model_info_id";
export const MODEL_NAME_COLUMN_ID = "model_name";
export const CREDENTIALS_COLUMN_ID = "litellm_credential_name";
export const CREATED_BY_COLUMN_ID = "model_info_created_by";
export const UPDATED_AT_COLUMN_ID = "model_info_updated_at";
export const COSTS_COLUMN_ID = "input_cost";
export const TEAM_ID_COLUMN_ID = "model_info_team_id";
export const ACCESS_GROUPS_COLUMN_ID = "model_info_access_groups";
export const STATUS_COLUMN_ID = "model_info_db_model";

const COLUMN_ID_TO_SERVER_SORT_FIELD: Record<string, string> = {
  [COSTS_COLUMN_ID]: "costs",
  [STATUS_COLUMN_ID]: "status",
  [CREATED_BY_COLUMN_ID]: "created_at",
  [UPDATED_AT_COLUMN_ID]: "updated_at",
};

export const toServerSortField = (columnId: string): string => COLUMN_ID_TO_SERVER_SORT_FIELD[columnId] ?? columnId;

const formatShortDate = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : formatCellDate(date, "date");
};

function ModelInformationCell({ model, displayName, t }: { model: ModelData; displayName: string; t: TFunction }) {
  const litellmModelName = model.litellm_model_name || "-";

  return (
    <HoverCard>
      <HoverCardTrigger
        render={
          <div className="flex min-w-0 items-center gap-2.5" data-testid={`model-information-${model.model_info.id}`} />
        }
      >
        {model.provider ? (
          <ProviderLogo provider={model.provider} className="size-6 shrink-0" />
        ) : (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
            -
          </span>
        )}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="max-w-60 truncate text-sm font-medium text-foreground" title={displayName}>
            {displayName}
          </span>
          <span className="max-w-60 truncate font-mono text-xs text-muted-foreground" title={litellmModelName}>
            {litellmModelName}
          </span>
        </span>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            {model.provider ? <ProviderLogo provider={model.provider} className="size-4 shrink-0" /> : null}
            <span className="truncate text-xs text-muted-foreground">
              {model.provider || t("modelManagement.unknownProvider")}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">{t("modelManagement.publicModelName")}</span>
            <span className="truncate text-sm font-medium text-foreground" title={displayName}>
              {displayName}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">{t("modelManagement.litellmModelName")}</span>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-mono text-sm text-foreground" title={litellmModelName}>
                {litellmModelName}
              </span>
              <button
                type="button"
                aria-label={t("modelManagement.copyLiteLlmModelName")}
                data-testid={`copy-litellm-model-name-${model.model_info.id}`}
                className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
                onClick={() => void copyToClipboard(litellmModelName, t("modelManagement.litellmModelNameCopied"))}
              >
                <Copy className="size-3.5" />
              </button>
            </span>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function CredentialsHeader({ t }: { t: TFunction }) {
  return (
    <span className="flex items-center gap-1">
      {t("modelManagement.credentials")}
      <HoverCard>
        <HoverCardTrigger
          render={
            <button
              type="button"
              aria-label={t("modelManagement.credentialTypes")}
              data-testid="credentials-header-info"
              className="cursor-pointer text-muted-foreground hover:text-foreground"
            />
          }
        >
          <Info className="size-3.5" />
        </HoverCardTrigger>
        <HoverCardContent align="start" className="w-80">
          <div className="flex flex-col gap-3">
            <span className="text-sm font-medium text-foreground">{t("modelManagement.credentialTypes")}</span>
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-sm font-medium text-info">
                <RefreshCw className="size-3.5" />
                {t("modelManagement.reusable")}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("modelManagement.reusableCredentialDescription")}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Pencil className="size-3.5" />
                {t("modelManagement.manual")}
              </span>
              <span className="text-xs text-muted-foreground">{t("modelManagement.manualCredentialDescription")}</span>
            </div>
          </div>
        </HoverCardContent>
      </HoverCard>
    </span>
  );
}

function CredentialsCell({ credentialName, t }: { credentialName: string | undefined; t: TFunction }) {
  if (!credentialName) {
    return (
      <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
        <Pencil className="size-3" />
        {t("modelManagement.manual")}
      </Badge>
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-info" title={credentialName}>
      <RefreshCw className="size-3 shrink-0" />
      <span className="truncate">{credentialName}</span>
    </span>
  );
}

function CreatedByCell({ model, t }: { model: ModelData; t: TFunction }) {
  const isConfigModel = !model.model_info?.db_model;
  const createdAt = formatShortDate(model.model_info.created_at);
  const primary = isConfigModel
    ? t("modelManagement.definedInConfig")
    : model.model_info.created_by || t("modelManagement.unknown");
  const secondaryForDbModel = createdAt ?? t("modelManagement.unknownDate");

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="max-w-44 truncate text-sm text-foreground" title={primary}>
        {primary}
      </span>
      <span className="truncate text-xs text-muted-foreground">{isConfigModel ? "-" : secondaryForDbModel}</span>
    </div>
  );
}

function CostsCell({ model, t }: { model: ModelData; t: TFunction }) {
  const { input_cost: inputCost, output_cost: outputCost } = model;

  if (inputCost == null && outputCost == null) {
    return <span className="text-sm text-muted-foreground">-</span>;
  }

  return (
    <CellTooltip
      content={t("modelManagement.costPerMillionTokens")}
      trigger={
        <div className="flex flex-col gap-0.5 whitespace-nowrap">
          {inputCost != null && (
            <span className="flex items-baseline gap-1.5">
              <span className="text-[10px] font-semibold tracking-wider text-muted-foreground">IN</span>
              <span className="text-xs font-medium tabular-nums text-foreground">${inputCost}</span>
            </span>
          )}
          {outputCost != null && (
            <span className="flex items-baseline gap-1.5">
              <span className="text-[10px] font-semibold tracking-wider text-muted-foreground">OUT</span>
              <span className="text-xs font-medium tabular-nums text-foreground">${outputCost}</span>
            </span>
          )}
        </div>
      }
    />
  );
}

function AccessGroupsCell({ accessGroups, t }: { accessGroups: string[] | null; t: TFunction }) {
  if (!accessGroups || accessGroups.length === 0) {
    return <span className="text-sm text-muted-foreground">-</span>;
  }

  const [first, ...overflow] = accessGroups;

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Badge variant="outline" className="max-w-36 truncate border-info/20 bg-info/10 font-normal text-info">
        {first}
      </Badge>
      {overflow.length > 0 && (
        <CellTooltip
          content={
            <div className="flex max-w-[280px] flex-col gap-0.5">
              {overflow.map((group) => (
                <span key={group}>{group}</span>
              ))}
            </div>
          }
          trigger={
            <Badge variant="outline" className="shrink-0 cursor-default font-normal">
              {t("modelManagement.moreCount", { count: overflow.length })}
            </Badge>
          }
        />
      )}
    </div>
  );
}

interface ModelRowActionsProps {
  model: ModelData;
  userRole: string;
  userID: string;
  isPausing: boolean;
  t: TFunction;
  onDeleteClick?: (modelId: string) => void;
  onTogglePauseClick?: (modelId: string, blocked: boolean) => void | Promise<void>;
}

function ModelRowActions({
  model,
  userRole,
  userID,
  isPausing,
  t,
  onDeleteClick,
  onTogglePauseClick,
}: ModelRowActionsProps) {
  const modelId = model.model_info?.id;
  const isConfigModel = !model.model_info?.db_model;
  const isAdmin = userRole === "Admin";
  const canEditModel = isAdmin || model.model_info?.created_by === userID;
  const isBlocked = model.model_info?.blocked === true;
  const isPauseToggleable = !isConfigModel && isAdmin && Boolean(onTogglePauseClick);

  const resolvePauseTooltip = (): string => {
    if (isConfigModel) {
      return t("modelManagement.configModelPauseUnavailable");
    }
    if (!isAdmin) {
      return t("modelManagement.adminPauseOnly");
    }
    return isBlocked ? t("modelManagement.resumeModelTooltip") : t("modelManagement.pauseModelTooltip");
  };

  const deleteTooltip = isConfigModel
    ? t("modelManagement.configModelDeleteUnavailable")
    : t("modelManagement.deleteModel");

  return (
    <div className="flex items-center justify-end gap-1.5">
      <span className="flex w-8 shrink-0 items-center justify-center">
        {isPausing ? (
          <Loader2
            className="size-4 animate-spin text-muted-foreground"
            data-testid={`model-pause-pending-${modelId}`}
          />
        ) : (
          <CellTooltip
            content={resolvePauseTooltip()}
            trigger={
              <span className="inline-flex">
                <Switch
                  size="sm"
                  checked={!isBlocked}
                  disabled={!isPauseToggleable}
                  aria-label={isBlocked ? t("modelManagement.resumeModel") : t("modelManagement.pauseModel")}
                  data-testid={`model-pause-toggle-${modelId}`}
                  onCheckedChange={(nextChecked) => {
                    if (isPauseToggleable && onTogglePauseClick && modelId) {
                      void onTogglePauseClick(modelId, !nextChecked);
                    }
                  }}
                />
              </span>
            }
          />
        )}
      </span>
      <CellTooltip
        content={deleteTooltip}
        trigger={
          <span className="inline-flex">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("modelManagement.deleteModel")}
              data-testid={`model-delete-${modelId}`}
              disabled={isConfigModel || !canEditModel}
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                if (onDeleteClick && modelId) {
                  onDeleteClick(modelId);
                }
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </span>
        }
      />
    </div>
  );
}

export interface ModelsTableColumnDeps {
  userRole: string;
  userID: string;
  t: TFunction;
  onModelIdClick: (modelId: string) => void;
  onTeamIdClick: (teamId: string) => void;
  onDeleteClick?: (modelId: string) => void;
  onTogglePauseClick?: (modelId: string, blocked: boolean) => void | Promise<void>;
  pausingModelId?: string | null;
}

export const getModelsTableColumns = ({
  userRole,
  userID,
  t,
  onModelIdClick,
  onTeamIdClick,
  onDeleteClick,
  onTogglePauseClick,
  pausingModelId,
}: ModelsTableColumnDeps): ColumnDef<ModelData>[] => [
  {
    id: MODEL_ID_COLUMN_ID,
    accessorFn: (row) => row.model_info.id,
    meta: { title: t("modelManagement.modelId") },
    header: t("modelManagement.modelId"),
    enableSorting: false,
    size: 140,
    minSize: 90,
    cell: ({ row }) => (
      <IdCell
        value={row.original.model_info.id}
        onClick={onModelIdClick}
        dataTestId={`model-id-${row.original.model_info.id}`}
      />
    ),
  },
  {
    id: MODEL_NAME_COLUMN_ID,
    accessorFn: (row) => row.model_name ?? "",
    meta: { title: t("modelManagement.modelInformation"), skeleton: "twoLine" },
    header: ({ column }) => <DataTableSortHeader column={column} title={t("modelManagement.modelInformation")} />,
    enableSorting: true,
    size: 280,
    minSize: 160,
    cell: ({ row }) => (
      <ModelInformationCell model={row.original} displayName={getDisplayModelName(row.original) || "-"} t={t} />
    ),
  },
  {
    id: CREDENTIALS_COLUMN_ID,
    accessorFn: (row) => row.litellm_params?.litellm_credential_name ?? "",
    meta: { title: t("modelManagement.credentials") },
    header: () => <CredentialsHeader t={t} />,
    enableSorting: false,
    size: 180,
    minSize: 110,
    cell: ({ row }) => <CredentialsCell credentialName={row.original.litellm_params?.litellm_credential_name} t={t} />,
  },
  {
    id: CREATED_BY_COLUMN_ID,
    accessorFn: (row) => row.model_info.created_by ?? "",
    meta: { title: t("modelManagement.createdBy"), skeleton: "twoLine" },
    header: ({ column }) => <DataTableSortHeader column={column} title={t("modelManagement.createdBy")} />,
    enableSorting: true,
    size: 180,
    minSize: 110,
    cell: ({ row }) => <CreatedByCell model={row.original} t={t} />,
  },
  {
    id: UPDATED_AT_COLUMN_ID,
    accessorFn: (row) => row.model_info.updated_at ?? "",
    meta: { title: t("modelManagement.updatedAt") },
    header: ({ column }) => <DataTableSortHeader column={column} title={t("modelManagement.updatedAt")} />,
    enableSorting: true,
    size: 140,
    minSize: 100,
    cell: ({ row }) => <DateCell value={row.original.model_info.updated_at} precision="date" />,
  },
  {
    id: COSTS_COLUMN_ID,
    accessorFn: (row) => row.input_cost,
    meta: { title: t("modelManagement.costs") },
    header: ({ column }) => <DataTableSortHeader column={column} title={t("modelManagement.costs")} />,
    enableSorting: true,
    size: 130,
    minSize: 90,
    cell: ({ row }) => <CostsCell model={row.original} t={t} />,
  },
  {
    id: TEAM_ID_COLUMN_ID,
    accessorFn: (row) => row.model_info.team_id ?? "",
    meta: { title: t("modelManagement.teamId") },
    header: t("modelManagement.teamId"),
    enableSorting: false,
    size: 140,
    minSize: 90,
    cell: ({ row }) => (
      <IdCell
        value={row.original.model_info.team_id}
        onClick={onTeamIdClick}
        dataTestId={`model-team-id-${row.original.model_info.id}`}
      />
    ),
  },
  {
    id: ACCESS_GROUPS_COLUMN_ID,
    accessorFn: (row) => row.model_info.access_groups ?? [],
    meta: { title: t("modelManagement.accessGroup"), skeleton: "chips" },
    header: t("modelManagement.accessGroup"),
    enableSorting: false,
    size: 200,
    minSize: 120,
    cell: ({ row }) => <AccessGroupsCell accessGroups={row.original.model_info.access_groups} t={t} />,
  },
  {
    id: STATUS_COLUMN_ID,
    accessorFn: (row) => row.model_info.db_model,
    meta: { title: t("modelManagement.statusColumn"), skeleton: "badge" },
    header: ({ column }) => <DataTableSortHeader column={column} title={t("modelManagement.statusColumn")} />,
    enableSorting: true,
    size: 140,
    minSize: 100,
    cell: ({ row }) =>
      row.original.model_info.db_model ? (
        <StatusBadge tone="info" label={t("modelManagement.dbModel")} />
      ) : (
        <StatusBadge tone="neutral" label={t("modelManagement.configModel")} />
      ),
  },
  {
    id: "actions",
    meta: { title: t("modelManagement.actions"), className: "text-right", headerClassName: "text-right" },
    header: t("modelManagement.actions"),
    enableSorting: false,
    enableHiding: false,
    enableResizing: false,
    size: 110,
    minSize: 110,
    cell: ({ row }) => (
      <ModelRowActions
        model={row.original}
        userRole={userRole}
        userID={userID}
        isPausing={pausingModelId === row.original.model_info?.id}
        t={t}
        onDeleteClick={onDeleteClick}
        onTogglePauseClick={onTogglePauseClick}
      />
    ),
  },
];
