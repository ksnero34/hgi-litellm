import React from "react";
import { CircleCheck, CircleAlert, RefreshCw, Wrench, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/shared/Alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { UiLoadingSpinner } from "@/components/ui/ui-loading-spinner";
import { useTranslation } from "react-i18next";

interface MCPConnectionStatusProps {
  formValues: Record<string, any>;
  tools: any[];
  isLoadingTools: boolean;
  toolsError: string | null;
  toolsErrorStatus?: number | null;
  toolsErrorStackTrace: string | null;
  canFetchTools: boolean;
  fetchTools: () => Promise<void>;
}

function getConnectionStatusTitle({
  isLoadingTools,
  hasTools,
  hasError,
  isPreviewForbidden,
  isEnglish,
  t,
}: {
  isLoadingTools: boolean;
  hasTools: boolean;
  hasError: boolean;
  isPreviewForbidden: boolean;
  isEnglish: boolean;
  t: (key: string) => string;
}): string {
  if (isLoadingTools) {
    return t("toolsModels.mcp.testingConnection");
  }
  if (hasTools) {
    return t("toolsModels.mcp.connectionSuccessful");
  }
  if (!hasError) {
    return t("toolsModels.mcp.readyToTest");
  }
  if (isPreviewForbidden) {
    return t("toolsModels.mcp.readyToSubmit");
  }
  if (isEnglish) {
    return "Connection failed";
  }
  return t("toolsModels.mcp.connectionFailed");
}

function getConnectionFailedTitle(isEnglish: boolean, t: (key: string) => string): string {
  if (isEnglish) {
    return "Connection Failed";
  }
  return t("toolsModels.mcp.connectionFailed");
}

const MCPConnectionStatus: React.FC<MCPConnectionStatusProps> = ({
  formValues,
  tools,
  isLoadingTools,
  toolsError,
  toolsErrorStatus = null,
  toolsErrorStackTrace,
  canFetchTools,
  fetchTools,
}) => {
  const { i18n, t } = useTranslation();
  const isEnglish = (i18n.resolvedLanguage ?? i18n.language ?? "en").startsWith("en");
  const isPreviewForbidden = toolsErrorStatus === 403;
  const hasTools = tools.length > 0;
  const hasError = Boolean(toolsError);
  const connectionStatusTitle = getConnectionStatusTitle({
    isLoadingTools,
    hasTools,
    hasError,
    isPreviewForbidden,
    isEnglish,
    t,
  });
  const connectionFailedTitle = getConnectionFailedTitle(isEnglish, t);
  // Don't show anything if required fields aren't filled
  if (!canFetchTools && !formValues.url && !formValues.spec_path) {
    return null;
  }

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <CircleCheck className="size-4 text-muted-foreground" />
          <h3 className="text-lg font-medium">{t("toolsModels.mcp.connectionStatus")}</h3>
        </div>

        {!canFetchTools && (formValues.url || formValues.spec_path) && (
          <div className="rounded-lg border border-dashed py-6 text-center text-muted-foreground">
            <Wrench className="mx-auto mb-2 size-6" />
            <p className="text-sm">{t("toolsModels.mcp.completeFieldsToTest")}</p>
            <p className="text-sm">{t("toolsModels.mcp.fillFieldsToTest")}</p>
          </div>
        )}

        {canFetchTools && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{connectionStatusTitle}</p>
                <p className="text-sm text-muted-foreground">
                  {t("toolsModels.mcp.serverLabel")}: {formValues.url || formValues.spec_path}
                </p>
              </div>

              {isLoadingTools && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <UiLoadingSpinner className="size-4" />
                  <p className="text-sm">{t("toolsModels.mcp.connecting")}</p>
                </div>
              )}

              {!isLoadingTools && !hasError && hasTools && (
                <div className="flex items-center gap-1">
                  <CircleCheck className="size-4" />
                  <p className="text-sm font-medium">{t("toolsModels.mcp.connected")}</p>
                </div>
              )}

              {hasError && !isPreviewForbidden && (
                <div className="flex items-center gap-1 text-destructive">
                  <CircleAlert className="size-4" />
                  <p className="text-sm font-medium">{t("toolsModels.mcp.failed")}</p>
                </div>
              )}
            </div>

            {isLoadingTools && (
              <div className="flex items-center justify-center gap-3 py-6">
                <UiLoadingSpinner className="size-6 text-muted-foreground" />
                <p className="text-sm">{t("toolsModels.mcp.testingAndLoadingTools")}</p>
              </div>
            )}

            {hasError && isPreviewForbidden && (
              <Alert>
                <Info />
                <AlertTitle>{t("toolsModels.mcp.toolPreviewUnavailable")}</AlertTitle>
                <AlertDescription>{toolsError}</AlertDescription>
              </Alert>
            )}

            {hasError && !isPreviewForbidden && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>{connectionFailedTitle}</AlertTitle>
                <AlertDescription>
                  <div>{toolsError}</div>
                  {toolsErrorStackTrace && (
                    <Collapsible className="mt-3">
                      <CollapsibleTrigger
                        render={
                          <Button variant="link" size="sm" className="h-auto p-0">
                            {t("toolsModels.mcp.stackTrace")}
                          </Button>
                        }
                      />
                      <CollapsibleContent>
                        <pre className="mt-2 max-h-100 overflow-auto rounded-sm bg-muted p-2 font-mono text-xs break-words whitespace-pre-wrap">
                          {toolsErrorStackTrace}
                        </pre>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </AlertDescription>
                <div className="mt-3">
                  <Button variant="outline" size="sm" onClick={fetchTools}>
                    <RefreshCw />
                    {t("toolsModels.mcp.retry")}
                  </Button>
                </div>
              </Alert>
            )}

            {!isLoadingTools && !hasTools && !hasError && (
              <div className="rounded-lg border border-dashed py-6 text-center">
                <CircleCheck className="mx-auto mb-2 size-6" />
                <p className="text-sm font-medium">{t("toolsModels.mcp.connectionSuccessfulBang")}</p>
                <p className="text-sm text-muted-foreground">{t("toolsModels.mcp.noToolsForServer")}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};

export default MCPConnectionStatus;
