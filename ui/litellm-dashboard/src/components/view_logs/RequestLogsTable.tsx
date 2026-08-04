"use client";

import type { ColumnFiltersState, OnChangeFn, PaginationState, SortingState } from "@tanstack/react-table";
import { ScrollText } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { DataTable, DataTableFilterDrawer, DataTableToolbar } from "@/components/shared/DataTable";

import type { Team } from "../key_team_helpers/key_list";
import type { LogEntry } from "./columns";
import { LOG_FILTER_IDS, type LogsWindow } from "./log_filter_logic";
import { RequestLogsFilters } from "./RequestLogsFilters";
import { getRequestLogsTableColumns } from "./RequestLogsTableColumns";

interface RequestLogsTableProps {
  data: LogEntry[];
  rowCount: number;
  isLoading: boolean;
  isRefreshing: boolean;
  pagination: PaginationState;
  onPaginationChange: OnChangeFn<PaginationState>;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  columnFilters: ColumnFiltersState;
  onColumnFiltersChange: OnChangeFn<ColumnFiltersState>;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onRowClick: (log: LogEntry) => void;
  onKeyHashClick: (keyHash: string) => void;
  onSessionClick: (sessionId: string) => void;
  teams: Team[];
  logsWindow: LogsWindow;
  toolbarChildren?: ReactNode;
}

function RequestLogsEmptyState({ filtered }: { filtered: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center gap-1 py-6">
      <div className="mb-1 flex size-10 items-center justify-center rounded-lg bg-muted">
        <ScrollText className="size-5 text-muted-foreground" />
      </div>
      <div className="text-sm font-medium text-foreground">
        {filtered
          ? t("observabilityExtra.requestLogs.empty.noMatchingRequests")
          : t("observabilityExtra.requestLogs.empty.noRequestsYet")}
      </div>
      <div className="max-w-xs text-center text-sm text-muted-foreground">
        {filtered
          ? t("observabilityExtra.requestLogs.empty.noMatchingRequestsDescription")
          : t("observabilityExtra.requestLogs.empty.noRequestsYetDescription")}
      </div>
    </div>
  );
}

export function RequestLogsTable({
  data,
  rowCount,
  isLoading,
  isRefreshing,
  pagination,
  onPaginationChange,
  sorting,
  onSortingChange,
  columnFilters,
  onColumnFiltersChange,
  searchValue,
  onSearchChange,
  onRefresh,
  onRowClick,
  onKeyHashClick,
  onSessionClick,
  teams,
  logsWindow,
  toolbarChildren,
}: RequestLogsTableProps) {
  const { t, i18n } = useTranslation();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const columns = useMemo(() => {
    const deps = { onKeyHashClick, onSessionClick, t };
    return getRequestLogsTableColumns(deps);
  }, [i18n.resolvedLanguage, onKeyHashClick, onSessionClick, t]);

  const filterLabels = useMemo(
    () => ({
      [LOG_FILTER_IDS.TEAM_ID]: t("observabilityExtra.requestLogs.filters.teamId"),
      [LOG_FILTER_IDS.STATUS]: t("observabilityExtra.requestLogs.filters.status"),
      [LOG_FILTER_IDS.KEY_ALIAS]: t("observabilityExtra.requestLogs.filters.keyAlias"),
      [LOG_FILTER_IDS.END_USER]: t("observabilityExtra.requestLogs.filters.endUser"),
      [LOG_FILTER_IDS.ERROR_CODE]: t("observabilityExtra.requestLogs.filters.errorCode"),
      [LOG_FILTER_IDS.ERROR_MESSAGE]: t("observabilityExtra.requestLogs.filters.errorMessage"),
      [LOG_FILTER_IDS.KEY_HASH]: t("observabilityExtra.requestLogs.filters.keyHash"),
      [LOG_FILTER_IDS.SESSION_ID]: t("observabilityExtra.requestLogs.filters.sessionId"),
      [LOG_FILTER_IDS.MODEL_ID]: t("observabilityExtra.requestLogs.filters.model"),
      [LOG_FILTER_IDS.PUBLIC_MODEL_OR_SEARCH_TOOL]: t("observabilityExtra.requestLogs.filters.publicModelOrSearchTool"),
    }),
    [i18n.resolvedLanguage, t],
  );

  const formatFilterValue = (columnId: string, value: unknown): string => {
    const raw = String(value);
    if (columnId !== LOG_FILTER_IDS.STATUS) return raw;
    return raw === "failure"
      ? t("observabilityExtra.requestLogs.status.failure")
      : t("observabilityExtra.requestLogs.status.success");
  };

  const isFiltered = columnFilters.length > 0 || searchValue !== "";

  return (
    <DataTable
      data={data}
      columns={columns}
      getRowId={(row) => row.request_id}
      sortingMode="server"
      sorting={sorting}
      onSortingChange={onSortingChange}
      paginationMode="server"
      pagination={pagination}
      onPaginationChange={onPaginationChange}
      rowCount={rowCount}
      filterMode="server"
      columnFilters={columnFilters}
      onColumnFiltersChange={onColumnFiltersChange}
      isLoading={isLoading}
      loadingMessage={t("observabilityExtra.requestLogs.loading")}
      noDataMessage={<RequestLogsEmptyState filtered={isFiltered} />}
      size="compact"
      onRowClick={onRowClick}
      toolbar={(table) => (
        <>
          <DataTableToolbar
            table={table}
            searchValue={searchValue}
            onSearchChange={onSearchChange}
            searchPlaceholder={t("observabilityExtra.logs.searchRequestId")}
            onRefresh={onRefresh}
            isRefreshing={isRefreshing}
            onOpenFilters={() => setFiltersOpen(true)}
            filterLabels={filterLabels}
            formatFilterValue={formatFilterValue}
            showViewOptions={false}
          >
            {toolbarChildren}
          </DataTableToolbar>
          <DataTableFilterDrawer
            table={table}
            open={filtersOpen}
            onOpenChange={setFiltersOpen}
            title={t("observabilityExtra.requestLogs.filters.title")}
            description={t("observabilityExtra.requestLogs.filters.description")}
          >
            {({ get, set }) => <RequestLogsFilters get={get} set={set} teams={teams} logsWindow={logsWindow} />}
          </DataTableFilterDrawer>
        </>
      )}
    />
  );
}
