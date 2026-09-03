"use client";

import { SortingState } from "@tanstack/react-table";
import { Layers } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { DataTable } from "@/components/shared/DataTable";

import { getAccessGroupsTableColumns } from "./AccessGroupsTableColumns";
import { AccessGroup } from "./types";

interface AccessGroupsCopy {
  loading: string;
  emptyFilteredTitle: string;
  emptyTitle: string;
  emptyFilteredDescription: string;
  emptyDescription: string;
  id: string;
  name: string;
  resources: string;
  created: string;
  updated: string;
  models: string;
  mcpServers: string;
  agents: string;
  openActions: string;
  delete: string;
  actions: string;
}

interface AccessGroupsTableProps {
  groups: AccessGroup[];
  isLoading: boolean;
  isFiltered: boolean;
  canModify: boolean;
  onGroupClick: (id: string) => void;
  onDeleteClick: (group: AccessGroup) => void;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50];

function EmptyState({ isFiltered, copy }: { isFiltered: boolean; copy: AccessGroupsCopy }) {
  return (
    <div className="flex flex-col items-center gap-1 py-6">
      <div className="mb-1 flex size-10 items-center justify-center rounded-lg bg-muted">
        <Layers className="size-5 text-muted-foreground" />
      </div>
      <div className="text-sm font-medium text-foreground">
        {isFiltered ? copy.emptyFilteredTitle : copy.emptyTitle}
      </div>
      <div className="text-sm text-muted-foreground">
        {isFiltered ? copy.emptyFilteredDescription : copy.emptyDescription}
      </div>
    </div>
  );
}

export function AccessGroupsTable({
  groups,
  isLoading,
  isFiltered,
  canModify,
  onGroupClick,
  onDeleteClick,
}: AccessGroupsTableProps) {
  const { i18n } = useTranslation();
  const [sorting, setSorting] = useState<SortingState>([]);
  const currentLanguage = i18n.resolvedLanguage ?? i18n.language;

  const copy = useMemo<AccessGroupsCopy>(() => {
    const translate = i18n.getFixedT(currentLanguage);
    return {
      loading: translate("identityAdmin.accessGroups.loading", { defaultValue: "Loading access groups…" }),
      emptyFilteredTitle: translate("identityAdmin.accessGroups.empty.filteredTitle", {
        defaultValue: "No matching access groups",
      }),
      emptyTitle: translate("identityAdmin.accessGroups.empty.title", { defaultValue: "No access groups yet" }),
      emptyFilteredDescription: translate("identityAdmin.accessGroups.empty.filteredDescription", {
        defaultValue: "Try a different search term.",
      }),
      emptyDescription: translate("identityAdmin.accessGroups.empty.description", {
        defaultValue: "Create an access group to manage resource permissions for your organization.",
      }),
      id: translate("identityAdmin.accessGroups.id", { defaultValue: "ID" }),
      name: translate("identityAdmin.accessGroups.name", { defaultValue: "Name" }),
      resources: translate("identityAdmin.accessGroups.resources", { defaultValue: "Resources" }),
      created: translate("identityAdmin.accessGroups.created", { defaultValue: "Created" }),
      updated: translate("identityAdmin.accessGroups.updated", { defaultValue: "Updated" }),
      models: translate("identityAdmin.organization.models", { defaultValue: "Models" }),
      mcpServers: translate("identityAdmin.accessGroups.mcpServers", { defaultValue: "MCP Servers" }),
      agents: translate("identityAdmin.accessGroups.agents", { defaultValue: "Agents" }),
      openActions: translate("identityAdmin.accessGroups.openActions", { defaultValue: "Open access group actions" }),
      delete: translate("identityAdmin.accessGroups.delete", { defaultValue: "Delete access group" }),
      actions: translate("identityAdmin.users.actions", { defaultValue: "Actions" }),
    };
  }, [currentLanguage, i18n]);

  const columns = useMemo(() => {
    const deps = { copy, canModify, onGroupClick, onDeleteClick };
    return getAccessGroupsTableColumns(deps);
  }, [copy, canModify, onGroupClick, onDeleteClick]);

  return (
    <DataTable
      data={groups}
      columns={columns}
      getRowId={(group, index) => group.id || String(index)}
      sortingMode="client"
      sorting={sorting}
      onSortingChange={setSorting}
      paginationMode="client"
      pageSizeOptions={PAGE_SIZE_OPTIONS}
      isLoading={isLoading}
      loadingMessage={copy.loading}
      noDataMessage={<EmptyState isFiltered={isFiltered} copy={copy} />}
      size="compact"
    />
  );
}
