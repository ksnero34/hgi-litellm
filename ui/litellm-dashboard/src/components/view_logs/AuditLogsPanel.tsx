import { useCallback, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ColumnFiltersState, OnChangeFn, PaginationState } from "@tanstack/react-table";
import moment from "moment";

import { uiAuditLogsCall } from "../networking";
import { AuditLogEntry } from "./AuditLogsTableColumns";
import { AuditLogsTable } from "./AuditLogsTable";
import { AuditLogDrawer } from "./AuditLogDrawer/AuditLogDrawer";

interface AuditLogsProps {
  accessToken: string | null;
  token: string | null;
  userRole: string | null;
  userID: string | null;
  isActive: boolean;
}

const PAGE_SIZE = 50;
const AUDIT_READER_ROLES = new Set(["Admin", "proxy_admin", "Admin Viewer", "proxy_admin_viewer"]);

const parseSuccessFilter = (value: string | undefined): boolean | undefined => {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return undefined;
};

interface AuditLogsResponse {
  audit_logs: AuditLogEntry[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export default function AuditLogsPanel({ userID, userRole, token, accessToken, isActive }: AuditLogsProps) {
  const { t } = useTranslation();
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: PAGE_SIZE });
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const getFilterValue = (columnId: string): string | undefined => {
    const entry = columnFilters.find((filter) => filter.id === columnId);
    return typeof entry?.value === "string" && entry.value.trim() ? entry.value.trim() : undefined;
  };

  const canReadAuditLogs = userRole !== null && AUDIT_READER_ROLES.has(userRole);
  const auditAuthParts = [accessToken, token, userRole, userID];
  const hasResolvedAuditAuth = auditAuthParts.every(Boolean);
  const canQueryAuditLogs = hasResolvedAuditAuth && isActive && canReadAuditLogs;
  const emptyAuditLogsResponse = {
    audit_logs: [],
    total: 0,
    page: 1,
    page_size: pagination.pageSize,
    total_pages: 0,
  } satisfies AuditLogsResponse;

  const auditLogsQueryOptions = {
    queryKey: ["audit_logs", pagination.pageIndex, pagination.pageSize, columnFilters],
    queryFn: async () => {
      if (!accessToken) {
        return emptyAuditLogsResponse;
      }
      const startDateFilter = getFilterValue("start_date");
      const endDateFilter = getFilterValue("end_date");
      const success = parseSuccessFilter(getFilterValue("success"));
      const queryParams = {
        object_id: getFilterValue("object_id"),
        changed_by: getFilterValue("changed_by"),
        object_key_hash: getFilterValue("key_hash"),
        object_team_id: getFilterValue("team_id"),
        action: getFilterValue("action"),
        table_name: getFilterValue("table_name"),
        start_date: startDateFilter
          ? moment.utc(startDateFilter, "YYYY-MM-DD").startOf("day").format("YYYY-MM-DD HH:mm:ss")
          : undefined,
        end_date: endDateFilter
          ? moment.utc(endDateFilter, "YYYY-MM-DD").endOf("day").format("YYYY-MM-DD HH:mm:ss")
          : undefined,
        success,
        sort_order: "desc" as const,
      };
      const auditLogsRequest = {
        accessToken,
        page: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
        params: queryParams,
      };

      return uiAuditLogsCall(auditLogsRequest);
    },
    enabled: canQueryAuditLogs,
    placeholderData: keepPreviousData,
  } satisfies Parameters<typeof useQuery<AuditLogsResponse>>[0];
  const query = useQuery<AuditLogsResponse>(auditLogsQueryOptions);

  const refreshAuditLogs = useCallback(() => {
    void query.refetch();
  }, [query]);

  const handleColumnFiltersChange = useCallback<OnChangeFn<ColumnFiltersState>>((updaterOrValue) => {
    setColumnFilters(updaterOrValue);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, []);

  const handleViewLog = useCallback((log: AuditLogEntry) => {
    setSelectedLog(log);
    setDrawerOpen(true);
  }, []);

  if (!canReadAuditLogs) {
    return (
      <div className="rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
        {t("observabilityExtra.audit.accessDenied")}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">{t("observabilityExtra.audit.title")}</h1>
      </div>

      {query.isError ? (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {t("observabilityExtra.audit.loadError", {
            error: query.error instanceof Error ? query.error.message : t("observabilityExtra.audit.unknownError"),
          })}
        </div>
      ) : null}

      <AuditLogsTable
        data={query.data?.audit_logs ?? []}
        rowCount={query.data?.total ?? 0}
        isLoading={query.isLoading}
        isRefreshing={query.isFetching}
        pagination={pagination}
        onPaginationChange={setPagination}
        columnFilters={columnFilters}
        onColumnFiltersChange={handleColumnFiltersChange}
        onRefresh={refreshAuditLogs}
        onViewLog={handleViewLog}
      />

      <AuditLogDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} log={selectedLog} />
    </>
  );
}
