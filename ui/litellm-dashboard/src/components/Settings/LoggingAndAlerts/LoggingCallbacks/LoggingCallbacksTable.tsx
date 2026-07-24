import { Button } from "@tremor/react";
import type { TableProps } from "antd";
import { Table } from "antd";
import Title from "antd/es/typography/Title";
import React from "react";
import { StatusBadge, type StatusTone } from "@/components/shared/table_cells";
import TableIconActionButton from "../../../common_components/IconActionButton/TableIconActionButtons/TableIconActionButton";
import { AlertingObject } from "./types";
import { useTranslation } from "react-i18next";

type LoggingCallbacksProps = {
  callbacks: AlertingObject[];
  availableCallbacks?: Record<
    string,
    {
      litellm_callback_name: string;
      litellm_callback_params: string[];
      ui_callback_name: string;
    }
  >;
  onTest?: (callback: AlertingObject) => void | Promise<void>;
  onEdit?: (callback: AlertingObject) => void;
  onDelete?: (callback: AlertingObject) => void;
  onAdd?: () => void;
};

type CallbackRow = AlertingObject & {
  id?: string;
  mode?: "success" | "failure" | "info" | string;
};

export const LoggingCallbacksTable: React.FC<LoggingCallbacksProps> = ({
  callbacks,
  availableCallbacks = {},
  onTest = () => {},
  onEdit = () => {},
  onDelete = () => {},
  onAdd = () => {},
}) => {
  const { t } = useTranslation();
  const callbackModes = [
    { value: "success", label: t("settingsExtra.callbacks.success") },
    { value: "failure", label: t("settingsExtra.callbacks.failure") },
    { value: "success_and_failure", label: t("settingsExtra.callbacks.both") },
  ];
  const columns: TableProps<CallbackRow>["columns"] = [
    {
      title: <span className="font-medium text-gray-700">{t("settingsExtra.callbacks.name")}</span>,
      dataIndex: "name",
      key: "name",
      render: (_: string, record: CallbackRow) => {
        const id = record.name;
        const displayName = availableCallbacks[id]?.ui_callback_name || id;
        return <div className="font-medium text-gray-800">{displayName}</div>;
      },
    },
    {
      title: <span className="font-medium text-gray-700">{t("settingsExtra.callbacks.mode")}</span>,
      key: "mode",
      render: (_: unknown, record: CallbackRow) => {
        // Backend sends `type` (success | failure); legacy in-memory rows
        // from add-callback flow set `mode`. Read both so newly-added rows
        // and server-fetched rows both render correctly.
        const mode = record.type || record.mode || "success";
        const label = callbackModes.find((m) => m.value === mode)?.label || mode;
        const tone: StatusTone = mode === "success" ? "success" : mode === "failure" ? "error" : "info";
        return <StatusBadge tone={tone} label={label} />;
      },
      width: 240,
    },
    {
      title: (
        <span className="font-medium text-gray-700 text-right w-full block">{t("settingsExtra.common.actions")}</span>
      ),
      key: "actions",
      align: "right",
      render: (_: unknown, record: CallbackRow) => (
        <div className="flex justify-end gap-2">
          <TableIconActionButton
            variant="Test"
            tooltipText={t("settingsExtra.callbacks.test")}
            onClick={() => onTest(record)}
          />
          <TableIconActionButton
            variant="Edit"
            tooltipText={t("settingsExtra.callbacks.edit")}
            onClick={() => onEdit(record)}
          />
          <TableIconActionButton
            variant="Delete"
            tooltipText={t("settingsExtra.callbacks.delete")}
            onClick={() => onDelete(record)}
          />
        </div>
      ),
      width: 240,
    },
  ];
  return (
    <>
      <div className="w-full mt-4">
        <Button onClick={onAdd} className="mx-auto">
          {t("settingsExtra.callbacks.add")}
        </Button>
        <div className="flex justify-between items-center my-2">
          <Title level={4}>{t("settingsExtra.callbacks.active")}</Title>
        </div>
        {/* Empty state */}
        {callbacks.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="text-center">
              <h3 className="text-lg font-medium text-gray-700 mb-2">{t("settingsExtra.callbacks.empty")}</h3>
              <p className="text-gray-500">{t("settingsExtra.callbacks.emptyDescription")}</p>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <Table
              columns={columns}
              dataSource={callbacks as CallbackRow[]}
              // `generic_api` can appear as both a success and a failure
              // callback simultaneously — keying by `name` alone produced
              // duplicate React keys. Compose with type to keep keys unique.
              rowKey={(record) => `${record.name}-${record.type || record.mode || "success"}`}
              pagination={false}
              rowClassName={() => "hover:bg-gray-50"}
            />
          </div>
        )}
      </div>
    </>
  );
};
