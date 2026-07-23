import React from "react";
import { Alert } from "antd";
import { useTranslation } from "react-i18next";
import { AUTH_TYPE } from "./types";

/**
 * Warning shown in the create/edit MCP server forms when auth_type
 * true_passthrough is selected: the gateway performs no admission auth for
 * that server, so callers reach the upstream without a LiteLLM identity.
 */
export default function TruePassthroughWarning({ authType }: { authType?: string | null }) {
  const { t } = useTranslation();

  if (authType !== AUTH_TYPE.TRUE_PASSTHROUGH) return null;
  return (
    <Alert
      type="warning"
      showIcon
      className="mb-4 rounded-lg"
      message={t("toolsModels.mcp.truePassthroughWarning.title")}
      description={t("toolsModels.mcp.truePassthroughWarning.description")}
    />
  );
}
