import React, { useEffect, useState } from "react";
import { Button as Button2, Checkbox, Form, Input, Modal, Select } from "antd";
import { Text, TextInput } from "@tremor/react";
import { useTranslation } from "react-i18next";
import { getSSOSettings, updateSSOSettings } from "./networking";
import NotificationsManager from "./molecules/notifications_manager";
import { detectSSOProvider } from "./Settings/AdminSettings/SSOSettings/utils";
import { parseErrorMessage } from "./shared/errorUtils";

interface SSOModalsProps {
  isAddSSOModalVisible: boolean;
  isInstructionsModalVisible: boolean;
  handleAddSSOOk: () => void;
  handleAddSSOCancel: () => void;
  handleShowInstructions: (formValues: Record<string, any>) => void;
  handleInstructionsOk: () => void;
  handleInstructionsCancel: () => void;
  form: any;
  accessToken: string | null;
  ssoConfigured?: boolean;
}

const ssoProviderLogoMap: Record<string, string> = {
  google: "https://artificialanalysis.ai/img/logos/google_small.svg",
  microsoft: "https://upload.wikimedia.org/wikipedia/commons/a/a8/Microsoft_Azure_Logo.svg",
  okta: "https://www.okta.com/sites/default/files/Okta_Logo_BrightBlue_Medium.png",
  generic: "",
};

interface SSOProviderFieldConfig {
  name: string;
  labelKey: string;
  defaultLabel: string;
  placeholderKey?: string;
  defaultPlaceholder?: string;
  required?: boolean;
}

interface SSOProviderConfig {
  fields: SSOProviderFieldConfig[];
}

const ssoProviderConfigs: Record<string, SSOProviderConfig> = {
  google: {
    fields: [
      { labelKey: "auth.sso.googleClientId", defaultLabel: "Google Client ID", name: "google_client_id" },
      {
        labelKey: "auth.sso.googleClientSecret",
        defaultLabel: "Google Client Secret",
        name: "google_client_secret",
      },
    ],
  },
  microsoft: {
    fields: [
      { labelKey: "auth.sso.microsoftClientId", defaultLabel: "Microsoft Client ID", name: "microsoft_client_id" },
      {
        labelKey: "auth.sso.microsoftClientSecret",
        defaultLabel: "Microsoft Client Secret",
        name: "microsoft_client_secret",
      },
      { labelKey: "auth.sso.microsoftTenant", defaultLabel: "Microsoft Tenant", name: "microsoft_tenant" },
    ],
  },
  okta: {
    fields: [
      { labelKey: "auth.sso.genericClientId", defaultLabel: "Generic Client ID", name: "generic_client_id" },
      {
        labelKey: "auth.sso.genericClientSecret",
        defaultLabel: "Generic Client Secret",
        name: "generic_client_secret",
      },
      {
        labelKey: "auth.sso.discoveryUrl",
        defaultLabel: "Discovery URL",
        name: "generic_discovery_url",
        placeholderKey: "auth.sso.discoveryUrlPlaceholder",
        defaultPlaceholder: "https://your-domain/.well-known/openid-configuration",
        required: false,
      },
      {
        labelKey: "auth.sso.authorizationEndpoint",
        defaultLabel: "Authorization Endpoint",
        name: "generic_authorization_endpoint",
        placeholderKey: "auth.sso.authorizationEndpointPlaceholder",
        defaultPlaceholder: "https://your-domain/authorize",
        required: false,
      },
      {
        labelKey: "auth.sso.tokenEndpoint",
        defaultLabel: "Token Endpoint",
        name: "generic_token_endpoint",
        placeholderKey: "auth.sso.tokenEndpointPlaceholder",
        defaultPlaceholder: "https://your-domain/token",
        required: false,
      },
      {
        labelKey: "auth.sso.userinfoEndpoint",
        defaultLabel: "Userinfo Endpoint",
        name: "generic_userinfo_endpoint",
        placeholderKey: "auth.sso.userinfoEndpointPlaceholder",
        defaultPlaceholder: "https://your-domain/userinfo",
        required: false,
      },
    ],
  },
  generic: {
    fields: [
      { labelKey: "auth.sso.genericClientId", defaultLabel: "Generic Client ID", name: "generic_client_id" },
      {
        labelKey: "auth.sso.genericClientSecret",
        defaultLabel: "Generic Client Secret",
        name: "generic_client_secret",
      },
      {
        labelKey: "auth.sso.discoveryUrl",
        defaultLabel: "Discovery URL",
        name: "generic_discovery_url",
        placeholderKey: "auth.sso.discoveryUrlPlaceholder",
        defaultPlaceholder: "https://your-domain/.well-known/openid-configuration",
        required: false,
      },
      {
        labelKey: "auth.sso.authorizationEndpoint",
        defaultLabel: "Authorization Endpoint",
        name: "generic_authorization_endpoint",
        required: false,
      },
      {
        labelKey: "auth.sso.tokenEndpoint",
        defaultLabel: "Token Endpoint",
        name: "generic_token_endpoint",
        required: false,
      },
      {
        labelKey: "auth.sso.userinfoEndpoint",
        defaultLabel: "Userinfo Endpoint",
        name: "generic_userinfo_endpoint",
        required: false,
      },
    ],
  },
};

const SSOModals: React.FC<SSOModalsProps> = ({
  isAddSSOModalVisible,
  isInstructionsModalVisible,
  handleAddSSOOk,
  handleAddSSOCancel,
  handleShowInstructions,
  handleInstructionsOk,
  handleInstructionsCancel,
  form,
  accessToken,
  ssoConfigured = false,
}) => {
  const { t } = useTranslation();
  const [isClearConfirmModalVisible, setIsClearConfirmModalVisible] = useState(false);

  useEffect(() => {
    const loadSSOSettings = async () => {
      if (isAddSSOModalVisible && accessToken) {
        try {
          const ssoData = await getSSOSettings(accessToken);
          if (ssoData && ssoData.values) {
            const selectedProvider = detectSSOProvider(ssoData.values);
            let roleMappingFields = {};
            if (ssoData.values.role_mappings) {
              const roleMappings = ssoData.values.role_mappings;
              const joinTeams = (teams: string[] | undefined): string => {
                if (!teams || teams.length === 0) return "";
                return teams.join(", ");
              };

              roleMappingFields = {
                use_role_mappings: true,
                group_claim: roleMappings.group_claim,
                default_role: roleMappings.default_role || "internal_user",
                proxy_admin_teams: joinTeams(roleMappings.roles?.proxy_admin),
                admin_viewer_teams: joinTeams(roleMappings.roles?.proxy_admin_viewer),
                internal_user_teams: joinTeams(roleMappings.roles?.internal_user),
                internal_viewer_teams: joinTeams(roleMappings.roles?.internal_user_viewer),
              };
            }

            const formValues = {
              sso_provider: selectedProvider,
              proxy_base_url: ssoData.values.proxy_base_url,
              user_email: ssoData.values.user_email,
              ...ssoData.values,
              ...roleMappingFields,
            };

            form.resetFields();
            setTimeout(() => {
              form.setFieldsValue(formValues);
            }, 100);
          }
        } catch (error) {
          console.error("Failed to load SSO settings:", error);
        }
      }
    };

    loadSSOSettings();
  }, [isAddSSOModalVisible, accessToken, form]);

  const handleFormSubmit = async (formValues: Record<string, any>) => {
    if (!accessToken) {
      NotificationsManager.fromBackend(
        t("auth.sso.errors.noAccessToken", { defaultValue: "No access token available" }),
      );
      return;
    }

    try {
      const {
        proxy_admin_teams,
        admin_viewer_teams,
        internal_user_teams,
        internal_viewer_teams,
        default_role,
        group_claim,
        use_role_mappings,
        ...rest
      } = formValues;

      const payload: any = {
        ...rest,
      };

      if (use_role_mappings) {
        const splitTeams = (teams: string | undefined): string[] => {
          if (!teams || teams.trim() === "") return [];
          return teams
            .split(",")
            .map((team) => team.trim())
            .filter((team) => team.length > 0);
        };

        const defaultRoleMapping: Record<string, string> = {
          internal_user_viewer: "internal_user_viewer",
          internal_user: "internal_user",
          proxy_admin_viewer: "proxy_admin_viewer",
          proxy_admin: "proxy_admin",
        };

        payload.role_mappings = {
          provider: "generic",
          group_claim,
          default_role: defaultRoleMapping[default_role] || "internal_user",
          roles: {
            proxy_admin: splitTeams(proxy_admin_teams),
            proxy_admin_viewer: splitTeams(admin_viewer_teams),
            internal_user: splitTeams(internal_user_teams),
            internal_user_viewer: splitTeams(internal_viewer_teams),
          },
        };
      }

      await updateSSOSettings(accessToken, payload);
      handleShowInstructions(formValues);
    } catch (error: unknown) {
      NotificationsManager.fromBackend(
        t("auth.sso.errors.saveSettings", {
          defaultValue: "Failed to save SSO settings: {{message}}",
          message: parseErrorMessage(error),
        }),
      );
    }
  };

  const handleClearSSO = async () => {
    if (!accessToken) {
      NotificationsManager.fromBackend(
        t("auth.sso.errors.noAccessToken", { defaultValue: "No access token available" }),
      );
      return;
    }

    try {
      const clearSettings = {
        google_client_id: null,
        google_client_secret: null,
        microsoft_client_id: null,
        microsoft_client_secret: null,
        microsoft_tenant: null,
        generic_client_id: null,
        generic_client_secret: null,
        generic_discovery_url: null,
        generic_authorization_endpoint: null,
        generic_token_endpoint: null,
        generic_userinfo_endpoint: null,
        proxy_base_url: null,
        user_email: null,
        sso_provider: null,
        role_mappings: null,
      };

      await updateSSOSettings(accessToken, clearSettings);
      form.resetFields();
      setIsClearConfirmModalVisible(false);
      handleAddSSOOk();

      NotificationsManager.success(
        t("auth.sso.notifications.cleared", { defaultValue: "SSO settings cleared successfully" }),
      );
    } catch (error) {
      console.error("Failed to clear SSO settings:", error);
      NotificationsManager.fromBackend(
        t("auth.sso.errors.clearSettings", { defaultValue: "Failed to clear SSO settings" }),
      );
    }
  };

  const getRequiredMessage = (label: string) =>
    t("auth.sso.validation.enterField", {
      defaultValue: "Please enter the {{field}}",
      field: label.toLowerCase(),
    });

  const renderProviderFields = (provider: string) => {
    const config = ssoProviderConfigs[provider];
    if (!config) return null;

    return config.fields.map((field) => {
      const label = t(field.labelKey, { defaultValue: field.defaultLabel });
      const placeholder = field.placeholderKey
        ? t(field.placeholderKey, { defaultValue: field.defaultPlaceholder ?? "" })
        : field.defaultPlaceholder;

      return (
        <Form.Item
          key={field.name}
          label={label}
          name={field.name}
          rules={[{ required: field.required !== false, message: getRequiredMessage(label) }]}
        >
          {field.name.includes("client") ? <Input.Password /> : <TextInput placeholder={placeholder} />}
        </Form.Item>
      );
    });
  };

  const providerOptionLabel = (value: string) => {
    if (value.toLowerCase() === "okta") {
      return t("auth.sso.providers.okta", { defaultValue: "Okta / Auth0" });
    }

    return t(`auth.sso.providers.${value}`, {
      defaultValue: value.charAt(0).toUpperCase() + value.slice(1),
    });
  };

  return (
    <>
      <Modal
        title={
          ssoConfigured
            ? t("auth.sso.editTitle", { defaultValue: "Edit SSO Settings" })
            : t("auth.sso.addTitle", { defaultValue: "Add SSO" })
        }
        open={isAddSSOModalVisible}
        width={800}
        footer={null}
        onOk={handleAddSSOOk}
        onCancel={handleAddSSOCancel}
      >
        <Form
          form={form}
          onFinish={handleFormSubmit}
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 16 }}
          labelAlign="left"
        >
          <Form.Item
            label={t("auth.sso.provider", { defaultValue: "SSO Provider" })}
            name="sso_provider"
            rules={[
              {
                required: true,
                message: t("auth.sso.validation.selectProvider", { defaultValue: "Please select an SSO provider" }),
              },
            ]}
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
                    <span>{providerOptionLabel(value)} SSO</span>
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
            label={t("auth.sso.proxyAdminEmail", { defaultValue: "Proxy Admin Email" })}
            name="user_email"
            rules={[
              {
                required: true,
                message: t("auth.sso.validation.enterProxyAdminEmail", {
                  defaultValue: "Please enter the email of the proxy admin",
                }),
              },
            ]}
          >
            <TextInput />
          </Form.Item>
          <Form.Item
            label={t("auth.sso.proxyBaseUrl", { defaultValue: "Proxy Base URL" })}
            name="proxy_base_url"
            normalize={(value) => value?.trim()}
            rules={[
              {
                required: true,
                message: t("auth.sso.validation.enterProxyBaseUrl", {
                  defaultValue: "Please enter the proxy base url",
                }),
              },
              {
                pattern: /^https?:\/\/.+/,
                message: t("auth.sso.validation.urlProtocol", {
                  defaultValue: "URL must start with http:// or https://",
                }),
              },
              {
                validator: (_, value) => {
                  if (value && /^https?:\/\/.+/.test(value) && value.endsWith("/")) {
                    return Promise.reject(
                      t("auth.sso.validation.noTrailingSlash", {
                        defaultValue: "URL must not end with a trailing slash",
                      }),
                    );
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <TextInput placeholder={t("auth.sso.proxyBaseUrlPlaceholder", { defaultValue: "https://example.com" })} />
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) => prevValues.sso_provider !== currentValues.sso_provider}
          >
            {({ getFieldValue }) => {
              const provider = getFieldValue("sso_provider");
              return provider === "okta" || provider === "generic" ? (
                <Form.Item
                  label={t("auth.sso.useRoleMappings", { defaultValue: "Use Role Mappings" })}
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
              prevValues.use_role_mappings !== currentValues.use_role_mappings
            }
          >
            {({ getFieldValue }) => {
              const useRoleMappings = getFieldValue("use_role_mappings");
              return useRoleMappings ? (
                <Form.Item
                  label={t("auth.sso.groupClaim", { defaultValue: "Group Claim" })}
                  name="group_claim"
                  rules={[
                    {
                      required: true,
                      message: t("auth.sso.validation.enterGroupClaim", {
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
              prevValues.use_role_mappings !== currentValues.use_role_mappings
            }
          >
            {({ getFieldValue }) => {
              const useRoleMappings = getFieldValue("use_role_mappings");
              return useRoleMappings ? (
                <>
                  <Form.Item
                    label={t("auth.sso.defaultRole", { defaultValue: "Default Role" })}
                    name="default_role"
                    initialValue="Internal User"
                  >
                    <Select>
                      <Select.Option value="internal_user_viewer">
                        {t("auth.sso.roles.internalUserViewer", { defaultValue: "Internal Viewer" })}
                      </Select.Option>
                      <Select.Option value="internal_user">
                        {t("auth.sso.roles.internalUser", { defaultValue: "Internal User" })}
                      </Select.Option>
                      <Select.Option value="proxy_admin_viewer">
                        {t("auth.sso.roles.proxyAdminViewer", { defaultValue: "Admin Viewer" })}
                      </Select.Option>
                      <Select.Option value="proxy_admin">
                        {t("auth.sso.roles.proxyAdmin", { defaultValue: "Proxy Admin" })}
                      </Select.Option>
                    </Select>
                  </Form.Item>

                  <Form.Item
                    label={t("auth.sso.proxyAdminTeams", { defaultValue: "Proxy Admin Teams" })}
                    name="proxy_admin_teams"
                  >
                    <TextInput />
                  </Form.Item>

                  <Form.Item
                    label={t("auth.sso.adminViewerTeams", { defaultValue: "Admin Viewer Teams" })}
                    name="admin_viewer_teams"
                  >
                    <TextInput />
                  </Form.Item>

                  <Form.Item
                    label={t("auth.sso.internalUserTeams", { defaultValue: "Internal User Teams" })}
                    name="internal_user_teams"
                  >
                    <TextInput />
                  </Form.Item>

                  <Form.Item
                    label={t("auth.sso.internalViewerTeams", { defaultValue: "Internal Viewer Teams" })}
                    name="internal_viewer_teams"
                  >
                    <TextInput />
                  </Form.Item>
                </>
              ) : null;
            }}
          </Form.Item>
          <div
            style={{
              textAlign: "right",
              marginTop: "10px",
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: "8px",
            }}
          >
            {ssoConfigured && (
              <Button2
                onClick={() => setIsClearConfirmModalVisible(true)}
                style={{ backgroundColor: "#6366f1", borderColor: "#6366f1", color: "white" }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.backgroundColor = "#5558eb";
                  event.currentTarget.style.borderColor = "#5558eb";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.backgroundColor = "#6366f1";
                  event.currentTarget.style.borderColor = "#6366f1";
                }}
              >
                {t("auth.sso.actions.clear", { defaultValue: "Clear" })}
              </Button2>
            )}
            <Button2 htmlType="submit">{t("auth.sso.actions.save", { defaultValue: "Save" })}</Button2>
          </div>
        </Form>
      </Modal>

      <Modal
        title={t("auth.sso.confirmClearTitle", { defaultValue: "Confirm Clear SSO Settings" })}
        open={isClearConfirmModalVisible}
        onOk={handleClearSSO}
        onCancel={() => setIsClearConfirmModalVisible(false)}
        okText={t("auth.sso.actions.confirmClear", { defaultValue: "Yes, Clear" })}
        cancelText={t("auth.sso.actions.cancel", { defaultValue: "Cancel" })}
        okButtonProps={{ danger: true, style: { backgroundColor: "#dc2626", borderColor: "#dc2626" } }}
      >
        <p>
          {t("auth.sso.confirmClearDescription", {
            defaultValue: "Are you sure you want to clear all SSO settings? This action cannot be undone.",
          })}
        </p>
        <p>
          {t("auth.sso.confirmClearWarning", {
            defaultValue: "Users will no longer be able to login using SSO after this change.",
          })}
        </p>
      </Modal>

      <Modal
        title={t("auth.sso.instructionsTitle", { defaultValue: "SSO Setup Instructions" })}
        open={isInstructionsModalVisible}
        width={800}
        footer={null}
        onOk={handleInstructionsOk}
        onCancel={handleInstructionsCancel}
      >
        <p>{t("auth.sso.instructionsIntro", { defaultValue: "Follow these steps to complete the SSO setup:" })}</p>
        <Text className="mt-2">{t("auth.sso.instructions.step1", { defaultValue: "1. DO NOT Exit this TAB" })}</Text>
        <Text className="mt-2">
          {t("auth.sso.instructions.step2", { defaultValue: "2. Open a new tab, visit your proxy base url" })}
        </Text>
        <Text className="mt-2">
          {t("auth.sso.instructions.step3", {
            defaultValue: "3. Confirm your SSO is configured correctly and you can login on the new Tab",
          })}
        </Text>
        <Text className="mt-2">
          {t("auth.sso.instructions.step4", { defaultValue: "4. If Step 3 is successful, you can close this tab" })}
        </Text>
        <div style={{ textAlign: "right", marginTop: "10px" }}>
          <Button2 onClick={handleInstructionsOk}>{t("auth.sso.actions.done", { defaultValue: "Done" })}</Button2>
        </div>
      </Modal>
    </>
  );
};

export { ssoProviderConfigs };
export default SSOModals;
