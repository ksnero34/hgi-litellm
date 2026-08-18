import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { useProjects } from "@/app/(dashboard)/hooks/projects/useProjects";
import { useUISettings } from "@/app/(dashboard)/hooks/uiSettings/useUISettings";
import useTeams from "@/app/(dashboard)/hooks/useTeams";
import { formatNumberWithCommas } from "@/utils/dataUtils";
import { mapEmptyStringToNull } from "@/utils/keyUpdateUtils";
import { ArrowLeftIcon } from "@heroicons/react/outline";
import { Badge, Button, Card, Grid, Tab, TabGroup, TabList, TabPanel, TabPanels, Text, Title } from "@tremor/react";
import { Modal, Tag } from "antd";
import { KeyInfoHeader } from "./KeyInfoHeader";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { isProxyAdminRole, isUserTeamAdminForSingleTeam, rolesWithWriteAccess } from "../../utils/roles";
import { mapDisplayToInternalNames, mapInternalToDisplayNames } from "../callback_info_helpers";
import AutoRotationView from "../common_components/AutoRotationView";
import DeleteResourceModal from "../common_components/DeleteResourceModal";
import { extractLoggingSettings, formatMetadataForDisplay, stripTagsFromMetadata } from "../key_info_utils";
import { KeyResponse } from "../key_team_helpers/key_list";
import LoggingSettingsView from "../logging_settings_view";
import NotificationManager from "../molecules/notifications_manager";
import { getPolicyInfoWithGuardrails, keyDeleteCall, keyUpdateCall, personalKeyDeleteCall } from "../networking";
import { useResetKeySpend } from "@/app/(dashboard)/hooks/keys/useResetKeySpend";
import { useSetKeyBlockedState } from "@/app/(dashboard)/hooks/keys/useSetKeyBlockedState";
import { keyKeys } from "@/app/(dashboard)/hooks/keys/useKeys";
import { useQueryClient } from "@tanstack/react-query";
import ObjectPermissionsView from "../object_permissions_view";
import { RegenerateKeyModal } from "../organisms/RegenerateKeyModal";
import { parseErrorMessage } from "../shared/errorUtils";
import { KeyEditView } from "./key_edit_view";

interface KeyInfoViewProps {
  keyId: string;
  onClose: () => void;
  keyData: KeyResponse | undefined;
  onKeyDataUpdate?: (data: Partial<KeyResponse>) => void;
  onDelete?: () => void;
  teams: any[] | null;
  backButtonText?: string;
}

const LICENSED_METADATA_FIELDS = ["prompts", "tags", "allowed_passthrough_routes", "policies"] as const;

const isEmptyValue = (v: unknown): boolean =>
  v == null || (Array.isArray(v) && v.length === 0) || (typeof v === "string" && v.trim() === "");

const hasManagedPersonalKeyPurpose = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return "key_purpose" in value && value.key_purpose === "personal_llm";
};
/**
 * ─────────────────────────────────────────────────────────────────────────
 * @deprecated
 * This component is being DEPRECATED in favor of src/app/(dashboard)/virtual-keys/components/KeyInfoView.tsx
 * Please contribute to the new refactor.
 * ─────────────────────────────────────────────────────────────────────────
 */
export default function KeyInfoView({
  onClose,
  keyData,
  teams,
  onKeyDataUpdate,
  onDelete,
  backButtonText,
}: KeyInfoViewProps) {
  const { t, i18n } = useTranslation();
  const { accessToken, userId: userID, userRole } = useAuthorized();
  const queryClient = useQueryClient();
  const canEditGuardrails = userRole != null && rolesWithWriteAccess.includes(userRole);
  const { teams: teamsData } = useTeams();
  const { data: projects } = useProjects();
  const { data: uiSettingsData } = useUISettings();
  const enableProjectsUI = Boolean(uiSettingsData?.values?.enable_projects_ui);
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [isRegenerateModalOpen, setIsRegenerateModalOpen] = useState(false);
  const [isResetSpendModalOpen, setIsResetSpendModalOpen] = useState(false);
  const [isBlockModalOpen, setIsBlockModalOpen] = useState(false);
  const { mutate: resetKeySpend, isPending: resetSpendLoading } = useResetKeySpend();
  const { mutate: setKeyBlockedState, isPending: blockLoading } = useSetKeyBlockedState();
  // Add local state to maintain key data and track regeneration
  const [currentKeyData, setCurrentKeyData] = useState<KeyResponse | undefined>(keyData);
  const [lastRegeneratedAt, setLastRegeneratedAt] = useState<Date | null>(null);
  const [isRecentlyRegenerated, setIsRecentlyRegenerated] = useState(false);
  const [policyGuardrails, setPolicyGuardrails] = useState<Record<string, string[]>>({});
  const [loadingPolicies, setLoadingPolicies] = useState(false);

  // Update local state when keyData prop changes (but don't reset to undefined)
  useEffect(() => {
    if (keyData) {
      setCurrentKeyData(keyData);
    }
  }, [keyData]);

  // Fetch resolved guardrails for all policies
  useEffect(() => {
    const fetchPolicyGuardrails = async () => {
      const policies = currentKeyData?.metadata?.policies;
      if (!accessToken || !policies || !Array.isArray(policies) || policies.length === 0) {
        return;
      }

      setLoadingPolicies(true);
      const guardrailsMap: Record<string, string[]> = {};

      try {
        await Promise.all(
          policies.map(async (policyName: string) => {
            try {
              const policyInfo = await getPolicyInfoWithGuardrails(accessToken, policyName);
              guardrailsMap[policyName] = policyInfo.resolved_guardrails || [];
            } catch (error) {
              console.error(`Failed to fetch guardrails for policy ${policyName}:`, error);
              guardrailsMap[policyName] = [];
            }
          }),
        );
        setPolicyGuardrails(guardrailsMap);
      } catch (error) {
        console.error("Failed to fetch policy guardrails:", error);
      } finally {
        setLoadingPolicies(false);
      }
    };

    fetchPolicyGuardrails();
  }, [accessToken, currentKeyData?.metadata?.policies]);

  // Reset recent regeneration indicator after 5 seconds
  useEffect(() => {
    if (isRecentlyRegenerated) {
      const timer = setTimeout(() => {
        setIsRecentlyRegenerated(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [isRecentlyRegenerated]);

  // Use currentKeyData instead of keyData throughout the component
  if (!currentKeyData) {
    return (
      <div className="p-4">
        <Button icon={ArrowLeftIcon} variant="light" onClick={onClose} className="mb-4">
          {backButtonText}
        </Button>
        <Text>{t("gateway.keyInfoView.keyNotFound")}</Text>
      </div>
    );
  }

  const handleKeyUpdate = async (formValues: Record<string, any>) => {
    try {
      if (!accessToken) return;

      const currentKey = formValues.token;
      formValues.key = currentKey;

      if (!canEditGuardrails) {
        delete formValues.guardrails;
        delete formValues.policies;
        delete formValues.disable_global_guardrails;
      }

      for (const field of LICENSED_METADATA_FIELDS) {
        const previousValue =
          (currentKeyData.metadata as Record<string, unknown> | undefined)?.[field] ??
          (currentKeyData as unknown as Record<string, unknown>)[field];
        if (isEmptyValue(formValues[field]) && isEmptyValue(previousValue)) {
          delete formValues[field];
        }
      }

      const previousDisableGlobalGuardrails = Boolean(
        (currentKeyData.metadata as Record<string, unknown> | undefined)?.disable_global_guardrails,
      );
      if (Boolean(formValues.disable_global_guardrails) === previousDisableGlobalGuardrails) {
        delete formValues.disable_global_guardrails;
      }

      // Handle max budget empty string
      formValues.max_budget = mapEmptyStringToNull(formValues.max_budget);

      // Handle object_permission updates
      if (formValues.vector_stores !== undefined) {
        formValues.object_permission = {
          ...currentKeyData.object_permission,
          vector_stores: formValues.vector_stores || [],
        };
        // Remove vector_stores from the top level as it should be in object_permission
        delete formValues.vector_stores;
      }

      if (formValues.mcp_servers_and_groups !== undefined) {
        const { servers, accessGroups, toolsets } = formValues.mcp_servers_and_groups || {
          servers: [],
          accessGroups: [],
          toolsets: [],
        };
        formValues.object_permission = {
          ...currentKeyData.object_permission,
          mcp_servers: servers || [],
          mcp_access_groups: accessGroups || [],
          mcp_toolsets: toolsets || [],
        };
        // Remove mcp_servers_and_groups from the top level as it should be in object_permission
        delete formValues.mcp_servers_and_groups;
      }

      // Handle MCP tool permissions
      if (formValues.mcp_tool_permissions !== undefined) {
        const mcpToolPermissions = formValues.mcp_tool_permissions || {};
        if (Object.keys(mcpToolPermissions).length > 0) {
          formValues.object_permission = {
            ...formValues.object_permission,
            mcp_tool_permissions: mcpToolPermissions,
          };
        }
        delete formValues.mcp_tool_permissions;
      }

      // Handle agent permissions
      if (formValues.agents_and_groups !== undefined) {
        const { agents, accessGroups } = formValues.agents_and_groups || { agents: [], accessGroups: [] };
        formValues.object_permission = {
          ...formValues.object_permission,
          agents: agents || [],
          agent_access_groups: accessGroups || [],
        };
        delete formValues.agents_and_groups;
      }

      formValues.max_budget = mapEmptyStringToNull(formValues.max_budget);
      formValues.tpm_limit = mapEmptyStringToNull(formValues.tpm_limit);
      formValues.rpm_limit = mapEmptyStringToNull(formValues.rpm_limit);
      formValues.max_parallel_requests = mapEmptyStringToNull(formValues.max_parallel_requests);

      // Convert metadata back to an object if it exists and is a string
      if (formValues.metadata && typeof formValues.metadata === "string") {
        try {
          const parsedMetadata = JSON.parse(formValues.metadata);
          // Ensure tags are controlled via dedicated field, not in metadata textarea
          if ("tags" in parsedMetadata) {
            delete parsedMetadata["tags"];
          }
          formValues.metadata = {
            ...parsedMetadata,
            ...(Array.isArray(formValues.tags) && formValues.tags.length > 0 ? { tags: formValues.tags } : {}),
            ...(formValues.guardrails?.length > 0 ? { guardrails: formValues.guardrails } : {}),
            ...(Array.isArray(formValues.logging_settings) && formValues.logging_settings.length > 0
              ? { logging: formValues.logging_settings }
              : {}),
            ...(formValues.disabled_callbacks?.length > 0
              ? {
                  litellm_disabled_callbacks: mapDisplayToInternalNames(formValues.disabled_callbacks),
                }
              : {}),
          };
        } catch (error) {
          console.error("Error parsing metadata JSON:", error);
          NotificationManager.error(t("gateway.keyInfoView.invalidMetadata"));
          return;
        }
      } else {
        const baseMetadata = formValues.metadata || {};
        const { tags: _omitTags, ...rest } = baseMetadata;
        formValues.metadata = {
          ...rest,
          ...(Array.isArray(formValues.tags) && formValues.tags.length > 0 ? { tags: formValues.tags } : {}),
          ...(formValues.guardrails?.length > 0 ? { guardrails: formValues.guardrails } : {}),
          ...(Array.isArray(formValues.logging_settings) && formValues.logging_settings.length > 0
            ? { logging: formValues.logging_settings }
            : {}),
          ...(formValues.disabled_callbacks?.length > 0
            ? {
                litellm_disabled_callbacks: mapDisplayToInternalNames(formValues.disabled_callbacks),
              }
            : {}),
        };
      }

      // tags are merged into metadata; do not send as top-level field
      if ("tags" in formValues) {
        delete formValues.tags;
      }
      delete formValues.logging_settings;

      // Normalize any legacy word-form budget_duration to the canonical API format
      if (formValues.budget_duration) {
        const wordToCanonical: Record<string, string> = {
          hourly: "1h",
          daily: "24h",
          weekly: "7d",
          monthly: "30d",
        };
        formValues.budget_duration = wordToCanonical[formValues.budget_duration] ?? formValues.budget_duration;
      }

      const newKeyValues = await keyUpdateCall(accessToken, formValues);

      // Update local state
      setCurrentKeyData((prevData) => (prevData ? { ...prevData, ...newKeyValues } : undefined));

      if (onKeyDataUpdate) {
        onKeyDataUpdate(newKeyValues);
      }
      NotificationManager.success(t("gateway.keyInfoView.updateSuccess"));
      setIsEditing(false);
      // Refresh key data here if needed
    } catch (error) {
      NotificationManager.fromBackend(parseErrorMessage(error));
      console.error("Error updating key:", error);
    }
  };

  const handleDelete = async () => {
    try {
      setDeleteLoading(true);
      if (!accessToken) return;
      const canDeleteManagedPersonalKey = isProxyAdminRole(userRole) && Boolean(currentKeyData.user_id);

      if (isManagedPersonalKey && canDeleteManagedPersonalKey) {
        await personalKeyDeleteCall(accessToken, currentKeyData.user_id);
      } else {
        await keyDeleteCall(accessToken, currentKeyData.token || currentKeyData.token_id);
      }
      NotificationManager.success(t("gateway.keyInfoView.deleteSuccess"));
      await queryClient.invalidateQueries({ queryKey: keyKeys.lists() });
      if (onDelete) {
        onDelete();
      }
      onClose();
    } catch (error) {
      console.error("Error deleting the key:", error);
      NotificationManager.fromBackend(error);
    } finally {
      setDeleteLoading(false);
      setIsDeleteModalOpen(false);
    }
  };

  const handleRegenerateKeyUpdate = (updatedKeyData: Partial<KeyResponse>) => {
    // Update local state immediately with ALL the new data
    setCurrentKeyData((prevData) => {
      if (!prevData) return undefined;
      const newData = {
        ...prevData,
        ...updatedKeyData, // This should include the new token (key-id)
        // Update the created_at to show when it was regenerated
        created_at: new Date().toLocaleString(),
      };
      return newData;
    });

    // Track regeneration timestamp
    setLastRegeneratedAt(new Date());
    setIsRecentlyRegenerated(true);

    if (onKeyDataUpdate) {
      onKeyDataUpdate({
        ...updatedKeyData,
        created_at: new Date().toLocaleString(),
      });
    }
  };

  const formatTimestamp = (timestamp: string | Date) => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return t("gateway.keyInfoView.invalidDate");
    }
    const locale = i18n.resolvedLanguage === "ko" ? "ko-KR" : "en-US";
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  };

  const isManagedPersonalKey = hasManagedPersonalKeyPurpose(currentKeyData.metadata.personal_key);

  const canModifyKey =
    isProxyAdminRole(userRole || "") ||
    (teamsData &&
      isUserTeamAdminForSingleTeam(
        teamsData?.filter((team) => team.team_id === currentKeyData.team_id)[0]?.members_with_roles,
        userID || "",
      )) ||
    (userID === currentKeyData.user_id && userRole !== "Internal Viewer");

  const isKeyAdmin =
    isProxyAdminRole(userRole || "") ||
    Boolean(
      teamsData &&
        isUserTeamAdminForSingleTeam(
          teamsData?.filter((team) => team.team_id === currentKeyData.team_id)[0]?.members_with_roles,
          userID || "",
        ),
    );

  const canResetSpend = isKeyAdmin;
  const canBlockKey = isKeyAdmin;

  const handleResetSpend = () => {
    resetKeySpend(currentKeyData.token || currentKeyData.token_id, {
      onSuccess: () => {
        setCurrentKeyData((prevData) => (prevData ? { ...prevData, spend: 0 } : undefined));
        if (onKeyDataUpdate) {
          onKeyDataUpdate({ spend: 0 });
        }
        NotificationManager.success(t("gateway.keyInfoView.resetSpendSuccess"));
        setIsResetSpendModalOpen(false);
      },
      onError: (error) => {
        NotificationManager.fromBackend(parseErrorMessage(error));
        console.error("Error resetting key spend:", error);
      },
    });
  };

  const isBlocked = currentKeyData.blocked === true;

  const handleToggleBlocked = () => {
    setKeyBlockedState(
      { keyToken: currentKeyData.token || currentKeyData.token_id, blocked: !isBlocked },
      {
        onSuccess: (response) => {
          const blocked = response.blocked === true;
          setCurrentKeyData((prevData) => (prevData ? { ...prevData, blocked } : undefined));
          if (onKeyDataUpdate) {
            onKeyDataUpdate({ blocked });
          }
          NotificationManager.success(blocked ? "Key blocked" : "Key unblocked");
          setIsBlockModalOpen(false);
        },
        onError: (error) => {
          NotificationManager.fromBackend(parseErrorMessage(error));
          console.error("Error updating key blocked state:", error);
        },
      },
    );
  };

  const parentTeam = currentKeyData.team_id ? teamsData?.find((team) => team.team_id === currentKeyData.team_id) : null;

  const budgetDisplay =
    currentKeyData.max_budget !== null
      ? "$" + formatNumberWithCommas(currentKeyData.max_budget, 2)
      : parentTeam?.max_budget != null
        ? t("gateway.keyInfoView.teamBudget", {
            budget: "$" + formatNumberWithCommas(parentTeam.max_budget, 2),
            team: parentTeam.team_alias || parentTeam.team_id,
            duration: parentTeam.budget_duration ? " / " + parentTeam.budget_duration : "",
          })
        : t("gateway.keyInfoView.unlimited");

  return (
    <div className="w-full h-full overflow-y-auto p-4">
      <KeyInfoHeader
        data={{
          keyName: currentKeyData.key_alias || t("gateway.regenerate.virtualKey"),
          keyId: currentKeyData.token_id || currentKeyData.token,
          userId: currentKeyData.user_id || "",
          userEmail: currentKeyData.user_email || "",
          userAlias: currentKeyData.user?.user_alias ?? null,
          createdBy:
            currentKeyData.created_by_user?.user_alias ||
            currentKeyData.created_by_user?.user_email ||
            currentKeyData.created_by ||
            "",
          createdAt: currentKeyData.created_at ? formatTimestamp(currentKeyData.created_at) : "",
          lastUpdated: currentKeyData.updated_at ? formatTimestamp(currentKeyData.updated_at) : "",
          lastActive: currentKeyData.last_active
            ? formatTimestamp(currentKeyData.last_active)
            : t("gateway.regenerate.never"),
          expires: currentKeyData.expires ? formatTimestamp(currentKeyData.expires) : t("gateway.regenerate.never"),
        }}
        onBack={onClose}
        onRegenerate={() => setIsRegenerateModalOpen(true)}
        onDelete={() => setIsDeleteModalOpen(true)}
        onResetSpend={!isManagedPersonalKey && canResetSpend ? () => setIsResetSpendModalOpen(true) : undefined}
        onToggleBlocked={!isManagedPersonalKey && canBlockKey ? () => setIsBlockModalOpen(true) : undefined}
        isBlocked={isBlocked}
        regenerateDisabled={isManagedPersonalKey}
        canModifyKey={canModifyKey}
        backButtonText={backButtonText}
      />

      {/* Add RegenerateKeyModal */}
      <RegenerateKeyModal
        selectedToken={currentKeyData}
        visible={isRegenerateModalOpen}
        onClose={() => setIsRegenerateModalOpen(false)}
        onKeyUpdate={handleRegenerateKeyUpdate}
      />

      {/* Delete Confirmation Modal */}
      <DeleteResourceModal
        isOpen={isDeleteModalOpen}
        title={t("gateway.keyInfoView.deleteTitle")}
        alertMessage={t("gateway.keyInfoView.deleteAlert")}
        message={t("gateway.keyInfoView.deleteMessage")}
        resourceInformationTitle={t("gateway.keyInfoView.keyInformation")}
        resourceInformation={[
          {
            label: t("gateway.keyEdit.keyAlias"),
            value: currentKeyData?.key_alias || "-",
          },
          {
            label: t("gateway.keyInfoView.keyId"),
            value: currentKeyData?.token_id || currentKeyData?.token || "-",
            code: true,
          },
          {
            label: t("gateway.keyInfoView.teamId"),
            value: currentKeyData?.team_id || "-",
            code: true,
          },
          {
            label: t("gateway.keyInfoView.spend"),
            value: currentKeyData?.spend ? `$${formatNumberWithCommas(currentKeyData.spend, 4)}` : "$0.0000",
          },
        ]}
        onCancel={() => {
          setIsDeleteModalOpen(false);
        }}
        onOk={handleDelete}
        confirmLoading={deleteLoading}
        requiredConfirmation={currentKeyData?.key_alias}
      />

      {/* Reset Spend Confirmation Modal */}
      <Modal
        title={t("gateway.keyInfoView.resetSpendTitle")}
        open={isResetSpendModalOpen}
        onOk={handleResetSpend}
        onCancel={() => setIsResetSpendModalOpen(false)}
        okText={t("gateway.keyInfoView.reset")}
        okButtonProps={{ danger: true }}
        confirmLoading={resetSpendLoading}
      >
        <p>
          {t("gateway.keyInfoView.resetSpendQuestion", {
            name: currentKeyData?.key_alias || currentKeyData?.token_id || t("gateway.keyInfoView.thisKey"),
          })}
        </p>
        <p style={{ color: "#666", fontSize: "0.875rem", marginTop: 8 }}>
          {t("gateway.keyInfoView.resetSpendDescription", {
            spend: "$" + formatNumberWithCommas(currentKeyData.spend, 4),
          })}
        </p>
      </Modal>

      <Modal
        title={isBlocked ? "Unblock Key" : "Block Key"}
        open={isBlockModalOpen}
        onOk={handleToggleBlocked}
        onCancel={() => setIsBlockModalOpen(false)}
        okText={isBlocked ? "Unblock" : "Block"}
        okButtonProps={isBlocked ? undefined : { danger: true }}
        confirmLoading={blockLoading}
      >
        <p>
          {isBlocked ? "Unblock" : "Block"}{" "}
          <strong>{currentKeyData?.key_alias || currentKeyData?.token_id || "this key"}</strong>?
        </p>
        <p style={{ color: "#666", fontSize: "0.875rem", marginTop: 8 }}>
          {isBlocked
            ? "Requests using this key will be accepted again."
            : "Requests using this key will be rejected with a 401 error until it is unblocked. The key is not deleted and can be unblocked at any time."}
        </p>
      </Modal>

      <TabGroup>
        <TabList className="mb-4">
          <Tab>{t("gateway.keyInfoView.overview")}</Tab>
          <Tab>{t("gateway.keyInfoView.settings")}</Tab>
        </TabList>

        <TabPanels>
          {/* Overview Panel */}
          <TabPanel>
            <Grid numItems={1} numItemsSm={2} numItemsLg={3} className="gap-6">
              <Card>
                <Text>{t("gateway.keyInfoView.spend")}</Text>
                <div className="mt-2">
                  <Title>${formatNumberWithCommas(currentKeyData.spend, 4)}</Title>
                  <Text>{t("gateway.keyInfoView.ofBudget", { budget: budgetDisplay })}</Text>
                  {currentKeyData.budget_reset_at && (
                    <Text>
                      {t("gateway.keyInfoView.resetsAt", {
                        defaultValue: "Resets {{timestamp}}",
                        timestamp: formatTimestamp(currentKeyData.budget_reset_at),
                      })}
                    </Text>
                  )}
                </div>
              </Card>

              <Card>
                <Text>{t("gateway.keyInfoView.rateLimits")}</Text>
                <div className="mt-2">
                  <Text>
                    {t("gateway.virtualKeys.tpm", {
                      value:
                        currentKeyData.tpm_limit !== null
                          ? currentKeyData.tpm_limit
                          : t("gateway.keyInfoView.unlimited"),
                    })}
                  </Text>
                  <Text>
                    {t("gateway.virtualKeys.rpm", {
                      value:
                        currentKeyData.rpm_limit !== null
                          ? currentKeyData.rpm_limit
                          : t("gateway.keyInfoView.unlimited"),
                    })}
                  </Text>
                  {Boolean(currentKeyData.metadata?.throttle_on_budget_exceeded) && (
                    <Text>{t("gateway.keyInfoView.throttleEnabled")}</Text>
                  )}
                </div>
              </Card>

              <Card>
                <Text>{t("gateway.keyInfoView.models")}</Text>
                <div className="mt-2 flex flex-wrap gap-2">
                  {currentKeyData.models && currentKeyData.models.length > 0 ? (
                    currentKeyData.models.map((model, index) => (
                      <Badge key={index} color="red">
                        {model}
                      </Badge>
                    ))
                  ) : (
                    <Text>{t("gateway.keyInfoView.noModels")}</Text>
                  )}
                </div>
              </Card>

              <Card>
                <ObjectPermissionsView
                  objectPermission={currentKeyData.object_permission}
                  variant="inline"
                  accessToken={accessToken}
                />
              </Card>

              <Card>
                <Text className="font-medium mb-3">{t("gateway.keyInfoView.guardrails")}</Text>
                {Array.isArray(currentKeyData.metadata?.guardrails) && currentKeyData.metadata.guardrails.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {currentKeyData.metadata.guardrails.map((guardrail: string, index: number) => (
                      <Badge key={index} color="blue">
                        {guardrail}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <Text className="text-gray-500">{t("gateway.keyInfoView.noGuardrails")}</Text>
                )}
                {typeof currentKeyData.metadata?.disable_global_guardrails === "boolean" &&
                  currentKeyData.metadata.disable_global_guardrails === true && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <Badge color="yellow">{t("gateway.keyInfoView.globalGuardrailsDisabled")}</Badge>
                    </div>
                  )}
              </Card>

              <Card>
                <Text className="font-medium mb-3">{t("gateway.keyInfoView.policies")}</Text>
                {Array.isArray(currentKeyData.metadata?.policies) && currentKeyData.metadata.policies.length > 0 ? (
                  <div className="space-y-4">
                    {currentKeyData.metadata.policies.map((policy: string, index: number) => (
                      <div key={index} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Badge color="purple">{policy}</Badge>
                          {loadingPolicies && (
                            <Text className="text-xs text-gray-400">{t("gateway.keyInfoView.loadingGuardrails")}</Text>
                          )}
                        </div>
                        {!loadingPolicies && policyGuardrails[policy] && policyGuardrails[policy].length > 0 && (
                          <div className="ml-4 pl-3 border-l-2 border-gray-200">
                            <Text className="text-xs text-gray-500 mb-1">
                              {t("gateway.keyInfoView.resolvedGuardrails")}
                            </Text>
                            <div className="flex flex-wrap gap-1">
                              {policyGuardrails[policy].map((guardrail: string, gIndex: number) => (
                                <Badge key={gIndex} color="blue" size="xs">
                                  {guardrail}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <Text className="text-gray-500">{t("gateway.keyInfoView.noPolicies")}</Text>
                )}
              </Card>

              <LoggingSettingsView
                loggingConfigs={extractLoggingSettings(currentKeyData.metadata)}
                disabledCallbacks={
                  Array.isArray(currentKeyData.metadata?.litellm_disabled_callbacks)
                    ? mapInternalToDisplayNames(currentKeyData.metadata.litellm_disabled_callbacks)
                    : []
                }
                variant="card"
              />

              <AutoRotationView
                autoRotate={currentKeyData.auto_rotate}
                rotationInterval={currentKeyData.rotation_interval}
                lastRotationAt={currentKeyData.last_rotation_at}
                keyRotationAt={currentKeyData.key_rotation_at}
                nextRotationAt={currentKeyData.next_rotation_at}
                variant="card"
              />
            </Grid>
          </TabPanel>

          {/* Settings Panel */}
          <TabPanel>
            <Card>
              <div className="flex justify-between items-center mb-4">
                <Title>{t("gateway.keyInfoView.keySettings")}</Title>
                {!isEditing && canModifyKey && (
                  <Button onClick={() => setIsEditing(true)}>{t("gateway.keyInfoView.editSettings")}</Button>
                )}
              </div>

              {isEditing ? (
                <KeyEditView
                  keyData={currentKeyData}
                  onCancel={() => setIsEditing(false)}
                  onSubmit={handleKeyUpdate}
                  teams={teams}
                  accessToken={accessToken}
                  userID={userID}
                  userRole={userRole}
                  managedPersonalKey={isManagedPersonalKey}
                />
              ) : (
                <div className="space-y-4">
                  <div>
                    <Text className="font-medium">{t("gateway.keyInfoView.keyId")}</Text>
                    <Text className="font-mono">{currentKeyData.token_id || currentKeyData.token}</Text>
                  </div>

                  <div>
                    <Text className="font-medium">{t("gateway.keyEdit.keyAlias")}</Text>
                    <Text>{currentKeyData.key_alias || t("gateway.keyInfoView.notSet")}</Text>
                  </div>

                  <div>
                    <Text className="font-medium">{t("gateway.keyInfoView.secretKey")}</Text>
                    <Text className="font-mono">{currentKeyData.key_name}</Text>
                  </div>

                  <div>
                    <Text className="font-medium">{t("gateway.keyInfoView.teamId")}</Text>
                    <Text>{currentKeyData.team_id || t("gateway.keyInfoView.notSet")}</Text>
                  </div>

                  {enableProjectsUI && (
                    <div>
                      <Text className="font-medium">{t("gateway.keyInfoView.project")}</Text>
                      <Text>
                        {currentKeyData.project_id
                          ? (() => {
                              const project = projects?.find((p) => p.project_id === currentKeyData.project_id);
                              return project?.project_alias
                                ? `${project.project_alias} (${currentKeyData.project_id})`
                                : currentKeyData.project_id;
                            })()
                          : t("gateway.keyInfoView.notSet")}
                      </Text>
                    </div>
                  )}

                  <div>
                    <Text className="font-medium">{t("gateway.keyInfoView.organization")}</Text>
                    <Text>
                      {(currentKeyData.organization_id ?? currentKeyData.org_id) || t("gateway.keyInfoView.notSet")}
                    </Text>
                  </div>

                  <div>
                    <Text className="font-medium">{t("gateway.keyInfoView.created")}</Text>
                    <Text>{formatTimestamp(currentKeyData.created_at)}</Text>
                  </div>

                  {lastRegeneratedAt && (
                    <div>
                      <Text className="font-medium">{t("gateway.keyInfoView.lastRegenerated")}</Text>
                      <div className="flex items-center gap-2">
                        <Text>{formatTimestamp(lastRegeneratedAt)}</Text>
                        <Badge color="green" size="xs">
                          {t("gateway.keyInfoView.recent")}
                        </Badge>
                      </div>
                    </div>
                  )}

                  <div>
                    <Text className="font-medium">{t("gateway.keyInfoView.expires")}</Text>
                    <Text>
                      {currentKeyData.expires ? formatTimestamp(currentKeyData.expires) : t("gateway.regenerate.never")}
                    </Text>
                  </div>

                  <AutoRotationView
                    autoRotate={currentKeyData.auto_rotate}
                    rotationInterval={currentKeyData.rotation_interval}
                    lastRotationAt={currentKeyData.last_rotation_at}
                    keyRotationAt={currentKeyData.key_rotation_at}
                    nextRotationAt={currentKeyData.next_rotation_at}
                    variant="inline"
                    className="pt-4 border-t border-gray-200"
                  />

                  <div>
                    <Text className="font-medium">{t("gateway.keyInfoView.spend")}</Text>
                    <Text>${formatNumberWithCommas(currentKeyData.spend, 4)} USD</Text>
                  </div>

                  <div>
                    <Text className="font-medium">{t("gateway.keyInfoView.budget")}</Text>
                    <Text>
                      {currentKeyData.max_budget !== null
                        ? `$${formatNumberWithCommas(currentKeyData.max_budget, 2)}`
                        : t("gateway.keyInfoView.unlimited")}
                    </Text>
                  </div>

                  <div>
                    <Text className="font-medium">Budget Reset</Text>
                    <Text>
                      {currentKeyData.budget_reset_at
                        ? `${currentKeyData.budget_duration ? `Every ${currentKeyData.budget_duration}, next ` : ""}${formatTimestamp(currentKeyData.budget_reset_at)}`
                        : "Never"}
                    </Text>
                  </div>

                  {currentKeyData.budget_fallbacks && Object.keys(currentKeyData.budget_fallbacks).length > 0 && (
                    <div>
                      <Text className="font-medium">{t("gateway.keyInfoView.budgetFallbacks")}</Text>
                      <div className="mt-1 space-y-1">
                        {Object.entries(currentKeyData.budget_fallbacks).map(([model, fallbacks]) => (
                          <div key={model} className="text-xs text-gray-600">
                            <span className="font-medium">{model}</span>
                            <span className="mx-1 text-gray-400">-&gt;</span>
                            {fallbacks.join(", ")}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <Text className="font-medium">{t("gateway.keyInfoView.tags")}</Text>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {Array.isArray(currentKeyData.metadata?.tags) && currentKeyData.metadata.tags.length > 0
                        ? currentKeyData.metadata.tags.map((tag, index) => (
                            <span key={index} className="px-2 mr-2 py-1 bg-blue-100 rounded-sm text-xs">
                              {tag}
                            </span>
                          ))
                        : t("gateway.keyInfoView.noTags")}
                    </div>
                  </div>

                  <div>
                    <Text className="font-medium">{t("gateway.keyInfoView.prompts")}</Text>
                    <Text>
                      {Array.isArray(currentKeyData.metadata?.prompts) && currentKeyData.metadata.prompts.length > 0
                        ? currentKeyData.metadata.prompts.map((prompt, index) => (
                            <span key={index} className="px-2 mr-2 py-1 bg-blue-100 rounded-sm text-xs">
                              {prompt}
                            </span>
                          ))
                        : t("gateway.keyInfoView.noPrompts")}
                    </Text>
                  </div>

                  <div>
                    <Text className="font-medium">{t("gateway.keyInfoView.allowedRoutes")}</Text>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {Array.isArray(currentKeyData.allowed_routes) && currentKeyData.allowed_routes.length > 0 ? (
                        currentKeyData.allowed_routes.map((route, index) => (
                          <span key={index} className="px-2 py-1 bg-blue-100 rounded-sm text-xs">
                            {route}
                          </span>
                        ))
                      ) : (
                        <Tag color="green">{t("gateway.keyInfoView.allRoutesAllowed")}</Tag>
                      )}
                    </div>
                  </div>

                  <div>
                    <Text className="font-medium">{t("gateway.keyInfoView.allowedPassThroughRoutes")}</Text>
                    <Text>
                      {Array.isArray(currentKeyData.metadata?.allowed_passthrough_routes) &&
                      currentKeyData.metadata.allowed_passthrough_routes.length > 0
                        ? currentKeyData.metadata.allowed_passthrough_routes.map((route, index) => (
                            <span key={index} className="px-2 mr-2 py-1 bg-blue-100 rounded-sm text-xs">
                              {route}
                            </span>
                          ))
                        : t("gateway.keyInfoView.noPassThroughRoutes")}
                    </Text>
                  </div>

                  <div>
                    <Text className="font-medium">{t("gateway.keyInfoView.disableGlobalGuardrails")}</Text>
                    <Text>
                      {currentKeyData.metadata?.disable_global_guardrails === true ? (
                        <Badge color="yellow">{t("gateway.keyInfoView.globalGuardrailsBypassed")}</Badge>
                      ) : (
                        <Badge color="green">{t("gateway.keyInfoView.globalGuardrailsActive")}</Badge>
                      )}
                    </Text>
                  </div>

                  <div>
                    <Text className="font-medium">{t("gateway.keyInfoView.models")}</Text>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {currentKeyData.models && currentKeyData.models.length > 0 ? (
                        currentKeyData.models.map((model, index) => (
                          <span key={index} className="px-2 py-1 bg-blue-100 rounded-sm text-xs">
                            {model}
                          </span>
                        ))
                      ) : (
                        <Text>{t("gateway.keyInfoView.noModels")}</Text>
                      )}
                    </div>
                  </div>

                  <div>
                    <Text className="font-medium">{t("gateway.keyInfoView.rateLimits")}</Text>
                    <Text>
                      {t("gateway.virtualKeys.tpm", {
                        value:
                          currentKeyData.tpm_limit !== null
                            ? currentKeyData.tpm_limit
                            : t("gateway.keyInfoView.unlimited"),
                      })}
                    </Text>
                    <Text>
                      {t("gateway.virtualKeys.rpm", {
                        value:
                          currentKeyData.rpm_limit !== null
                            ? currentKeyData.rpm_limit
                            : t("gateway.keyInfoView.unlimited"),
                      })}
                    </Text>
                    <Text>
                      {t("gateway.keyInfoView.maxParallelRequests", {
                        value:
                          currentKeyData.max_parallel_requests !== null
                            ? currentKeyData.max_parallel_requests
                            : t("gateway.keyInfoView.unlimited"),
                      })}
                    </Text>
                    <Text>
                      {t("gateway.keyInfoView.modelTpmLimits", {
                        value: currentKeyData.metadata?.model_tpm_limit
                          ? JSON.stringify(currentKeyData.metadata.model_tpm_limit)
                          : t("gateway.keyInfoView.unlimited"),
                      })}
                    </Text>
                    <Text>
                      {t("gateway.keyInfoView.modelRpmLimits", {
                        value: currentKeyData.metadata?.model_rpm_limit
                          ? JSON.stringify(currentKeyData.metadata.model_rpm_limit)
                          : t("gateway.keyInfoView.unlimited"),
                      })}
                    </Text>
                    <Text>
                      {t("gateway.keyInfoView.tagRpmLimits", {
                        value:
                          currentKeyData.metadata?.tag_rpm_limit &&
                          Object.keys(currentKeyData.metadata.tag_rpm_limit).length > 0
                            ? JSON.stringify(currentKeyData.metadata.tag_rpm_limit)
                            : t("gateway.keyInfoView.unlimited"),
                      })}
                    </Text>
                  </div>

                  <div>
                    <Text className="font-medium">{t("gateway.keyInfoView.metadata")}</Text>
                    <pre className="bg-gray-100 p-2 rounded-sm text-xs overflow-auto mt-1">
                      {formatMetadataForDisplay(stripTagsFromMetadata(currentKeyData.metadata))}
                    </pre>
                  </div>

                  <ObjectPermissionsView
                    objectPermission={currentKeyData.object_permission}
                    variant="inline"
                    className="pt-4 border-t border-gray-200"
                    accessToken={accessToken}
                  />

                  <LoggingSettingsView
                    loggingConfigs={extractLoggingSettings(currentKeyData.metadata)}
                    disabledCallbacks={
                      Array.isArray(currentKeyData.metadata?.litellm_disabled_callbacks)
                        ? mapInternalToDisplayNames(currentKeyData.metadata.litellm_disabled_callbacks)
                        : []
                    }
                    variant="inline"
                    className="pt-4 border-t border-gray-200"
                  />
                </div>
              )}
            </Card>
          </TabPanel>
        </TabPanels>
      </TabGroup>
    </div>
  );
}
