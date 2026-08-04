"use client";

import { TextInput } from "@tremor/react";
import { Checkbox, Form, Input, Select } from "antd";
import React from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "@/components/molecules/logo/Logo";
import { ssoProviderDisplayNames, ssoProviderLogoMap } from "../constants";

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export interface BaseSSOSettingsFormProps {
  form: any;
  onFormSubmit: (formValues: Record<string, any>) => Promise<void>;
}

export interface SSOProviderFieldConfig {
  labelKey: string;
  defaultLabel: string;
  name: string;
  placeholderKey?: string;
  defaultPlaceholder?: string;
  required?: boolean;
  type?: "password" | "textarea" | "checkbox";
}

export interface SSOProviderConfig {
  envVarMap: Record<string, string>;
  fields: SSOProviderFieldConfig[];
}

export const ssoProviderConfigs: Record<string, SSOProviderConfig> = {
  google: {
    envVarMap: {
      google_client_id: "GOOGLE_CLIENT_ID",
      google_client_secret: "GOOGLE_CLIENT_SECRET",
    },
    fields: [
      {
        labelKey: "settings.sso.googleClientId",
        defaultLabel: "Google Client ID",
        name: "google_client_id",
      },
      {
        labelKey: "settings.sso.googleClientSecret",
        defaultLabel: "Google Client Secret",
        name: "google_client_secret",
      },
    ],
  },
  microsoft: {
    envVarMap: {
      microsoft_client_id: "MICROSOFT_CLIENT_ID",
      microsoft_client_secret: "MICROSOFT_CLIENT_SECRET",
      microsoft_tenant: "MICROSOFT_TENANT",
    },
    fields: [
      {
        labelKey: "settings.sso.microsoftClientId",
        defaultLabel: "Microsoft Client ID",
        name: "microsoft_client_id",
      },
      {
        labelKey: "settings.sso.microsoftClientSecret",
        defaultLabel: "Microsoft Client Secret",
        name: "microsoft_client_secret",
      },
      {
        labelKey: "settings.sso.tenant",
        defaultLabel: "Microsoft Tenant",
        name: "microsoft_tenant",
      },
    ],
  },
  okta: {
    envVarMap: {
      generic_client_id: "GENERIC_CLIENT_ID",
      generic_client_secret: "GENERIC_CLIENT_SECRET",
      generic_discovery_url: "GENERIC_DISCOVERY_URL",
      generic_authorization_endpoint: "GENERIC_AUTHORIZATION_ENDPOINT",
      generic_token_endpoint: "GENERIC_TOKEN_ENDPOINT",
      generic_userinfo_endpoint: "GENERIC_USERINFO_ENDPOINT",
      generic_scope: "GENERIC_SCOPE",
    },
    fields: [
      {
        labelKey: "settings.sso.genericClientId",
        defaultLabel: "Generic Client ID",
        name: "generic_client_id",
      },
      {
        labelKey: "settings.sso.genericClientSecret",
        defaultLabel: "Generic Client Secret",
        name: "generic_client_secret",
      },
      {
        labelKey: "settings.sso.discoveryUrl",
        defaultLabel: "Discovery URL",
        name: "generic_discovery_url",
        placeholderKey: "settings.sso.discoveryUrlPlaceholder",
        defaultPlaceholder: "https://your-domain/.well-known/openid-configuration",
        required: false,
      },
      {
        labelKey: "settings.sso.authorizationEndpoint",
        defaultLabel: "Authorization Endpoint",
        name: "generic_authorization_endpoint",
        placeholderKey: "settings.sso.authorizationEndpointPlaceholder",
        defaultPlaceholder: "https://your-domain/authorize",
        required: false,
      },
      {
        labelKey: "settings.sso.tokenEndpoint",
        defaultLabel: "Token Endpoint",
        name: "generic_token_endpoint",
        placeholderKey: "settings.sso.tokenEndpointPlaceholder",
        defaultPlaceholder: "https://your-domain/token",
        required: false,
      },
      {
        labelKey: "settings.sso.userInfoEndpoint",
        defaultLabel: "Userinfo Endpoint",
        name: "generic_userinfo_endpoint",
        placeholderKey: "settings.sso.userInfoEndpointPlaceholder",
        defaultPlaceholder: "https://your-domain/userinfo",
        required: false,
      },
      {
        labelKey: "settings.sso.scopes",
        defaultLabel: "Scopes",
        name: "generic_scope",
        placeholderKey: "settings.sso.scopesPlaceholder",
        defaultPlaceholder: "openid email profile",
        required: false,
      },
    ],
  },
  generic: {
    envVarMap: {
      generic_client_id: "GENERIC_CLIENT_ID",
      generic_client_secret: "GENERIC_CLIENT_SECRET",
      generic_discovery_url: "GENERIC_DISCOVERY_URL",
      generic_authorization_endpoint: "GENERIC_AUTHORIZATION_ENDPOINT",
      generic_token_endpoint: "GENERIC_TOKEN_ENDPOINT",
      generic_userinfo_endpoint: "GENERIC_USERINFO_ENDPOINT",
      generic_scope: "GENERIC_SCOPE",
    },
    fields: [
      {
        labelKey: "settings.sso.genericClientId",
        defaultLabel: "Generic Client ID",
        name: "generic_client_id",
      },
      {
        labelKey: "settings.sso.genericClientSecret",
        defaultLabel: "Generic Client Secret",
        name: "generic_client_secret",
      },
      {
        labelKey: "settings.sso.discoveryUrl",
        defaultLabel: "Discovery URL",
        name: "generic_discovery_url",
        placeholderKey: "settings.sso.discoveryUrlPlaceholder",
        defaultPlaceholder: "https://your-domain/.well-known/openid-configuration",
        required: false,
      },
      {
        labelKey: "settings.sso.authorizationEndpoint",
        defaultLabel: "Authorization Endpoint",
        name: "generic_authorization_endpoint",
        placeholderKey: "settings.sso.authorizationEndpointPlaceholder",
        defaultPlaceholder: "https://your-domain/authorize",
        required: false,
      },
      {
        labelKey: "settings.sso.tokenEndpoint",
        defaultLabel: "Token Endpoint",
        name: "generic_token_endpoint",
        placeholderKey: "settings.sso.tokenEndpointPlaceholder",
        defaultPlaceholder: "https://your-domain/token",
        required: false,
      },
      {
        labelKey: "settings.sso.userInfoEndpoint",
        defaultLabel: "Userinfo Endpoint",
        name: "generic_userinfo_endpoint",
        placeholderKey: "settings.sso.userInfoEndpointPlaceholder",
        defaultPlaceholder: "https://your-domain/userinfo",
        required: false,
      },
      {
        labelKey: "settings.sso.scopes",
        defaultLabel: "Scopes",
        name: "generic_scope",
        placeholderKey: "settings.sso.scopesPlaceholder",
        defaultPlaceholder: "openid email profile",
        required: false,
      },
    ],
  },
  saml: {
    envVarMap: {
      saml_idp_metadata_url: "SAML_IDP_METADATA_URL",
      saml_idp_metadata_xml: "SAML_IDP_METADATA_XML",
      saml_sp_entity_id: "SAML_SP_ENTITY_ID",
      saml_allow_unsolicited: "SAML_ALLOW_UNSOLICITED",
    },
    fields: [
      {
        labelKey: "settings.sso.samlIdpMetadataUrl",
        defaultLabel: "IdP Metadata URL",
        name: "saml_idp_metadata_url",
        placeholderKey: "settings.sso.samlIdpMetadataUrlPlaceholder",
        defaultPlaceholder: "https://idp.example.com/metadata (use this or the metadata XML below)",
        required: false,
      },
      {
        labelKey: "settings.sso.samlIdpMetadataXml",
        defaultLabel: "IdP Metadata XML",
        name: "saml_idp_metadata_xml",
        placeholderKey: "settings.sso.samlIdpMetadataXmlPlaceholder",
        defaultPlaceholder: "Paste the IdP metadata XML here if you do not have a metadata URL",
        required: false,
        type: "textarea",
      },
      {
        labelKey: "settings.sso.samlSpEntityId",
        defaultLabel: "SP Entity ID",
        name: "saml_sp_entity_id",
        placeholderKey: "settings.sso.samlSpEntityIdPlaceholder",
        defaultPlaceholder: "Defaults to <proxy base url>/sso/saml/metadata",
        required: false,
      },
      {
        labelKey: "settings.sso.samlAllowUnsolicited",
        defaultLabel: "Allow IdP-initiated (unsolicited) responses",
        name: "saml_allow_unsolicited",
        required: false,
        type: "checkbox",
      },
    ],
  },
};

const defaultTranslate: TranslateFn = (_, options) => String(options?.defaultValue ?? "");

export const renderProviderFields = (provider: string, t: TranslateFn = defaultTranslate) => {
  const config = ssoProviderConfigs[provider];
  if (!config) return null;

  return config.fields.map((field) => {
    const label = t(field.labelKey, { defaultValue: field.defaultLabel });
    const placeholder = field.placeholderKey
      ? t(field.placeholderKey, { defaultValue: field.defaultPlaceholder ?? "" })
      : field.defaultPlaceholder;
    const rules =
      field.required === false
        ? []
        : [
            {
              required: true,
              message: t("settings.sso.form.fieldRequired", {
                defaultValue: `Please enter the ${label.toLowerCase()}`,
                field: label.toLowerCase(),
              }),
            },
          ];

    const control =
      field.type === "checkbox" ? (
        <Checkbox />
      ) : field.type === "textarea" ? (
        <Input.TextArea rows={4} placeholder={placeholder} />
      ) : field.type === "password" || field.name.includes("client") ? (
        <Input.Password />
      ) : (
        <TextInput placeholder={placeholder} />
      );

    return (
      <Form.Item
        key={field.name}
        label={label}
        name={field.name}
        rules={rules}
        valuePropName={field.type === "checkbox" ? "checked" : undefined}
      >
        {control}
      </Form.Item>
    );
  });
};

const BaseSSOSettingsForm: React.FC<BaseSSOSettingsFormProps> = ({ form, onFormSubmit }) => {
  const { t } = useTranslation();

  return (
    <div>
      <Form form={form} onFinish={onFormSubmit} labelCol={{ span: 8 }} wrapperCol={{ span: 16 }} labelAlign="left">
        <Form.Item
          label={t("settings.sso.form.provider", { defaultValue: "SSO Provider" })}
          name="sso_provider"
          rules={[
            {
              required: true,
              message: t("settings.sso.form.selectProvider", { defaultValue: "Please select an SSO provider" }),
            },
          ]}
        >
          <Select>
            {Object.entries(ssoProviderLogoMap).map(([value, logo]) => (
              <Select.Option key={value} value={value}>
                <div style={{ display: "flex", alignItems: "center", padding: "4px 0" }}>
                  {logo && (
                    <Logo
                      src={logo}
                      label={ssoProviderDisplayNames[value] || value}
                      className="h-6 w-6 mr-3 object-contain"
                    />
                  )}
                  <span>
                    {ssoProviderDisplayNames[value] || value.charAt(0).toUpperCase() + value.slice(1) + " SSO"}
                  </span>
                </div>
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          noStyle
          shouldUpdate={(prevValues, currentValues) => prevValues.sso_provider !== currentValues.sso_provider}
        >
          {({ getFieldValue }) => {
            const provider = getFieldValue("sso_provider");
            return provider ? renderProviderFields(provider, t) : null;
          }}
        </Form.Item>

        <Form.Item
          label={t("settings.sso.form.proxyAdminEmail", { defaultValue: "Proxy Admin Email" })}
          name="user_email"
          rules={[
            {
              required: true,
              message: t("settings.sso.form.proxyAdminEmailRequired", {
                defaultValue: "Please enter the email of the proxy admin",
              }),
            },
          ]}
        >
          <TextInput />
        </Form.Item>
        <Form.Item
          label={t("settings.sso.form.proxyBaseUrl", { defaultValue: "Proxy Base URL" })}
          name="proxy_base_url"
          normalize={(value) => value?.trim()}
          rules={[
            {
              required: true,
              message: t("settings.sso.form.proxyBaseUrlRequired", {
                defaultValue: "Please enter the proxy base url",
              }),
            },
            {
              pattern: /^https?:\/\/.+/,
              message: t("settings.sso.form.urlProtocol", {
                defaultValue: "URL must start with http:// or https://",
              }),
            },
            {
              validator: (_, value) => {
                if (value && /^https?:\/\/.+/.test(value) && value.endsWith("/")) {
                  return Promise.reject(
                    t("settings.sso.form.urlTrailingSlash", {
                      defaultValue: "URL must not end with a trailing slash",
                    }),
                  );
                }
                return Promise.resolve();
              },
            },
          ]}
        >
          <TextInput placeholder="https://example.com" />
        </Form.Item>

        <Form.Item
          noStyle
          shouldUpdate={(prevValues, currentValues) => prevValues.sso_provider !== currentValues.sso_provider}
        >
          {({ getFieldValue }) => {
            const provider = getFieldValue("sso_provider");
            return provider === "okta" || provider === "generic" ? (
              <Form.Item
                label={t("settings.sso.form.useRoleMappings", { defaultValue: "Use Role Mappings" })}
                name="use_role_mappings"
                valuePropName="checked"
              >
                <Checkbox />
              </Form.Item>
            ) : null;
          }}
        </Form.Item>

        <Form.Item
          noStyle
          shouldUpdate={(prevValues, currentValues) =>
            prevValues.use_role_mappings !== currentValues.use_role_mappings ||
            prevValues.sso_provider !== currentValues.sso_provider
          }
        >
          {({ getFieldValue }) => {
            const useRoleMappings = getFieldValue("use_role_mappings");
            const provider = getFieldValue("sso_provider");
            const supportsRoleMappings = provider === "okta" || provider === "generic";
            return useRoleMappings && supportsRoleMappings ? (
              <Form.Item
                label={t("settings.sso.form.groupClaim", { defaultValue: "Group Claim" })}
                name="group_claim"
                rules={[
                  {
                    required: true,
                    message: t("settings.sso.form.groupClaimRequired", {
                      defaultValue: "Please enter the group claim",
                    }),
                  },
                ]}
              >
                <TextInput />
              </Form.Item>
            ) : null;
          }}
        </Form.Item>

        <Form.Item
          noStyle
          shouldUpdate={(prevValues, currentValues) =>
            prevValues.use_role_mappings !== currentValues.use_role_mappings ||
            prevValues.sso_provider !== currentValues.sso_provider
          }
        >
          {({ getFieldValue }) => {
            const useRoleMappings = getFieldValue("use_role_mappings");
            const provider = getFieldValue("sso_provider");
            const supportsRoleMappings = provider === "okta" || provider === "generic";
            return useRoleMappings && supportsRoleMappings ? (
              <>
                <Form.Item
                  label={t("settings.sso.form.defaultRole", { defaultValue: "Default Role" })}
                  name="default_role"
                  initialValue="internal_user"
                >
                  <Select>
                    <Select.Option value="internal_user_viewer">
                      {t("settings.sso.form.internalViewer", { defaultValue: "Internal Viewer" })}
                    </Select.Option>
                    <Select.Option value="internal_user">
                      {t("settings.sso.form.internalUser", { defaultValue: "Internal User" })}
                    </Select.Option>
                    <Select.Option value="proxy_admin_viewer">
                      {t("settings.sso.form.adminViewer", { defaultValue: "Admin Viewer" })}
                    </Select.Option>
                    <Select.Option value="proxy_admin">
                      {t("settings.sso.form.proxyAdmin", { defaultValue: "Proxy Admin" })}
                    </Select.Option>
                  </Select>
                </Form.Item>

                <Form.Item
                  label={t("settings.sso.form.proxyAdminTeams", { defaultValue: "Proxy Admin Teams" })}
                  name="proxy_admin_teams"
                >
                  <TextInput />
                </Form.Item>

                <Form.Item
                  label={t("settings.sso.form.adminViewerTeams", { defaultValue: "Admin Viewer Teams" })}
                  name="admin_viewer_teams"
                >
                  <TextInput />
                </Form.Item>

                <Form.Item
                  label={t("settings.sso.form.internalUserTeams", { defaultValue: "Internal User Teams" })}
                  name="internal_user_teams"
                >
                  <TextInput />
                </Form.Item>

                <Form.Item
                  label={t("settings.sso.form.internalViewerTeams", { defaultValue: "Internal Viewer Teams" })}
                  name="internal_viewer_teams"
                >
                  <TextInput />
                </Form.Item>
              </>
            ) : null;
          }}
        </Form.Item>

        <Form.Item
          noStyle
          shouldUpdate={(prevValues, currentValues) => prevValues.sso_provider !== currentValues.sso_provider}
        >
          {({ getFieldValue }) => {
            const provider = getFieldValue("sso_provider");
            return provider === "okta" || provider === "generic" ? (
              <Form.Item
                label={t("settings.sso.form.useTeamMappings", { defaultValue: "Use Team Mappings" })}
                name="use_team_mappings"
                valuePropName="checked"
              >
                <Checkbox />
              </Form.Item>
            ) : null;
          }}
        </Form.Item>

        <Form.Item
          noStyle
          shouldUpdate={(prevValues, currentValues) =>
            prevValues.use_team_mappings !== currentValues.use_team_mappings ||
            prevValues.sso_provider !== currentValues.sso_provider
          }
        >
          {({ getFieldValue }) => {
            const useTeamMappings = getFieldValue("use_team_mappings");
            const provider = getFieldValue("sso_provider");
            const supportsTeamMappings = provider === "okta" || provider === "generic";
            return useTeamMappings && supportsTeamMappings ? (
              <Form.Item
                label={t("settings.sso.teamIdsJwtField", { defaultValue: "Team IDs JWT Field" })}
                name="team_ids_jwt_field"
                rules={[
                  {
                    required: true,
                    message: t("settings.sso.form.teamIdsJwtFieldRequired", {
                      defaultValue: "Please enter the team IDs JWT field",
                    }),
                  },
                ]}
                extra={t("settings.sso.form.teamClaimHelp", {
                  defaultValue: "JWT claim containing the team IDs to map",
                })}
              >
                <TextInput />
              </Form.Item>
            ) : null;
          }}
        </Form.Item>
      </Form>
    </div>
  );
};

export default BaseSSOSettingsForm;
