"use client";

import { useOrganizations } from "@/app/(dashboard)/hooks/organizations/useOrganizations";
import { useTeamsTable } from "@/app/(dashboard)/hooks/teams/useTeams";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import {
  DataTable,
  DataTableFilterDrawer,
  DataTableFilterField,
  DataTableToolbar,
} from "@/components/shared/DataTable";
import { SearchSelect } from "@/components/shared/SearchSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEBOUNCE_WAIT_MS } from "@/utils/debounceConstants";
import { useDebouncedValue } from "@tanstack/react-pacer/debouncer";
import { ColumnFiltersState, OnChangeFn, PaginationState, SortingState } from "@tanstack/react-table";
import { Download } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Team } from "../key_team_helpers/key_list";
import { getTeamTableColumns, TEAM_TABLE_HIDDEN_COLUMNS } from "./teamTableColumns";
import { exportTeamsToCsv } from "./teamsCsvExport";

interface TeamsTableProps {
  userRole: string | null;
  userID: string | null;
  onSelectTeam: (team: Team) => void;
  onEditTeam: (team: Team) => void;
  onDeleteTeam: (team: Team) => void;
}

const DEFAULT_SORTING: SortingState = [{ id: "created_at", desc: true }];

const toSortOrder = (sorting: SortingState): "asc" | "desc" | undefined => {
  const active = sorting[0];
  if (!active) return undefined;
  return active.desc ? "desc" : "asc";
};

export function TeamsTable({ userRole, userID, onSelectTeam, onEditTeam, onDeleteTeam }: TeamsTableProps) {
  const { t } = useTranslation();
  const { data: fetchedOrganizations } = useOrganizations();
  const organizations = useMemo(() => fetchedOrganizations ?? [], [fetchedOrganizations]);
  const filterLabels = useMemo(
    () => ({
      org_id: t("access.teams.columns.organization", { defaultValue: "Organization" }),
      alias: t("access.teams.filters.alias", { defaultValue: "Team alias" }),
      team_id: t("access.teams.columns.teamId", { defaultValue: "Team ID" }),
    }),
    [t],
  );

  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const [tablePagination, setTablePagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [searchQuery] = useDebouncedValue(searchInput, { wait: DEBOUNCE_WAIT_MS });
  const { accessToken } = useAuthorized();

  const getFilterValue = useCallback(
    (columnId: string): string | undefined => {
      const entry = columnFilters.find((filter) => filter.id === columnId);
      return typeof entry?.value === "string" && entry.value.trim() ? entry.value.trim() : undefined;
    },
    [columnFilters],
  );

  const isAdminView = userRole === "Admin" || userRole === "Admin Viewer";

  const teamListOptions = useMemo(
    () => ({
      organizationID: getFilterValue("org_id"),
      team_alias: getFilterValue("alias"),
      teamID: getFilterValue("team_id"),
      search: searchQuery.trim() || undefined,
      searchTeamIdMatch: "prefix" as const,
      userID: isAdminView ? undefined : userID ?? undefined,
      sortBy: sorting[0]?.id,
      sortOrder: toSortOrder(sorting),
    }),
    [getFilterValue, searchQuery, isAdminView, userID, sorting],
  );

  const {
    data: teamsResponse,
    isPending: isLoading,
    isFetching,
    refetch,
  } = useTeamsTable(tablePagination.pageIndex + 1, tablePagination.pageSize, teamListOptions);

  const teamList = useMemo<Team[]>(() => teamsResponse?.teams ?? [], [teamsResponse]);
  const rowCount = teamsResponse?.total ?? 0;

  const handleSearchChange = useCallback((value: string) => {
    setOpenTeamId(null);
    setSearchInput(value);
    setTablePagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, []);

  const handleSortingChange = useCallback<OnChangeFn<SortingState>>((updaterOrValue) => {
    setOpenTeamId(null);
    setSorting(updaterOrValue);
    setTablePagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, []);

  const handleColumnFiltersChange = useCallback<OnChangeFn<ColumnFiltersState>>((updaterOrValue) => {
    setOpenTeamId(null);
    setColumnFilters(updaterOrValue);
    setTablePagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, []);

  const handleExportCsv = useCallback(async () => {
    if (!accessToken || isExporting) return;
    setIsExporting(true);
    try {
      await exportTeamsToCsv(accessToken, teamListOptions);
    } finally {
      setIsExporting(false);
    }
  }, [accessToken, isExporting, teamListOptions]);

  const columns = useMemo(() => {
    const columnDeps = {
      organizations,
      userRole,
      openTeamId,
      onOpenTeamIdChange: setOpenTeamId,
      onSelectTeam,
      onEditTeam,
      onDeleteTeam,
      t,
    };
    return getTeamTableColumns(columnDeps);
  }, [organizations, userRole, openTeamId, onSelectTeam, onEditTeam, onDeleteTeam, t]);

  const orgOptions = useMemo(
    () =>
      organizations
        .filter((org) => org.organization_id)
        .map((org) => {
          const id = org.organization_id as string;
          return { label: org.organization_alias || id, value: id, sublabel: org.organization_alias ? id : undefined };
        }),
    [organizations],
  );

  const formatFilterValue = useCallback(
    (columnId: string, value: unknown): string => {
      const raw = String(value);
      if (columnId === "org_id") {
        return organizations.find((org) => org.organization_id === raw)?.organization_alias || raw;
      }
      return raw;
    },
    [organizations],
  );

  return (
    <DataTable
      data={teamList}
      columns={columns}
      getRowId={(row) => row.team_id}
      defaultColumnVisibility={TEAM_TABLE_HIDDEN_COLUMNS}
      sortingMode="server"
      sorting={sorting}
      onSortingChange={handleSortingChange}
      paginationMode="server"
      pagination={tablePagination}
      onPaginationChange={(updaterOrValue) => {
        setOpenTeamId(null);
        setTablePagination(updaterOrValue);
      }}
      rowCount={rowCount}
      filterMode="server"
      columnFilters={columnFilters}
      onColumnFiltersChange={handleColumnFiltersChange}
      enableColumnResizing
      columnResizeMode="onChange"
      isLoading={isLoading}
      loadingMessage={t("access.teams.table.loading", { defaultValue: "Loading teams..." })}
      noDataMessage={t("access.teams.table.empty", { defaultValue: "No teams found" })}
      maxBodyHeight="calc(75vh - 210px)"
      size="compact"
      toolbar={(table) => (
        <>
          <DataTableToolbar
            table={table}
            searchValue={searchInput}
            onSearchChange={handleSearchChange}
            searchPlaceholder={t("access.teams.search.placeholder", {
              defaultValue: "Search teams by name, ID, organization, or model...",
            })}
            onRefresh={() => refetch?.()}
            isRefreshing={isFetching}
            onOpenFilters={() => setFiltersOpen(true)}
            filterLabels={filterLabels}
            formatFilterValue={formatFilterValue}
          >
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              disabled={isExporting}
              data-testid="teams-export-csv"
            >
              <Download />
              {isExporting ? "Exporting..." : "Export CSV"}
            </Button>
          </DataTableToolbar>
          <DataTableFilterDrawer
            table={table}
            open={filtersOpen}
            onOpenChange={setFiltersOpen}
            title={t("access.teams.filters.title", { defaultValue: "Filters" })}
            description={t("access.teams.filters.description", {
              defaultValue: "Filter teams by organization, alias, or team ID",
            })}
          >
            {({ get, set }) => (
              <>
                <DataTableFilterField label={t("access.teams.columns.organization", { defaultValue: "Organization" })}>
                  <SearchSelect
                    options={orgOptions}
                    value={(get("org_id") as string) || undefined}
                    onValueChange={(value) => set("org_id", value)}
                    placeholder={t("access.teams.filters.organizationPlaceholder", {
                      defaultValue: "Select an organization",
                    })}
                    emptyText={t("access.teams.filters.noOrganizations", { defaultValue: "No organizations found" })}
                  />
                </DataTableFilterField>
                <DataTableFilterField label={t("access.teams.filters.alias", { defaultValue: "Team alias" })}>
                  <Input
                    value={(get("alias") as string) ?? ""}
                    onChange={(event) => set("alias", event.target.value)}
                    placeholder={t("access.teams.filters.aliasPlaceholder", { defaultValue: "Enter team alias" })}
                  />
                </DataTableFilterField>
                <DataTableFilterField label={t("access.teams.columns.teamId", { defaultValue: "Team ID" })}>
                  <Input
                    value={(get("team_id") as string) ?? ""}
                    onChange={(event) => set("team_id", event.target.value)}
                    placeholder={t("access.teams.filters.teamIdPlaceholder", { defaultValue: "Enter team ID" })}
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
