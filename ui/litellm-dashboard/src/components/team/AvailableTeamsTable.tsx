"use client";

import { SortingState } from "@tanstack/react-table";
import { Users } from "lucide-react";
import React, { useMemo, useState } from "react";

import { DataTable } from "@/components/shared/DataTable";

import { AvailableTeam, getAvailableTeamsTableColumns } from "./AvailableTeamsTableColumns";

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

interface AvailableTeamsTableProps {
  teams: AvailableTeam[];
  isLoading: boolean;
  onJoinTeam: (teamId: string) => void;
  translator: TranslateFn;
}

const DEFAULT_SORTING: SortingState = [{ id: "team_alias", desc: false }];

function EmptyState({ translator }: { translator: TranslateFn }) {
  return (
    <div className="flex flex-col items-center gap-1 py-6">
      <div className="mb-1 flex size-10 items-center justify-center rounded-lg bg-muted">
        <Users className="size-5 text-muted-foreground" />
      </div>
      <div className="text-sm font-medium text-foreground">
        {translator("access.teams.available.empty", { defaultValue: "No available teams to join" })}
      </div>
      <div className="text-sm text-muted-foreground">
        {translator("access.teams.available.emptyHelp", { defaultValue: "See how to set available teams" })}{" "}
        <a
          href="https://docs.litellm.ai/docs/proxy/self_serve#all-settings-for-self-serve--sso-flow"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline-offset-4 hover:underline"
        >
          {translator("access.teams.available.emptyLink", { defaultValue: "here" })}
        </a>
      </div>
    </div>
  );
}

const AvailableTeamsTable: React.FC<AvailableTeamsTableProps> = ({ teams, isLoading, onJoinTeam, translator }) => {
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);

  const columns = useMemo(() => getAvailableTeamsTableColumns({ onJoinTeam, translator }), [onJoinTeam, translator]);

  return (
    <DataTable
      data={teams}
      columns={columns}
      getRowId={(team, index) => team.team_id || String(index)}
      sortingMode="client"
      sorting={sorting}
      onSortingChange={setSorting}
      isLoading={isLoading}
      loadingMessage={translator("access.teams.table.loadingAvailable", { defaultValue: "Loading available teams..." })}
      noDataMessage={<EmptyState translator={translator} />}
      size="compact"
    />
  );
};

export default AvailableTeamsTable;
