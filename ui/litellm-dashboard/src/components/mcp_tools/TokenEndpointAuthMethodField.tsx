import React from "react";
import { useTranslation } from "react-i18next";
import { Form, Select, Tooltip } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";

const TOKEN_ENDPOINT_AUTH_METHOD_OPTIONS = [
  { value: "client_secret_basic", label: "Client Secret Basic" },
  { value: "client_secret_post", label: "Client Secret Post" },
];

interface TokenEndpointAuthMethodFieldProps {
  isEditing?: boolean;
}

const TokenEndpointAuthMethodField: React.FC<TokenEndpointAuthMethodFieldProps> = ({ isEditing = false }) => {
  const { t } = useTranslation();
  return (
    <Form.Item
      label={
        <span className="text-sm font-medium text-gray-700 flex items-center">
          {t("toolsModels.mcp.tokenEndpointAuthMethodOptional")}
          <Tooltip title={t("toolsModels.mcp.tokenEndpointAuthMethodTooltip")}>
            <InfoCircleOutlined className="ml-2 text-blue-400 hover:text-blue-600 cursor-help" />
          </Tooltip>
        </span>
      }
      name={["credentials", "token_endpoint_auth_method"]}
    >
      <Select
        allowClear
        placeholder={
          isEditing
            ? t("toolsModels.mcp.tokenEndpointAuthMethodKeepExisting")
            : t("toolsModels.mcp.tokenEndpointAuthMethodDefault")
        }
        className="rounded-lg"
        size="large"
        options={TOKEN_ENDPOINT_AUTH_METHOD_OPTIONS.map((option) => ({
          ...option,
          label:
            option.value === "client_secret_basic"
              ? t("toolsModels.mcp.clientSecretBasic")
              : t("toolsModels.mcp.clientSecretPost"),
        }))}
      />
    </Form.Item>
  );
};

export default TokenEndpointAuthMethodField;
