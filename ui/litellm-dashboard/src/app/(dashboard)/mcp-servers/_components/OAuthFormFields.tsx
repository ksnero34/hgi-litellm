import React from "react";
import { useTranslation } from "react-i18next";
import { Form, Input, InputNumber, Select, Tooltip } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import { Button, TextInput } from "@tremor/react";
import { OAUTH_FLOW } from "@/components/mcp_tools/types";
import TokenEndpointAuthMethodField from "./TokenEndpointAuthMethodField";

interface OAuthFlowStatus {
  startOAuthFlow: () => void;
  status: string;
  error: string | null;
  tokenResponse: { access_token?: string; expires_in?: number } | null;
}

interface OAuthFormFieldsProps {
  isM2M: boolean;
  isEditing?: boolean;
  oauthFlow?: OAuthFlowStatus;
  initialFlowType?: string;
  /** Link to provider docs for creating an OAuth app (e.g. GitHub). */
  docsUrl?: string | null;
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

const OAuthFormFields: React.FC<OAuthFormFieldsProps> = ({
  isM2M,
  isEditing = false,
  oauthFlow,
  initialFlowType,
  docsUrl,
}) => {
  const { t } = useTranslation();
  const placeholderSuffix = isEditing ? t("toolsModels.mcp.keepExistingSuffix") : "";

  return (
    <>
      <Form.Item
        label={
          <FieldLabel label={t("toolsModels.mcp.oauthFlowType")} tooltip={t("toolsModels.mcp.oauthFlowTooltip")} />
        }
        name="oauth_flow_type"
        {...(initialFlowType ? { initialValue: initialFlowType } : {})}
      >
        <Select className="rounded-lg" size="large">
          <Select.Option value={OAUTH_FLOW.M2M}>
            <div>
              <span className="font-medium">{t("toolsModels.mcp.oauthM2M")}</span>
              <span className="text-gray-400 text-xs ml-2">{t("toolsModels.mcp.oauthM2MDescription")}</span>
            </div>
          </Select.Option>
          <Select.Option value={OAUTH_FLOW.INTERACTIVE}>
            <div>
              <span className="font-medium">{t("toolsModels.mcp.oauthInteractive")}</span>
              <span className="text-gray-400 text-xs ml-2">{t("toolsModels.mcp.oauthInteractiveDescription")}</span>
            </div>
          </Select.Option>
        </Select>
      </Form.Item>

      {isM2M ? (
        <>
          <Form.Item
            label={
              <FieldLabel label={t("toolsModels.mcp.clientId")} tooltip={t("toolsModels.mcp.clientIdM2MTooltip")} />
            }
            name={["credentials", "client_id"]}
            rules={[{ required: true, message: t("toolsModels.mcp.clientIdM2MRequired") }]}
          >
            <TextInput
              type="password"
              placeholder={`${t("toolsModels.mcp.enterOAuthClientId")}${placeholderSuffix}`}
              className={fieldClassName}
            />
          </Form.Item>
          <Form.Item
            label={
              <FieldLabel
                label={t("toolsModels.mcp.clientSecret")}
                tooltip={t("toolsModels.mcp.clientSecretM2MTooltip")}
              />
            }
            name={["credentials", "client_secret"]}
            rules={[{ required: true, message: t("toolsModels.mcp.clientSecretM2MRequired") }]}
          >
            <TextInput
              type="password"
              placeholder={`${t("toolsModels.mcp.enterOAuthClientSecret")}${placeholderSuffix}`}
              className={fieldClassName}
            />
          </Form.Item>
          <Form.Item
            label={
              <FieldLabel label={t("toolsModels.mcp.tokenUrl")} tooltip={t("toolsModels.mcp.tokenUrlM2MTooltip")} />
            }
            name="token_url"
            rules={[{ required: true, message: t("toolsModels.mcp.tokenUrlM2MRequired") }]}
          >
            <TextInput placeholder="https://auth.example.com/oauth/token" className={fieldClassName} />
          </Form.Item>
          <TokenEndpointAuthMethodField isEditing={isEditing} />
          <Form.Item
            label={
              <FieldLabel label={t("toolsModels.mcp.scopesOptional")} tooltip={t("toolsModels.mcp.scopesM2MTooltip")} />
            }
            name={["credentials", "scopes"]}
          >
            <Select
              mode="tags"
              tokenSeparators={[","]}
              placeholder={t("toolsModels.mcp.addScopes")}
              className="rounded-lg"
              size="large"
            />
          </Form.Item>
        </>
      ) : (
        <>
          <Form.Item
            label={
              <span className="flex items-center justify-between w-full">
                <FieldLabel
                  label={t("toolsModels.mcp.clientIdOptional")}
                  tooltip={t("toolsModels.mcp.dynamicRegistrationTooltip")}
                />
                {docsUrl && (
                  <a
                    href={docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-500 hover:text-blue-700 ml-2 font-normal"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Create OAuth App →
                  </a>
                )}
              </span>
            }
            name={["credentials", "client_id"]}
          >
            <TextInput
              type="password"
              placeholder={`${t("toolsModels.mcp.enterClientId")}${placeholderSuffix}`}
              className={fieldClassName}
            />
          </Form.Item>
          <Form.Item
            label={
              <FieldLabel
                label={t("toolsModels.mcp.clientSecretOptional")}
                tooltip={t("toolsModels.mcp.dynamicRegistrationTooltip")}
              />
            }
            name={["credentials", "client_secret"]}
          >
            <TextInput
              type="password"
              placeholder={`${t("toolsModels.mcp.enterClientSecret")}${placeholderSuffix}`}
              className={fieldClassName}
            />
          </Form.Item>
          <Form.Item
            label={
              <FieldLabel
                label={t("toolsModels.mcp.scopesOptional")}
                tooltip={t("toolsModels.mcp.scopesInteractiveTooltip")}
              />
            }
            name={["credentials", "scopes"]}
          >
            <Select
              mode="tags"
              tokenSeparators={[","]}
              placeholder={t("toolsModels.mcp.addScopes")}
              className="rounded-lg"
              size="large"
            />
          </Form.Item>
          <Form.Item
            label={
              <FieldLabel
                label="Issuer (optional)"
                tooltip="OAuth 2.0 authorization server issuer (RFC 8414). Auto-discovered from the upstream on first connect; set it explicitly to pin the trust anchor so token and scope discovery is fetched from and validated against this issuer (RFC 8414 §3.3) instead of anything the resource advertises."
              />
            }
            name="issuer"
          >
            <TextInput placeholder="https://issuer.example.com" className={fieldClassName} />
          </Form.Item>
          <Form.Item
            label={
              <FieldLabel
                label={t("toolsModels.mcp.authorizationUrlOptional")}
                tooltip={t("toolsModels.mcp.authorizationUrlTooltip")}
              />
            }
            name="authorization_url"
          >
            <TextInput placeholder="https://example.com/oauth/authorize" className={fieldClassName} />
          </Form.Item>
          <Form.Item
            label={
              <FieldLabel
                label={t("toolsModels.mcp.tokenUrlOptional")}
                tooltip={t("toolsModels.mcp.tokenUrlTooltip")}
              />
            }
            name="token_url"
          >
            <TextInput placeholder="https://example.com/oauth/token" className={fieldClassName} />
          </Form.Item>
          <TokenEndpointAuthMethodField isEditing={isEditing} />
          <Form.Item
            label={
              <FieldLabel
                label={t("toolsModels.mcp.registrationUrlOptional")}
                tooltip={t("toolsModels.mcp.registrationUrlTooltip")}
              />
            }
            name="registration_url"
          >
            <TextInput placeholder="https://example.com/oauth/register" className={fieldClassName} />
          </Form.Item>
          <Form.Item
            label={
              <FieldLabel
                label={t("toolsModels.mcp.tokenValidationOptional")}
                tooltip={t("toolsModels.mcp.tokenValidationTooltip")}
              />
            }
            name="token_validation_json"
            rules={[
              {
                validator: (_: any, value: string) => {
                  if (!value || value.trim() === "") return Promise.resolve();
                  try {
                    JSON.parse(value);
                    return Promise.resolve();
                  } catch {
                    return Promise.reject(new Error(t("toolsModels.mcp.validJsonRequired")));
                  }
                },
              },
            ]}
          >
            <Input.TextArea
              placeholder={'{\n  "organization": "my-org",\n  "team.id": "123"\n}'}
              rows={4}
              className="font-mono text-sm rounded-lg border-gray-300 focus:border-blue-500 focus:ring-blue-500"
            />
          </Form.Item>
                    <Form.Item
                      label={
                        <FieldLabel
                          label={t("toolsModels.mcp.tokenStorageTtlOptional")}
                          tooltip={t("toolsModels.mcp.tokenStorageTtlTooltip")}
                        />
                      }
                      name="token_storage_ttl_seconds"
          >
            <InputNumber
              min={1}
              placeholder={t("toolsModels.mcp.tokenStorageTtlPlaceholder")}
              className="w-full rounded-lg"
              style={{ width: "100%" }}
            />
          </Form.Item>
          {oauthFlow && (
            <div className="rounded-lg border border-dashed border-gray-300 p-4 space-y-2">
              <p className="text-sm text-gray-600">{t("toolsModels.mcp.oauthFetchHelp")}</p>
              <Button
                variant="secondary"
                onClick={oauthFlow.startOAuthFlow}
                disabled={oauthFlow.status === "authorizing" || oauthFlow.status === "exchanging"}
              >
                {oauthFlow.status === "authorizing"
                  ? t("toolsModels.mcp.oauthWaiting")
                  : oauthFlow.status === "exchanging"
                    ? t("toolsModels.mcp.oauthExchanging")
                    : t("toolsModels.mcp.oauthFetchToken")}
              </Button>
              {oauthFlow.error && <p className="text-sm text-red-500">{oauthFlow.error}</p>}
              {oauthFlow.status === "success" && oauthFlow.tokenResponse?.access_token && (
                <p className="text-sm text-green-600">
                  {t("toolsModels.mcp.oauthTokenFetched", { seconds: oauthFlow.tokenResponse.expires_in ?? "?" })}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
};

export default OAuthFormFields;
