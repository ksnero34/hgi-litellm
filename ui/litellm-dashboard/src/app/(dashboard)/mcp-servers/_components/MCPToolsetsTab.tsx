import React, { useState, useCallback } from "react";
import { Button, Text, Title } from "@tremor/react";
import { Modal, Form, Input, message, Spin } from "antd";
import { PlusIcon } from "@heroicons/react/outline";
import { SortingState } from "@tanstack/react-table";
import { useMCPToolsets } from "@/app/(dashboard)/hooks/mcpServers/useMCPToolsets";
import { useMCPServers } from "@/app/(dashboard)/hooks/mcpServers/useMCPServers";
import { useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/shared/DataTable";
import {
  createMCPToolset,
  updateMCPToolset,
  deleteMCPToolset,
  listMCPTools,
  getProxyBaseUrl,
} from "@/components/networking";
import { MCPToolset, MCPToolsetTool } from "@/components/mcp_tools/types";
import { displayToolName, getMCPToolsetTableColumns } from "./MCPToolsetTableColumns";
import { useTranslation } from "react-i18next";

interface MCPToolsetsTabProps {
  accessToken: string | null;
  userRole: string | null;
}

interface ToolsetFormValues {
  toolset_name: string;
  description?: string;
}

interface MCPToolListProps {
  serverId: string;
  serverName: string;
  accessToken: string | null;
  selectedTools: MCPToolsetTool[];
  onToggle: (tool: MCPToolsetTool) => void;
}

interface ToolEntry {
  name: string;
  description?: string;
}

function MCPToolList({ serverId, serverName, accessToken, selectedTools, onToggle }: MCPToolListProps) {
  const { t } = useTranslation();
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const selectedSet = new Set(selectedTools.filter((t) => t.server_id === serverId).map((t) => t.tool_name));

  const fetchTools = useCallback(async () => {
    if (!accessToken || tools.length > 0) return;
    setLoading(true);
    try {
      const result = await listMCPTools(accessToken, serverId);
      const toolList = Array.isArray(result) ? result : result?.tools ?? [];
      setTools(toolList.map((t: any) => ({ name: t.name ?? t.tool_name ?? t, description: t.description ?? "" })));
    } catch {
      setTools([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, serverId, tools.length]);

  const handleToggle = () => {
    if (!expanded) fetchTools();
    setExpanded(!expanded);
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
        onClick={handleToggle}
      >
        <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500 shrink-0" />
          {serverName}
          {selectedSet.size > 0 && (
            <span className="ml-1 text-xs text-purple-600 font-semibold">
              {t("toolsModels.mcp.toolsets.selectedCount", { count: selectedSet.size })}
            </span>
          )}
        </span>
        <span className="text-gray-400 text-xs">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="p-2">
          {loading ? (
            <div className="flex justify-center py-3">
              <Spin size="small" />
            </div>
          ) : tools.length === 0 ? (
            <p className="text-xs text-gray-400 px-2 py-2">{t("toolsModels.mcp.toolsets.noToolsForServer")}</p>
          ) : (
            <div className="flex flex-col gap-1">
              {tools.map((tool) => {
                const selected = selectedSet.has(tool.name);
                return (
                  <button
                    key={tool.name}
                    type="button"
                    onClick={() => onToggle({ server_id: serverId, tool_name: tool.name })}
                    className={`flex items-start justify-between px-3 py-2 rounded-lg text-left transition-colors ${
                      selected
                        ? "bg-purple-50 border border-purple-300"
                        : "bg-white border border-gray-100 hover:bg-gray-50"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm font-medium leading-tight ${selected ? "text-purple-800" : "text-gray-800"}`}
                      >
                        {tool.name}
                      </p>
                      {tool.description && (
                        <p className="text-xs text-gray-400 mt-0.5 leading-tight line-clamp-2">{tool.description}</p>
                      )}
                    </div>
                    {selected && <span className="text-purple-500 text-xs font-semibold ml-2 shrink-0 mt-0.5">✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface CreateToolsetModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, description: string | undefined, tools: MCPToolsetTool[]) => Promise<void>;
  accessToken: string | null;
  initialToolset?: MCPToolset;
}

function CreateToolsetModal({ open, onClose, onSave, accessToken, initialToolset }: CreateToolsetModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<ToolsetFormValues>();
  const [selectedTools, setSelectedTools] = useState<MCPToolsetTool[]>(initialToolset?.tools || []);
  const [saving, setSaving] = useState(false);
  const [serverSearch, setServerSearch] = useState("");
  const { data: mcpServers = [] } = useMCPServers();
  const serverPrefixById = React.useMemo(
    () => new Map(mcpServers.map((s) => [s.server_id, s.alias || s.server_name || s.server_id])),
    [mcpServers],
  );

  React.useEffect(() => {
    if (open) {
      form.setFieldsValue({
        toolset_name: initialToolset?.toolset_name || "",
        description: initialToolset?.description || "",
      });
      setSelectedTools(initialToolset?.tools || []);
      setServerSearch("");
    }
  }, [open, initialToolset]);

  const handleToggleTool = (tool: MCPToolsetTool) => {
    setSelectedTools((prev) => {
      const exists = prev.some((t) => t.server_id === tool.server_id && t.tool_name === tool.tool_name);
      return exists
        ? prev.filter((t) => !(t.server_id === tool.server_id && t.tool_name === tool.tool_name))
        : [...prev, tool];
    });
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await onSave(values.toolset_name, values.description, selectedTools);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const filteredServers = mcpServers.filter((s) => {
    const q = serverSearch.toLowerCase();
    return !q || (s.alias || "").toLowerCase().includes(q) || (s.server_name || "").toLowerCase().includes(q);
  });

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={initialToolset ? t("toolsModels.mcp.toolsets.editTitle") : t("toolsModels.mcp.toolsets.newTitle")}
      width={960}
      footer={null}
      forceRender
    >
      <Form form={form} layout="vertical" className="mt-2">
        <div className="flex gap-4 mb-4">
          <Form.Item
            label={t("toolsModels.mcp.toolsets.name")}
            name="toolset_name"
            rules={[{ required: true, message: t("toolsModels.mcp.toolsets.nameRequired") }]}
            className="flex-1 mb-0"
          >
            <Input placeholder={t("toolsModels.mcp.toolsets.namePlaceholder")} />
          </Form.Item>
          <Form.Item label={t("toolsModels.mcp.common.description")} name="description" className="flex-1 mb-0">
            <Input placeholder={t("toolsModels.mcp.toolsets.descriptionPlaceholder")} />
          </Form.Item>
        </div>
      </Form>

      <div className="flex gap-4 mt-2" style={{ minHeight: 360 }}>
        {/* Left panel: Available Tools */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <Text className="text-sm font-semibold text-gray-700">{t("toolsModels.mcp.toolsets.availableTools")}</Text>
          </div>
          <Input
            placeholder={t("toolsModels.mcp.toolsets.searchServers")}
            value={serverSearch}
            onChange={(e) => setServerSearch(e.target.value)}
            className="mb-2"
            allowClear
          />
          <div className="space-y-2 overflow-y-auto" style={{ maxHeight: 300 }}>
            {filteredServers.length === 0 ? (
              <Text className="text-gray-400 text-sm">
                {mcpServers.length === 0
                  ? t("toolsModels.mcp.toolsets.noServersConfigured")
                  : t("toolsModels.mcp.toolsets.noServerMatches")}
              </Text>
            ) : (
              filteredServers.map((server) => (
                <MCPToolList
                  key={server.server_id}
                  serverId={server.server_id}
                  serverName={server.alias || server.server_name || server.server_id}
                  accessToken={accessToken}
                  selectedTools={selectedTools}
                  onToggle={handleToggleTool}
                />
              ))
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="w-px bg-gray-200 shrink-0" />

        {/* Right panel: Your Toolset */}
        <div className="w-72 shrink-0">
          <Text className="text-sm font-semibold text-gray-700 mb-2 block">
            {t("toolsModels.mcp.toolsets.yourToolset")}{" "}
            <span className="text-xs font-normal text-gray-400">
              ({t("toolsModels.mcp.toolsets.toolCount", { count: selectedTools.length })})
            </span>
          </Text>
          <div className="space-y-1 overflow-y-auto" style={{ maxHeight: 340 }}>
            {selectedTools.length === 0 ? (
              <Text className="text-gray-400 text-sm">{t("toolsModels.mcp.toolsets.noToolsAdded")}</Text>
            ) : (
              selectedTools.map((tool, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleToggleTool(tool)}
                  className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg border border-purple-200 bg-purple-50 hover:bg-red-50 hover:border-red-200 group transition-colors"
                >
                  <div className="min-w-0 text-left">
                    <span className="text-xs font-medium text-purple-800 group-hover:text-red-600 truncate block">
                      {displayToolName(serverPrefixById.get(tool.server_id), tool.tool_name)}
                    </span>
                    <span className="text-[10px] text-purple-400 truncate block">{tool.server_id.slice(0, 8)}…</span>
                  </div>
                  <span className="ml-2 text-purple-300 group-hover:text-red-400 text-xs shrink-0">✕</span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-200">
        <Button variant="secondary" onClick={onClose}>
          {t("toolsModels.mcp.common.cancel")}
        </Button>
        <Button onClick={handleSubmit} loading={saving}>
          {initialToolset ? t("toolsModels.mcp.common.saveChanges") : t("toolsModels.mcp.toolsets.create")}
        </Button>
      </div>
    </Modal>
  );
}

function ToolsetUsageGuide() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const proxyBaseUrl = getProxyBaseUrl();

  const snippet = `{
  "mcpServers": {
    "my-toolset": {
      "url": "${proxyBaseUrl}/toolset/<toolset-name>/mcp",
      "headers": { "x-litellm-api-key": "Bearer <your-api-key>" }
    }
  }
}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 px-5 py-4">
      <p className="text-sm font-medium text-gray-700 mb-1">{t("toolsModels.mcp.toolsets.guide.title")}</p>
      <p className="text-sm text-gray-500 mb-3">
        {t("toolsModels.mcp.toolsets.guide.beforePath")}{" "}
        <span className="font-medium text-gray-700">{t("toolsModels.mcp.toolsets.guide.path")}</span>{" "}
        {t("toolsModels.mcp.toolsets.guide.afterPath")}
      </p>
      <div className="text-xs text-gray-400 mb-1">{t("toolsModels.mcp.toolsets.guide.configLabel")}</div>
      <div className="relative">
        <pre className="bg-white border border-gray-200 rounded-sm px-4 py-3 text-xs font-mono text-gray-700 overflow-x-auto leading-relaxed pr-14">
          {snippet}
        </pre>
        <button
          type="button"
          onClick={copy}
          className="absolute top-2 right-2 px-2 py-1 text-xs rounded-sm border bg-white hover:bg-gray-50 text-gray-400 hover:text-gray-600 border-gray-200 transition-colors"
        >
          {copied ? "✓" : t("toolsModels.mcp.common.copy")}
        </button>
      </div>
    </div>
  );
}

export function MCPToolsetsTab({ accessToken, userRole }: MCPToolsetsTabProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: toolsets = [], isLoading } = useMCPToolsets();
  const { data: mcpServers = [] } = useMCPServers();
  const [createOpen, setCreateOpen] = useState(false);
  const [editToolset, setEditToolset] = useState<MCPToolset | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isAdmin = userRole === "Admin" || userRole === "proxy_admin";

  const handleCreate = async (name: string, description: string | undefined, tools: MCPToolsetTool[]) => {
    if (!accessToken) return;
    await createMCPToolset(accessToken, { toolset_name: name, description, tools });
    message.success(t("toolsModels.mcp.toolsets.createdSuccess"));
    queryClient.invalidateQueries({ queryKey: ["mcpToolsets"] });
  };

  const handleUpdate = async (name: string, description: string | undefined, tools: MCPToolsetTool[]) => {
    if (!accessToken || !editToolset) return;
    await updateMCPToolset(accessToken, { toolset_id: editToolset.toolset_id, toolset_name: name, description, tools });
    message.success(t("toolsModels.mcp.toolsets.updatedSuccess"));
    queryClient.invalidateQueries({ queryKey: ["mcpToolsets"] });
    setEditToolset(null);
  };

  const handleDelete = async () => {
    if (!accessToken || !deleteId) return;
    setDeleting(true);
    try {
      await deleteMCPToolset(accessToken, deleteId);
      message.success(t("toolsModels.mcp.toolsets.deletedSuccess"));
      queryClient.invalidateQueries({ queryKey: ["mcpToolsets"] });
      setDeleteId(null);
    } finally {
      setDeleting(false);
    }
  };

  const serverPrefixById = React.useMemo(
    () => new Map(mcpServers.map((s) => [s.server_id, s.alias || s.server_name || s.server_id])),
    [mcpServers],
  );
  const [sorting, setSorting] = useState<SortingState>([]);
  const columns = React.useMemo(() => {
    const deps = {
      isAdmin,
      serverPrefixById,
      onEditClick: setEditToolset,
      onDeleteClick: setDeleteId,
    };
    return getMCPToolsetTableColumns(deps);
  }, [isAdmin, serverPrefixById]);

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <Title>{t("toolsModels.mcp.toolsets.title")}</Title>
          <Text className="text-gray-500 text-sm">{t("toolsModels.mcp.toolsets.description")}</Text>
        </div>
        {isAdmin && (
          <Button icon={PlusIcon} onClick={() => setCreateOpen(true)}>
            {t("toolsModels.mcp.toolsets.newTitle")}
          </Button>
        )}
      </div>

      <ToolsetUsageGuide />

      <DataTable
        data={toolsets}
        columns={columns}
        getRowId={(toolset, index) => toolset.toolset_id || String(index)}
        sortingMode="client"
        sorting={sorting}
        onSortingChange={setSorting}
        isLoading={isLoading}
        loadingMessage={t("toolsModels.mcp.toolsets.loading")}
        noDataMessage={t("toolsModels.mcp.toolsets.empty")}
        size="compact"
      />

      <CreateToolsetModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSave={handleCreate}
        accessToken={accessToken}
      />

      {editToolset && (
        <CreateToolsetModal
          open={!!editToolset}
          onClose={() => setEditToolset(null)}
          onSave={handleUpdate}
          accessToken={accessToken}
          initialToolset={editToolset}
        />
      )}

      <Modal
        open={!!deleteId}
        onCancel={() => setDeleteId(null)}
        onOk={handleDelete}
        okText={t("toolsModels.mcp.common.delete")}
        okButtonProps={{ danger: true, loading: deleting }}
        title={t("toolsModels.mcp.toolsets.deleteTitle")}
      >
        <p>{t("toolsModels.mcp.toolsets.deleteWarning")}</p>
      </Modal>
    </div>
  );
}
