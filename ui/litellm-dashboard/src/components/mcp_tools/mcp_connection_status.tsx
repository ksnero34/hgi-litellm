import React from "react";
import { Button, Spin, Alert, Collapse } from "antd";
import { CheckCircleOutlined, ExclamationCircleOutlined, ReloadOutlined, ToolOutlined } from "@ant-design/icons";
import { Card, Title, Text } from "@tremor/react";
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
  const { t } = useTranslation();
  const isPreviewForbidden = toolsErrorStatus === 403;
  // Don't show anything if required fields aren't filled
  if (!canFetchTools && !formValues.url && !formValues.spec_path) {
    return null;
  }

  return (
    <Card>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <CheckCircleOutlined className="text-blue-600" />
          <Title>{t("toolsModels.mcp.connectionStatus")}</Title>
        </div>

        {!canFetchTools && (formValues.url || formValues.spec_path) && (
          <div className="text-center py-6 text-gray-400 border rounded-lg border-dashed">
            <ToolOutlined className="text-2xl mb-2" />
            <Text>{t("toolsModels.mcp.completeFieldsToTest")}</Text>
            <br />
            <Text className="text-sm">{t("toolsModels.mcp.fillFieldsToTest")}</Text>
          </div>
        )}

        {canFetchTools && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <Text className="text-gray-700 font-medium">
                  {isLoadingTools
                    ? t("toolsModels.mcp.testingConnection")
                    : tools.length > 0
                      ? t("toolsModels.mcp.connectionSuccessful")
                      : toolsError
                        ? isPreviewForbidden
                          ? t("toolsModels.mcp.readyToSubmit")
                          : t("toolsModels.mcp.connectionFailed")
                        : t("toolsModels.mcp.readyToTest")}
                </Text>
                <br />
                <Text className="text-gray-500 text-sm">
                  {t("toolsModels.mcp.serverLabel")}: {formValues.url || formValues.spec_path}
                </Text>
              </div>

              {isLoadingTools && (
                <div className="flex items-center text-blue-600">
                  <Spin size="small" className="mr-2" />
                  <Text className="text-blue-600">{t("toolsModels.mcp.connecting")}</Text>
                </div>
              )}

              {!isLoadingTools && !toolsError && tools.length > 0 && (
                <div className="flex items-center text-green-600">
                  <CheckCircleOutlined className="mr-1" />
                  <Text className="text-green-600 font-medium">{t("toolsModels.mcp.connected")}</Text>
                </div>
              )}

              {toolsError && !isPreviewForbidden && (
                <div className="flex items-center text-red-600">
                  <ExclamationCircleOutlined className="mr-1" />
                  <Text className="text-red-600 font-medium">{t("toolsModels.mcp.failed")}</Text>
                </div>
              )}
            </div>

            {isLoadingTools && (
              <div className="flex items-center justify-center py-6">
                <Spin size="large" />
                <Text className="ml-3">{t("toolsModels.mcp.testingAndLoadingTools")}</Text>
              </div>
            )}

            {toolsError && isPreviewForbidden && (
              <Alert
                message={t("toolsModels.mcp.toolPreviewUnavailable")}
                description={toolsError}
                type="info"
                showIcon
              />
            )}

            {toolsError && !isPreviewForbidden && (
              <Alert
                message={t("toolsModels.mcp.connectionFailed")}
                description={
                  <div>
                    <div>{toolsError}</div>
                    {toolsErrorStackTrace && (
                      <Collapse
                        items={[
                          {
                            key: "stack-trace",
                            label: t("toolsModels.mcp.stackTrace"),
                            children: (
                              <pre
                                style={{
                                  whiteSpace: "pre-wrap",
                                  wordBreak: "break-word",
                                  fontSize: "12px",
                                  fontFamily: "monospace",
                                  margin: 0,
                                  padding: "8px",
                                  backgroundColor: "#f5f5f5",
                                  borderRadius: "4px",
                                  maxHeight: "400px",
                                  overflow: "auto",
                                }}
                              >
                                {toolsErrorStackTrace}
                              </pre>
                            ),
                          },
                        ]}
                        style={{ marginTop: "12px" }}
                      />
                    )}
                  </div>
                }
                type="error"
                showIcon
                action={
                  <Button icon={<ReloadOutlined />} onClick={fetchTools} size="small">
                    {t("toolsModels.mcp.retry")}
                  </Button>
                }
              />
            )}

            {!isLoadingTools && tools.length === 0 && !toolsError && (
              <div className="text-center py-6 text-gray-500 border rounded-lg border-dashed">
                <CheckCircleOutlined className="text-2xl mb-2 text-green-500" />
                <Text className="text-green-600 font-medium">{t("toolsModels.mcp.connectionSuccessfulBang")}</Text>
                <br />
                <Text className="text-gray-500">{t("toolsModels.mcp.noToolsForServer")}</Text>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};

export default MCPConnectionStatus;
