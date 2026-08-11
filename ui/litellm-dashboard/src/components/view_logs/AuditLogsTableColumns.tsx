"use client";

import { ColumnDef } from "@tanstack/react-table";

import { DateCell, IdCell, IdentityCell, StatusBadge, type StatusTone } from "@/components/shared/table_cells";

import DefaultProxyAdminTag from "../common_components/DefaultProxyAdminTag";

export type AuditLogEntry = {
  id: string;
  updated_at: string;
  changed_by: string;
  changed_by_api_key: string;
  action: string;
  table_name: string;
  object_id: string;
  before_value: Record<string, unknown> | null;
  updated_values: Record<string, unknown> | null;
};

const ACTION_TONE: Record<string, StatusTone> = {
  created: "success",
  updated: "info",
  deleted: "error",
  rotated: "warning",
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

const capitalize = (value: string): string => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

export const getAuditLogSuccess = (log: AuditLogEntry): boolean | null => {
  const updatedSuccess = log.updated_values?.success;
  if (typeof updatedSuccess === "boolean") {
    return updatedSuccess;
  }

  const beforeSuccess = log.before_value?.success;
  if (typeof beforeSuccess === "boolean") {
    return beforeSuccess;
  }

  return null;
};

interface AuditLogsTableColumnsDeps {
  onViewLog: (log: AuditLogEntry) => void;
  labels: {
    timestamp: string;
    action: string;
    resourceType: string;
    success: string;
    successSuccess: string;
    successFailure: string;
    successUnknown: string;
    resourceId: string;
    actor: string;
    apiKeyHash: string;
    getTableNameLabel: (tableName: string) => string;
  };
}

export const getAuditLogsTableColumns = ({
  onViewLog,
  labels,
}: AuditLogsTableColumnsDeps): ColumnDef<AuditLogEntry>[] => [
  {
    id: "updated_at",
    accessorKey: "updated_at",
    header: labels.timestamp,
    size: 200,
    enableSorting: false,
    cell: ({ row }) => <DateCell value={row.original.updated_at} />,
  },
  {
    id: "action",
    accessorKey: "action",
    header: labels.action,
    size: 110,
    enableSorting: false,
    cell: ({ row }) => (
      <StatusBadge tone={ACTION_TONE[row.original.action] ?? "neutral"} label={capitalize(row.original.action)} />
    ),
  },
  {
    id: "table_name",
    accessorKey: "table_name",
    header: labels.resourceType,
    size: 130,
    enableSorting: false,
    cell: ({ row }) => <span className="text-sm">{labels.getTableNameLabel(row.original.table_name)}</span>,
  },
  {
    id: "success",
    accessorFn: (row) => getAuditLogSuccess(row),
    header: labels.success,
    size: 110,
    enableSorting: false,
    cell: ({ row }) => {
      const success = getAuditLogSuccess(row.original);
      let successLabel = labels.successUnknown;
      if (success === true) {
        successLabel = labels.successSuccess;
      } else if (success === false) {
        successLabel = labels.successFailure;
      }
      return <StatusBadge tone={getSuccessTone(success)} label={successLabel} />;
    },
  },
  {
    id: "object_id",
    accessorKey: "object_id",
    header: labels.resourceId,
    minSize: 220,
    enableSorting: false,
    cell: ({ row }) => (
      <IdentityCell
        title={row.original.object_id}
        titleClassName="font-mono text-xs font-normal text-primary"
        className="max-w-72"
        onClick={() => onViewLog(row.original)}
      />
    ),
  },
  {
    id: "changed_by",
    accessorKey: "changed_by",
    header: labels.actor,
    size: 200,
    enableSorting: false,
    cell: ({ row }) => <DefaultProxyAdminTag userId={row.original.changed_by} />,
  },
  {
    id: "changed_by_api_key",
    accessorKey: "changed_by_api_key",
    header: labels.apiKeyHash,
    size: 160,
    enableSorting: false,
    cell: ({ row }) => <IdCell value={row.original.changed_by_api_key} variant="plain" />,
  },
];
