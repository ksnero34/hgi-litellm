import React from "react";
import { useTranslation } from "react-i18next";
import { Table, Tooltip } from "antd";
import MessageManager from "@/components/molecules/message_manager";
import { EyeOutlined, CopyOutlined, DeleteOutlined } from "@ant-design/icons";
import { StatusBadge, type StatusTone } from "@/components/shared/table_cells";
import { DocumentUpload } from "@/components/vector_store_management/types";

interface DocumentsTableProps {
  documents: DocumentUpload[];
  onRemove: (uid: string) => void;
}

const DocumentsTable: React.FC<DocumentsTableProps> = ({ documents, onRemove }) => {
  const { t } = useTranslation();
  const handleCopyId = (uid: string) => {
    navigator.clipboard.writeText(uid);
    MessageManager.success(t("operations.vector.documents.idCopied"));
  };

  const getStatusBadge = (status: DocumentUpload["status"]) => {
    const statusConfig: Record<DocumentUpload["status"], { tone: StatusTone; label: string }> = {
      uploading: { tone: "info", label: t("operations.vector.documents.uploading") },
      done: { tone: "success", label: t("operations.vector.documents.ready") },
      error: { tone: "error", label: t("operations.vector.documents.error") },
      removed: { tone: "neutral", label: t("operations.vector.documents.removed") },
    };

    const config: { tone: StatusTone; label: string } = statusConfig[status] ?? { tone: "neutral", label: status };
    return <StatusBadge tone={config.tone} label={config.label} />;
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return "-";
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(2)} KB`;
    return `${(kb / 1024).toFixed(2)} MB`;
  };

  const columns = [
    {
      title: t("operations.vector.documents.name"),
      dataIndex: "name",
      key: "name",
      render: (name: string, record: DocumentUpload) => (
        <div className="flex items-center space-x-2">
          <span className="text-sm">{name}</span>
          {record.size && <span className="text-xs text-gray-400">({formatFileSize(record.size)})</span>}
        </div>
      ),
    },
    {
      title: t("operations.vector.documents.status"),
      dataIndex: "status",
      key: "status",
      width: 150,
      render: (status: DocumentUpload["status"]) => getStatusBadge(status),
    },
    {
      title: t("operations.vector.documents.actions"),
      key: "actions",
      width: 120,
      render: (_: any, record: DocumentUpload) => (
        <div className="flex items-center space-x-2">
          <Tooltip title={t("operations.vector.documents.viewDetails")}>
            <EyeOutlined className="cursor-pointer text-gray-600 hover:text-blue-500" onClick={() => {}} />
          </Tooltip>
          <Tooltip title={t("operations.vector.documents.copyId")}>
            <CopyOutlined
              className="cursor-pointer text-gray-600 hover:text-blue-500"
              onClick={() => handleCopyId(record.uid)}
            />
          </Tooltip>
          <Tooltip title={t("operations.vector.documents.remove")}>
            <DeleteOutlined
              className="cursor-pointer text-gray-600 hover:text-red-500"
              onClick={() => onRemove(record.uid)}
            />
          </Tooltip>
        </div>
      ),
    },
  ];

  return (
    <Table
      dataSource={documents}
      columns={columns}
      rowKey="uid"
      pagination={false}
      locale={{
        emptyText: t("operations.vector.documents.empty"),
      }}
      size="small"
    />
  );
};

export default DocumentsTable;
