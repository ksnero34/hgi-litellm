import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { ColumnFiltersState, OnChangeFn, PaginationState, SortingState } from "@tanstack/react-table";
import moment from "moment";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@tremor/react";
import { Select } from "antd";

import { useTeams } from "@/app/(dashboard)/hooks/teams/useTeams";
import { useCurrentUser } from "@/app/(dashboard)/hooks/users/useCurrentUser";
import { AutoRouterModelGroupsProvider } from "@/components/shared/table_cells";

import { internalUserRoles } from "../../utils/roles";
import DeletedKeysPage from "../DeletedKeysPage/DeletedKeysPage";
import DeletedTeamsPage from "../DeletedTeamsPage/DeletedTeamsPage";
import type { KeyResponse, Team } from "../key_team_helpers/key_list";
import { keyInfoV1Call } from "../networking";
import KeyInfoView from "../templates/key_info_view";
import { AntDLoadingSpinner } from "../ui/AntDLoadingSpinner";
import type { LogEntry } from "./columns";
import { AGENT_CALL_TYPES, MCP_CALL_TYPES } from "./constants";
import { LogDetailsDrawer } from "./LogDetailsDrawer";
import { LiveTailBanner, LogsTableToolbar } from "./LogsTableToolbar";
import {
  DEFAULT_LOGS_SORTING,
  formatLogsWindow,
  getLogsWindowEndBound,
  LOG_FILTER_IDS,
  useLogFilterLogic,
} from "./log_filter_logic";
import RequestLogsPanel from "./RequestLogsPanel";
import { RequestLogsTable } from "./RequestLogsTable";
import AuditLogsPanel from "./AuditLogsPanel";

interface SpendLogsTableProps {
  accessToken: string | null;
  token: string | null;
  userRole: string | null;
  userID: string | null;
  premiumUser: boolean;
}

const AUDIT_READER_ROLES = new Set(["Admin", "proxy_admin", "Admin Viewer", "proxy_admin_viewer"]);

interface ScopedRequestLogsPanelProps {
  accessToken: string;
  token: string;
  userRole: string;
  userID: string;
}

interface SessionComposition {
  llm: number;
  agent: number;
  mcp: number;
}

const PAGE_SIZE = 50;
const DEFAULT_INTERVAL = { value: 24, unit: "hours" } as const;

const stripTeamFilter = (filters: ColumnFiltersState): ColumnFiltersState =>
  filters.filter((filter) => filter.id !== LOG_FILTER_IDS.TEAM_ID);

const withScopedTeamFilter = (
  filters: ColumnFiltersState,
  logScope: "mine" | "team",
  selectedTeamId: string | null,
): ColumnFiltersState => {
  const nextFilters = stripTeamFilter(filters);
  if (logScope !== "team" || selectedTeamId === null) return nextFilters;
  return [...nextFilters, { id: LOG_FILTER_IDS.TEAM_ID, value: selectedTeamId }];
};

const teamLabel = (team: Team, managedTeamIds: Set<string>, t: ReturnType<typeof useTranslation>["t"]) =>
  `${team.team_alias || team.team_id} (${t(
    managedTeamIds.has(team.team_id)
      ? "observability.usage.managed_department_team"
      : "observability.usage.service_team",
    { defaultValue: managedTeamIds.has(team.team_id) ? "Managed Team" : "Service Team" },
  )})`;

function ScopedRequestLogsPanel({ accessToken, token, userRole, userID }: ScopedRequestLogsPanelProps) {
  const { t } = useTranslation();
  const { data: scopedTeams = [] } = useTeams();
  const { data: currentUser } = useCurrentUser();
  const managedTeamIds = useMemo(() => {
    const value = currentUser?.metadata?.litellm_sso_managed_team_ids;
    return new Set(Array.isArray(value) ? value.filter((teamId): teamId is string => typeof teamId === "string") : []);
  }, [currentUser?.metadata]);

  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: PAGE_SIZE });
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_LOGS_SORTING);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const [startTime, setStartTime] = useState<string>(moment().subtract(24, "hours").format("YYYY-MM-DDTHH:mm"));
  const [endTime, setEndTime] = useState<string>(moment().format("YYYY-MM-DDTHH:mm"));
  const [isCustomDate, setIsCustomDate] = useState(false);
  const [selectedTimeInterval, setSelectedTimeInterval] = useState<{ value: number; unit: string }>(DEFAULT_INTERVAL);

  const [selectedKeyIdInfoView, setSelectedKeyIdInfoView] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const [logScope, setLogScope] = useState<"mine" | "team">("mine");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const [isLiveTail, setIsLiveTail] = useState<boolean>(() => {
    const storedValue = sessionStorage.getItem("isLiveTail");
    return storedValue !== null ? JSON.parse(storedValue) : true;
  });

  useEffect(() => {
    sessionStorage.setItem("isLiveTail", JSON.stringify(isLiveTail));
  }, [isLiveTail]);

  const effectiveColumnFilters = useMemo(
    () => withScopedTeamFilter(columnFilters, logScope, selectedTeamId),
    [columnFilters, logScope, selectedTeamId],
  );

  const activeTab = logScope === "team" && selectedTeamId === null ? "inactive" : "request logs";

  const { logsQuery, filteredLogs } = useLogFilterLogic({
    accessToken,
    token,
    userRole,
    userID,
    columnFilters: effectiveColumnFilters,
    filterByCurrentUser: logScope === "mine",
    activeTab,
    isLiveTail,
    startTime,
    endTime,
    pagination,
    isCustomDate,
    sorting,
  });

  const windowEndBound = getLogsWindowEndBound(logsQuery.dataUpdatedAt || Date.parse(endTime));
  const logsWindow = useMemo(
    () => formatLogsWindow(startTime, endTime, isCustomDate, windowEndBound),
    [startTime, endTime, isCustomDate, windowEndBound],
  );

  const keyInfoQueryOptions: UseQueryOptions<KeyResponse | null> = {
    queryKey: ["scopedRequestLogsKeyInfo", selectedKeyIdInfoView],
    queryFn: async () => {
      if (selectedKeyIdInfoView === null) return null;
      const keyData = await keyInfoV1Call(accessToken, selectedKeyIdInfoView);
      return {
        ...keyData["info"],
        token: selectedKeyIdInfoView,
        api_key: selectedKeyIdInfoView,
      };
    },
    enabled: selectedKeyIdInfoView !== null,
  };

  const { data: selectedKeyInfo } = useQuery(keyInfoQueryOptions);

  const rows = useMemo<LogEntry[]>(() => {
    const searchedLogs = filteredLogs.data;

    const sessionCompositionById = searchedLogs.reduce<Record<string, SessionComposition>>((acc, log) => {
      if (!log.session_id) return acc;
      if (!acc[log.session_id]) {
        acc[log.session_id] = { llm: 0, agent: 0, mcp: 0 };
      }
      if (MCP_CALL_TYPES.includes(log.call_type)) {
        acc[log.session_id].mcp += 1;
      } else if (AGENT_CALL_TYPES.includes(log.call_type)) {
        acc[log.session_id].agent += 1;
      } else {
        acc[log.session_id].llm += 1;
      }
      return acc;
    }, {});

    const sessionRepresentativeMap = new Map<string, { requestId: string; isMcp: boolean }>();
    for (const log of searchedLogs) {
      if (!log.session_id || (log.session_total_count || 1) <= 1) continue;
      const isMcp = MCP_CALL_TYPES.includes(log.call_type);
      const existing = sessionRepresentativeMap.get(log.session_id);
      if (!existing || (existing.isMcp && !isMcp)) {
        sessionRepresentativeMap.set(log.session_id, { requestId: log.request_id, isMcp });
      }
    }

    return searchedLogs
      .map((log) => {
        const sessionComposition = log.session_id ? sessionCompositionById[log.session_id] : undefined;
        return {
          ...log,
          session_llm_count: sessionComposition?.llm ?? undefined,
          session_mcp_count: sessionComposition?.mcp ?? undefined,
          session_agent_count: sessionComposition?.agent ?? undefined,
        };
      })
      .filter((log) => {
        if (!log.session_id || (log.session_total_count || 1) <= 1) return true;
        return sessionRepresentativeMap.get(log.session_id)?.requestId === log.request_id;
      });
  }, [filteredLogs.data]);

  const searchTerm = useMemo(() => {
    const entry = effectiveColumnFilters.find((filter) => filter.id === LOG_FILTER_IDS.REQUEST_ID);
    return typeof entry?.value === "string" ? entry.value : "";
  }, [effectiveColumnFilters]);

  const handleSearchChange = useCallback((value: string) => {
    setColumnFilters((previous) => {
      const others = previous.filter((filter) => filter.id !== LOG_FILTER_IDS.REQUEST_ID);
      return value === "" ? others : [...others, { id: LOG_FILTER_IDS.REQUEST_ID, value }];
    });
    setPagination((previous) => ({ ...previous, pageIndex: 0 }));
  }, []);

  const handleSortingChange = useCallback<OnChangeFn<SortingState>>((updaterOrValue) => {
    setSorting(updaterOrValue);
    setPagination((previous) => ({ ...previous, pageIndex: 0 }));
  }, []);

  const handleColumnFiltersChange = useCallback<OnChangeFn<ColumnFiltersState>>(
    (updaterOrValue) => {
      setColumnFilters((previous) => {
        const previousFilters = withScopedTeamFilter(previous, logScope, selectedTeamId);
        const nextFilters = typeof updaterOrValue === "function" ? updaterOrValue(previousFilters) : updaterOrValue;
        return stripTeamFilter(nextFilters);
      });
      setPagination((previous) => ({ ...previous, pageIndex: 0 }));
    },
    [logScope, selectedTeamId],
  );

  const resetToFirstPage = useCallback(() => {
    setPagination((previous) => ({ ...previous, pageIndex: 0 }));
  }, []);

  const handleResetFilters = useCallback(() => {
    setColumnFilters([]);
    setStartTime(moment().subtract(24, "hours").format("YYYY-MM-DDTHH:mm"));
    setEndTime(moment().format("YYYY-MM-DDTHH:mm"));
    setIsCustomDate(false);
    setSelectedTimeInterval(DEFAULT_INTERVAL);
    resetToFirstPage();
  }, [resetToFirstPage]);

  const handleRowClick = useCallback((log: LogEntry) => {
    const isMultiCallSession = log.session_id !== undefined && (log.session_total_count || 1) > 1;
    setSelectedSessionId(isMultiCallSession ? log.session_id ?? null : null);
    setSelectedLog(log);
    setIsDrawerOpen(true);
  }, []);

  const handleSessionClick = useCallback(
    (sessionId: string) => {
      if (!sessionId) return;
      const log = rows.find((candidate) => candidate.session_id === sessionId) ?? null;
      setSelectedSessionId(sessionId);
      setSelectedLog(log);
      setIsDrawerOpen(true);
    },
    [rows],
  );

  const handleKeyHashClick = useCallback((keyHash: string) => {
    setSelectedKeyIdInfoView(keyHash);
  }, []);

  const handleScopeChange = useCallback(
    (value: "mine" | "team") => {
      setLogScope(value);
      resetToFirstPage();
    },
    [resetToFirstPage],
  );

  const handleTeamChange = useCallback(
    (value: string) => {
      setSelectedTeamId(value);
      resetToFirstPage();
    },
    [resetToFirstPage],
  );

  if (selectedKeyInfo && selectedKeyIdInfoView && selectedKeyInfo.api_key === selectedKeyIdInfoView) {
    return (
      <KeyInfoView
        keyId={selectedKeyIdInfoView}
        keyData={selectedKeyInfo}
        teams={scopedTeams}
        onClose={() => setSelectedKeyIdInfoView(null)}
        backButtonText={t("observability.logs.back_to_logs", { defaultValue: "Back to Logs" })}
      />
    );
  }

  return (
    <AutoRouterModelGroupsProvider>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">
          {t("observability.logs.request_logs_title", { defaultValue: "Request Logs" })}
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-3 mb-4 md:grid-cols-2">
        <Select
          value={logScope}
          onChange={handleScopeChange}
          options={[
            { value: "mine", label: t("observability.logs.scope_mine", { defaultValue: "My Logs" }) },
            { value: "team", label: t("observability.logs.scope_team", { defaultValue: "Team Logs" }) },
          ]}
        />
        {logScope === "team" && (
          <Select
            value={selectedTeamId}
            onChange={handleTeamChange}
            options={scopedTeams.map((team) => ({
              value: team.team_id,
              label: teamLabel(team, managedTeamIds, t),
            }))}
            placeholder={t("observability.logs.select_team", { defaultValue: "Select a team" })}
          />
        )}
      </div>

      {isLiveTail && pagination.pageIndex === 0 && <LiveTailBanner onStop={() => setIsLiveTail(false)} />}

      <RequestLogsTable
        data={rows}
        rowCount={filteredLogs.total}
        isLoading={logsQuery.isLoading}
        isRefreshing={logsQuery.isFetching}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={handleSortingChange}
        columnFilters={effectiveColumnFilters}
        onColumnFiltersChange={handleColumnFiltersChange}
        searchValue={searchTerm}
        onSearchChange={handleSearchChange}
        onRefresh={() => void logsQuery.refetch()}
        onRowClick={handleRowClick}
        onKeyHashClick={handleKeyHashClick}
        onSessionClick={handleSessionClick}
        teams={scopedTeams}
        logsWindow={logsWindow}
        toolbarChildren={
          <LogsTableToolbar
            startTime={startTime}
            onStartTimeChange={setStartTime}
            endTime={endTime}
            onEndTimeChange={setEndTime}
            isCustomDate={isCustomDate}
            onIsCustomDateChange={setIsCustomDate}
            selectedTimeInterval={selectedTimeInterval}
            onSelectedTimeIntervalChange={setSelectedTimeInterval}
            isLiveTail={isLiveTail}
            onIsLiveTailChange={setIsLiveTail}
            onResetToFirstPage={resetToFirstPage}
            onResetFilters={handleResetFilters}
          />
        }
      />

      <LogDetailsDrawer
        open={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          setSelectedSessionId(null);
        }}
        logEntry={selectedLog}
        sessionId={selectedSessionId}
        accessToken={accessToken}
        allLogs={rows}
        onSelectLog={setSelectedLog}
        startTime={moment(startTime).utc().format("YYYY-MM-DD HH:mm:ss")}
      />
    </AutoRouterModelGroupsProvider>
  );
}

export default function SpendLogsTable({ accessToken, token, userRole, userID, premiumUser }: SpendLogsTableProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("request logs");
  const isScopedUser = internalUserRoles.includes(userRole ?? "");
  const canViewAuditLogs = userRole !== null && AUDIT_READER_ROLES.has(userRole);
  const handleTabChange = useCallback(
    (index: number) => {
      if (index === 0) {
        setActiveTab("request logs");
        return;
      }
      if (canViewAuditLogs && index === 1) {
        setActiveTab("audit logs");
        return;
      }
      setActiveTab("other");
    },
    [canViewAuditLogs],
  );

  if (!accessToken || !token || !userRole || !userID) {
    return (
      <div className="flex items-center justify-center h-64">
        <AntDLoadingSpinner size="large" />
      </div>
    );
  }

  if (isScopedUser) {
    return (
      <div className="w-full p-6 overflow-x-hidden box-border">
        <ScopedRequestLogsPanel accessToken={accessToken} token={token} userRole={userRole} userID={userID} />
      </div>
    );
  }

  return (
    <div className="w-full p-6 overflow-x-hidden box-border">
      {canViewAuditLogs ? (
        <TabGroup defaultIndex={0} onIndexChange={handleTabChange}>
          <TabList>
            <Tab>{t("observability.logs.request_logs_tab", { defaultValue: "Request Logs" })}</Tab>
            <Tab>{t("observabilityExtra.audit.title")}</Tab>
            <Tab>{t("observability.logs.deleted_keys_tab", { defaultValue: "Deleted Keys" })}</Tab>
            <Tab>{t("observability.logs.deleted_teams_tab", { defaultValue: "Deleted Teams" })}</Tab>
          </TabList>
          <TabPanels>
            <TabPanel>
              <RequestLogsPanel
                accessToken={accessToken}
                token={token}
                userRole={userRole}
                userID={userID}
                isActive={activeTab === "request logs"}
              />
            </TabPanel>
            <TabPanel>
              <AuditLogsPanel
                userID={userID}
                userRole={userRole}
                token={token}
                accessToken={accessToken}
                isActive={activeTab === "audit logs"}
              />
            </TabPanel>
            <TabPanel>
              <DeletedKeysPage />
            </TabPanel>
            <TabPanel>
              <DeletedTeamsPage />
            </TabPanel>
          </TabPanels>
        </TabGroup>
      ) : (
        <TabGroup defaultIndex={0} onIndexChange={handleTabChange}>
          <TabList>
            <Tab>{t("observability.logs.request_logs_tab", { defaultValue: "Request Logs" })}</Tab>
            <Tab>{t("observability.logs.deleted_keys_tab", { defaultValue: "Deleted Keys" })}</Tab>
            <Tab>{t("observability.logs.deleted_teams_tab", { defaultValue: "Deleted Teams" })}</Tab>
          </TabList>
          <TabPanels>
            <TabPanel>
              <RequestLogsPanel
                accessToken={accessToken}
                token={token}
                userRole={userRole}
                userID={userID}
                isActive={activeTab === "request logs"}
              />
            </TabPanel>
            <TabPanel>
              <DeletedKeysPage />
            </TabPanel>
            <TabPanel>
              <DeletedTeamsPage />
            </TabPanel>
          </TabPanels>
        </TabGroup>
      )}
    </div>
  );
}
