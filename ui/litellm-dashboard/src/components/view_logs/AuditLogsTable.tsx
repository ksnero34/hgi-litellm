"use client";

import { ColumnFiltersState, OnChangeFn, PaginationState } from "@tanstack/react-table";
import { ScrollText } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
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

import { AuditLogEntry, getAuditLogSuccess, getAuditLogsTableColumns } from "./AuditLogsTableColumns";
import {
  AUDIT_ACTION_FILTER_VALUES,
  AUDIT_ACTION_TONE,
  AUDIT_TABLE_FILTER_VALUES,
  getAuditActionLabel,
  getAuditTableNameLabel,
} from "./auditLogLabels";

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

const SUCCESS_VALUE_TO_LABEL_KEY: Record<"true" | "false", string> = {
  true: "observabilityExtra.audit.success.success",
  false: "observabilityExtra.audit.success.failure",
};

const getSuccessTone = (success: boolean | null): StatusTone => {
  if (success === true) {
    return "success";
  }
  if (success === false) {
    return "error";
  }
  return "neutral";
};

function AuditLogsEmptyState({ filtered }: { filtered: boolean }) {
  const { t } = useTranslation();
  const title = filtered
    ? t("observabilityExtra.audit.empty.noMatchingTitle")
    : t("observabilityExtra.audit.empty.noLogsTitle");
  const description = filtered
    ? t("observabilityExtra.audit.empty.noMatchingDescription")
    : t("observabilityExtra.audit.empty.noLogsDescription");

  return (
    <div className="flex flex-col items-center gap-1 py-6">
      <div className="mb-1 flex size-10 items-center justify-center rounded-lg bg-muted">
        <ScrollText className="size-5 text-muted-foreground" />
      </div>
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="max-w-xs text-center text-sm text-muted-foreground">{description}</div>
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
  const { t } = useTranslation();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const getActionLabel = useCallback((action: string): string => getAuditActionLabel(t, action), [t]);
  const getTableLabel = useCallback((tableName: string): string => getAuditTableNameLabel(t, tableName), [t]);

  const getSuccessLabel = useCallback(
    (success: boolean | null): string => {
      if (success === true) {
        return t("observabilityExtra.audit.success.success");
      }
      if (success === false) {
        return t("observabilityExtra.audit.success.failure");
      }
      return t("observabilityExtra.audit.success.unknown");
    },
    [t],
  );

  const columns = useMemo(
    () =>
      getAuditLogsTableColumns({
        onViewLog,
        labels: {
          timestamp: t("observabilityExtra.audit.timestamp"),
          action: t("observabilityExtra.audit.actionLabel"),
          resourceType: t("observabilityExtra.audit.resourceType"),
          success: t("observabilityExtra.audit.successLabel"),
          successSuccess: t("observabilityExtra.audit.success.success"),
          successFailure: t("observabilityExtra.audit.success.failure"),
          successUnknown: t("observabilityExtra.audit.success.unknown"),
          resourceId: t("observabilityExtra.audit.resourceId"),
          actor: t("observabilityExtra.audit.actor"),
          apiKeyHash: t("observabilityExtra.audit.apiKeyHash"),
          getTableNameLabel: getTableLabel,
        },
      }).map((column) => {
        if (column.id === "action") {
          return {
            ...column,
            cell: ({ row }: { row: { original: AuditLogEntry } }) => (
              <StatusBadge
                tone={(AUDIT_ACTION_TONE[row.original.action] ?? "neutral") as StatusTone}
                label={getActionLabel(row.original.action)}
              />
            ),
          };
        }
        if (column.id === "table_name") {
          return {
            ...column,
            cell: ({ row }: { row: { original: AuditLogEntry } }) => (
              <span className="text-sm">{getTableLabel(row.original.table_name)}</span>
            ),
          };
        }
        if (column.id === "success") {
          return {
            ...column,
            cell: ({ row }: { row: { original: AuditLogEntry } }) => {
              const success = getAuditLogSuccess(row.original);
              return <StatusBadge tone={getSuccessTone(success)} label={getSuccessLabel(success)} />;
            },
          };
        }
        return column;
      }),
    [getActionLabel, getSuccessLabel, getTableLabel, onViewLog, t],
  );

  const actionOptions = useMemo(
    () => AUDIT_ACTION_FILTER_VALUES.map((value) => ({ label: getActionLabel(value), value })),
    [getActionLabel],
  );

  const tableOptions = useMemo(
    () => AUDIT_TABLE_FILTER_VALUES.map((value) => ({ label: getTableLabel(value), value })),
    [getTableLabel],
  );

  const successOptions = useMemo(
    () => [
      { label: t("observabilityExtra.audit.success.success"), value: "true" },
      { label: t("observabilityExtra.audit.success.failure"), value: "false" },
    ],
    [t],
  );

  const filterLabels = useMemo(
    () => ({
      object_id: t("observabilityExtra.audit.resourceId"),
      changed_by: t("observabilityExtra.audit.actor"),
      team_id: t("observabilityExtra.audit.teamId"),
      key_hash: t("observabilityExtra.audit.keyHash"),
      action: t("observabilityExtra.audit.actionLabel"),
      table_name: t("observabilityExtra.audit.resourceType"),
      success: t("observabilityExtra.audit.successLabel"),
      start_date: t("observabilityExtra.audit.startDate"),
      end_date: t("observabilityExtra.audit.endDate"),
    }),
    [t],
  );

  const formatFilterValue = (columnId: string, value: unknown): string => {
    const raw = String(value);
    if (columnId === "action") return getActionLabel(raw);
    if (columnId === "table_name") return getTableLabel(raw);
    if (columnId === "success" && (raw === "true" || raw === "false")) {
      return t(SUCCESS_VALUE_TO_LABEL_KEY[raw]);
    }
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
                <DataTableFilterField label={t("observabilityExtra.audit.resourceId")}>
                  <Input
                    value={(get("object_id") as string) ?? ""}
                    onChange={(event) => set("object_id", event.target.value)}
                    placeholder={t("observabilityExtra.audit.enterResourceId")}
                  />
                </DataTableFilterField>
                <DataTableFilterField label={t("observabilityExtra.audit.actor")}>
                  <Input
                    value={(get("changed_by") as string) ?? ""}
                    onChange={(event) => set("changed_by", event.target.value)}
                    placeholder={t("observabilityExtra.audit.enterActor")}
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
                <DataTableFilterField label={t("observabilityExtra.audit.resourceType")}>
                  <Select
                    value={(get("table_name") as string) ?? ALL_VALUE}
                    onValueChange={(value) => set("table_name", value === ALL_VALUE ? undefined : value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("observabilityExtra.audit.allResourceTypes")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_VALUE}>{t("observabilityExtra.audit.allResourceTypes")}</SelectItem>
                      {tableOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </DataTableFilterField>
                <DataTableFilterField label={t("observabilityExtra.audit.successLabel")}>
                  <Select
                    value={(get("success") as string) ?? ALL_VALUE}
                    onValueChange={(value) => set("success", value === ALL_VALUE ? undefined : value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("observabilityExtra.audit.allResults")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_VALUE}>{t("observabilityExtra.audit.allResults")}</SelectItem>
                      {successOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </DataTableFilterField>
                <DataTableFilterField label={t("observabilityExtra.audit.startDate")}>
                  <Input
                    type="date"
                    value={(get("start_date") as string) ?? ""}
                    onChange={(event) => set("start_date", event.target.value)}
                    aria-label={t("observabilityExtra.audit.startDate")}
                  />
                </DataTableFilterField>
                <DataTableFilterField label={t("observabilityExtra.audit.endDate")}>
                  <Input
                    type="date"
                    value={(get("end_date") as string) ?? ""}
                    onChange={(event) => set("end_date", event.target.value)}
                    aria-label={t("observabilityExtra.audit.endDate")}
                  />
                </DataTableFilterField>
              </>
            )}
          </DataTableFilterDrawer>
        </>
      )}
    />
  );
}
