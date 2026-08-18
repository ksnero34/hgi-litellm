import GuardrailSelector from "@/components/guardrails/GuardrailSelector";
import { useOrganizations } from "@/app/(dashboard)/hooks/organizations/useOrganizations";
import { useProjects } from "@/app/(dashboard)/hooks/projects/useProjects";
import { useUISettings } from "@/app/(dashboard)/hooks/uiSettings/useUISettings";
import PolicySelector from "@/components/policies/PolicySelector";
import { InfoCircleOutlined } from "@ant-design/icons";
import { TextInput, Button as TremorButton } from "@tremor/react";
import { Form, Input, Select, Switch, Tooltip } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { rolesWithWriteAccess } from "../../utils/roles";
import AgentSelector from "../agent_management/AgentSelector";
import AccessGroupSelector from "../common_components/AccessGroupSelector";
import BudgetDurationDropdown from "../common_components/budget_duration_dropdown";
import KeyLifecycleSettings from "../common_components/KeyLifecycleSettings";
import PassThroughRoutesSelector from "../common_components/PassThroughRoutesSelector";
import RateLimitTypeFormItem from "../common_components/RateLimitTypeFormItem";
import OrganizationDropdown from "../common_components/OrganizationDropdown";
import { formatMetadataForDisplay, stripTagsFromMetadata } from "../key_info_utils";
import { BudgetFallbacksEditor } from "../key_team_helpers/BudgetFallbacksEditor";
import { BudgetWindowEntry, BudgetWindowsEditor } from "../key_team_helpers/BudgetWindowsEditor";
import {
  TagRateLimitEditor,
  TagRateLimitEntry,
  tagLimitsToRows,
  tagRowsToLimits,
} from "../key_team_helpers/TagRateLimitEditor";
import { excludeProxyWideSentinel, hasAllModelsSentinel } from "../key_team_helpers/fetch_available_models_team_key";
import { KeyResponse } from "../key_team_helpers/key_list";
import MCPServerSelector from "../mcp_server_management/MCPServerSelector";
import { NO_MCP_SERVERS_SENTINEL } from "../mcp_tools/constants";
import MCPToolPermissions from "../mcp_server_management/MCPToolPermissions";
import NotificationsManager from "../molecules/notifications_manager";
import { modelAvailableCall, tagListCall } from "../networking";
import { fetchTeamModels } from "../organisms/create_key_button";
import NumericalInput from "../shared/numerical_input";
import { Tag } from "../tag_management/types";
import VectorStoreSelector from "../vector_store_management/VectorStoreSelector";

interface KeyEditViewProps {
  keyData: KeyResponse;
  onCancel: () => void;
  onSubmit: (values: any) => Promise<void>;
  teams?: any[] | null;
  accessToken: string | null;
  userID: string | null;
  userRole: string | null;
  premiumUser?: boolean;
  managedPersonalKey?: boolean;
}

// Add this helper function

// Helper function to determine key_type display value from allowed_routes
const getKeyTypeFromRoutes = (allowedRoutes: string[] | null | undefined): string => {
  if (!allowedRoutes || allowedRoutes.length === 0) {
    return "default";
  }

  if (allowedRoutes.includes("llm_api_routes")) {
    return "llm_api";
  }

  if (allowedRoutes.includes("management_routes")) {
    return "management";
  }

  if (allowedRoutes.includes("info_routes")) {
    return "read_only";
  }

  return "default";
};

const parseAllowlistValues = (value: unknown): string[] | undefined => {
  if (typeof value !== "string" && !Array.isArray(value)) {
    return undefined;
  }
  const values = typeof value === "string" ? [value] : value;
  return values
    .filter((entry): entry is string => typeof entry === "string")
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const managedPersonalKeyExcludedFields =
  "agent_id auto_rotate blocked budget_id duration organization_id rotation_interval spend team_id temp_budget_expiry temp_budget_increase user_id".split(
    " ",
  );

export function KeyEditView({
  keyData,
  onCancel,
  onSubmit,
  teams,
  accessToken,
  userID,
  userRole,
  premiumUser = false,
  managedPersonalKey = false,
}: KeyEditViewProps) {
  const { t } = useTranslation();
  const canEditGuardrails = premiumUser || (userRole != null && rolesWithWriteAccess.includes(userRole));
  const [form] = Form.useForm();
  const [tagsList, setTagsList] = useState<Record<string, Tag>>({});
  const team = teams?.find((team) => team.team_id === keyData.team_id);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(keyData.organization_id || null);
  const [autoRotationEnabled, setAutoRotationEnabled] = useState<boolean>(keyData.auto_rotate || false);
  const [rotationInterval, setRotationInterval] = useState<string>(keyData.rotation_interval || "");
  const [neverExpire, setNeverExpire] = useState<boolean>(!keyData.expires);
  const [isKeySaving, setIsKeySaving] = useState(false);
  const [budgetLimits, setBudgetLimits] = useState<BudgetWindowEntry[]>(
    Array.isArray(keyData.budget_limits) ? keyData.budget_limits : [],
  );
  const [tagRateLimits, setTagRateLimits] = useState<TagRateLimitEntry[]>(
    tagLimitsToRows(keyData.metadata?.tag_rpm_limit),
  );
  const [budgetFallbacks, setBudgetFallbacks] = useState<Record<string, string[]>>(
    keyData.budget_fallbacks && typeof keyData.budget_fallbacks === "object" ? keyData.budget_fallbacks : {},
  );
  const { data: organizations, isLoading: isOrganizationsLoading } = useOrganizations();
  const { data: projects } = useProjects();
  const { data: uiSettingsData } = useUISettings();
  const enableProjectsUI = Boolean(uiSettingsData?.values?.enable_projects_ui);
  const hasProject = Boolean(keyData.project_id);
  const projectDisplay = (() => {
    if (!keyData.project_id) return null;
    const project = projects?.find((p) => p.project_id === keyData.project_id);
    return project?.project_alias ? `${project.project_alias} (${keyData.project_id})` : keyData.project_id;
  })();

  useEffect(() => {
    const fetchModels = async () => {
      if (!userID || !userRole || !accessToken) return;

      try {
        if (keyData.team_id === null) {
          // Fetch user models if no team
          const model_available = await modelAvailableCall(accessToken, userID, userRole);
          const available_model_names = model_available["data"].map((element: { id: string }) => element.id);
          setAvailableModels(excludeProxyWideSentinel(available_model_names));
        } else if (team?.team_id) {
          // Fetch team models if team exists
          const models = await fetchTeamModels(userID, userRole, accessToken, team.team_id);
          setAvailableModels(excludeProxyWideSentinel(Array.from(new Set([...team.models, ...models]))));
        }
      } catch (error) {
        console.error("Error fetching models:", error);
      }
    };

    fetchModels();
  }, [userID, userRole, accessToken, team, keyData.team_id]);

  // Convert API budget duration to form format
  const getBudgetDuration = (duration: string | null) => {
    if (!duration) return null;
    const wordToCanonical: Record<string, string> = {
      hourly: "1h",
      daily: "24h",
      weekly: "7d",
      monthly: "30d",
    };
    return wordToCanonical[duration] ?? duration;
  };

  // Set initial form values
  const initialValues = {
    ...keyData,
    token: keyData.token || keyData.token_id,
    budget_duration: getBudgetDuration(keyData.budget_duration),
    metadata: formatMetadataForDisplay(stripTagsFromMetadata(keyData.metadata)),
    guardrails: keyData.metadata?.guardrails,
    disable_global_guardrails: keyData.metadata?.disable_global_guardrails || false,
    throttle_on_budget_exceeded: keyData.metadata?.throttle_on_budget_exceeded || false,
    tags: keyData.metadata?.tags,
    vector_stores: keyData.object_permission?.vector_stores || [],
    mcp_servers_and_groups: {
      servers: keyData.object_permission?.mcp_servers || [],
      accessGroups: keyData.object_permission?.mcp_access_groups || [],
      toolsets: keyData.object_permission?.mcp_toolsets || [],
    },
    mcp_tool_permissions: keyData.object_permission?.mcp_tool_permissions || {},
    agents_and_groups: {
      agents: keyData.object_permission?.agents || [],
      accessGroups: keyData.object_permission?.agent_access_groups || [],
    },
    access_group_ids: keyData.access_group_ids || [],
    auto_rotate: keyData.auto_rotate || false,
    ...(keyData.rotation_interval && { rotation_interval: keyData.rotation_interval }),
    allowed_routes:
      Array.isArray(keyData.allowed_routes) && keyData.allowed_routes.length > 0
        ? keyData.allowed_routes.join(", ")
        : "",
    allowed_ip_ranges: keyData.allowed_ip_ranges ?? [],
  };

  useEffect(() => {
    form.setFieldsValue({
      ...keyData,
      token: keyData.token || keyData.token_id,
      budget_duration: getBudgetDuration(keyData.budget_duration),
      metadata: formatMetadataForDisplay(stripTagsFromMetadata(keyData.metadata)),
      guardrails: keyData.metadata?.guardrails,
      disable_global_guardrails: keyData.metadata?.disable_global_guardrails || false,
      tags: keyData.metadata?.tags,
      vector_stores: keyData.object_permission?.vector_stores || [],
      mcp_servers_and_groups: {
        servers: keyData.object_permission?.mcp_servers || [],
        accessGroups: keyData.object_permission?.mcp_access_groups || [],
        toolsets: keyData.object_permission?.mcp_toolsets || [],
      },
      mcp_tool_permissions: keyData.object_permission?.mcp_tool_permissions || {},
      throttle_on_budget_exceeded: keyData.metadata?.throttle_on_budget_exceeded || false,
      access_group_ids: keyData.access_group_ids || [],
      auto_rotate: keyData.auto_rotate || false,
      ...(keyData.rotation_interval && { rotation_interval: keyData.rotation_interval }),
      allowed_routes:
        Array.isArray(keyData.allowed_routes) && keyData.allowed_routes.length > 0
          ? keyData.allowed_routes.join(", ")
          : "",
      allowed_ip_ranges: keyData.allowed_ip_ranges ?? [],
    });
  }, [keyData, form]);

  // Sync auto-rotation state with form values
  useEffect(() => {
    form.setFieldValue("auto_rotate", autoRotationEnabled);
  }, [autoRotationEnabled, form]);

  useEffect(() => {
    if (rotationInterval) {
      form.setFieldValue("rotation_interval", rotationInterval);
    }
  }, [rotationInterval, form]);

  // Fetch tags for selector
  useEffect(() => {
    const fetchTags = async () => {
      if (!accessToken) return;
      try {
        const response = await tagListCall(accessToken);
        setTagsList(response);
      } catch (error) {
        NotificationsManager.fromBackend(t("gateway.keyEdit.fetchTagsError", { error: String(error) }));
      }
    };
    fetchTags();
  }, [accessToken, t]);

  const handleSubmit = async (values: any) => {
    try {
      setIsKeySaving(true);

      // Parse allowed_routes from comma-separated string to array
      if (typeof values.allowed_routes === "string") {
        const trimmedInput = values.allowed_routes.trim();
        if (trimmedInput === "") {
          values.allowed_routes = [];
        } else {
          values.allowed_routes = trimmedInput
            .split(",")
            .map((route: string) => route.trim())
            .filter((route: string) => route.length > 0);
        }
      }
      // If it's already an array (shouldn't happen, but handle it), keep as is

      // Backend rejects non-empty allowed_routes from non-admins, so re-sending
      // an unchanged value 403s a team admin. Set compare tolerates reorder.
      const originalRoutesSet = new Set<string>(Array.isArray(keyData.allowed_routes) ? keyData.allowed_routes : []);
      const submittedRoutesSet = new Set<string>(Array.isArray(values.allowed_routes) ? values.allowed_routes : []);
      const allowedRoutesUnchanged =
        originalRoutesSet.size === submittedRoutesSet.size &&
        [...submittedRoutesSet].every((r) => originalRoutesSet.has(r));
      if (allowedRoutesUnchanged) {
        delete values.allowed_routes;
      }

      const submittedIpRanges = parseAllowlistValues(values.allowed_ip_ranges);
      if (submittedIpRanges !== undefined) {
        values.allowed_ip_ranges = submittedIpRanges;
      }
      const originalIpRangesSet = new Set<string>(
        Array.isArray(keyData.allowed_ip_ranges) ? keyData.allowed_ip_ranges : [],
      );
      const submittedIpRangesSet = new Set<string>(
        Array.isArray(values.allowed_ip_ranges) ? values.allowed_ip_ranges : [],
      );
      const allowedIpRangesUnchanged =
        originalIpRangesSet.size === submittedIpRangesSet.size &&
        [...submittedIpRangesSet].every((ipRange) => originalIpRangesSet.has(ipRange));
      if (allowedIpRangesUnchanged) {
        delete values.allowed_ip_ranges;
      }

      if (neverExpire) {
        values.duration = null;
      }

      if (keyData.budget_duration && !values.budget_duration) {
        values.budget_duration = null;
      }

      // Reconcile multi-window budget limits from the editor state, dropping
      // incomplete entries (no max_budget). The backend treats any budget_limits
      // in a /key/update request as an admin-only budget change, so re-sending
      // the stored windows on an unrelated edit 403s a non-admin key owner
      // (issue #33246). Only send the field when the user actually changed the
      // windows, mirroring how allowed_routes is dropped above when unchanged:
      // compare on (duration, cap), ignoring server-owned reset_at and order.
      // Sending [] clears every window, so send it only when the user removed
      // the last one; otherwise leave the field off (JSON.stringify drops the
      // undefined key) so an unchanged or incomplete editor state never touches
      // storage.
      const windowSignature = (windows: Array<{ budget_duration: string; max_budget: number | null }> | undefined) =>
        (windows ?? [])
          .filter((w) => w.budget_duration && w.max_budget !== null && w.max_budget !== undefined)
          .map((w) => `${w.budget_duration}:${w.max_budget}`)
          .sort()
          .join("|");
      const validWindows = budgetLimits.filter(
        (w) => w.budget_duration && w.max_budget !== null && w.max_budget !== undefined,
      );
      const budgetLimitsUnchanged = windowSignature(keyData.budget_limits) === windowSignature(validWindows);
      if (budgetLimitsUnchanged) {
        // no-op: leave budget_limits off the payload
      } else if (validWindows.length > 0) {
        values.budget_limits = validWindows;
      } else if (budgetLimits.length === 0) {
        values.budget_limits = [];
      }

      // Always send the current per-tag limit map so removing every row
      // clears the stored limits ({} overwrites the metadata field).
      const { tag_rpm_limit } = tagRowsToLimits(tagRateLimits);
      values.tag_rpm_limit = tag_rpm_limit;

      const hadExistingFallbacks = keyData.budget_fallbacks != null && Object.keys(keyData.budget_fallbacks).length > 0;
      if (Object.keys(budgetFallbacks).length > 0) {
        values.budget_fallbacks = budgetFallbacks;
      } else if (hadExistingFallbacks) {
        values.budget_fallbacks = {};
      }

      if (managedPersonalKey) {
        for (const field of managedPersonalKeyExcludedFields) {
          delete values[field];
        }
      }

      await onSubmit(values);
    } finally {
      setIsKeySaving(false);
    }
  };

  return (
    <Form form={form} onFinish={handleSubmit} initialValues={initialValues} layout="vertical">
      <Form.Item label={t("gateway.keyEdit.keyAlias")} name="key_alias">
        <TextInput />
      </Form.Item>

      <Form.Item label={t("gateway.keyEdit.models")} name="models">
        <Form.Item
          noStyle
          shouldUpdate={(prevValues, currentValues) =>
            prevValues.allowed_routes !== currentValues.allowed_routes || prevValues.models !== currentValues.models
          }
        >
          {({ getFieldValue, setFieldValue }) => {
            const allowedRoutesValue = getFieldValue("allowed_routes") || "";
            // Convert string to array for checking
            const allowedRoutes =
              typeof allowedRoutesValue === "string" && allowedRoutesValue.trim() !== ""
                ? allowedRoutesValue
                    .split(",")
                    .map((r: string) => r.trim())
                    .filter((r: string) => r.length > 0)
                : [];
            const isDisabled = allowedRoutes.includes("management_routes") || allowedRoutes.includes("info_routes");
            const models = getFieldValue("models") || [];

            return (
              <>
                <Select
                  mode="multiple"
                  placeholder={t("gateway.createKey.modelsPlaceholder")}
                  style={{ width: "100%" }}
                  disabled={isDisabled}
                  value={isDisabled ? [] : models}
                  onChange={(value) => {
                    if (value.includes("all-team-models")) {
                      setFieldValue("models", ["all-team-models"]);
                    } else if (value.includes("all-proxy-models")) {
                      setFieldValue("models", ["all-proxy-models"]);
                    } else {
                      setFieldValue("models", value);
                    }
                  }}
                >
                  {keyData.team_id != null ? (
                    team != null && (
                      <Select.Option value="all-team-models">{t("gateway.createKey.modelsAllTeam")}</Select.Option>
                    )
                  ) : (
                    <Select.Option value="all-proxy-models">{t("gateway.createKey.modelsAllProxy")}</Select.Option>
                  )}
                  {availableModels.map((model) => (
                    <Select.Option key={model} value={model} disabled={hasAllModelsSentinel(models)}>
                      {model}
                    </Select.Option>
                  ))}
                </Select>
                {isDisabled && (
                  <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                    {t("gateway.createKey.modelsDisabled")}
                  </div>
                )}
              </>
            );
          }}
        </Form.Item>
      </Form.Item>

      <Form.Item label={t("gateway.createKey.keyTypePlaceholder")}>
        <Form.Item
          noStyle
          shouldUpdate={(prevValues, currentValues) => prevValues.allowed_routes !== currentValues.allowed_routes}
        >
          {({ getFieldValue, setFieldValue }) => {
            const allowedRoutesValue = getFieldValue("allowed_routes") || "";
            // Convert string to array for getKeyTypeFromRoutes
            const allowedRoutes =
              typeof allowedRoutesValue === "string" && allowedRoutesValue.trim() !== ""
                ? allowedRoutesValue
                    .split(",")
                    .map((r: string) => r.trim())
                    .filter((r: string) => r.length > 0)
                : [];
            const keyTypeValue = getKeyTypeFromRoutes(allowedRoutes);

            return (
              <Select
                placeholder={t("gateway.createKey.keyTypePlaceholder")}
                style={{ width: "100%" }}
                optionLabelProp="label"
                value={keyTypeValue}
                onChange={(value) => {
                  switch (value) {
                    case "default":
                      setFieldValue("allowed_routes", "");
                      break;
                    case "llm_api":
                      setFieldValue("allowed_routes", "llm_api_routes");
                      break;
                    case "management":
                      setFieldValue("allowed_routes", "management_routes");
                      setFieldValue("models", []);
                      break;
                  }
                }}
              >
                <Select.Option value="default" label={t("gateway.keyEdit.fullAccess")}>
                  <div style={{ padding: "4px 0" }}>
                    <div style={{ fontWeight: 500 }}>{t("gateway.keyEdit.fullAccess")}</div>
                    <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                      {t("gateway.keyEdit.fullAccessDescription")}
                    </div>
                  </div>
                </Select.Option>
                <Select.Option value="llm_api" label={t("gateway.keyEdit.aiApis")}>
                  <div style={{ padding: "4px 0" }}>
                    <div style={{ fontWeight: 500 }}>{t("gateway.keyEdit.aiApis")}</div>
                    <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                      {t("gateway.keyEdit.aiApisDescription")}
                    </div>
                  </div>
                </Select.Option>
                <Select.Option value="management" label={t("gateway.keyEdit.management")}>
                  <div style={{ padding: "4px 0" }}>
                    <div style={{ fontWeight: 500 }}>{t("gateway.keyEdit.management")}</div>
                    <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                      {t("gateway.keyEdit.managementDescription")}
                    </div>
                  </div>
                </Select.Option>
              </Select>
            );
          }}
        </Form.Item>
      </Form.Item>

      <Form.Item
        label={
          <span>
            {t("gateway.keyEdit.allowedRoutes")}{" "}
            <Tooltip title={t("gateway.keyEdit.allowedRoutesTooltip")}>
              <InfoCircleOutlined style={{ marginLeft: "4px" }} />
            </Tooltip>
          </span>
        }
        name="allowed_routes"
      >
        <Input placeholder={t("gateway.keyEdit.allowedRoutesPlaceholder")} />
      </Form.Item>

      <Form.Item
        label={
          <span>
            {t("gateway.ipAllowlist.label")}{" "}
            <Tooltip title={t("gateway.ipAllowlist.tooltip")}>
              <InfoCircleOutlined style={{ marginLeft: "4px" }} />
            </Tooltip>
          </span>
        }
        name="allowed_ip_ranges"
        extra={t("gateway.ipAllowlist.help")}
      >
        <Select
          mode="tags"
          tokenSeparators={[","]}
          placeholder={t("gateway.ipAllowlist.placeholder")}
          style={{ width: "100%" }}
        />
      </Form.Item>

      <Form.Item label={t("gateway.keyEdit.maxBudget")} name="max_budget">
        <NumericalInput step={0.01} style={{ width: "100%" }} placeholder={t("gateway.keyEdit.numericPlaceholder")} />
      </Form.Item>

      <Form.Item label={t("gateway.keyEdit.resetBudget")} name="budget_duration">
        <BudgetDurationDropdown placeholder={t("gateway.keyEdit.neverResets", { defaultValue: "Never resets" })} />
      </Form.Item>

      <Form.Item
        label={
          <span>
            {t("gateway.keyEdit.budgetWindows")}{" "}
            <Tooltip title={t("gateway.keyEdit.budgetWindowsTooltip")}>
              <InfoCircleOutlined style={{ marginLeft: "4px" }} />
            </Tooltip>
          </span>
        }
      >
        <BudgetWindowsEditor value={budgetLimits} onChange={setBudgetLimits} />
      </Form.Item>

      <Form.Item
        label={
          <span>
            {t("gateway.keyEdit.budgetFallbacks")}{" "}
            <Tooltip title={t("gateway.keyEdit.budgetFallbacksTooltip")}>
              <InfoCircleOutlined style={{ marginLeft: "4px" }} />
            </Tooltip>
          </span>
        }
      >
        <BudgetFallbacksEditor
          value={budgetFallbacks}
          onChange={setBudgetFallbacks}
          availableModels={availableModels}
        />
      </Form.Item>

      <Form.Item label={t("gateway.regenerate.tpmLimit")} name="tpm_limit">
        <NumericalInput min={0} />
      </Form.Item>

      <RateLimitTypeFormItem type="tpm" name="tpm_limit_type" showDetailedDescriptions={false} />

      <Form.Item label={t("gateway.regenerate.rpmLimit")} name="rpm_limit">
        <NumericalInput min={0} />
      </Form.Item>

      <RateLimitTypeFormItem type="rpm" name="rpm_limit_type" showDetailedDescriptions={false} />

      <Form.Item
        label={
          <span>
            {t("gateway.keyEdit.throttle")}{" "}
            <Tooltip title={t("gateway.keyEdit.throttleTooltip")}>
              <InfoCircleOutlined style={{ marginLeft: "4px" }} />
            </Tooltip>
          </span>
        }
        name="throttle_on_budget_exceeded"
        valuePropName="checked"
      >
        <Switch checkedChildren={t("gateway.keyEdit.yes")} unCheckedChildren={t("gateway.keyEdit.no")} />
      </Form.Item>

      <Form.Item label={t("gateway.keyEdit.maxParallelRequests")} name="max_parallel_requests">
        <NumericalInput min={0} />
      </Form.Item>

      <Form.Item label={t("gateway.keyEdit.modelTpmLimit")} name="model_tpm_limit">
        <Input.TextArea rows={4} placeholder='{"gpt-4": 100, "claude-v1": 200}' />
      </Form.Item>

      <Form.Item label={t("gateway.keyEdit.modelRpmLimit")} name="model_rpm_limit">
        <Input.TextArea rows={4} placeholder='{"gpt-4": 100, "claude-v1": 200}' />
      </Form.Item>

      <Form.Item
        label={
          <span>
            {t("gateway.keyEdit.perTagRateLimits")}{" "}
            <Tooltip title={t("gateway.keyEdit.perTagRateLimitsTooltip")}>
              <InfoCircleOutlined style={{ marginLeft: "4px" }} />
            </Tooltip>
          </span>
        }
      >
        <TagRateLimitEditor value={tagRateLimits} onChange={setTagRateLimits} />
      </Form.Item>

      <Form.Item label={t("gateway.keyEdit.guardrails")} name="guardrails">
        {accessToken && (
          <GuardrailSelector
            onChange={(v) => {
              form.setFieldValue("guardrails", v);
            }}
            accessToken={accessToken}
            disabled={!canEditGuardrails}
          />
        )}
      </Form.Item>

      <Form.Item
        label={
          <span>
            {t("gateway.keyEdit.disableGlobalGuardrails")}{" "}
            <Tooltip title={t("gateway.keyEdit.disableGlobalGuardrailsTooltip")}>
              <InfoCircleOutlined style={{ marginLeft: "4px" }} />
            </Tooltip>
          </span>
        }
        name="disable_global_guardrails"
        valuePropName="checked"
      >
        <Switch
          disabled={!canEditGuardrails}
          checkedChildren={t("gateway.keyEdit.yes")}
          unCheckedChildren={t("gateway.keyEdit.no")}
        />
      </Form.Item>

      <Form.Item
        label={
          <span>
            {t("gateway.keyEdit.policies")}{" "}
            <Tooltip title={t("gateway.keyEdit.policiesTooltip")}>
              <InfoCircleOutlined style={{ marginLeft: "4px" }} />
            </Tooltip>
          </span>
        }
        name="policies"
      >
        {accessToken && (
          <PolicySelector
            onChange={(v) => {
              form.setFieldValue("policies", v);
            }}
            accessToken={accessToken}
            disabled={!canEditGuardrails}
          />
        )}
      </Form.Item>

      <Form.Item label={t("gateway.keyEdit.tags")} name="tags">
        <Select
          mode="tags"
          style={{ width: "100%" }}
          placeholder={t("gateway.keyEdit.selectOrEnterTags")}
          options={Object.values(tagsList).map((tag) => ({
            value: tag.name,
            label: tag.name,
            title: tag.description || tag.name,
          }))}
        />
      </Form.Item>

      <Form.Item
        label={
          <span>
            {t("gateway.keyEdit.accessGroups")}{" "}
            <Tooltip title={t("gateway.keyEdit.accessGroupsTooltip")}>
              <InfoCircleOutlined style={{ marginLeft: "4px" }} />
            </Tooltip>
          </span>
        }
        name="access_group_ids"
      >
        <AccessGroupSelector placeholder={t("gateway.keyEdit.selectAccessGroups")} />
      </Form.Item>

      <Form.Item
        label={t("gateway.keyEdit.passThroughRoutes")}
        name="allowed_passthrough_routes"
        tooltip={!premiumUser ? t("gateway.keyEdit.passThroughRoutesPremium") : undefined}
      >
        <PassThroughRoutesSelector
          accessToken={accessToken || ""}
          placeholder={
            !premiumUser
              ? t("gateway.keyEdit.passThroughRoutesPremium")
              : Array.isArray(keyData.metadata?.allowed_passthrough_routes) &&
                  keyData.metadata.allowed_passthrough_routes.length > 0
                ? t("gateway.keyEdit.passThroughRoutesCurrent", {
                    routes: keyData.metadata.allowed_passthrough_routes.join(", "),
                  })
                : t("gateway.keyEdit.passThroughRoutesPlaceholder")
          }
          disabled={!premiumUser}
        />
      </Form.Item>

      <Form.Item label={t("gateway.keyEdit.vectorStores")} name="vector_stores">
        <VectorStoreSelector
          onChange={(values: string[]) => form.setFieldValue("vector_stores", values)}
          value={form.getFieldValue("vector_stores")}
          accessToken={accessToken || ""}
          placeholder={t("gateway.keyEdit.selectVectorStores")}
        />
      </Form.Item>

      <Form.Item label={t("gateway.keyEdit.mcpServersGroups")} name="mcp_servers_and_groups">
        <MCPServerSelector
          onChange={(val) => form.setFieldValue("mcp_servers_and_groups", val)}
          value={form.getFieldValue("mcp_servers_and_groups")}
          accessToken={accessToken || ""}
          placeholder={t("gateway.keyEdit.selectMcpServersGroups")}
          allowNoMcpServers
        />
      </Form.Item>

      {/* Hidden field to register mcp_tool_permissions with the form */}
      <Form.Item name="mcp_tool_permissions" initialValue={{}} hidden>
        <Input type="hidden" />
      </Form.Item>

      <Form.Item
        noStyle
        shouldUpdate={(prevValues, currentValues) =>
          prevValues.mcp_servers_and_groups !== currentValues.mcp_servers_and_groups ||
          prevValues.mcp_tool_permissions !== currentValues.mcp_tool_permissions
        }
      >
        {() => (
          <div className="mb-6">
            <MCPToolPermissions
              accessToken={accessToken || ""}
              selectedServers={(form.getFieldValue("mcp_servers_and_groups")?.servers || []).filter(
                (s: string) => s !== NO_MCP_SERVERS_SENTINEL,
              )}
              toolPermissions={form.getFieldValue("mcp_tool_permissions") || {}}
              onChange={(toolPerms) => form.setFieldsValue({ mcp_tool_permissions: toolPerms })}
            />
          </div>
        )}
      </Form.Item>

      <Form.Item label={t("gateway.keyEdit.agentsGroups")} name="agents_and_groups">
        <AgentSelector
          onChange={(val) => form.setFieldValue("agents_and_groups", val)}
          value={form.getFieldValue("agents_and_groups")}
          accessToken={accessToken || ""}
          placeholder={t("gateway.keyEdit.selectAgentsGroups")}
        />
      </Form.Item>

      <Form.Item
        label={
          <span>
            {t("gateway.keyEdit.organization")}{" "}
            <Tooltip title={t("gateway.keyEdit.organizationTooltip")}>
              <InfoCircleOutlined style={{ marginLeft: "4px" }} />
            </Tooltip>
          </span>
        }
        name="organization_id"
      >
        <OrganizationDropdown
          organizations={organizations}
          loading={isOrganizationsLoading}
          disabled={managedPersonalKey || userRole !== "Admin"}
          onChange={(orgId) => {
            setSelectedOrganizationId(orgId || null);
            form.setFieldValue("team_id", undefined);
          }}
        />
      </Form.Item>

      <Form.Item
        label={t("gateway.keyEdit.teamId")}
        name="team_id"
        help={enableProjectsUI && hasProject ? t("gateway.keyEdit.teamLockedByProject") : undefined}
      >
        <Select
          placeholder={t("gateway.keyEdit.selectTeam")}
          showSearch
          disabled={managedPersonalKey || (enableProjectsUI && hasProject)}
          style={{ width: "100%" }}
          onChange={(teamId) => {
            const selectedTeam = teams?.find((t) => t.team_id === teamId) || null;
            if (selectedTeam?.organization_id) {
              setSelectedOrganizationId(selectedTeam.organization_id);
              form.setFieldValue("organization_id", selectedTeam.organization_id);
            } else if (!teamId) {
              setSelectedOrganizationId(null);
              form.setFieldValue("organization_id", undefined);
            }
          }}
          filterOption={(input, option) => {
            const filteredTeams = selectedOrganizationId
              ? teams?.filter((t) => t.organization_id === selectedOrganizationId)
              : teams;
            const team = filteredTeams?.find((t) => t.team_id === option?.value);
            if (!team) return false;
            return team.team_alias?.toLowerCase().includes(input.toLowerCase()) ?? false;
          }}
        >
          {(selectedOrganizationId ? teams?.filter((t) => t.organization_id === selectedOrganizationId) : teams)?.map(
            (team) => (
              <Select.Option key={team.team_id} value={team.team_id}>
                {`${team.team_alias} (${team.team_id})`}
              </Select.Option>
            ),
          )}
        </Select>
      </Form.Item>
      {enableProjectsUI && hasProject && (
        <Form.Item label={t("gateway.keyEdit.project")}>
          <Input value={projectDisplay ?? ""} disabled />
        </Form.Item>
      )}
      <Form.Item label={t("gateway.keyEdit.metadata")} name="metadata">
        <Input.TextArea rows={10} />
      </Form.Item>

      {/* Auto-Rotation Settings */}
      {!managedPersonalKey && (
        <div className="mb-4">
          <KeyLifecycleSettings
            form={form}
            autoRotationEnabled={autoRotationEnabled}
            onAutoRotationChange={setAutoRotationEnabled}
            rotationInterval={rotationInterval}
            onRotationIntervalChange={setRotationInterval}
            neverExpire={neverExpire}
            onNeverExpireChange={setNeverExpire}
          />
        </div>
      )}

      {/* Hidden form field for token */}
      <Form.Item name="token" hidden>
        <Input />
      </Form.Item>

      {/* Hidden form fields for auto-rotation */}
      <Form.Item name="auto_rotate" hidden>
        <Input />
      </Form.Item>
      <Form.Item name="rotation_interval" hidden>
        <Input />
      </Form.Item>

      <div className="sticky z-10 bg-white p-4 border-t border-gray-200 -bottom-6 -inset-x-6">
        <div className="flex justify-end items-center gap-2">
          <TremorButton variant="secondary" onClick={onCancel} disabled={isKeySaving}>
            {t("gateway.keyEdit.cancel")}
          </TremorButton>
          <TremorButton type="submit" loading={isKeySaving}>
            {t("gateway.keyEdit.saveChanges")}
          </TremorButton>
        </div>
      </div>
    </Form>
  );
}
