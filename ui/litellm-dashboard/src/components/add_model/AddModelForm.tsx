import { useProviderFields } from "@/app/(dashboard)/hooks/providers/useProviderFields";
import { useGuardrails } from "@/app/(dashboard)/hooks/guardrails/useGuardrails";
import { useTags } from "@/app/(dashboard)/hooks/tags/useTags";
import { all_admin_roles, isUserTeamAdminForAnyTeam } from "@/utils/roles";
import { modelCreationScope } from "@/utils/modelPermissions";
import { Switch, Text } from "@tremor/react";
import type { FormInstance } from "antd";
import { Select as AntdSelect, Button, Card, Col, Form, Modal, Row, Tooltip, Typography, Alert } from "antd";
import type { UploadProps } from "antd/es/upload";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import TeamDropdown from "../common_components/team_dropdown";
import type { Team } from "../key_team_helpers/key_list";
import { type CredentialItem, type ProviderCreateInfo, modelAvailableCall } from "../networking";
import { Providers } from "../provider_info_helpers";
import { ProviderLogo } from "../molecules/models/ProviderLogo";
import AdvancedSettings from "./advanced_settings";
import ConditionalPublicModelName from "./conditional_public_model_name";
import LiteLLMModelNameField from "./litellm_model_name";
import ConnectionErrorDisplay from "./model_connection_test";
import ProviderSpecificFields from "./provider_specific_fields";
import { TEST_MODES } from "./add_model_modes";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";

interface AddModelFormProps {
  form: FormInstance; // For the Add Model tab
  handleOk: () => Promise<void>;
  selectedProvider: Providers;
  setSelectedProvider: (provider: Providers) => void;
  providerModels: string[];
  setProviderModelsFn: (provider: Providers) => void;
  getPlaceholder: (provider: Providers) => string;
  uploadProps: UploadProps;
  showAdvancedSettings: boolean;
  setShowAdvancedSettings: (show: boolean) => void;
  teams: Team[] | null;
  credentials: CredentialItem[];
}

const { Title, Link } = Typography;

const AddModelForm: React.FC<AddModelFormProps> = ({
  form,
  handleOk,
  selectedProvider,
  setSelectedProvider,
  providerModels,
  setProviderModelsFn,
  getPlaceholder,
  uploadProps,
  showAdvancedSettings,
  setShowAdvancedSettings,
  teams,
  credentials,
}) => {
  const { t } = useTranslation();
  const [testMode, setTestMode] = useState<string>("chat");
  const [isResultModalVisible, setIsResultModalVisible] = useState<boolean>(false);
  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false);
  // Using a unique ID to force the ConnectionErrorDisplay to remount and run a fresh test
  const [connectionTestId, setConnectionTestId] = useState<string>("");

  const { accessToken, userRole, premiumUser, userId } = useAuthorized();
  const {
    data: providerMetadata,
    isLoading: isProviderMetadataLoading,
    error: providerMetadataError,
  } = useProviderFields();
  const { data: guardrailsData } = useGuardrails();
  const guardrailsList = guardrailsData?.guardrails.map((g) => g.guardrail_name);
  const { data: tagsList } = useTags();

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setConnectionTestId(`test-${Date.now()}`);
    setIsResultModalVisible(true);
  };

  const [isTeamOnly, setIsTeamOnly] = useState<boolean>(false);
  const [modelAccessGroups, setModelAccessGroups] = useState<string[]>([]);
  // Team admin specific state
  const [teamAdminSelectedTeam, setTeamAdminSelectedTeam] = useState<string | null>(null);

  useEffect(() => {
    const fetchModelAccessGroups = async () => {
      const response = await modelAvailableCall(accessToken, "", "", false, null, true, true);
      setModelAccessGroups(response["data"].map((model: any) => model["id"]));
    };
    fetchModelAccessGroups();
  }, [accessToken]);

  const sortedProviderMetadata: ProviderCreateInfo[] = useMemo(() => {
    if (!providerMetadata) {
      return [];
    }
    return [...providerMetadata].sort((a, b) => a.provider_display_name.localeCompare(b.provider_display_name));
  }, [providerMetadata]);

  const providerMetadataErrorText = providerMetadataError
    ? providerMetadataError instanceof Error
      ? providerMetadataError.message
      : t("modelManagement.loadProvidersFailed")
    : null;

  const isAdmin = all_admin_roles.includes(userRole);
  const isTeamAdmin = isUserTeamAdminForAnyTeam(teams, userId);
  // Same owner the Auto-Routers tab uses, so the two creation forms cannot disagree about
  // who has to name a team. This form is only reachable when creation is allowed at all.
  const createScope = modelCreationScope({ userRole, userID: userId }, { teams, disabledForInternalUsers: false });
  const requiresTeamScope = createScope === "team-required";

  return (
    <>
      <Title level={2}>{t("modelManagement.addModel")}</Title>

      <Card>
        <Form
          form={form}
          onFinish={async (values) => {
            await handleOk().then(() => {
              setTeamAdminSelectedTeam(null);
            });
          }}
          onFinishFailed={(errorInfo) => {}}
          labelCol={{ span: 10 }}
          wrapperCol={{ span: 16 }}
          labelAlign="left"
        >
          <>
            {requiresTeamScope && (
              <>
                <Form.Item
                  label={t("modelManagement.selectTeam")}
                  name="team_id"
                  rules={[{ required: true, message: t("modelManagement.selectTeamRequired") }]}
                  tooltip={t("modelManagement.selectTeamTooltip")}
                >
                  <TeamDropdown
                    onChange={(value) => {
                      setTeamAdminSelectedTeam(value);
                    }}
                  />
                </Form.Item>
                {!teamAdminSelectedTeam && (
                  <Alert
                    message={t("modelManagement.teamSelectionRequired")}
                    description={t("modelManagement.teamSelectionDescription")}
                    type="info"
                    showIcon
                    className="mb-4"
                  />
                )}
              </>
            )}
            {(isAdmin || (isTeamAdmin && teamAdminSelectedTeam)) && (
              <>
                <Form.Item
                  rules={[{ required: true, message: t("modelManagement.required") }]}
                  label={t("modelManagement.providerLabel")}
                  name="custom_llm_provider"
                  tooltip={t("modelManagement.providerTooltip")}
                  labelCol={{ span: 10 }}
                  labelAlign="left"
                >
                  <AntdSelect
                    virtual={false}
                    showSearch
                    loading={isProviderMetadataLoading}
                    placeholder={
                      isProviderMetadataLoading
                        ? t("modelManagement.loadingProviders")
                        : t("modelManagement.selectProvider")
                    }
                    optionFilterProp="data-label"
                    onChange={(value) => {
                      setSelectedProvider(value as Providers);
                      setProviderModelsFn(value as Providers);
                      form.setFieldsValue({
                        custom_llm_provider: value,
                      });
                      form.setFieldsValue({
                        model: [],
                        model_name: undefined,
                      });
                    }}
                  >
                    {providerMetadataErrorText && sortedProviderMetadata.length === 0 && (
                      <AntdSelect.Option key="__error" value="">
                        {providerMetadataErrorText}
                      </AntdSelect.Option>
                    )}
                    {sortedProviderMetadata.map((providerInfo) => {
                      const displayName = providerInfo.provider_display_name;
                      const providerKey = providerInfo.provider;

                      return (
                        <AntdSelect.Option key={providerKey} value={providerKey} data-label={displayName}>
                          <div className="flex items-center space-x-2">
                            <ProviderLogo provider={providerKey} className="w-5 h-5" />
                            <span>{displayName}</span>
                          </div>
                        </AntdSelect.Option>
                      );
                    })}
                  </AntdSelect>
                </Form.Item>
                <LiteLLMModelNameField
                  selectedProvider={selectedProvider}
                  providerModels={providerModels}
                  getPlaceholder={getPlaceholder}
                />

                {/* Conditionally Render "Public Model Name" */}
                <ConditionalPublicModelName />

                {/* Select Mode */}
                <Form.Item label={t("modelManagement.modeLabel")} name="mode" className="mb-1">
                  <AntdSelect
                    style={{ width: "100%" }}
                    value={testMode}
                    onChange={(value) => setTestMode(value)}
                    options={TEST_MODES}
                  />
                </Form.Item>
                <Row>
                  <Col span={10}></Col>
                  <Col span={10}>
                    <Text className="mb-5 mt-1">
                      <strong>{t("modelManagement.optional")}</strong> - {t("modelManagement.healthCheckEndpointHelp")}{" "}
                      <Link href="https://docs.litellm.ai/docs/proxy/health#health" target="_blank">
                        {t("modelManagement.learnMore")}
                      </Link>
                    </Text>
                  </Col>
                </Row>

                {/* Credentials */}
                <div className="mb-4">
                  <Typography.Text className="text-sm text-gray-500 mb-2">
                    {t("modelManagement.credentialsChoice")}
                  </Typography.Text>
                </div>

                <Form.Item
                  label={t("modelManagement.existingCredentials")}
                  name="litellm_credential_name"
                  initialValue={null}
                >
                  <AntdSelect
                    showSearch
                    placeholder={t("modelManagement.selectCredentials")}
                    optionFilterProp="children"
                    filterOption={(input, option) => (option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
                    options={[
                      { value: null, label: t("modelManagement.none") },
                      ...credentials.map((credential) => ({
                        value: credential.credential_name,
                        label: credential.credential_name,
                      })),
                    ]}
                    allowClear
                  />
                </Form.Item>

                <Form.Item
                  noStyle
                  shouldUpdate={(prevValues, currentValues) =>
                    prevValues.litellm_credential_name !== currentValues.litellm_credential_name ||
                    prevValues.provider !== currentValues.provider
                  }
                >
                  {({ getFieldValue }) => {
                    const credentialName = getFieldValue("litellm_credential_name");
                    // Only show provider specific fields if no credentials selected
                    if (!credentialName) {
                      return (
                        <>
                          <div className="flex items-center my-4">
                            <div className="grow border-t border-gray-200"></div>
                            <span className="px-4 text-gray-500 text-sm">{t("modelManagement.or")}</span>
                            <div className="grow border-t border-gray-200"></div>
                          </div>
                          <ProviderSpecificFields selectedProvider={selectedProvider} uploadProps={uploadProps} />
                        </>
                      );
                    }
                    return null;
                  }}
                </Form.Item>
                <div className="flex items-center my-4">
                  <div className="grow border-t border-gray-200"></div>
                  <span className="px-4 text-gray-500 text-sm">{t("modelManagement.additionalSettings")}</span>
                  <div className="grow border-t border-gray-200"></div>
                </div>
                {/* Team-only Model Switch - Only show for proxy admins, not team admins */}
                {(isAdmin || !isTeamAdmin) && premiumUser && (
                  <Form.Item
                    label={t("modelManagement.teamByokModel")}
                    tooltip={t("modelManagement.teamByokTooltip")}
                    className="mb-4"
                  >
                    <Tooltip title="" placement="top">
                      <Switch
                        checked={isTeamOnly}
                        onChange={(checked) => {
                          setIsTeamOnly(checked);
                          if (!checked) {
                            form.setFieldValue("team_id", undefined);
                          }
                        }}
                        disabled={!premiumUser}
                      />
                    </Tooltip>
                  </Form.Item>
                )}

                {/* Conditional Team Selection */}
                {isTeamOnly && !requiresTeamScope && (
                  <Form.Item
                    label={t("modelManagement.selectTeam")}
                    name="team_id"
                    className="mb-4"
                    tooltip={t("modelManagement.teamOnlyTooltip")}
                    rules={[
                      {
                        required: isTeamOnly && !isAdmin,
                        message: t("modelManagement.selectTeamShortRequired"),
                      },
                    ]}
                  >
                    <TeamDropdown disabled={!premiumUser} />
                  </Form.Item>
                )}
                {isAdmin && (
                  <>
                    <Form.Item
                      label={t("modelManagement.accessGroup")}
                      name="model_access_group"
                      className="mb-4"
                      tooltip={t("modelManagement.accessGroupTooltip")}
                    >
                      <AntdSelect
                        mode="tags"
                        showSearch
                        placeholder={t("modelManagement.accessGroupPlaceholder")}
                        optionFilterProp="children"
                        tokenSeparators={[","]}
                        options={modelAccessGroups.map((group) => ({
                          value: group,
                          label: group,
                        }))}
                        maxTagCount="responsive"
                        allowClear
                      />
                    </Form.Item>
                  </>
                )}
                <AdvancedSettings
                  showAdvancedSettings={showAdvancedSettings}
                  setShowAdvancedSettings={setShowAdvancedSettings}
                  teams={teams}
                  guardrailsList={guardrailsList || []}
                  tagsList={tagsList || {}}
                  accessToken={accessToken || ""}
                />
              </>
            )}
            <div className="flex justify-between items-center mb-4">
              <Tooltip title={t("modelManagement.helpTooltip")}>
                <Typography.Link href="https://github.com/BerriAI/litellm/issues">
                  {t("modelManagement.needHelp")}
                </Typography.Link>
              </Tooltip>
              <div className="space-x-2">
                <Button data-testid="test-connect-btn" onClick={handleTestConnection} loading={isTestingConnection}>
                  {t("modelManagement.testConnect")}
                </Button>
                <Button data-testid="add-model-btn" htmlType="submit">
                  {t("modelManagement.addModel")}
                </Button>
              </div>
            </div>
          </>
        </Form>
      </Card>

      {/* Test Connection Results Modal */}
      <Modal
        title={t("modelManagement.connectionResults")}
        open={isResultModalVisible}
        onCancel={() => {
          setIsResultModalVisible(false);
          setIsTestingConnection(false);
        }}
        footer={[
          <Button
            key="close"
            onClick={() => {
              setIsResultModalVisible(false);
              setIsTestingConnection(false);
            }}
          >
            Close
          </Button>,
        ]}
        width={700}
      >
        {/* Only render the ConnectionErrorDisplay when modal is visible and we have a test ID */}
        {isResultModalVisible && (
          <ConnectionErrorDisplay
            // The key prop tells React to create a fresh component instance when it changes
            key={connectionTestId}
            formValues={form.getFieldsValue()}
            accessToken={accessToken}
            testMode={testMode}
            modelName={form.getFieldValue("model_name") || form.getFieldValue("model")}
            onClose={() => {
              setIsResultModalVisible(false);
              setIsTestingConnection(false);
            }}
            onTestComplete={() => setIsTestingConnection(false)}
          />
        )}
      </Modal>
    </>
  );
};

export default AddModelForm;
