import { Drawer, Tag, Typography } from "antd";
import { CheckOutlined, CloseOutlined, CopyOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import moment from "moment";

import DefaultProxyAdminTag from "../../common_components/DefaultProxyAdminTag";
import { uiAuditLogByIdCall } from "../../networking";
import { AuditLogEntry, getAuditLogSuccess } from "../AuditLogsTableColumns";
import { AUDIT_ACTION_TONE, getAuditActionLabel, getAuditTableNameLabel } from "../auditLogLabels";

const { Text } = Typography;

interface AuditLogDrawerProps {
  open: boolean;
  onClose: () => void;
  log: AuditLogEntry | null;
  accessToken: string | null;
}

const ACTION_COLOR: Record<string, string> = {
  success: "green",
  info: "blue",
  error: "red",
  warning: "orange",
  neutral: "default",
};

const getSuccessLabel = (success: boolean | null, t: ReturnType<typeof useTranslation>["t"]): string => {
  if (success === true) {
    return t("observabilityExtra.audit.success.success");
  }
  if (success === false) {
    return t("observabilityExtra.audit.success.failure");
  }
  return t("observabilityExtra.audit.success.unknown");
};

function CopyableJsonBlock({ label, value }: { label: string; value: Record<string, unknown> }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      const text = JSON.stringify(value, null, 2);
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const el = document.createElement("textarea");
        el.value = text;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.focus();
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Copy failed:", e);
    }
  }, [value]);

  return (
    <div className="overflow-hidden rounded-sm border bg-white">
      <div className="flex items-center justify-between border-b bg-gray-50 px-3 py-2">
        <span className="text-xs font-semibold text-gray-600">{label}</span>
        <button
          onClick={handleCopy}
          className="rounded-sm p-1 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700"
          title={t("observabilityExtra.audit.copyJson")}
        >
          {copied ? <CheckOutlined className="text-green-600" /> : <CopyOutlined />}
        </button>
      </div>
      <pre className="m-0 max-h-96 overflow-auto whitespace-pre-wrap break-all bg-white p-3 font-mono text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function MetadataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="w-36 shrink-0 text-xs text-gray-500">{label}</span>
      <span className="break-all text-xs text-gray-900">{value}</span>
    </div>
  );
}

function renderEmptyBlock(label: string, emptyLabel: string) {
  return (
    <div className="overflow-hidden rounded-sm border bg-white">
      <div className="flex items-center border-b bg-gray-50 px-3 py-2">
        <span className="text-xs font-semibold text-gray-600">{label}</span>
      </div>
      <p className="m-0 px-3 py-3 text-xs italic text-gray-400">{emptyLabel}</p>
    </div>
  );
}

function DiffSection({ log }: { log: AuditLogEntry }) {
  const { t } = useTranslation();
  const beforeValue = log.before_value ?? {};
  const updatedValues = log.updated_values ?? {};
  const isKeyTable = log.table_name === "LiteLLM_VerificationToken";
  const isUpdateAction = log.action === "updated" || log.action === "rotated";

  let displayBefore: Record<string, unknown> = beforeValue;
  let displayAfter: Record<string, unknown> = updatedValues;

  if (isUpdateAction) {
    const changedBefore: Record<string, unknown> = {};
    const changedAfter: Record<string, unknown> = {};
    const allKeys = new Set([...Object.keys(beforeValue), ...Object.keys(updatedValues)]);

    allKeys.forEach((key) => {
      const beforeString = JSON.stringify(beforeValue[key]);
      const afterString = JSON.stringify(updatedValues[key]);
      if (beforeString !== afterString) {
        if (key in beforeValue) {
          changedBefore[key] = beforeValue[key];
        }
        if (key in updatedValues) {
          changedAfter[key] = updatedValues[key];
        }
      }
    });

    displayBefore =
      Object.keys(changedBefore).length > 0 ? changedBefore : { note: t("observabilityExtra.audit.noDifferingFields") };
    displayAfter =
      Object.keys(changedAfter).length > 0 ? changedAfter : { note: t("observabilityExtra.audit.noDifferingFields") };
  }

  const renderValue = (label: string, value: Record<string, unknown>) => {
    if (Object.keys(value).length === 0) {
      return renderEmptyBlock(label, t("observabilityExtra.audit.notAvailable"));
    }

    if (isKeyTable && isUpdateAction) {
      const knownKeyFields = ["token", "spend", "max_budget"];
      const hasOnlyKnown = Object.keys(value).every((key) => knownKeyFields.includes(key));
      if (hasOnlyKnown && !("note" in value)) {
        return (
          <div className="overflow-hidden rounded-sm border bg-white">
            <div className="flex items-center border-b bg-gray-50 px-3 py-2">
              <span className="text-xs font-semibold text-gray-600">{label}</span>
            </div>
            <div className="space-y-1 px-3 py-3 text-xs">
              {"token" in value ? (
                <p>
                  <span className="text-gray-500">{t("observabilityExtra.audit.token")}:</span>{" "}
                  {String(value.token ?? t("observabilityExtra.audit.notAvailable"))}
                </p>
              ) : null}
              {"spend" in value ? (
                <p>
                  <span className="text-gray-500">{t("observabilityExtra.audit.spend")}:</span> $
                  {Number(value.spend).toFixed(6)}
                </p>
              ) : null}
              {"max_budget" in value ? (
                <p>
                  <span className="text-gray-500">{t("observabilityExtra.audit.maxBudget")}:</span> $
                  {Number(value.max_budget).toFixed(6)}
                </p>
              ) : null}
            </div>
          </div>
        );
      }
    }

    return <CopyableJsonBlock label={label} value={value} />;
  };

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
      {renderValue(t("observabilityExtra.audit.before"), displayBefore)}
      {renderValue(t("observabilityExtra.audit.after"), displayAfter)}
    </div>
  );
}

export function AuditLogDrawer({ open, onClose, log, accessToken }: AuditLogDrawerProps) {
  const { t } = useTranslation();
  const detailQuery = useQuery({
    queryKey: ["audit_log_detail", log?.id],
    queryFn: async () => {
      if (!accessToken || !log?.id) {
        return null;
      }
      return uiAuditLogByIdCall({ accessToken, auditId: log.id });
    },
    enabled: open && !!accessToken && !!log?.id,
  });

  if (!log) {
    return null;
  }

  const detailedLog = detailQuery.data ?? log;
  const tableDisplay = getAuditTableNameLabel(t, detailedLog.table_name);
  const actionColor = ACTION_COLOR[AUDIT_ACTION_TONE[detailedLog.action] ?? "neutral"] ?? "default";
  const actionLabel = getAuditActionLabel(t, detailedLog.action);
  const success = getAuditLogSuccess(detailedLog);
  const successLabel = getSuccessLabel(success, t);

  return (
    <Drawer
      placement="right"
      width="60%"
      open={open}
      onClose={onClose}
      closable={false}
      mask
      maskClosable
      styles={{ body: { padding: 0, display: "flex", flexDirection: "column" }, header: { display: "none" } }}
    >
      <div className="shrink-0 border-b bg-white px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Tag color={actionColor} className="m-0 capitalize">
              {actionLabel}
            </Tag>
            <span className="text-sm text-gray-500">
              {moment.utc(detailedLog.updated_at).local().format("MMM D, YYYY HH:mm:ss")}
            </span>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-sm text-gray-500 hover:bg-gray-100"
            aria-label={t("observabilityExtra.audit.close")}
          >
            <CloseOutlined />
          </button>
        </div>
      </div>

      <div className="px-6 py-5">
        {detailQuery.isLoading ? (
          <div className="mb-4 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            {t("observabilityExtra.audit.detailsLoading")}
          </div>
        ) : null}
        {detailQuery.isError ? (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {t("observabilityExtra.audit.detailsLoadError", {
              error:
                detailQuery.error instanceof Error
                  ? detailQuery.error.message
                  : t("observabilityExtra.audit.unknownError"),
            })}
          </div>
        ) : null}

        <div className="mb-5 rounded-lg border bg-gray-50 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-700">
            {t("observabilityExtra.audit.details")}
          </p>
          <MetadataRow label={t("observabilityExtra.audit.resourceType")} value={tableDisplay} />
          <MetadataRow
            label={t("observabilityExtra.audit.resourceId")}
            value={
              <Text copyable className="font-mono text-xs">
                {detailedLog.object_id}
              </Text>
            }
          />
          <MetadataRow
            label={t("observabilityExtra.audit.actor")}
            value={<DefaultProxyAdminTag userId={detailedLog.changed_by} />}
          />
          <MetadataRow label={t("observabilityExtra.audit.successLabel")} value={successLabel} />
          <MetadataRow
            label={t("observabilityExtra.audit.apiKeyHash")}
            value={
              detailedLog.changed_by_api_key ? (
                <Text copyable className="break-all font-mono text-xs">
                  {detailedLog.changed_by_api_key}
                </Text>
              ) : (
                t("observabilityExtra.audit.notAvailable")
              )
            }
          />
        </div>

        <DiffSection log={detailedLog} />
      </div>
    </Drawer>
  );
}
