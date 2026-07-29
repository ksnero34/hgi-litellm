import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Table, Tag, Input, Select, Button, Pagination, Spin } from "antd";
import { ReloadOutlined, LoadingOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { resolveLogoSrc } from "@/lib/assetPaths";
import { DateCell, IdCell } from "@/components/shared/table_cells";
import { uiAuditLogsCall } from "../networking";
import { AuditLogEntry } from "./columns";
import { AuditLogDrawer } from "./AuditLogDrawer/AuditLogDrawer";
import DefaultProxyAdminTag from "../common_components/DefaultProxyAdminTag";

const { Search } = Input;

interface AuditLogsProps {
  accessToken: string | null;
  token: string | null;
  userRole: string | null;
  userID: string | null;
  isActive: boolean;
  premiumUser: boolean;
}

const asset_logos_folder = "/ui/assets/";
export const auditLogsPreviewImg = `${asset_logos_folder}audit-logs-preview.png`;

const TABLE_NAME_LABEL_KEYS: Record<string, string> = {
  LiteLLM_VerificationToken: "observability.logs.audit.table_keys",
  LiteLLM_TeamTable: "observability.logs.audit.table_teams",
  LiteLLM_UserTable: "observability.logs.audit.table_users",
  LiteLLM_OrganizationTable: "observability.logs.audit.table_organizations",
  LiteLLM_ProxyModelTable: "observability.logs.audit.table_models",
};

const ACTION_COLOR: Record<string, string> = {
  created: "green",
  updated: "blue",
  deleted: "red",
  rotated: "orange",
};

const ACTION_LABEL_KEYS: Record<string, string> = {
  created: "observability.logs.audit.action_created",
  updated: "observability.logs.audit.action_updated",
  deleted: "observability.logs.audit.action_deleted",
  rotated: "observability.logs.audit.action_rotated",
};

const PAGE_SIZE = 50;

export default function AuditLogs({ userID, userRole, token, accessToken, isActive, premiumUser }: AuditLogsProps) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);

  // Filter state
  const [objectId, setObjectId] = useState("");
  const [changedBy, setChangedBy] = useState("");
  const [keyHash, setKeyHash] = useState("");
  const [teamId, setTeamId] = useState("");
  const [action, setAction] = useState<string | undefined>(undefined);
  const [tableName, setTableName] = useState<string | undefined>(undefined);

  // Drawer state
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const query = useQuery({
    queryKey: ["audit_logs", page, PAGE_SIZE, objectId, changedBy, keyHash, teamId, action, tableName],
    queryFn: async () => {
      if (!accessToken || !token || !userRole || !userID) {
        return { audit_logs: [], total: 0, page: 1, page_size: PAGE_SIZE, total_pages: 0 };
      }
      return uiAuditLogsCall({
        accessToken,
        page,
        page_size: PAGE_SIZE,
        params: {
          object_id: objectId || undefined,
          changed_by: changedBy || undefined,
          object_key_hash: keyHash || undefined,
          object_team_id: teamId || undefined,
          action: action || undefined,
          table_name: tableName || undefined,
          sort_by: "updated_at",
          sort_order: "desc",
        },
      });
    },
    enabled: !!accessToken && !!token && !!userRole && !!userID && isActive,
    placeholderData: keepPreviousData,
  });

  const resetPage = () => setPage(1);

  const handleRowClick = (log: AuditLogEntry) => {
    setSelectedLog(log);
    setDrawerOpen(true);
  };

  const columns: ColumnsType<AuditLogEntry> = [
    {
      title: t("observability.logs.audit.timestamp"),
      dataIndex: "updated_at",
      key: "updated_at",
      width: 200,
      render: (val: string) => <DateCell value={val} />,
    },
    {
      title: t("observability.logs.audit.action"),
      dataIndex: "action",
      key: "action",
      width: 100,
      render: (val: string) => (
        <Tag color={ACTION_COLOR[val] ?? "default"} className="capitalize">
          {t(ACTION_LABEL_KEYS[val] ?? "", { defaultValue: val })}
        </Tag>
      ),
    },
    {
      title: t("observability.logs.audit.table"),
      dataIndex: "table_name",
      key: "table_name",
      width: 130,
      render: (val: string) => t(TABLE_NAME_LABEL_KEYS[val] ?? "", { defaultValue: val }),
    },
    {
      title: t("observability.logs.audit.object_id"),
      dataIndex: "object_id",
      key: "object_id",
      render: (val: string) => <IdCell value={val} variant="plain" truncate={false} />,
    },
    {
      title: t("observability.logs.audit.changed_by"),
      dataIndex: "changed_by",
      key: "changed_by",
      width: 200,
      render: (val: string) => <DefaultProxyAdminTag userId={val} />,
    },
    {
      title: t("observability.logs.audit.api_key_hash"),
      dataIndex: "changed_by_api_key",
      key: "changed_by_api_key",
      width: 140,
      render: (val: string) => <IdCell value={val} variant="plain" />,
    },
  ];

  if (!premiumUser) {
    return (
      <div style={{ textAlign: "center", marginTop: "20px" }}>
        <h1 style={{ display: "block", marginBottom: "10px" }}>
          ✨ {t("observability.logs.audit.enterprise_feature")}
        </h1>
        <p style={{ display: "block", marginBottom: "10px" }}>{t("observability.logs.audit.enterprise_description")}</p>
        <p style={{ display: "block", marginBottom: "20px", fontStyle: "italic" }}>
          {t("observability.logs.audit.preview_intro")}
        </p>
        <img
          src={resolveLogoSrc(auditLogsPreviewImg)}
          alt="Audit Logs Preview"
          style={{
            maxWidth: "100%",
            maxHeight: "700px",
            borderRadius: "8px",
            boxShadow: "0 4px 8px rgba(0,0,0,0.1)",
            margin: "0 auto",
          }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
    );
  }

  const auditLogs: AuditLogEntry[] = query.data?.audit_logs ?? [];
  const total: number = query.data?.total ?? 0;

  return (
    <>
      <div className="bg-white rounded-lg shadow-sm">
        {/* Header */}
        <div className="border-b px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-semibold">{t("observability.logs.audit.title")}</h1>
          </div>

          {/* Filters + pagination on same row */}
          <div className="flex flex-wrap items-center gap-3">
            <Search
              placeholder={t("observability.logs.audit.placeholder_object_id")}
              allowClear
              style={{ width: 200 }}
              onSearch={(val) => {
                setObjectId(val);
                resetPage();
              }}
              onChange={(e) => {
                if (!e.target.value) {
                  setObjectId("");
                  resetPage();
                }
              }}
            />
            <Search
              placeholder={t("observability.logs.audit.placeholder_changed_by")}
              allowClear
              style={{ width: 180 }}
              onSearch={(val) => {
                setChangedBy(val);
                resetPage();
              }}
              onChange={(e) => {
                if (!e.target.value) {
                  setChangedBy("");
                  resetPage();
                }
              }}
            />
            <Search
              placeholder={t("observability.logs.audit.placeholder_team_id")}
              allowClear
              style={{ width: 180 }}
              onSearch={(val) => {
                setTeamId(val);
                resetPage();
              }}
              onChange={(e) => {
                if (!e.target.value) {
                  setTeamId("");
                  resetPage();
                }
              }}
            />
            <Search
              placeholder={t("observability.logs.audit.placeholder_key_hash")}
              allowClear
              style={{ width: 180 }}
              onSearch={(val) => {
                setKeyHash(val);
                resetPage();
              }}
              onChange={(e) => {
                if (!e.target.value) {
                  setKeyHash("");
                  resetPage();
                }
              }}
            />
            <Select
              placeholder={t("observability.logs.audit.all_actions")}
              allowClear
              style={{ width: 140 }}
              options={[
                { label: t("observability.logs.audit.action_created"), value: "created" },
                { label: t("observability.logs.audit.action_updated"), value: "updated" },
                { label: t("observability.logs.audit.action_deleted"), value: "deleted" },
                { label: t("observability.logs.audit.action_rotated"), value: "rotated" },
              ]}
              onChange={(val) => {
                setAction(val);
                resetPage();
              }}
            />
            <Select
              placeholder={t("observability.logs.audit.all_tables")}
              allowClear
              style={{ width: 150 }}
              options={[
                { label: t("observability.logs.audit.table_keys"), value: "LiteLLM_VerificationToken" },
                { label: t("observability.logs.audit.table_teams"), value: "LiteLLM_TeamTable" },
                { label: t("observability.logs.audit.table_users"), value: "LiteLLM_UserTable" },
                { label: t("observability.logs.audit.table_organizations"), value: "LiteLLM_OrganizationTable" },
                { label: t("observability.logs.audit.table_models"), value: "LiteLLM_ProxyModelTable" },
              ]}
              onChange={(val) => {
                setTableName(val);
                resetPage();
              }}
            />

            {/* Pagination + refresh pushed to the right */}
            <div className="ml-auto flex items-center gap-2">
              <Button
                icon={<ReloadOutlined spin={query.isFetching} />}
                onClick={() => query.refetch()}
                disabled={query.isFetching}
              />
              <Pagination
                current={page}
                pageSize={PAGE_SIZE}
                total={total}
                showTotal={(count) => t("observability.logs.audit.total_count", { count })}
                showSizeChanger={false}
                size="small"
                onChange={(p) => setPage(p)}
              />
            </div>
          </div>
        </div>

        {/* Table — pagination handled in header */}
        <Table<AuditLogEntry>
          columns={columns}
          dataSource={auditLogs}
          rowKey="id"
          loading={{
            spinning: query.isLoading,
            indicator: <Spin indicator={<LoadingOutlined spin />} size="small" />,
          }}
          size="small"
          pagination={false}
          onRow={(record) => ({
            onClick: () => handleRowClick(record),
            style: { cursor: "pointer" },
          })}
        />
      </div>

      <AuditLogDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} log={selectedLog} />
    </>
  );
}
