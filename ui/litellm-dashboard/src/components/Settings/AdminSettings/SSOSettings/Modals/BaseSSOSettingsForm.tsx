"use client";

import { TextInput } from "@tremor/react";
import { Checkbox, Form, Input, Select } from "antd";
import React from "react";
import { useTranslation } from "react-i18next";
import { ssoProviderLogoMap, ssoProviderDisplayNames } from "../constants";

export interface BaseSSOSettingsFormProps {
  form: any;
  onFormSubmit: (formValues: Record<string, any>) => Promise<void>;
}

export interface SSOProviderConfig {
  envVarMap: Record<string, string>;
  fields: Array<{
    label: string;
    name: string;
    placeholder?: string;
    required?: boolean;
  }>;
}

const buildProviderConfigs = (t: (key: string) => string): Record<string, SSOProviderConfig> => ({
  google: {
    envVarMap: {
      google_client_id: "GOOGLE_CLIENT_ID",
      google_client_secret: "GOOGLE_CLIENT_SECRET",
    },
    fields: [
      { label: t("settings.sso.clientId"), name: "google_client_id" },
      { label: t("settings.sso.clientSecret"), name: "google_client_secret" },
    ],
  },
  microsoft: {
    envVarMap: {
      microsoft_client_id: "MICROSOFT_CLIENT_ID",
      microsoft_client_secret: "MICROSOFT_CLIENT_SECRET",
      microsoft_tenant: "MICROSOFT_TENANT",
    },
    fields: [
      { label: t("settings.sso.clientId"), name: "microsoft_client_id" },
      { label: t("settings.sso.clientSecret"), name: "microsoft_client_secret" },
      { label: t("settings.sso.tenant"), name: "microsoft_tenant" },
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
    },
    fields: [
      { label: t("settings.sso.clientId"), name: "generic_client_id" },
      { label: t("settings.sso.clientSecret"), name: "generic_client_secret" },
      {
        label: t("settings.sso.discoveryUrl"),
        name: "generic_discovery_url",
        placeholder: "https://your-domain/.well-known/openid-configuration",
        required: false,
      },
      {
        label: t("settings.sso.authorizationEndpoint"),
        name: "generic_authorization_endpoint",
        placeholder: "https://your-domain/authorize",
        required: false,
      },
      {
        label: t("settings.sso.tokenEndpoint"),
        name: "generic_token_endpoint",
        placeholder: "https://your-domain/token",
        required: false,
      },
      {
        label: t("settings.sso.userInfoEndpoint"),
        name: "generic_userinfo_endpoint",
        placeholder: "https://your-domain/userinfo",
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
    },
    fields: [
      { label: t("settings.sso.clientId"), name: "generic_client_id" },
      { label: t("settings.sso.clientSecret"), name: "generic_client_secret" },
      {
        label: t("settings.sso.discoveryUrl"),
        name: "generic_discovery_url",
        placeholder: "https://your-domain/.well-known/openid-configuration",
        required: false,
      },
      { label: t("settings.sso.authorizationEndpoint"), name: "generic_authorization_endpoint", required: false },
      { label: t("settings.sso.tokenEndpoint"), name: "generic_token_endpoint", required: false },
      { label: t("settings.sso.userInfoEndpoint"), name: "generic_userinfo_endpoint", required: false },
    ],
  },
});

const BaseSSOSettingsForm: React.FC<BaseSSOSettingsFormProps> = ({ form, onFormSubmit }) => {
  const { t } = useTranslation();
  const providerConfigs = buildProviderConfigs(t);

  const renderProviderFields = (provider: string) => {
    const config = providerConfigs[provider];
    if (!config) return null;

    return config.fields.map((field) => (
      <Form.Item
        key={field.name}
        label={field.label}
        name={field.name}
        rules={[
          {
            required: field.required !== false,
            message: t("settings.sso.form.fieldRequired", { field: field.label.toLowerCase() }),
          },
        ]}
      >
        {field.name.includes("client") ? <Input.Password /> : <TextInput placeholder={field.placeholder} />}
      </Form.Item>
    ));
  };

  return (
    <div>
      <Form form={form} onFinish={onFormSubmit} labelCol={{ span: 8 }} wrapperCol={{ span: 16 }} labelAlign="left">
        <Form.Item
          label={t("settings.sso.form.provider")}
          name="sso_provider"
          rules={[{ required: true, message: t("settings.sso.form.selectProvider") }]}
        >
          <Select>
            {Object.entries(ssoProviderLogoMap).map(([value, logo]) => (
              <Select.Option key={value} value={value}>
                <div style={{ display: "flex", alignItems: "center", padding: "4px 0" }}>
                  {logo && (
                    <img
                      src={logo}
                      alt={value}
                      style={{ height: 24, width: 24, marginRight: 12, objectFit: "contain" }}
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
            return provider ? renderProviderFields(provider) : null;
          }}
        </Form.Item>

        <Form.Item
          label={t("settings.sso.form.proxyAdminEmail")}
          name="user_email"
          rules={[{ required: true, message: t("settings.sso.form.proxyAdminEmailRequired") }]}
        >
          <TextInput />
        </Form.Item>
        <Form.Item
          label={t("settings.sso.form.proxyBaseUrl")}
          name="proxy_base_url"
          normalize={(value) => value?.trim()}
          rules={[
            { required: true, message: t("settings.sso.form.proxyBaseUrlRequired") },
            {
              pattern: /^https?:\/\/.+/,
              message: t("settings.sso.form.urlProtocol"),
            },
            {
              validator: (_, value) => {
                if (value && /^https?:\/\/.+/.test(value) && value.endsWith("/")) {
                  return Promise.reject(t("settings.sso.form.urlTrailingSlash"));
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
                label={t("settings.sso.form.useRoleMappings")}
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
                label={t("settings.sso.form.groupClaim")}
                name="group_claim"
                rules={[{ required: true, message: t("settings.sso.form.groupClaimRequired") }]}
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
                <Form.Item label={t("settings.sso.form.defaultRole")} name="default_role" initialValue="Internal User">
                  <Select>
                    <Select.Option value="internal_user_viewer">{t("settings.sso.form.internalViewer")}</Select.Option>
                    <Select.Option value="internal_user">{t("settings.sso.form.internalUser")}</Select.Option>
                    <Select.Option value="proxy_admin_viewer">{t("settings.sso.form.adminViewer")}</Select.Option>
                    <Select.Option value="proxy_admin">{t("settings.sso.form.proxyAdmin")}</Select.Option>
                  </Select>
                </Form.Item>

                <Form.Item label={t("settings.sso.form.proxyAdminTeams")} name="proxy_admin_teams">
                  <TextInput />
                </Form.Item>

                <Form.Item label={t("settings.sso.form.adminViewerTeams")} name="admin_viewer_teams">
                  <TextInput />
                </Form.Item>

                <Form.Item label={t("settings.sso.form.internalUserTeams")} name="internal_user_teams">
                  <TextInput />
                </Form.Item>

                <Form.Item label={t("settings.sso.form.internalViewerTeams")} name="internal_viewer_teams">
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
                label={t("settings.sso.form.useTeamMappings")}
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
                label={t("settings.sso.teamIdsJwtField")}
                name="team_ids_jwt_field"
                rules={[{ required: true, message: t("settings.sso.form.teamIdsJwtFieldRequired") }]}
                extra={t("settings.sso.form.teamClaimHelp")}
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
