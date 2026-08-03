import moment from "moment";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@tremor/react";
import { Alert, Select } from "antd";
import { internalUserRoles } from "../../utils/roles";
import { useTeams } from "@/app/(dashboard)/hooks/teams/useTeams";
import { useCurrentUser } from "@/app/(dashboard)/hooks/users/useCurrentUser";
import DeletedKeysPage from "../DeletedKeysPage/DeletedKeysPage";
import DeletedTeamsPage from "../DeletedTeamsPage/DeletedTeamsPage";
import { KeyResponse } from "../key_team_helpers/key_list";
import FilterComponent from "../molecules/filter";
import { keyInfoV1Call } from "../networking";
import KeyInfoView from "../templates/key_info_view";
import { createColumns, LogEntry, type LogsSortField } from "./columns";
import { AGENT_CALL_TYPES, MCP_CALL_TYPES } from "./constants";
import { getLogFilterOptions } from "./filter_options";
import { useLogFilterLogic, defaultFilters, type LogFilterState } from "./log_filter_logic";
import { LogDetailsDrawer } from "./LogDetailsDrawer";
import { LogsTableToolbar } from "./LogsTableToolbar";
import { DataTable } from "./table";
import { AntDLoadingSpinner } from "../ui/AntDLoadingSpinner";

interface SpendLogsTableProps {
  accessToken: string | null;
  token: string | null;
  userRole: string | null;
  userID: string | null;
  premiumUser: boolean;
}

export default function SpendLogsTable({ accessToken, token, userRole, userID }: SpendLogsTableProps) {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(50);

  // New state variables for Start and End Time
  const [startTime, setStartTime] = useState<string>(moment().subtract(24, "hours").format("YYYY-MM-DDTHH:mm"));
  const [endTime, setEndTime] = useState<string>(moment().format("YYYY-MM-DDTHH:mm"));

  const [isCustomDate, setIsCustomDate] = useState(false);
  const [filters, setFilters] = useState<LogFilterState>(defaultFilters);
  const [selectedKeyInfo, setSelectedKeyInfo] = useState<KeyResponse | null>(null);
  const [selectedKeyIdInfoView, setSelectedKeyIdInfoView] = useState<string | null>(null);
  const [logScope, setLogScope] = useState<"mine" | "team">("mine");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("request logs");
  const isScopedUser = internalUserRoles.includes(userRole || "");
  const { data: allTeams = [] } = useTeams();
  const { data: currentUser } = useCurrentUser();
  const managedTeamIds = useMemo(() => {
    const value = currentUser?.metadata?.litellm_sso_managed_team_ids;
    return new Set(Array.isArray(value) ? value.filter((teamId): teamId is string => typeof teamId === "string") : []);
  }, [currentUser?.metadata]);

  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const [sortBy, setSortBy] = useState<LogsSortField>("startTime");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const [selectedTimeInterval, setSelectedTimeInterval] = useState<{ value: number; unit: string }>({
    value: 24,
    unit: "hours",
  });

  const [isLiveTail, setIsLiveTail] = useState<boolean>(() => {
    const storedValue = sessionStorage.getItem("isLiveTail");
    // default to true if nothing is stored
    return storedValue !== null ? JSON.parse(storedValue) : true;
  });

  useEffect(() => {
    sessionStorage.setItem("isLiveTail", JSON.stringify(isLiveTail));
  }, [isLiveTail]);

  useEffect(() => {
    const fetchKeyInfo = async () => {
      if (selectedKeyIdInfoView && accessToken) {
        const keyData = await keyInfoV1Call(accessToken, selectedKeyIdInfoView);

        const keyResponse: KeyResponse = {
          ...keyData["info"],
          token: selectedKeyIdInfoView,
          api_key: selectedKeyIdInfoView,
        };
        setSelectedKeyInfo(keyResponse);
      }
    };
    fetchKeyInfo();
  }, [selectedKeyIdInfoView, accessToken]);

  const {
    logsQuery,
    filteredLogs,
    handleFilterChange,
    handleFilterReset: handleFilterResetFromHook,
  } = useLogFilterLogic({
    accessToken,
    token,
    userRole,
    userID,
    filters,
    setFilters,
    filterByCurrentUser: isScopedUser && logScope === "mine",
    selectedTeamId: isScopedUser && logScope === "team" ? selectedTeamId : null,
    scopeReady: !isScopedUser || logScope === "mine" || selectedTeamId !== null,
    activeTab,
    isLiveTail,
    startTime,
    endTime,
    pageSize,
    isCustomDate,
    setCurrentPage,
    sortBy,
    sortOrder,
    currentPage,
  });

  const handleFilterReset = useCallback(() => {
    handleFilterResetFromHook();
    setStartTime(moment().subtract(24, "hours").format("YYYY-MM-DDTHH:mm"));
    setEndTime(moment().format("YYYY-MM-DDTHH:mm"));
    setIsCustomDate(false);
    setSelectedTimeInterval({ value: 24, unit: "hours" });
    setCurrentPage(1);
  }, [handleFilterResetFromHook]);

  const handleSortChange = useCallback((newSortBy: LogsSortField, newSortOrder: "asc" | "desc") => {
    setSortBy(newSortBy);
    setSortOrder(newSortOrder);
    setCurrentPage(1);
  }, []);

  const columns = useMemo(
    () => createColumns({ sortBy, sortOrder, onSortChange: handleSortChange }, t),
    [sortBy, sortOrder, handleSortChange, t],
  );

  const filteredData = useMemo(() => {
    const searchedLogs = filteredLogs.data.filter((log) => {
      const matchesSearch =
        !searchTerm ||
        log.request_id.includes(searchTerm) ||
        log.model.includes(searchTerm) ||
        (log.user && log.user.includes(searchTerm));

      // No need for additional filtering since we're now handling this in the API call
      return matchesSearch;
    });

    const sessionCompositionById = searchedLogs.reduce<Record<string, { llm: number; agent: number; mcp: number }>>(
      (acc, log) => {
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
      },
      {},
    );

    // Build a single-pass map of session_id → representative request_id.
    // Prefers an LLM row over an MCP row as the representative.
    const sessionRepresentativeMap = new Map<string, { requestId: string; isMcp: boolean }>();
    for (const log of searchedLogs) {
      if (!log.session_id || (log.session_total_count || 1) <= 1) continue;
      const isMcp = MCP_CALL_TYPES.includes(log.call_type);
      const existing = sessionRepresentativeMap.get(log.session_id);
      if (!existing || (existing.isMcp && !isMcp)) {
        sessionRepresentativeMap.set(log.session_id, { requestId: log.request_id, isMcp });
      }
    }

    return (
      searchedLogs
        .map((log) => {
          const sessionComposition = log.session_id ? sessionCompositionById[log.session_id] : undefined;
          return {
            ...log,
            request_duration_ms: log.request_duration_ms,
            session_llm_count: sessionComposition?.llm ?? undefined,
            session_mcp_count: sessionComposition?.mcp ?? undefined,
            session_agent_count: sessionComposition?.agent ?? undefined,
            onKeyHashClick: (keyHash: string) => setSelectedKeyIdInfoView(keyHash),
            onSessionClick: (sessionId: string) => {
              if (sessionId) {
                setSelectedSessionId(sessionId);
                setSelectedLog(log);
                setIsDrawerOpen(true);
              }
            },
          };
        })
        // Deduplicate multi-call sessions using the pre-built map (O(1) per row).
        .filter((log) => {
          if (!log.session_id || (log.session_total_count || 1) <= 1) return true;
          return sessionRepresentativeMap.get(log.session_id)?.requestId === log.request_id;
        })
    );
  }, [filteredLogs.data, searchTerm]);

  // Keep the Fetch button busy until the table has actually committed the new
  // rows. `keepPreviousData` leaves logsQuery.isLoading false on refetch, so
  // without this the button clears while stale rows are still on screen.
  const deferredData = useDeferredValue(filteredData);
  const isStale = deferredData !== filteredData;
  const isButtonLoading = logsQuery.isFetching || isStale;
  const isRefiltering = logsQuery.isPlaceholderData;
  const isLogsLoading = logsQuery.isLoading || isRefiltering;

  if (!accessToken || !token || !userRole || !userID) {
    return (
      <div className="flex items-center justify-center h-64">
        <AntDLoadingSpinner size="large" />
      </div>
    );
  }

  const handleRowClick = (log: LogEntry) => {
    // Multi-call session row: open in the same right-side drawer (session mode)
    if (log.session_id && (log.session_total_count || 1) > 1) {
      setSelectedSessionId(log.session_id);
      setSelectedLog(log);
      setIsDrawerOpen(true);
      return;
    }
    // Single-call row: open the detail drawer
    setSelectedSessionId(null);
    setSelectedLog(log);
    setIsDrawerOpen(true);
  };

  return (
    <div className="w-full p-6 overflow-x-hidden box-border">
      <TabGroup defaultIndex={0} onIndexChange={(index) => setActiveTab(index === 0 ? "request logs" : "audit logs")}>
        <TabList>
          <Tab>{t("observability.logs.request_logs_tab")}</Tab>
          {isScopedUser ? <></> : <Tab>{t("observability.logs.deleted_keys_tab")}</Tab>}
          {isScopedUser ? <></> : <Tab>{t("observability.logs.deleted_teams_tab")}</Tab>}
        </TabList>
        <TabPanels>
          <TabPanel>
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-xl font-semibold">{t("observability.logs.request_logs_title")}</h1>
            </div>
            {isScopedUser && (
              <div className="grid grid-cols-1 gap-3 mb-4 md:grid-cols-2">
                <Select
                  value={logScope}
                  onChange={(value) => {
                    setLogScope(value);
                    setCurrentPage(1);
                  }}
                  options={[
                    { value: "mine", label: t("observability.logs.scope_mine") },
                    { value: "team", label: t("observability.logs.scope_team") },
                  ]}
                />
                {logScope === "team" && (
                  <Select
                    value={selectedTeamId}
                    onChange={(value) => {
                      setSelectedTeamId(value);
                      setCurrentPage(1);
                    }}
                    options={allTeams.map((team) => ({
                      value: team.team_id,
                      label: `${team.team_alias} (${t(
                        managedTeamIds.has(team.team_id)
                          ? "observability.usage.managed_department_team"
                          : "observability.usage.service_team",
                      )})`,
                    }))}
                    placeholder={t("observability.logs.select_team")}
                  />
                )}
              </div>
            )}
            {logsQuery.isError && (
              <Alert
                type="error"
                className="mb-4"
                message={t("observability.logs.load_failed")}
                description={logsQuery.error instanceof Error ? logsQuery.error.message : undefined}
                action={<button onClick={() => logsQuery.refetch()}>{t("observability.logs.retry")}</button>}
              />
            )}
            {selectedKeyInfo && selectedKeyIdInfoView && selectedKeyInfo.api_key === selectedKeyIdInfoView ? (
              <KeyInfoView
                keyId={selectedKeyIdInfoView}
                keyData={selectedKeyInfo}
                teams={allTeams}
                onClose={() => setSelectedKeyIdInfoView(null)}
                backButtonText={t("observability.logs.back_to_logs")}
              />
            ) : (
              <>
                <FilterComponent
                  options={getLogFilterOptions(accessToken, !isScopedUser)}
                  onApplyFilters={handleFilterChange}
                  onResetFilters={handleFilterReset}
                />
                <div className="bg-white rounded-lg shadow-sm w-full max-w-full box-border">
                  <LogsTableToolbar
                    searchTerm={searchTerm}
                    onSearchChange={setSearchTerm}
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
                    currentPage={currentPage}
                    onCurrentPageChange={setCurrentPage}
                    pageSize={pageSize}
                    isLoading={isLogsLoading}
                    isButtonLoading={isButtonLoading}
                    onRefetch={() => logsQuery.refetch()}
                    filteredLogs={filteredLogs}
                  />
                  <DataTable
                    columns={columns}
                    data={deferredData}
                    getRowId={(row) => row.request_id}
                    onRowClick={handleRowClick}
                    isLoading={isLogsLoading}
                  />
                </div>
              </>
            )}
          </TabPanel>
          {!isScopedUser && (
            <TabPanel>
              <DeletedKeysPage />
            </TabPanel>
          )}
          {!isScopedUser && (
            <TabPanel>
              <DeletedTeamsPage />
            </TabPanel>
          )}
        </TabPanels>
      </TabGroup>

      {/* Log Details Drawer */}
      <LogDetailsDrawer
        open={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          setSelectedSessionId(null);
        }}
        logEntry={selectedLog}
        sessionId={selectedSessionId}
        accessToken={accessToken}
        allLogs={filteredData}
        onSelectLog={setSelectedLog}
        startTime={moment(startTime).utc().format("YYYY-MM-DD HH:mm:ss")}
      />
    </div>
  );
}
