"use client";

import { useSSOSettings, type SSOSettingsValues } from "@/app/(dashboard)/hooks/sso/useSSOSettings";
import { Logo } from "@/components/molecules/logo/Logo";
import { Button, Card, Descriptions, Space, Tag, Typography } from "antd";
import { Edit, Shield, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import AddSSOSettingsModal from "./Modals/AddSSOSettingsModal";
import DeleteSSOSettingsModal from "./Modals/DeleteSSOSettingsModal";
import EditSSOSettingsModal from "./Modals/EditSSOSettingsModal";
import RedactableField from "./RedactableField";
import RoleMappings from "./RoleMappings";
import SSOSettingsEmptyPlaceholder from "./SSOSettingsEmptyPlaceholder";
import SSOSettingsLoadingSkeleton from "./SSOSettingsLoadingSkeleton";
import { ssoProviderDisplayNames, ssoProviderLogoMap } from "./constants";
import { detectSSOProvider } from "./utils";

const { Title, Text } = Typography;

export default function SSOSettings() {
  const { t } = useTranslation();
  const { data: ssoSettings, refetch, isLoading } = useSSOSettings();
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const isSSOConfigured = [
    ssoSettings?.values.google_client_id,
    ssoSettings?.values.microsoft_client_id,
    ssoSettings?.values.generic_client_id,
    ssoSettings?.values.saml_idp_metadata_url,
    ssoSettings?.values.saml_idp_metadata_xml,
  ].some(Boolean);

  const selectedProvider = ssoSettings?.values ? detectSSOProvider(ssoSettings.values) : null;
  const roleMappings = ssoSettings?.values.role_mappings;
  const isTeamMappingsEnabled = Boolean(ssoSettings?.values.team_mappings);

  const renderEndpointValue = (value?: string | null) => (
    <Text className="font-mono text-gray-600 text-sm" copyable={!!value}>
      {value || "-"}
    </Text>
  );

  const renderSimpleValue = (value?: string | null) =>
    value ? (
      value
    ) : (
      <span className="text-gray-400 italic">
        {t("settings.sso.notConfigured", { defaultValue: "Not configured" })}
      </span>
    );

  const renderTeamMappingsField = (values: SSOSettingsValues) => {
    if (!values.team_mappings?.team_ids_jwt_field) {
      return (
        <span className="text-gray-400 italic">
          {t("settings.sso.notConfigured", { defaultValue: "Not configured" })}
        </span>
      );
    }
    return <Tag>{values.team_mappings.team_ids_jwt_field}</Tag>;
  };

  const descriptionsConfig = {
    column: {
      xxl: 1,
      xl: 1,
      lg: 1,
      md: 1,
      sm: 1,
      xs: 1,
    },
  };

  const providerConfigs = {
    google: {
      providerText: ssoProviderDisplayNames.google,
      fields: [
        {
          label: t("settings.sso.clientId", { defaultValue: "Client ID" }),
          render: (values: SSOSettingsValues) => <RedactableField value={values.google_client_id} />,
        },
        {
          label: t("settings.sso.clientSecret", { defaultValue: "Client Secret" }),
          render: (values: SSOSettingsValues) => <RedactableField value={values.google_client_secret} />,
        },
        {
          label: t("settings.sso.proxyBaseUrl", { defaultValue: "Proxy Base URL" }),
          render: (values: SSOSettingsValues) => renderSimpleValue(values.proxy_base_url),
        },
      ],
    },
    microsoft: {
      providerText: ssoProviderDisplayNames.microsoft,
      fields: [
        {
          label: t("settings.sso.clientId", { defaultValue: "Client ID" }),
          render: (values: SSOSettingsValues) => <RedactableField value={values.microsoft_client_id} />,
        },
        {
          label: t("settings.sso.clientSecret", { defaultValue: "Client Secret" }),
          render: (values: SSOSettingsValues) => <RedactableField value={values.microsoft_client_secret} />,
        },
        {
          label: t("settings.sso.tenant", { defaultValue: "Tenant" }),
          render: (values: SSOSettingsValues) => renderSimpleValue(values.microsoft_tenant),
        },
        {
          label: t("settings.sso.proxyBaseUrl", { defaultValue: "Proxy Base URL" }),
          render: (values: SSOSettingsValues) => renderSimpleValue(values.proxy_base_url),
        },
      ],
    },
    okta: {
      providerText: ssoProviderDisplayNames.okta,
      fields: [
        {
          label: t("settings.sso.clientId", { defaultValue: "Client ID" }),
          render: (values: SSOSettingsValues) => <RedactableField value={values.generic_client_id} />,
        },
        {
          label: t("settings.sso.clientSecret", { defaultValue: "Client Secret" }),
          render: (values: SSOSettingsValues) => <RedactableField value={values.generic_client_secret} />,
        },
        {
          label: t("settings.sso.discoveryUrl", { defaultValue: "Discovery URL" }),
          render: (values: SSOSettingsValues) => renderEndpointValue(values.generic_discovery_url),
        },
        {
          label: t("settings.sso.authorizationEndpoint", { defaultValue: "Authorization Endpoint" }),
          render: (values: SSOSettingsValues) => renderEndpointValue(values.generic_authorization_endpoint),
        },
        {
          label: t("settings.sso.tokenEndpoint", { defaultValue: "Token Endpoint" }),
          render: (values: SSOSettingsValues) => renderEndpointValue(values.generic_token_endpoint),
        },
        {
          label: t("settings.sso.userInfoEndpoint", { defaultValue: "User Info Endpoint" }),
          render: (values: SSOSettingsValues) => renderEndpointValue(values.generic_userinfo_endpoint),
        },
        {
          label: t("settings.sso.scopes", { defaultValue: "Scopes" }),
          render: (values: SSOSettingsValues) => renderSimpleValue(values.generic_scope),
        },
        {
          label: t("settings.sso.proxyBaseUrl", { defaultValue: "Proxy Base URL" }),
          render: (values: SSOSettingsValues) => renderSimpleValue(values.proxy_base_url),
        },
        isTeamMappingsEnabled
          ? {
              label: t("settings.sso.teamIdsJwtField", { defaultValue: "Team IDs JWT Field" }),
              render: (values: SSOSettingsValues) => renderTeamMappingsField(values),
            }
          : null,
      ],
    },
    generic: {
      providerText: ssoProviderDisplayNames.generic,
      fields: [
        {
          label: t("settings.sso.clientId", { defaultValue: "Client ID" }),
          render: (values: SSOSettingsValues) => <RedactableField value={values.generic_client_id} />,
        },
        {
          label: t("settings.sso.clientSecret", { defaultValue: "Client Secret" }),
          render: (values: SSOSettingsValues) => <RedactableField value={values.generic_client_secret} />,
        },
        {
          label: t("settings.sso.discoveryUrl", { defaultValue: "Discovery URL" }),
          render: (values: SSOSettingsValues) => renderEndpointValue(values.generic_discovery_url),
        },
        {
          label: t("settings.sso.authorizationEndpoint", { defaultValue: "Authorization Endpoint" }),
          render: (values: SSOSettingsValues) => renderEndpointValue(values.generic_authorization_endpoint),
        },
        {
          label: t("settings.sso.tokenEndpoint", { defaultValue: "Token Endpoint" }),
          render: (values: SSOSettingsValues) => renderEndpointValue(values.generic_token_endpoint),
        },
        {
          label: t("settings.sso.userInfoEndpoint", { defaultValue: "User Info Endpoint" }),
          render: (values: SSOSettingsValues) => renderEndpointValue(values.generic_userinfo_endpoint),
        },
        {
          label: t("settings.sso.scopes", { defaultValue: "Scopes" }),
          render: (values: SSOSettingsValues) => renderSimpleValue(values.generic_scope),
        },
        {
          label: t("settings.sso.proxyBaseUrl", { defaultValue: "Proxy Base URL" }),
          render: (values: SSOSettingsValues) => renderSimpleValue(values.proxy_base_url),
        },
        isTeamMappingsEnabled
          ? {
              label: t("settings.sso.teamIdsJwtField", { defaultValue: "Team IDs JWT Field" }),
              render: (values: SSOSettingsValues) => renderTeamMappingsField(values),
            }
          : null,
      ],
    },
    saml: {
      providerText: ssoProviderDisplayNames.saml,
      fields: [
        {
          label: t("settings.sso.samlIdpMetadataUrl", { defaultValue: "IdP Metadata URL" }),
          render: (values: SSOSettingsValues) => renderEndpointValue(values.saml_idp_metadata_url),
        },
        {
          label: t("settings.sso.samlIdpMetadataXml", { defaultValue: "IdP Metadata XML" }),
          render: (values: SSOSettingsValues) =>
            values.saml_idp_metadata_xml ? (
              <Tag>{t("settings.sso.provided", { defaultValue: "Provided" })}</Tag>
            ) : (
              <span className="text-gray-400 italic">
                {t("settings.sso.notConfigured", { defaultValue: "Not configured" })}
              </span>
            ),
        },
        {
          label: t("settings.sso.samlSpEntityId", { defaultValue: "SP Entity ID" }),
          render: (values: SSOSettingsValues) => renderEndpointValue(values.saml_sp_entity_id),
        },
        {
          label: t("settings.sso.samlAllowUnsolicited", {
            defaultValue: "Allow IdP-initiated (unsolicited) responses",
          }),
          render: (values: SSOSettingsValues) => (
            <Tag color={values.saml_allow_unsolicited === "true" ? "green" : "default"}>
              {values.saml_allow_unsolicited === "true"
                ? t("settings.sso.enabled", { defaultValue: "Enabled" })
                : t("settings.sso.disabled", { defaultValue: "Disabled" })}
            </Tag>
          ),
        },
        {
          label: t("settings.sso.proxyBaseUrl", { defaultValue: "Proxy Base URL" }),
          render: (values: SSOSettingsValues) => renderSimpleValue(values.proxy_base_url),
        },
      ],
    },
  };

  const renderSSOSettings = () => {
    if (!ssoSettings?.values || !selectedProvider) return null;

    const { values } = ssoSettings;
    const config = providerConfigs[selectedProvider as keyof typeof providerConfigs];

    if (!config) return null;

    return (
      <Descriptions bordered {...descriptionsConfig}>
        <Descriptions.Item label={t("settings.sso.provider", { defaultValue: "Provider" })}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {ssoProviderLogoMap[selectedProvider] && (
              <Logo
                src={ssoProviderLogoMap[selectedProvider]}
                label={ssoProviderDisplayNames[selectedProvider] || selectedProvider}
                className="h-6 w-6 object-contain"
              />
            )}
            <span>{config.providerText}</span>
          </div>
        </Descriptions.Item>
        {config.fields.map(
          (field, index) =>
            field && (
              <Descriptions.Item key={index} label={field.label}>
                {field.render(values)}
              </Descriptions.Item>
            ),
        )}
      </Descriptions>
    );
  };

  return (
    <>
      {isLoading ? (
        <SSOSettingsLoadingSkeleton />
      ) : (
        <Space direction="vertical" size="large" className="w-full">
          <Card>
            <Space direction="vertical" size="large" className="w-full">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Shield className="w-6 h-6 text-gray-400" />
                  <div>
                    <Title level={3}>{t("settings.sso.title", { defaultValue: "SSO Configuration" })}</Title>
                    <Text type="secondary">
                      {t("settings.sso.subtitle", {
                        defaultValue: "Manage Single Sign-On authentication settings",
                      })}
                    </Text>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {isSSOConfigured && (
                    <>
                      <Button icon={<Edit className="w-4 h-4" />} onClick={() => setIsEditModalVisible(true)}>
                        {t("settings.sso.edit", { defaultValue: "Edit SSO Settings" })}
                      </Button>
                      <Button
                        danger
                        icon={<Trash2 className="w-4 h-4" />}
                        onClick={() => setIsDeleteModalVisible(true)}
                      >
                        {t("settings.sso.delete", { defaultValue: "Delete SSO Settings" })}
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {isSSOConfigured ? (
                renderSSOSettings()
              ) : (
                <SSOSettingsEmptyPlaceholder onAdd={() => setIsAddModalVisible(true)} />
              )}
            </Space>
          </Card>
          {roleMappings && <RoleMappings roleMappings={roleMappings} />}
        </Space>
      )}

      <DeleteSSOSettingsModal
        isVisible={isDeleteModalVisible}
        onCancel={() => setIsDeleteModalVisible(false)}
        onSuccess={() => refetch()}
      />

      <AddSSOSettingsModal
        isVisible={isAddModalVisible}
        onCancel={() => setIsAddModalVisible(false)}
        onSuccess={() => {
          setIsAddModalVisible(false);
          refetch();
        }}
      />

      <EditSSOSettingsModal
        isVisible={isEditModalVisible}
        onCancel={() => setIsEditModalVisible(false)}
        onSuccess={() => {
          setIsEditModalVisible(false);
          refetch();
        }}
      />
    </>
  );
}
