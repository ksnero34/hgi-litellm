import { KeyResponse } from "@/components/key_team_helpers/key_list";
import { Empty, Table, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { SpinProps } from "antd";
import DefaultProxyAdminTag from "@/components/common_components/DefaultProxyAdminTag";
import { DateCell } from "@/components/shared/table_cells";
import { useTranslation } from "react-i18next";

interface ProjectKeysTableProps {
  keys: KeyResponse[];
  loading?: boolean | SpinProps;
}

const getColumns = (t: (key: string) => string): ColumnsType<KeyResponse> => [
  {
    title: t("access.projects.keys.keyName"),
    dataIndex: "key_alias",
    key: "key_alias",
    render: (alias: string | null) => alias || t("access.common.none"),
  },
  {
    title: t("access.projects.keys.owner"),
    key: "owner",
    render: (_: unknown, record: KeyResponse) => {
      const email = record.user?.user_email ?? record.user_id ?? null;
      if (!email) return t("access.common.none");
      return (
        <Tooltip title={email}>
          <DefaultProxyAdminTag userId={email} />
        </Tooltip>
      );
    },
  },
  {
    title: t("access.projects.keys.created"),
    dataIndex: "created_at",
    key: "created_at",
    render: (date: string) => <DateCell value={date} precision="date" />,
  },
  {
    title: t("access.projects.keys.lastActive"),
    dataIndex: "last_active",
    key: "last_active",
    render: (date: string | null) => <DateCell value={date} precision="date" fallback={t("access.common.never")} />,
  },
];

export function ProjectKeysTable({ keys, loading }: ProjectKeysTableProps) {
  const { t } = useTranslation();

  return (
    <Table
      columns={getColumns(t)}
      dataSource={keys}
      rowKey="token"
      loading={loading}
      pagination={false}
      size="small"
      locale={{
        emptyText: <Empty description={t("access.projects.keys.empty")} image={Empty.PRESENTED_IMAGE_SIMPLE} />,
      }}
    />
  );
}
