import React from "react";
import { useTranslation } from "react-i18next";
import { Form, Input, Tooltip } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";

interface StdioConfigurationProps {
  isVisible: boolean;
  /**
   * When true, stdio_config is required + validated as JSON.
   * Edit screen can set this to false when using dedicated command/args/env fields.
   */
  required?: boolean;
}

const StdioConfiguration: React.FC<StdioConfigurationProps> = ({ isVisible, required = true }) => {
  const { t } = useTranslation();
  if (!isVisible) return null;

  return (
    <Form.Item
      label={
        <span className="text-sm font-medium text-gray-700 flex items-center">
          {t("toolsModels.mcp.stdioConfiguration")}
          <Tooltip title={t("toolsModels.mcp.stdioConfigurationTooltip")}>
            <InfoCircleOutlined className="ml-2 text-blue-400 hover:text-blue-600 cursor-help" />
          </Tooltip>
        </span>
      }
      name="stdio_config"
      rules={[
        ...(required ? [{ required: true, message: t("toolsModels.mcp.stdioConfigurationRequired") }] : []),
        {
          validator: (_, value) => {
            if (!value) return Promise.resolve();
            try {
              JSON.parse(value);
              return Promise.resolve();
            } catch {
              return Promise.reject(t("toolsModels.mcp.validJsonRequired"));
            }
          },
        },
      ]}
    >
      <Input.TextArea
        placeholder={`{
  "mcpServers": {
    "circleci-mcp-server": {
      "command": "npx",
      "args": ["-y", "@circleci/mcp-server-circleci"],
      "env": {
        "CIRCLECI_TOKEN": "your-circleci-token",
        "CIRCLECI_BASE_URL": "https://circleci.com"
      }
    }
  }
}`}
        rows={12}
        className="rounded-lg border-gray-300 focus:border-blue-500 focus:ring-blue-500 font-mono text-sm"
      />
    </Form.Item>
  );
};

export default StdioConfiguration;
