"use client";

import { ColumnFiltersState, OnChangeFn, PaginationState } from "@tanstack/react-table";
import { ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  DataTable,
  DataTableFilterDrawer,
  DataTableFilterField,
  DataTableToolbar,
} from "@/components/shared/DataTable";
import { StatusBadge, type StatusTone } from "@/components/shared/table_cells";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { AUDIT_TABLE_NAME_DISPLAY, AuditLogEntry, getAuditLogsTableColumns } from "./AuditLogsTableColumns";

interface AuditLogsTableProps {
  data: AuditLogEntry[];
  rowCount: number;
  isLoading: boolean;
  isRefreshing: boolean;
  pagination: PaginationState;
  onPaginationChange: OnChangeFn<PaginationState>;
  columnFilters: ColumnFiltersState;
  onColumnFiltersChange: OnChangeFn<ColumnFiltersState>;
  onRefresh: () => void;
  onViewLog: (log: AuditLogEntry) => void;
}

const ALL_VALUE = "all";

const ACTION_TONE: Record<string, StatusTone> = {
  created: "success",
  updated: "info",
  deleted: "error",
  rotated: "warning",
};

const AUDIT_ACTION_LABEL_KEYS: Record<string, string> = {
  created: "observabilityExtra.audit.action.created",
  updated: "observabilityExtra.audit.action.updated",
  deleted: "observabilityExtra.audit.action.deleted",
  rotated: "observabilityExtra.audit.action.rotated",
};

const AUDIT_TABLE_LABEL_KEYS: Record<string, string> = {
  LiteLLM_VerificationToken: "observabilityExtra.audit.tableName.keys",
  LiteLLM_TeamTable: "observabilityExtra.audit.tableName.teams",
  LiteLLM_UserTable: "observabilityExtra.audit.tableName.users",
  LiteLLM_OrganizationTable: "observabilityExtra.audit.tableName.organizations",
  LiteLLM_ProxyModelTable: "observabilityExtra.audit.tableName.models",
};

function AuditLogsEmptyState({ filtered }: { filtered: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center gap-1 py-6">
      <div className="mb-1 flex size-10 items-center justify-center rounded-lg bg-muted">
        <ScrollText className="size-5 text-muted-foreground" />
      </div>
      <div className="text-sm font-medium text-foreground">
        {filtered
          ? t("observabilityExtra.audit.empty.noMatchingTitle")
          : t("observabilityExtra.audit.empty.noLogsTitle")}
      </div>
      <div className="max-w-xs text-center text-sm text-muted-foreground">
        {filtered
          ? t("observabilityExtra.audit.empty.noMatchingDescription")
          : t("observabilityExtra.audit.empty.noLogsDescription")}
      </div>
    </div>
  );
}

export function AuditLogsTable({
  data,
  rowCount,
  isLoading,
  isRefreshing,
  pagination,
  onPaginationChange,
  columnFilters,
  onColumnFiltersChange,
  onRefresh,
  onViewLog,
}: AuditLogsTableProps) {
  const { t, i18n } = useTranslation();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const getAuditActionLabel = (action: string): string => {
    const key = AUDIT_ACTION_LABEL_KEYS[action];
    return key ? t(key) : action;
  };

  const getAuditTableNameLabel = (tableName: string): string => {
    const key = AUDIT_TABLE_LABEL_KEYS[tableName];
    return key ? t(key) : AUDIT_TABLE_NAME_DISPLAY[tableName] ?? tableName;
  };

  const columns = useMemo(
    () =>
      getAuditLogsTableColumns({ onViewLog }).map((column) => {
        if (column.id === "updated_at") {
          return { ...column, header: t("observabilityExtra.audit.timestamp") };
        }
        if (column.id === "action") {
          return {
            ...column,
            header: t("observabilityExtra.audit.actionLabel"),
            cell: ({ row }: { row: { original: AuditLogEntry } }) => (
              <StatusBadge
                tone={ACTION_TONE[row.original.action] ?? "neutral"}
                label={getAuditActionLabel(row.original.action)}
              />
            ),
          };
        }
        if (column.id === "table_name") {
          return {
            ...column,
            header: t("observabilityExtra.audit.table"),
            cell: ({ row }: { row: { original: AuditLogEntry } }) => (
              <span className="text-sm">{getAuditTableNameLabel(row.original.table_name)}</span>
            ),
          };
        }
        if (column.id === "object_id") {
          return { ...column, header: t("observabilityExtra.audit.objectId") };
        }
        if (column.id === "changed_by") {
          return { ...column, header: t("observabilityExtra.audit.changedBy") };
        }
        if (column.id === "changed_by_api_key") {
          return { ...column, header: t("observabilityExtra.audit.apiKeyHash") };
        }
        return column;
      }),
    [i18n.resolvedLanguage, onViewLog, t],
  );

  const actionOptions = useMemo(
    () => [
      { label: t("observabilityExtra.audit.action.created"), value: "created" },
      { label: t("observabilityExtra.audit.action.updated"), value: "updated" },
      { label: t("observabilityExtra.audit.action.deleted"), value: "deleted" },
      { label: t("observabilityExtra.audit.action.rotated"), value: "rotated" },
    ],
    [i18n.resolvedLanguage, t],
  );

  const tableOptions = useMemo(
    () => [
      { label: getAuditTableNameLabel("LiteLLM_VerificationToken"), value: "LiteLLM_VerificationToken" },
      { label: getAuditTableNameLabel("LiteLLM_TeamTable"), value: "LiteLLM_TeamTable" },
      { label: getAuditTableNameLabel("LiteLLM_UserTable"), value: "LiteLLM_UserTable" },
      { label: getAuditTableNameLabel("LiteLLM_OrganizationTable"), value: "LiteLLM_OrganizationTable" },
      { label: getAuditTableNameLabel("LiteLLM_ProxyModelTable"), value: "LiteLLM_ProxyModelTable" },
    ],
    [i18n.resolvedLanguage, t],
  );

  const filterLabels = useMemo(
    () => ({
      object_id: t("observabilityExtra.audit.objectId"),
      changed_by: t("observabilityExtra.audit.changedBy"),
      team_id: t("observabilityExtra.audit.teamId"),
      key_hash: t("observabilityExtra.audit.keyHash"),
      action: t("observabilityExtra.audit.actionLabel"),
      table_name: t("observabilityExtra.audit.table"),
    }),
    [i18n.resolvedLanguage, t],
  );

  const formatFilterValue = (columnId: string, value: unknown): string => {
    const raw = String(value);
    if (columnId === "action") return getAuditActionLabel(raw);
    if (columnId === "table_name") return getAuditTableNameLabel(raw);
    return raw;
  };

  return (
    <DataTable
      data={data}
      columns={columns}
      getRowId={(row) => row.id}
      paginationMode="server"
      pagination={pagination}
      onPaginationChange={onPaginationChange}
      rowCount={rowCount}
      filterMode="server"
      columnFilters={columnFilters}
      onColumnFiltersChange={onColumnFiltersChange}
      isLoading={isLoading}
      loadingMessage={t("observabilityExtra.audit.loading")}
      noDataMessage={<AuditLogsEmptyState filtered={columnFilters.length > 0} />}
      size="compact"
      toolbar={(table) => (
        <>
          <DataTableToolbar
            table={table}
            onRefresh={onRefresh}
            isRefreshing={isRefreshing}
            onOpenFilters={() => setFiltersOpen(true)}
            filterLabels={filterLabels}
            formatFilterValue={formatFilterValue}
            showViewOptions={false}
          />
          <DataTableFilterDrawer
            table={table}
            open={filtersOpen}
            onOpenChange={setFiltersOpen}
            title={t("observabilityExtra.audit.filtersTitle")}
            description={t("observabilityExtra.audit.filtersDescription")}
          >
            {({ get, set }) => (
              <>
                <DataTableFilterField label={t("observabilityExtra.audit.objectId")}>
                  <Input
                    value={(get("object_id") as string) ?? ""}
                    onChange={(event) => set("object_id", event.target.value)}
                    placeholder={t("observabilityExtra.audit.enterObjectId")}
                  />
                </DataTableFilterField>
                <DataTableFilterField label={t("observabilityExtra.audit.changedBy")}>
                  <Input
                    value={(get("changed_by") as string) ?? ""}
                    onChange={(event) => set("changed_by", event.target.value)}
                    placeholder={t("observabilityExtra.audit.enterUserId")}
                  />
                </DataTableFilterField>
                <DataTableFilterField label={t("observabilityExtra.audit.teamId")}>
                  <Input
                    value={(get("team_id") as string) ?? ""}
                    onChange={(event) => set("team_id", event.target.value)}
                    placeholder={t("observabilityExtra.audit.enterTeamId")}
                  />
                </DataTableFilterField>
                <DataTableFilterField label={t("observabilityExtra.audit.keyHash")}>
                  <Input
                    value={(get("key_hash") as string) ?? ""}
                    onChange={(event) => set("key_hash", event.target.value)}
                    placeholder={t("observabilityExtra.audit.enterKeyHash")}
                  />
                </DataTableFilterField>
                <DataTableFilterField label={t("observabilityExtra.audit.actionLabel")}>
                  <Select
                    value={(get("action") as string) ?? ALL_VALUE}
                    onValueChange={(value) => set("action", value === ALL_VALUE ? undefined : value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("observabilityExtra.audit.allActions")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_VALUE}>{t("observabilityExtra.audit.allActions")}</SelectItem>
                      {actionOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </DataTableFilterField>
                <DataTableFilterField label={t("observabilityExtra.audit.table")}>
                  <Select
                    value={(get("table_name") as string) ?? ALL_VALUE}
                    onValueChange={(value) => set("table_name", value === ALL_VALUE ? undefined : value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("observabilityExtra.audit.allTables")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_VALUE}>{t("observabilityExtra.audit.allTables")}</SelectItem>
                      {tableOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </DataTableFilterField>
              </>
            )}
          </DataTableFilterDrawer>
        </>
      )}
    />
  );
}
