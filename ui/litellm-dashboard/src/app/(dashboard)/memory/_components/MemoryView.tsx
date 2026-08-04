"use client";

import { useDebouncedValue } from "@tanstack/react-pacer/debouncer";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PaginationState } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { MemoryRow, createMemory, deleteMemory, fetchMemoryList, updateMemory } from "@/components/networking";
import DeleteResourceModal from "@/components/common_components/DeleteResourceModal";
import MessageManager from "@/components/molecules/message_manager";
import { Button } from "@/components/ui/button";
import { DEBOUNCE_WAIT_MS } from "@/utils/debounceConstants";

import { MemoryDetailDrawer } from "./MemoryDetailDrawer";
import { MemoryEditModal } from "./MemoryEditModal";
import { MemoryTable } from "./MemoryTable";

interface MemoryViewProps {
  accessToken: string | null;
  userID: string | null;
  userRole: string | null;
}

const DEFAULT_PAGE_SIZE = 50;

export const MemoryView: React.FC<MemoryViewProps> = ({ accessToken }) => {
  const { t } = useTranslation();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch] = useDebouncedValue(searchInput, { wait: DEBOUNCE_WAIT_MS });
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: DEFAULT_PAGE_SIZE });
  const [detailRow, setDetailRow] = useState<MemoryRow | null>(null);
  const [editRow, setEditRow] = useState<MemoryRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<MemoryRow | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const queryClient = useQueryClient();
  const MEMORY_LIST_KEY = "memoryList" as const;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [MEMORY_LIST_KEY, debouncedSearch, pagination.pageIndex, pagination.pageSize],
    queryFn: () => {
      if (!accessToken) throw new Error("Access token required");
      return fetchMemoryList(accessToken, {
        keyPrefix: debouncedSearch || undefined,
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
      });
    },
    enabled: !!accessToken,
  });

  const rows = useMemo(() => data?.memories ?? [], [data]);
  const total = data?.total ?? 0;

  const invalidateList = useCallback(
    () => queryClient.invalidateQueries({ queryKey: [MEMORY_LIST_KEY] }),
    [queryClient],
  );

  const createMutation = useMutation({
    mutationFn: (args: { key: string; value: string; metadata: unknown }) => {
      if (!accessToken) throw new Error("Access token required");
      return createMemory(accessToken, args);
    },
    onSuccess: (row) => {
      MessageManager.success(t("interactionExtra.memory.created", { key: row.key }));
      invalidateList();
    },
    onError: (err: Error) => {
      MessageManager.error(t("interactionExtra.memory.saveFailed", { message: err.message }));
    },
  });

  const updateMutation = useMutation({
    mutationFn: (args: { key: string; value?: string; metadata: unknown }) => {
      if (!accessToken) throw new Error("Access token required");
      const { key, ...payload } = args;
      return updateMemory(accessToken, key, payload);
    },
    onSuccess: (row) => {
      MessageManager.success(t("interactionExtra.memory.updated", { key: row.key }));
      invalidateList();
    },
    onError: (err: Error) => {
      MessageManager.error(t("interactionExtra.memory.saveFailed", { message: err.message }));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (key: string) => {
      if (!accessToken) throw new Error("Access token required");
      return deleteMemory(accessToken, key).then(() => key);
    },
    onSuccess: (key) => {
      MessageManager.success(t("interactionExtra.memory.deleted", { key }));
      invalidateList();
    },
    onError: (err: Error) => {
      MessageManager.error(t("interactionExtra.memory.deleteFailed", { message: err.message }));
    },
  });

  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, []);

  const handleView = useCallback((row: MemoryRow) => setDetailRow(row), []);
  const handleEdit = useCallback((row: MemoryRow) => setEditRow(row), []);
  const handleDelete = useCallback((row: MemoryRow) => setDeleteRow(row), []);

  const confirmDelete = async () => {
    if (!deleteRow) return;
    try {
      await deleteMutation.mutateAsync(deleteRow.key);
      setDeleteRow(null);
    } catch {
      return;
    }
  };

  const handleSave = async (key: string, value: string, metadataText: string, isCreate: boolean): Promise<boolean> => {
    if (!accessToken) return false;

    let metadataPayload: unknown;
    if (!metadataText.trim()) {
      metadataPayload = isCreate ? undefined : null;
    } else {
      try {
        metadataPayload = JSON.parse(metadataText);
      } catch {
        MessageManager.error(t("interactionExtra.memory.invalidMetadata"));
        return false;
      }
    }

    try {
      if (isCreate) {
        await createMutation.mutateAsync({
          key,
          value,
          metadata: metadataPayload,
        });
      } else {
        await updateMutation.mutateAsync({
          key,
          value,
          metadata: metadataPayload,
        });
      }
      return true;
    } catch {
      return false;
    }
  };

  return (
    <div className="w-full p-6">
      <div className="flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{t("interactionExtra.memory.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("interactionExtra.memory.description")}</p>
          </div>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus />
            {t("interactionExtra.memory.new")}
          </Button>
        </div>

        <MemoryTable
          data={rows}
          isLoading={isLoading}
          rowCount={total}
          pagination={pagination}
          onPaginationChange={setPagination}
          searchValue={searchInput}
          onSearchChange={handleSearchChange}
          isRefreshing={isFetching && !isLoading}
          onRefresh={invalidateList}
          hasActiveSearch={!!debouncedSearch}
          onViewClick={handleView}
          onEditClick={handleEdit}
          onDeleteClick={handleDelete}
        />
      </div>

      <MemoryDetailDrawer row={detailRow} onClose={() => setDetailRow(null)} />

      <MemoryEditModal
        open={isCreateOpen || !!editRow}
        mode={editRow ? "edit" : "create"}
        initialRow={editRow ?? undefined}
        onClose={() => {
          setIsCreateOpen(false);
          setEditRow(null);
        }}
        onSave={handleSave}
      />

      <DeleteResourceModal
        isOpen={!!deleteRow}
        title={t("interactionExtra.memory.deleteTitle")}
        message={t("interactionExtra.memory.deleteMessage")}
        resourceInformationTitle={t("interactionExtra.memory.title")}
        resourceInformation={
          deleteRow
            ? [
                { label: t("interactionExtra.memory.key"), value: deleteRow.key, code: true },
                { label: t("interactionExtra.memory.id"), value: deleteRow.memory_id, code: true },
                { label: t("interactionExtra.memory.userId"), value: deleteRow.user_id ?? "-", code: true },
                { label: t("interactionExtra.memory.teamId"), value: deleteRow.team_id ?? "-", code: true },
              ]
            : []
        }
        onCancel={() => {
          if (!deleteMutation.isPending) setDeleteRow(null);
        }}
        onOk={confirmDelete}
        confirmLoading={deleteMutation.isPending}
        requiredConfirmation={deleteRow?.key}
      />
    </div>
  );
};

export default MemoryView;
