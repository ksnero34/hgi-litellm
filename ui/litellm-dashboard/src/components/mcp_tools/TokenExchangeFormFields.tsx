import React from "react";
import { useTranslation } from "react-i18next";
import { Form, Input, Select, Tooltip } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";

interface TokenExchangeFormFieldsProps {
  isEditing?: boolean;
}

const fieldClassName = "rounded-lg border-gray-300 focus:border-blue-500 focus:ring-blue-500";

const FieldLabel: React.FC<{ label: string; tooltip: string }> = ({ label, tooltip }) => (
  <span className="text-sm font-medium text-gray-700 flex items-center">
    {label}
    <Tooltip title={tooltip}>
      <InfoCircleOutlined className="ml-2 text-blue-400 hover:text-blue-600 cursor-help" />
    </Tooltip>
  </span>
);

const TokenExchangeFormFields: React.FC<TokenExchangeFormFieldsProps> = ({ isEditing = false }) => {
  const { t } = useTranslation();
  const placeholderSuffix = isEditing ? t("toolsModels.mcp.keepExistingSuffix") : "";

  return (
    <>
      <Form.Item
        label={
          <FieldLabel label={t("toolsModels.mcp.profile")} tooltip={t("toolsModels.mcp.tokenExchangeProfileTooltip")} />
        }
        name="token_exchange_profile"
        {...(isEditing ? {} : { initialValue: "rfc8693" })}
      >
        <Select className="rounded-lg" size="large">
          <Select.Option value="rfc8693">
            <span className="font-medium">{t("toolsModels.mcp.rfc8693Standard")}</span>
          </Select.Option>
          <Select.Option value="entra_obo">
            <span className="font-medium">{t("toolsModels.mcp.entraObo")}</span>
          </Select.Option>
        </Select>
      </Form.Item>
      <Form.Item
        label={
          <FieldLabel
            label={t("toolsModels.mcp.tokenExchangeEndpointOptional")}
            tooltip={t("toolsModels.mcp.tokenExchangeEndpointTooltip")}
          />
        }
        name="token_exchange_endpoint"
      >
        <Input placeholder="https://idp.example.com/oauth2/token" className={fieldClassName} />
      </Form.Item>
      <Form.Item
        label={
          <FieldLabel
            label={t("toolsModels.mcp.clientId")}
            tooltip={t("toolsModels.mcp.tokenExchangeClientIdTooltip")}
          />
        }
        name={["credentials", "client_id"]}
        rules={[{ required: !isEditing, message: t("toolsModels.mcp.tokenExchangeClientIdRequired") }]}
      >
        <Input.Password
          placeholder={`${t("toolsModels.mcp.enterOAuthClientId")}${placeholderSuffix}`}
          className={fieldClassName}
        />
      </Form.Item>
      <Form.Item
        label={
          <FieldLabel
            label={t("toolsModels.mcp.clientSecret")}
            tooltip={t("toolsModels.mcp.tokenExchangeClientSecretTooltip")}
          />
        }
        name={["credentials", "client_secret"]}
        rules={[{ required: !isEditing, message: t("toolsModels.mcp.tokenExchangeClientSecretRequired") }]}
      >
        <Input.Password
          placeholder={`${t("toolsModels.mcp.enterOAuthClientSecret")}${placeholderSuffix}`}
          className={fieldClassName}
        />
      </Form.Item>
      <Form.Item noStyle shouldUpdate={(prev, cur) => prev.token_exchange_profile !== cur.token_exchange_profile}>
        {({ getFieldValue }) => {
          const isEntraObo = getFieldValue("token_exchange_profile") === "entra_obo";
          return (
            <>
              {!isEntraObo && (
                <>
                  <Form.Item
                    label={
                      <FieldLabel
                        label={t("toolsModels.mcp.audienceOptional")}
                        tooltip={t("toolsModels.mcp.audienceTooltip")}
                      />
                    }
                    name="audience"
                  >
                    <Input placeholder="https://upstream.example.com" className={fieldClassName} />
                  </Form.Item>
                  <Form.Item
                    label={
                      <FieldLabel
                        label={t("toolsModels.mcp.subjectTokenTypeOptional")}
                        tooltip={t("toolsModels.mcp.subjectTokenTypeTooltip")}
                      />
                    }
                    name="subject_token_type"
                  >
                    <Input placeholder="urn:ietf:params:oauth:token-type:access_token" className={fieldClassName} />
                  </Form.Item>
                </>
              )}
              <Form.Item
                label={
                  <FieldLabel
                    label={isEntraObo ? t("toolsModels.mcp.scopes") : t("toolsModels.mcp.scopesOptional")}
                    tooltip={
                      isEntraObo
                        ? t("toolsModels.mcp.entraScopesTooltip")
                        : t("toolsModels.mcp.tokenExchangeScopesTooltip")
                    }
                  />
                }
                name={["credentials", "scopes"]}
                rules={
                  isEntraObo
                    ? [
                        {
                          required: true,
                          message: t("toolsModels.mcp.entraScopeRequired"),
                        },
                      ]
                    : []
                }
              >
                <Select
                  mode="tags"
                  tokenSeparators={[","]}
                  placeholder={isEntraObo ? "api://<app-id>/.default" : t("toolsModels.mcp.addScopes")}
                  className="rounded-lg"
                  size="large"
                />
              </Form.Item>
            </>
          );
        }}
      </Form.Item>
    </>
  );
};

export default TokenExchangeFormFields;
