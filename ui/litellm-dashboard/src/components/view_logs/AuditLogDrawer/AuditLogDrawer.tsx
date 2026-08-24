import { Check, Copy } from "lucide-react";
import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import moment from "moment";
import { useTranslation } from "react-i18next";
import { AuditLogEntry, getAuditLogSuccess } from "../AuditLogsTableColumns";
import { AUDIT_ACTION_TONE, getAuditActionLabel, getAuditTableNameLabel } from "../auditLogLabels";
import DefaultProxyAdminTag from "../../common_components/DefaultProxyAdminTag";
import { uiAuditLogByIdCall } from "../../networking";
import CopyButton from "@/components/shared/CopyButton";
import { StatusBadge, type StatusTone } from "@/components/shared/table_cells/status_badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

interface AuditLogDrawerProps {
  open: boolean;
  onClose: () => void;
  log: AuditLogEntry | null;
  accessToken: string | null;
}

const getSuccessLabel = (success: boolean | null, t: ReturnType<typeof useTranslation>["t"]): string => {
  if (success === true) return t("observabilityExtra.audit.success.success");
  if (success === false) return t("observabilityExtra.audit.success.failure");
  return t("observabilityExtra.audit.success.unknown");
};

function CopyableJsonBlock({ label, value }: { label: string; value: Record<string, any> }) {
  const [copied, setCopied] = useState(false);
  const { t } = useTranslation();

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
    <div className="overflow-hidden rounded-sm border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-2">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleCopy}
          title={t("observabilityExtra.audit.copyJson")}
          aria-label={t("observabilityExtra.audit.copyJson")}
        >
          {copied ? <Check className="text-green-600" /> : <Copy />}
        </Button>
      </div>
      <pre className="m-0 max-h-96 overflow-auto bg-card p-3 font-mono text-xs break-all whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function MetadataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="w-36 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-xs break-all text-foreground">{value}</span>
    </div>
  );
}

function DiffSection({ log }: { log: AuditLogEntry }) {
  const { t } = useTranslation();
  const { action, table_name, before_value, updated_values } = log;
  const isKeyTable = table_name === "LiteLLM_VerificationToken";
  const isUpdateAction = action === "updated" || action === "rotated";

  let displayBefore = before_value;
  let displayAfter = updated_values;

  if (isUpdateAction && before_value && updated_values) {
    const changedBefore: Record<string, any> = {};
    const changedAfter: Record<string, any> = {};
    const allKeys = new Set([...Object.keys(before_value), ...Object.keys(updated_values)]);

    allKeys.forEach((key) => {
      const bStr = JSON.stringify(before_value[key]);
      const aStr = JSON.stringify(updated_values[key]);
      if (bStr !== aStr) {
        if (key in before_value) changedBefore[key] = before_value[key];
        if (key in updated_values) changedAfter[key] = updated_values[key];
      }
    });

    // Fields only in before (removed)
    Object.keys(before_value).forEach((key) => {
      if (!(key in updated_values) && !(key in changedBefore)) {
        changedBefore[key] = before_value[key];
        changedAfter[key] = undefined;
      }
    });

    // Fields only in after (added)
    Object.keys(updated_values).forEach((key) => {
      if (!(key in before_value) && !(key in changedAfter)) {
        changedAfter[key] = updated_values[key];
        changedBefore[key] = undefined;
      }
    });

    const noDiff = t("observabilityExtra.audit.noDifferingFields");
    displayBefore = Object.keys(changedBefore).length > 0 ? changedBefore : { note: noDiff };
    displayAfter = Object.keys(changedAfter).length > 0 ? changedAfter : { note: noDiff };
  }

  const renderValue = (label: string, value: Record<string, any> | null | undefined) => {
    if (!value || Object.keys(value).length === 0) {
      return (
        <div className="overflow-hidden rounded-sm border border-border bg-card">
          <div className="flex items-center border-b border-border bg-muted px-3 py-2">
            <span className="text-xs font-semibold text-muted-foreground">{label}</span>
          </div>
          <p className="m-0 px-3 py-3 text-xs text-muted-foreground italic">
            {t("observabilityExtra.audit.notAvailable")}
          </p>
        </div>
      );
    }

    // For key table updates, show only meaningful fields as plain text
    if (isKeyTable && isUpdateAction) {
      const knownKeyFields = ["token", "spend", "max_budget"];
      const hasOnlyKnown = Object.keys(value).every((k) => knownKeyFields.includes(k));
      if (hasOnlyKnown && !("note" in value)) {
        return (
          <div className="overflow-hidden rounded-sm border border-border bg-card">
            <div className="flex items-center border-b border-border bg-muted px-3 py-2">
              <span className="text-xs font-semibold text-muted-foreground">{label}</span>
            </div>
            <div className="space-y-1 px-3 py-3 text-xs">
              {value.token !== undefined && (
                <p>
                  <span className="text-muted-foreground">{t("observabilityExtra.audit.token")}:</span>{" "}
                  {value.token ?? t("observabilityExtra.audit.notAvailable")}
                </p>
              )}
              {value.spend !== undefined && (
                <p>
                  <span className="text-muted-foreground">{t("observabilityExtra.audit.spend")}:</span> $
                  {Number(value.spend).toFixed(6)}
                </p>
              )}
              {value.max_budget !== undefined && (
                <p>
                  <span className="text-muted-foreground">{t("observabilityExtra.audit.maxBudget")}:</span> $
                  {Number(value.max_budget).toFixed(6)}
                </p>
              )}
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
      if (!accessToken || !log?.id) return null;
      return uiAuditLogByIdCall({ accessToken, auditId: log.id });
    },
    enabled: open && !!accessToken && !!log?.id,
  });
  if (!log) return null;

  const detailedLog = detailQuery.data ?? log;
  const tableDisplay = getAuditTableNameLabel(t, detailedLog.table_name);
  const success = getAuditLogSuccess(detailedLog);

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <SheetContent side="right" className="w-[60%] gap-0 overflow-y-auto p-0 sm:max-w-none">
        <SheetTitle className="sr-only">{t("observabilityExtra.audit.details")}</SheetTitle>

        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-6 py-4">
          <StatusBadge
            tone={(AUDIT_ACTION_TONE[detailedLog.action] ?? "neutral") as StatusTone}
            label={getAuditActionLabel(t, detailedLog.action)}
          />
          <span className="text-sm text-muted-foreground">
            {moment.utc(detailedLog.updated_at).local().format("MMM D, YYYY HH:mm:ss")}
          </span>
        </div>

        <div className="px-6 py-5">
          {detailQuery.isLoading ? (
            <div className="mb-4 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
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
          <div className="mb-5 rounded-lg border border-border bg-muted p-4">
            <p className="mb-2 text-xs font-semibold tracking-wide text-foreground uppercase">
              {t("observabilityExtra.audit.details")}
            </p>
            <MetadataRow label={t("observabilityExtra.audit.resourceType")} value={tableDisplay} />
            <MetadataRow
              label={t("observabilityExtra.audit.resourceId")}
              value={
                <span className="inline-flex items-center gap-1 font-mono text-xs">
                  {detailedLog.object_id}
                  <CopyButton value={detailedLog.object_id} label={t("observabilityExtra.audit.resourceId")} />
                </span>
              }
            />
            <MetadataRow
              label={t("observabilityExtra.audit.actor")}
              value={<DefaultProxyAdminTag userId={detailedLog.changed_by} />}
            />
            <MetadataRow label={t("observabilityExtra.audit.successLabel")} value={getSuccessLabel(success, t)} />
            <MetadataRow
              label={t("observabilityExtra.audit.apiKeyHash")}
              value={
                detailedLog.changed_by_api_key ? (
                  <span className="inline-flex items-center gap-1 font-mono text-xs break-all">
                    {detailedLog.changed_by_api_key}
                    <CopyButton
                      value={detailedLog.changed_by_api_key}
                      label={t("observabilityExtra.audit.apiKeyHash")}
                    />
                  </span>
                ) : (
                  t("observabilityExtra.audit.notAvailable")
                )
              }
            />
          </div>

          <DiffSection log={detailedLog} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
