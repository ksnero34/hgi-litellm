import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Form, Typography, Select, Input, Switch, Modal } from "antd";
import { Button, TextInput } from "@tremor/react";
import {
  guardrail_provider_map,
  guardrailLogoMap,
  getGuardrailProviders,
  getSupportedModesForProvider,
  toModeArray,
  type SkipSystemMessageChoice,
  type SkipToolMessageChoice,
} from "./guardrail_info_helpers";
import { resolveLogoSrc } from "@/lib/assetPaths";
import { getGuardrailUISettings, getGlobalLitellmHeaderName } from "@/components/networking";
import PiiConfiguration from "./pii_configuration";
import NotificationsManager from "@/components/molecules/notifications_manager";

const { Title, Text } = Typography;
const { Option } = Select;

interface EditGuardrailFormProps {
  visible: boolean;
  onClose: () => void;
  accessToken: string | null;
  onSuccess: () => void;
  guardrailId: string;
  /** Full stored params merged into PUT so optional fields (e.g. content filter) are preserved. */
  fullLitellmParams?: Record<string, unknown> | null;
  initialValues: {
    guardrail_name: string;
    provider: string;
    mode: string;
    default_on: boolean;
    pii_entities_config?: { [key: string]: string };
    skip_system_message_choice?: SkipSystemMessageChoice;
    skip_tool_message_choice?: SkipToolMessageChoice;
    [key: string]: unknown;
  };
}

interface GuardrailSettings {
  supported_entities: string[];
  supported_actions: string[];
  supported_modes: string[];
  supported_modes_by_provider?: Record<string, string[]>;
  pii_entity_categories: Array<{
    category: string;
    entities: string[];
  }>;
}

const EditGuardrailForm: React.FC<EditGuardrailFormProps> = ({
  visible,
  onClose,
  accessToken,
  onSuccess,
  guardrailId,
  fullLitellmParams,
  initialValues,
}) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(initialValues?.provider || null);
  const [guardrailSettings, setGuardrailSettings] = useState<GuardrailSettings | null>(null);
  const [selectedEntities, setSelectedEntities] = useState<string[]>([]);
  const [selectedActions, setSelectedActions] = useState<{ [key: string]: string }>({});

  // Fetch guardrail settings when the component mounts
  useEffect(() => {
    const fetchGuardrailSettings = async () => {
      try {
        if (!accessToken) return;

        const data = await getGuardrailUISettings(accessToken);
        setGuardrailSettings(data);
      } catch (error) {
        console.error("Error fetching guardrail settings:", error);
        NotificationsManager.fromBackend(t("guardrails.edit.loadError"));
      }
    };

    fetchGuardrailSettings();
  }, [accessToken]);

  // Initialize selected entities and actions from initialValues
  useEffect(() => {
    if (initialValues?.pii_entities_config && Object.keys(initialValues.pii_entities_config).length > 0) {
      const entities = Object.keys(initialValues.pii_entities_config);
      setSelectedEntities(entities);
      setSelectedActions(initialValues.pii_entities_config);
    }
  }, [initialValues]);

  const handleProviderChange = (value: string) => {
    setSelectedProvider(value);
    // Reset form fields that are provider-specific
    form.setFieldsValue({
      config: undefined,
    });

    // Reset PII selections when changing provider
    setSelectedEntities([]);
    setSelectedActions({});
  };

  const handleEntitySelect = (entity: string) => {
    setSelectedEntities((prev) => {
      if (prev.includes(entity)) {
        return prev.filter((e) => e !== entity);
      } else {
        return [...prev, entity];
      }
    });
  };

  const handleActionSelect = (entity: string, action: string) => {
    setSelectedActions((prev) => ({
      ...prev,
      [entity]: action,
    }));
  };

  const handleSubmit = async () => {
    try {
      setLoading(true);
      const values = await form.validateFields();

      // Get the guardrail provider value from the map
      const guardrailProvider = guardrail_provider_map[values.provider];

      const litellm_params: Record<string, unknown> =
        fullLitellmParams && typeof fullLitellmParams === "object" ? { ...fullLitellmParams } : {};

      litellm_params.guardrail = guardrailProvider;
      litellm_params.mode = values.mode;
      litellm_params.default_on = values.default_on;

      const skipChoice = values.skip_system_message_choice as SkipSystemMessageChoice | undefined;
      if (skipChoice === "yes") {
        litellm_params.skip_system_message_in_guardrail = true;
      } else if (skipChoice === "no") {
        litellm_params.skip_system_message_in_guardrail = false;
      } else {
        delete litellm_params.skip_system_message_in_guardrail;
      }

      const skipToolChoice = values.skip_tool_message_choice as SkipToolMessageChoice | undefined;
      if (skipToolChoice === "yes") {
        litellm_params.skip_tool_message_in_guardrail = true;
      } else if (skipToolChoice === "no") {
        litellm_params.skip_tool_message_in_guardrail = false;
      } else {
        delete litellm_params.skip_tool_message_in_guardrail;
      }

      let guardrail_info: Record<string, unknown> = {};

      // For Presidio PII, add the entity and action configurations
      if (values.provider === "PresidioPII") {
        const piiEntitiesConfig: { [key: string]: string } = {};
        selectedEntities.forEach((entity) => {
          piiEntitiesConfig[entity] = selectedActions[entity] || "MASK";
        });

        litellm_params.pii_entities_config = piiEntitiesConfig;
      }
      // Add config values to the guardrail_info if provided
      else if (values.config) {
        try {
          const configObj = JSON.parse(values.config);
          // For some guardrails, the config values need to be in litellm_params
          // Especially for providers like Bedrock that need guardrailIdentifier and guardrailVersion
          if (values.provider === "Bedrock" && configObj) {
            if (configObj.guardrail_id) {
              litellm_params.guardrailIdentifier = configObj.guardrail_id;
            }
            if (configObj.guardrail_version) {
              litellm_params.guardrailVersion = configObj.guardrail_version;
            }
          } else {
            // For other providers, add the config to guardrail_info
            guardrail_info = configObj;
          }
        } catch (error) {
          NotificationsManager.fromBackend(t("guardrails.add.invalidJson"));
          setLoading(false);
          return;
        }
      }

      const guardrailData: {
        guardrail_id: string;
        guardrail: {
          guardrail_name: string;
          litellm_params: Record<string, unknown>;
          guardrail_info: Record<string, unknown>;
        };
      } = {
        guardrail_id: guardrailId,
        guardrail: {
          guardrail_name: values.guardrail_name,
          litellm_params,
          guardrail_info,
        },
      };

      if (!accessToken) {
        throw new Error("No access token available");
      }

      // Call the update endpoint
      const url = `/guardrails/${guardrailId}`;
      const response = await fetch(url, {
        method: "PUT",
        headers: {
          [getGlobalLitellmHeaderName()]: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(guardrailData),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(errorData || "Failed to update guardrail");
      }

      NotificationsManager.success(t("guardrails.edit.updated"));

      // Reset and close
      onSuccess();
      onClose();
    } catch (error) {
      console.error("Failed to update guardrail:", error);
      NotificationsManager.fromBackend(
        t("guardrails.edit.errorPrefix", { message: error instanceof Error ? error.message : String(error) }),
      );
    } finally {
      setLoading(false);
    }
  };

  const renderPiiConfiguration = () => {
    if (!guardrailSettings || !selectedProvider || selectedProvider !== "PresidioPII") return null;

    return (
      <PiiConfiguration
        entities={guardrailSettings.supported_entities}
        actions={guardrailSettings.supported_actions}
        selectedEntities={selectedEntities}
        selectedActions={selectedActions}
        onEntitySelect={handleEntitySelect}
        onActionSelect={handleActionSelect}
        entityCategories={guardrailSettings.pii_entity_categories}
      />
    );
  };

  const renderProviderSpecificFields = () => {
    if (!selectedProvider) return null;

    // For Presidio, we use the new PII configuration UI
    if (selectedProvider === "PresidioPII") {
      return renderPiiConfiguration();
    }

    switch (selectedProvider) {
      case "Aporia":
        return (
          <Form.Item
            label={t("guardrails.edit.aporiaConfig")}
            name="config"
            tooltip={t("guardrails.edit.aporiaTooltip")}
          >
            <Input.TextArea
              rows={4}
              placeholder={`{
  "api_key": "your_aporia_api_key",
  "project_name": "your_project_name"
}`}
            />
          </Form.Item>
        );
      case "AimSecurity":
        return (
          <Form.Item label={t("guardrails.edit.aimConfig")} name="config" tooltip={t("guardrails.edit.aimTooltip")}>
            <Input.TextArea
              rows={4}
              placeholder={`{
  "api_key": "your_aim_api_key"
}`}
            />
          </Form.Item>
        );
      case "Bedrock":
        return (
          <Form.Item
            label={t("guardrails.edit.bedrockConfig")}
            name="config"
            tooltip={t("guardrails.edit.bedrockTooltip")}
          >
            <Input.TextArea
              rows={4}
              placeholder={`{
  "guardrail_id": "your_guardrail_id",
  "guardrail_version": "your_guardrail_version"
}`}
            />
          </Form.Item>
        );
      case "CatoNetworks":
        return (
          <Form.Item label={t("guardrails.edit.catoConfig")} name="config" tooltip={t("guardrails.edit.catoTooltip")}>
            <Input.TextArea
              rows={4}
              placeholder={`{
  "api_key": "your_cato_api_key"
}`}
            />
          </Form.Item>
        );
      case "GuardrailsAI":
        return (
          <Form.Item
            label={t("guardrails.edit.guardrailsAiConfig")}
            name="config"
            tooltip={t("guardrails.edit.guardrailsAiTooltip")}
          >
            <Input.TextArea
              rows={4}
              placeholder={`{
  "api_key": "your_guardrails_api_key",
  "guardrail_id": "your_guardrail_id"
}`}
            />
          </Form.Item>
        );
      case "LakeraAI":
        return (
          <Form.Item
            label={t("guardrails.edit.lakeraConfig")}
            name="config"
            tooltip={t("guardrails.edit.lakeraTooltip")}
          >
            <Input.TextArea
              rows={4}
              placeholder={`{
  "api_key": "your_lakera_api_key"
}`}
            />
          </Form.Item>
        );
      case "PromptInjection":
        return (
          <Form.Item
            label={t("guardrails.edit.promptInjectionConfig")}
            name="config"
            tooltip={t("guardrails.edit.promptInjectionTooltip")}
          >
            <Input.TextArea
              rows={4}
              placeholder={`{
  "threshold": 0.8
}`}
            />
          </Form.Item>
        );
      default:
        return (
          <Form.Item
            label={t("guardrails.edit.customConfig")}
            name="config"
            tooltip={t("guardrails.edit.customConfigTooltip")}
          >
            <Input.TextArea
              rows={4}
              placeholder={`{
  "key1": "value1",
  "key2": "value2"
}`}
            />
          </Form.Item>
        );
    }
  };

  return (
    <Modal title={t("guardrails.modal.editTitle")} open={visible} onCancel={onClose} footer={null} width={700}>
      <Form form={form} layout="vertical" initialValues={initialValues}>
        <Form.Item
          name="guardrail_name"
          label={t("guardrails.form.name")}
          rules={[{ required: true, message: t("guardrails.form.nameRequired") }]}
        >
          <TextInput placeholder={t("guardrails.form.namePlaceholder")} />
        </Form.Item>

        <Form.Item
          name="provider"
          label={t("guardrails.form.provider")}
          rules={[{ required: true, message: t("guardrails.form.providerRequired") }]}
        >
          <Select
            placeholder={t("guardrails.form.providerPlaceholder")}
            onChange={handleProviderChange}
            disabled={true} // Disable changing provider in edit mode
            optionLabelProp="label"
          >
            {Object.entries(getGuardrailProviders()).map(([key, value]) => (
              <Option key={key} value={key} label={value}>
                <div style={{ display: "flex", alignItems: "center" }}>
                  {guardrailLogoMap[value] && (
                    <img
                      src={resolveLogoSrc(guardrailLogoMap[value])}
                      alt=""
                      style={{
                        height: "20px",
                        width: "20px",
                        marginRight: "8px",
                        objectFit: "contain",
                      }}
                      onError={(e) => {
                        // Hide broken image icon if image fails to load
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  )}
                  <span>{value}</span>
                </div>
              </Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="mode"
          label={t("guardrails.form.mode")}
          tooltip={t("guardrails.form.modeTooltip")}
          rules={[{ required: true, message: t("guardrails.form.modeRequired") }]}
        >
          <Select>
            {(() => {
              const modes = getSupportedModesForProvider(guardrailSettings, selectedProvider) ?? [
                "pre_call",
                "post_call",
              ];
              const currentModes = toModeArray(initialValues?.mode);
              const unsupportedCurrent = currentModes.filter((m) => !modes.includes(m));
              return [...unsupportedCurrent, ...modes].map((mode) => (
                <Option key={mode} value={mode}>
                  {unsupportedCurrent.includes(mode)
                    ? t("guardrails.edit.providerUnsupported", { mode, provider: selectedProvider ?? "" })
                    : mode}
                </Option>
              ));
            })()}
          </Select>
        </Form.Item>

        <Form.Item
          name="default_on"
          label={t("guardrails.form.alwaysOn")}
          tooltip={t("guardrails.form.alwaysOnTooltip")}
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>

        <Form.Item
          name="skip_system_message_choice"
          label={t("guardrails.form.skipSystem")}
          tooltip={t("guardrails.form.skipSystemTooltip")}
        >
          <Select>
            <Option value="inherit">{t("guardrails.form.useGlobalDefault")}</Option>
            <Option value="yes">{t("guardrails.form.skipExclude")}</Option>
            <Option value="no">{t("guardrails.form.skipInclude")}</Option>
          </Select>
        </Form.Item>

        <Form.Item
          name="skip_tool_message_choice"
          label={t("guardrails.form.skipTool")}
          tooltip={t("guardrails.form.skipToolTooltip")}
        >
          <Select>
            <Option value="inherit">{t("guardrails.form.useGlobalDefault")}</Option>
            <Option value="yes">{t("guardrails.form.skipExclude")}</Option>
            <Option value="no">{t("guardrails.form.skipInclude")}</Option>
          </Select>
        </Form.Item>

        {renderProviderSpecificFields()}

        <div className="flex justify-end space-x-2 mt-4">
          <Button variant="secondary" onClick={onClose}>
            {t("guardrails.actions.cancel")}
          </Button>
          <Button onClick={handleSubmit} loading={loading}>
            {t("guardrails.actions.update")}
          </Button>
        </div>
      </Form>
    </Modal>
  );
};

export default EditGuardrailForm;
