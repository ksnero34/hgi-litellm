import { useOrganizations } from "@/app/(dashboard)/hooks/organizations/useOrganizations";
import useCan from "@/app/(dashboard)/hooks/useCan";
import AvailableTeamsPanel from "@/components/team/AvailableTeamsPanel";
import TeamInfoView from "@/components/team/TeamInfo";
import TeamSSOSettings from "@/components/TeamSSOSettings";
import { isProxyAdminRole } from "@/utils/roles";
import { InfoCircleOutlined } from "@ant-design/icons";
import { Accordion, AccordionBody, AccordionHeader, TextInput } from "@tremor/react";
import { Button, Form, Input, Layout, Modal, Select, Switch, Tabs, theme, Tooltip, Typography } from "antd";
import { Plus, Users } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button as UIButton } from "@/components/ui/button";
import { teamsTableKeys } from "@/app/(dashboard)/hooks/teams/useTeams";
import { parseAsString, useQueryState } from "nuqs";
import { TeamsTable } from "./TeamsPage/TeamsTable";
import AccessGroupSelector from "./common_components/AccessGroupSelector";
import MetadataKeyValueFields, { metadataPairsToObject } from "./common_components/MetadataKeyValueFields";
import { useTeamMetadataSchema } from "@/app/(dashboard)/hooks/teams/useTeamMetadataSchema";
import PassThroughRoutesSelector from "./common_components/PassThroughRoutesSelector";
import AgentSelector from "./agent_management/AgentSelector";
import ModelAliasManager from "./common_components/ModelAliasManager";
import PremiumLoggingSettings from "./common_components/PremiumLoggingSettings";
import RouterSettingsAccordion, { RouterSettingsAccordionValue } from "./common_components/RouterSettingsAccordion";
import { fetchAvailableModelsForTeamOrKey } from "./key_team_helpers/fetch_available_models_team_key";
import type { Team } from "./key_team_helpers/key_list";
import MCPServerSelector from "./mcp_server_management/MCPServerSelector";
import MCPToolPermissions from "./mcp_server_management/MCPToolPermissions";
import NotificationsManager from "./molecules/notifications_manager";
import { extractProxyErrorMessage } from "@/lib/http/client";
import BudgetDurationDropdown, {
  getBudgetDurationLabel,
  NEVER_RESETS_BUDGET_DURATION,
} from "./common_components/budget_duration_dropdown";
import { Organization, getDefaultTeamSettings, getGuardrailsList, getPoliciesList, teamDeleteCall } from "./networking";
import NumericalInput from "./shared/numerical_input";
import VectorStoreSelector from "./vector_store_management/VectorStoreSelector";
import SearchToolSelector from "./search_tools/SearchToolSelector";

interface TeamProps {
  accessToken: string | null;
  userID: string | null;
  userRole: string | null;
  premiumUser?: boolean;
}

import DeleteResourceModal from "./common_components/DeleteResourceModal";
import { teamCreateCall } from "./networking";
import { normalizeTeamModelSelection } from "./team/teamModelAccess";
import { ModelSelect } from "./ModelSelect/ModelSelect";

const canCreateOrManageTeams = (
  userRole: string | null,
  userID: string | null,
  organizations: Organization[] | null,
): boolean => {
  // Admin role always has permission
  if (userRole === "Admin") {
    return true;
  }

  // Check if user is an org_admin in any organization
  if (organizations && userID) {
    return organizations.some((org) =>
      org.members?.some((member) => member.user_id === userID && member.user_role === "org_admin"),
    );
  }

  return false;
};

const getAdminOrganizations = (
  userRole: string | null,
  userID: string | null,
  organizations: Organization[] | null,
): Organization[] => {
  // Global Admin can see all organizations
  if (userRole === "Admin") {
    return organizations || [];
  }

  // Org Admin can only see organizations they're an admin for
  if (organizations && userID) {
    return organizations.filter((org) =>
      org.members?.some((member) => member.user_id === userID && member.user_role === "org_admin"),
    );
  }

  return [];
};

// @deprecated
const Teams: React.FC<TeamProps> = ({ accessToken, userID, userRole, premiumUser = false }) => {
  const { t } = useTranslation();
  const { data: organizationsData } = useOrganizations();
  const organizations = organizationsData ?? null;
  const { data: teamMetadataSchemaFields = [], isLoading: isTeamMetadataSchemaLoading } = useTeamMetadataSchema();
  const queryClient = useQueryClient();
  const refreshTeams = () => queryClient.invalidateQueries({ queryKey: teamsTableKeys.all });
  const [currentOrg] = useState<Organization | null>(null);
  const [currentOrgForCreateTeam, setCurrentOrgForCreateTeam] = useState<Organization | null>(null);

  const [form] = Form.useForm();

  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useQueryState("team", parseAsString.withOptions({ history: "push" }));
  const [editTeam, setEditTeam] = useState<boolean>(false);

  const [isTeamModalVisible, setIsTeamModalVisible] = useState(false);
  const [userModels, setUserModels] = useState<string[]>([]);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [teamToDelete, setTeamToDelete] = useState<Team | null>(null);
  const [isTeamDeleting, setIsTeamDeleting] = useState(false);
  // Add this state near the other useState declarations
  const [guardrailsList, setGuardrailsList] = useState<string[]>([]);
  const canViewPolicies = useCan("viewPolicies");
  const [policiesList, setPoliciesList] = useState<string[]>([]);
  const [loggingSettings, setLoggingSettings] = useState<any[]>([]);
  const [modelAliases, setModelAliases] = useState<{ [key: string]: string }>({});
  const [routerSettings, setRouterSettings] = useState<RouterSettingsAccordionValue | null>(null);
  const [routerSettingsKey, setRouterSettingsKey] = useState<number>(0);

  const { data: defaultTeamSettings } = useQuery({
    queryKey: ["defaultTeamSettings"],
    queryFn: () => getDefaultTeamSettings(accessToken as string),
    enabled: isTeamModalVisible && accessToken != null,
    retry: false,
    staleTime: 60_000,
  });
  const defaultBudgetDuration: string | undefined = defaultTeamSettings?.values?.budget_duration ?? undefined;
  const budgetDurationPlaceholder = defaultBudgetDuration
    ? `Default: ${getBudgetDurationLabel(defaultBudgetDuration)} (${defaultBudgetDuration})`
    : "n/a";

  useEffect(() => {
    form.setFieldValue("models", []);
  }, [currentOrgForCreateTeam, userModels]);

  // Handle organization preselection when modal opens
  useEffect(() => {
    if (isTeamModalVisible) {
      const adminOrgs = getAdminOrganizations(userRole, userID, organizations);
      const isOrgAdmin = userRole !== "Admin";

      // Org admins must scope a team to an org, so with exactly one we preselect it.
      // Proxy admins can create org-less teams, so the field stays optional regardless of org count.
      if (isOrgAdmin && adminOrgs.length === 1) {
        const org = adminOrgs[0];
        form.setFieldValue("organization_id", org.organization_id);
        setCurrentOrgForCreateTeam(org);
      } else {
        form.setFieldValue("organization_id", currentOrg?.organization_id || null);
        setCurrentOrgForCreateTeam(currentOrg);
      }
    }
  }, [isTeamModalVisible, userRole, userID, organizations, currentOrg]);

  // Add this useEffect to fetch guardrails
  useEffect(() => {
    const fetchGuardrails = async () => {
      try {
        if (accessToken == null) {
          return;
        }

        const response = await getGuardrailsList(accessToken);
        const guardrailNames = response.guardrails.map((g: { guardrail_name: string }) => g.guardrail_name);
        setGuardrailsList(guardrailNames);
      } catch (error) {
        console.error("Failed to fetch guardrails:", error);
      }
    };

    const fetchPolicies = async () => {
      try {
        if (accessToken == null) {
          return;
        }

        const response = await getPoliciesList(accessToken);
        const policyNames = response.policies.map((p: { policy_name: string }) => p.policy_name);
        setPoliciesList(policyNames);
      } catch (error) {
        console.error("Failed to fetch policies:", error);
      }
    };

    fetchGuardrails();
    if (canViewPolicies) fetchPolicies();
  }, [accessToken, canViewPolicies]);

  const handleOk = () => {
    setIsTeamModalVisible(false);
    form.resetFields();
    setLoggingSettings([]);
    setModelAliases({});
    setRouterSettings(null);
    setRouterSettingsKey((prev) => prev + 1);
  };

  const handleCancel = () => {
    setIsTeamModalVisible(false);
    form.resetFields();
    setLoggingSettings([]);
    setModelAliases({});
    setRouterSettings(null);
    setRouterSettingsKey((prev) => prev + 1);
  };

  const handleDelete = async (team: Team) => {
    // Set the team to delete and open the confirmation modal
    setTeamToDelete(team);
    setIsDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (teamToDelete == null || accessToken == null) {
      return;
    }

    try {
      setIsTeamDeleting(true);
      await teamDeleteCall(accessToken, teamToDelete.team_id);
      await refreshTeams();
      NotificationsManager.success(
        t("access.teams.notifications.deleted", { defaultValue: "Team deleted successfully" }),
      );
    } catch (error) {
      NotificationsManager.fromBackend(
        t("access.teams.notifications.deleteFailed", {
          error: String(error),
          defaultValue: "Error deleting the team: {{error}}",
        }),
      );
    } finally {
      setIsTeamDeleting(false);
      setIsDeleteModalOpen(false);
      setTeamToDelete(null);
    }
  };

  const cancelDelete = () => {
    setIsDeleteModalOpen(false);
    setTeamToDelete(null);
  };

  useEffect(() => {
    const fetchUserModels = async () => {
      try {
        if (userID === null || userRole === null || accessToken === null) {
          return;
        }
        const models = await fetchAvailableModelsForTeamOrKey(userID, userRole, accessToken);
        if (models) {
          setUserModels(models);
        }
      } catch (error) {
        console.error("Error fetching user models:", error);
      }
    };

    fetchUserModels();
  }, [accessToken, userID, userRole]);

  const handleCreate = async (formValues: Record<string, any>) => {
    try {
      if (accessToken != null) {
        let organizationId = formValues?.organization_id || currentOrg?.organization_id;
        if (organizationId === "" || typeof organizationId !== "string") {
          formValues.organization_id = null;
        } else {
          formValues.organization_id = organizationId.trim();
        }

        if (formValues.budget_duration === NEVER_RESETS_BUDGET_DURATION) {
          formValues.budget_duration = null;
        }

        NotificationsManager.info(t("access.teams.notifications.creating", { defaultValue: "Creating team" }));

        const metadataObject = {
          ...metadataPairsToObject(formValues.metadata),
          ...(loggingSettings.length > 0 ? { logging: loggingSettings.filter((config) => config.callback_name) } : {}),
        };
        formValues.metadata = Object.keys(metadataObject).length > 0 ? JSON.stringify(metadataObject) : undefined;

        if (formValues.secret_manager_settings) {
          if (typeof formValues.secret_manager_settings === "string") {
            if (formValues.secret_manager_settings.trim() === "") {
              delete formValues.secret_manager_settings;
            } else {
              try {
                formValues.secret_manager_settings = JSON.parse(formValues.secret_manager_settings);
              } catch (e) {
                throw new Error("Failed to parse secret manager settings: " + e);
              }
            }
          }
        }

        const hasSearchTools =
          Array.isArray(formValues.object_permission_search_tools) &&
          formValues.object_permission_search_tools.length > 0;

        if (
          (formValues.allowed_vector_store_ids && formValues.allowed_vector_store_ids.length > 0) ||
          (formValues.allowed_mcp_servers_and_groups &&
            (formValues.allowed_mcp_servers_and_groups.servers?.length > 0 ||
              formValues.allowed_mcp_servers_and_groups.accessGroups?.length > 0 ||
              formValues.allowed_mcp_servers_and_groups.toolPermissions))
        ) {
          if (!formValues.object_permission) {
            formValues.object_permission = {};
          }
          if (formValues.allowed_vector_store_ids && formValues.allowed_vector_store_ids.length > 0) {
            formValues.object_permission.vector_stores = formValues.allowed_vector_store_ids;
            delete formValues.allowed_vector_store_ids;
          }
          if (formValues.allowed_mcp_servers_and_groups) {
            const { servers, accessGroups } = formValues.allowed_mcp_servers_and_groups;
            if (servers && servers.length > 0) {
              formValues.object_permission.mcp_servers = servers;
            }
            if (accessGroups && accessGroups.length > 0) {
              formValues.object_permission.mcp_access_groups = accessGroups;
            }
            delete formValues.allowed_mcp_servers_and_groups;
          }

          if (formValues.mcp_tool_permissions && Object.keys(formValues.mcp_tool_permissions).length > 0) {
            formValues.object_permission.mcp_tool_permissions = formValues.mcp_tool_permissions;
            delete formValues.mcp_tool_permissions;
          }
        }

        // Transform allowed_mcp_access_groups into object_permission
        if (formValues.allowed_mcp_access_groups && formValues.allowed_mcp_access_groups.length > 0) {
          if (!formValues.object_permission) {
            formValues.object_permission = {};
          }
          formValues.object_permission.mcp_access_groups = formValues.allowed_mcp_access_groups;
          delete formValues.allowed_mcp_access_groups;
        }

        // Handle agent permissions
        if (formValues.allowed_agents_and_groups) {
          const { agents, accessGroups } = formValues.allowed_agents_and_groups;
          if (!formValues.object_permission) {
            formValues.object_permission = {};
          }
          if (agents && agents.length > 0) {
            formValues.object_permission.agents = agents;
          }
          if (accessGroups && accessGroups.length > 0) {
            formValues.object_permission.agent_access_groups = accessGroups;
          }
          delete formValues.allowed_agents_and_groups;
        }

        if (hasSearchTools) {
          if (!formValues.object_permission) {
            formValues.object_permission = {};
          }
          formValues.object_permission.search_tools = formValues.object_permission_search_tools;
          delete formValues.object_permission_search_tools;
        }

        // Add model_aliases if any are defined
        if (Object.keys(modelAliases).length > 0) {
          formValues.model_aliases = modelAliases;
        }

        // Add router_settings if any are defined
        if (routerSettings?.router_settings) {
          // Only include router_settings if it has at least one non-null value
          const hasValues = Object.values(routerSettings.router_settings).some(
            (value) => value !== null && value !== undefined && value !== "",
          );
          if (hasValues) {
            formValues.router_settings = routerSettings.router_settings;
          }
        }

        await teamCreateCall(accessToken, { ...formValues, models: normalizeTeamModelSelection(formValues.models) });
        NotificationsManager.success(t("access.teams.notifications.created", { defaultValue: "Team created" }));
        await refreshTeams();
        form.resetFields();
        setLoggingSettings([]);
        setModelAliases({});
        setRouterSettings(null);
        setRouterSettingsKey((prev) => prev + 1);
        setIsTeamModalVisible(false);
      }
    } catch (error) {
      console.error("Error creating the team:", error);
      NotificationsManager.fromBackend(
        t("access.teams.notifications.createFailed", {
          error: extractProxyErrorMessage(error),
          defaultValue: "Error creating the team: {{error}}",
        }),
      );
    }
  };

  const is_team_admin = (team: any) => {
    if (team == null || team.members_with_roles == null) {
      return false;
    }
    for (let i = 0; i < team.members_with_roles.length; i++) {
      let member = team.members_with_roles[i];
      if (member.user_id == userID && member.role == "admin") {
        return true;
      }
    }
    return false;
  };

  const { token } = theme.useToken();
  const { Text } = Typography;
  const { Content } = Layout;

  const tabItems = [
    {
      key: "your-teams",
      label: t("access.teams.tabs.yours", { defaultValue: "Your Teams" }),
      children: (
        <>
          <TeamsTable
            userRole={userRole}
            userID={userID}
            onSelectTeam={(team) => {
              setSelectedTeam(team);
              void setSelectedTeamId(team.team_id);
              setEditTeam(false);
            }}
            onEditTeam={(team) => {
              setSelectedTeam(team);
              void setSelectedTeamId(team.team_id);
              setEditTeam(true);
            }}
            onDeleteTeam={handleDelete}
          />

          <DeleteResourceModal
            isOpen={isDeleteModalOpen}
            title={t("access.teams.delete.title", { defaultValue: "Delete Team?" })}
            alertMessage={(() => {
              const deleteKeyCount = teamToDelete?.keys_count ?? teamToDelete?.keys?.length ?? 0;
              return deleteKeyCount === 0
                ? undefined
                : t("access.teams.delete.warning", {
                    count: deleteKeyCount,
                    defaultValue:
                      "Warning: This team has {{count}} keys associated with it. Deleting the team will also delete all associated keys, along with any models created for this team. This action is irreversible.",
                  });
            })()}
            message={t("access.teams.delete.message", {
              defaultValue:
                "Are you sure you want to delete this team, all its keys, and any models created for it? This action cannot be undone.",
            })}
            resourceInformationTitle={t("access.teams.delete.infoTitle", { defaultValue: "Team Information" })}
            resourceInformation={[
              {
                label: t("access.teams.columns.teamId", { defaultValue: "Team ID" }),
                value: teamToDelete?.team_id,
                code: true,
              },
              {
                label: t("access.teams.columns.teamName", { defaultValue: "Team Name" }),
                value: teamToDelete?.team_alias,
              },
              {
                label: t("access.teams.columns.keys", { defaultValue: "Keys" }),
                value: teamToDelete?.keys_count ?? teamToDelete?.keys?.length ?? 0,
              },
              {
                label: t("access.teams.columns.members", { defaultValue: "Members" }),
                value: teamToDelete?.members_with_roles?.length,
              },
            ]}
            requiredConfirmation={teamToDelete?.team_alias}
            onCancel={cancelDelete}
            onOk={confirmDelete}
            confirmLoading={isTeamDeleting}
          />
        </>
      ),
    },
    {
      key: "available-teams",
      label: t("access.teams.tabs.available", { defaultValue: "Available Teams" }),
      children: <AvailableTeamsPanel accessToken={accessToken} userID={userID} />,
    },
    ...(isProxyAdminRole(userRole || "")
      ? [
          {
            key: "default-settings",
            label: t("access.teams.tabs.defaults", { defaultValue: "Default Team Settings" }),
            children: <TeamSSOSettings accessToken={accessToken} userID={userID || ""} userRole={userRole || ""} />,
          },
        ]
      : []),
  ];

  return (
    <Content style={{ padding: token.paddingLG, paddingInline: token.paddingLG * 2 }}>
      {selectedTeamId ? (
        <TeamInfoView
          teamId={selectedTeamId}
          onUpdate={() => {
            refreshTeams();
          }}
          onClose={() => {
            setSelectedTeam(null);
            void setSelectedTeamId(null);
            setEditTeam(false);
          }}
          accessToken={accessToken}
          is_team_admin={is_team_admin(selectedTeam?.team_id === selectedTeamId ? selectedTeam : null)}
          is_proxy_admin={userRole == "Admin"}
          userModels={userModels}
          editTeam={editTeam}
          premiumUser={premiumUser}
        />
      ) : (
        <>
          <div className="mb-4">
            <PageHeader
              icon={<Users className="size-5" />}
              title={t("access.teams.title", { defaultValue: "Teams" })}
              subtitle={t("access.teams.subtitle", {
                defaultValue: "Manage teams, members, and their access to models and budgets",
              })}
            />
          </div>

          <Tabs
            items={tabItems}
            tabBarExtraContent={{
              left: canCreateOrManageTeams(userRole, userID, organizations) ? (
                <div className="flex items-center gap-4 pr-4">
                  <UIButton onClick={() => setIsTeamModalVisible(true)} data-testid="create-team-button">
                    <Plus className="size-4" />
                    {t("access.teams.actions.create", { defaultValue: "Create Team" })}
                  </UIButton>
                  <div className="h-6 w-px bg-gray-200" />
                </div>
              ) : undefined,
            }}
          />
        </>
      )}

      {canCreateOrManageTeams(userRole, userID, organizations) && (
        <Modal
          title={t("access.teams.create.title", { defaultValue: "Create Team" })}
          open={isTeamModalVisible}
          width={1000}
          footer={null}
          onOk={handleOk}
          onCancel={handleCancel}
          destroyOnHidden
        >
          <Form form={form} onFinish={handleCreate} labelCol={{ span: 8 }} wrapperCol={{ span: 16 }} labelAlign="left">
            <>
              <Form.Item
                label={t("access.teams.form.teamName", { defaultValue: "Team Name" })}
                name="team_alias"
                rules={[
                  {
                    required: true,
                    message: t("access.teams.form.teamNameRequired", { defaultValue: "Please input a team name" }),
                  },
                ]}
              >
                <TextInput placeholder="" data-testid="team-name-input" />
              </Form.Item>
              {(() => {
                const adminOrgs = getAdminOrganizations(userRole, userID, organizations);
                const isOrgAdmin = userRole !== "Admin";
                const isSingleOrg = adminOrgs.length === 1;
                const hasNoOrgs = adminOrgs.length === 0;

                return (
                  <>
                    <Form.Item
                      label={
                        <span>
                          {t("access.teams.columns.organization", { defaultValue: "Organization" })}{" "}
                          <Tooltip
                            title={
                              <span>
                                {t("access.teams.form.organizationTooltip", {
                                  defaultValue: "Organizations can have multiple teams. Learn more about",
                                })}{" "}
                                <a
                                  href="https://docs.litellm.ai/docs/proxy/user_management_heirarchy"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    color: "#1890ff",
                                    textDecoration: "underline",
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {t("access.teams.form.userHierarchy", { defaultValue: "user management hierarchy" })}
                                </a>
                              </span>
                            }
                          >
                            <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                          </Tooltip>
                        </span>
                      }
                      name="organization_id"
                      initialValue={currentOrg ? currentOrg.organization_id : null}
                      className="mt-8"
                      rules={
                        isOrgAdmin
                          ? [
                              {
                                required: true,
                                message: t("access.teams.form.organizationRequired", {
                                  defaultValue: "Please select an organization",
                                }),
                              },
                            ]
                          : []
                      }
                      help={
                        isOrgAdmin && isSingleOrg
                          ? t("access.teams.form.singleOrganizationHelp", {
                              defaultValue: "You can only create teams within this organization",
                            })
                          : isOrgAdmin
                            ? t("access.teams.form.organizationHelp", { defaultValue: "required" })
                            : ""
                      }
                    >
                      <Select
                        showSearch
                        allowClear={!isOrgAdmin}
                        disabled={isOrgAdmin && isSingleOrg}
                        placeholder={
                          hasNoOrgs
                            ? t("access.teams.form.noOrganizations", { defaultValue: "No organizations available" })
                            : t("access.teams.form.organizationPlaceholder", {
                                defaultValue: "Search or select an organization",
                              })
                        }
                        onChange={(value) => {
                          form.setFieldValue("organization_id", value);
                          setCurrentOrgForCreateTeam(adminOrgs?.find((org) => org.organization_id === value) || null);
                        }}
                        filterOption={(input, option) => {
                          if (!option) return false;
                          const optionValue = option.children?.toString() || "";
                          return optionValue.toLowerCase().includes(input.toLowerCase());
                        }}
                        optionFilterProp="children"
                      >
                        {adminOrgs?.map((org) => (
                          <Select.Option key={org.organization_id} value={org.organization_id}>
                            <span className="font-medium">{org.organization_alias}</span>{" "}
                            <span className="text-gray-500">({org.organization_id})</span>
                          </Select.Option>
                        ))}
                      </Select>
                    </Form.Item>

                    {/* Show message when org admin needs to select organization */}
                    {isOrgAdmin && !isSingleOrg && adminOrgs.length > 1 && (
                      <div className="mb-8 p-4 bg-blue-50 border border-blue-200 rounded-md">
                        <Text style={{ color: "#1e40af", fontSize: 14 }}>
                          {t("access.teams.form.organizationAdminHelp", {
                            defaultValue:
                              "Please select an organization to create a team for. You can only create teams within organizations where you are an admin.",
                          })}
                        </Text>
                      </div>
                    )}
                  </>
                );
              })()}
              <Form.Item
                label={
                  <span>
                    {t("access.teams.columns.models", { defaultValue: "Models" })}{" "}
                    <Tooltip
                      title={t("access.teams.form.modelsTooltip", {
                        defaultValue:
                          "These are the models that your selected team has access to. Leave empty to grant no models directly, e.g. when the team gets its models from access groups",
                      })}
                    >
                      <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                    </Tooltip>
                  </span>
                }
                name="models"
              >
                <ModelSelect
                  value={form.getFieldValue("models") || []}
                  onChange={(values) => form.setFieldValue("models", values)}
                  organizationID={form.getFieldValue("organization_id")}
                  options={{
                    includeSpecialOptions: true,
                    showAllProxyModelsOverride: !form.getFieldValue("organization_id"),
                  }}
                  context="team"
                  dataTestId="create-team-models-select"
                />
              </Form.Item>

              <Form.Item
                label={t("access.teams.form.maxBudget", { defaultValue: "Max Budget (USD)" })}
                name="max_budget"
              >
                <NumericalInput step={0.01} precision={2} width={200} />
              </Form.Item>
              <Form.Item
                className="mt-8"
                label={t("access.teams.form.resetBudget", { defaultValue: "Reset Budget" })}
                name="budget_duration"
              >
                <BudgetDurationDropdown showNeverResets placeholder={budgetDurationPlaceholder} />
              </Form.Item>
              <Form.Item
                label={t("access.teams.form.tpmLimit", { defaultValue: "Tokens per minute Limit (TPM)" })}
                name="tpm_limit"
              >
                <NumericalInput step={1} width={400} />
              </Form.Item>
              <Form.Item
                label={t("access.teams.form.rpmLimit", { defaultValue: "Requests per minute Limit (RPM)" })}
                name="rpm_limit"
              >
                <NumericalInput step={1} width={400} />
              </Form.Item>
              <Form.Item
                label={t("access.teams.form.metadata")}
                help='Values are saved as text. Enter JSON for typed values, e.g. 3, true, or {"region": "us"}.'
              >
                <MetadataKeyValueFields
                  form={form}
                  schemaFields={teamMetadataSchemaFields}
                  schemaLoading={isTeamMetadataSchemaLoading}
                />
              </Form.Item>

              <Accordion className="mt-20 mb-8">
                <AccordionHeader>
                  <b>{t("access.teams.form.additionalSettings", { defaultValue: "Additional Settings" })}</b>
                </AccordionHeader>
                <AccordionBody>
                  <Form.Item
                    label={t("access.teams.form.teamId")}
                    name="team_id"
                    help={t("access.teams.form.teamIdHelp")}
                  >
                    <TextInput
                      onChange={(e) => {
                        e.target.value = e.target.value.trim();
                      }}
                    />
                  </Form.Item>
                  <Form.Item
                    label={t("access.teams.form.memberBudget")}
                    name="team_member_budget"
                    normalize={(value) => (value ? Number(value) : undefined)}
                    tooltip={t("access.teams.form.memberBudgetHelp")}
                  >
                    <NumericalInput step={0.01} precision={2} width={200} />
                  </Form.Item>
                  <Form.Item
                    label={t("access.teams.form.memberKeyDuration")}
                    name="team_member_key_duration"
                    tooltip={t("access.teams.form.memberKeyDurationHelp")}
                  >
                    <TextInput placeholder={t("access.teams.form.memberKeyDurationPlaceholder")} />
                  </Form.Item>
                  <Form.Item
                    label={t("access.teams.form.memberRpmLimit")}
                    name="team_member_rpm_limit"
                    tooltip={t("access.teams.form.memberRpmLimitHelp")}
                  >
                    <NumericalInput step={1} width={400} />
                  </Form.Item>
                  <Form.Item
                    label={t("access.teams.form.memberTpmLimit")}
                    name="team_member_tpm_limit"
                    tooltip={t("access.teams.form.memberTpmLimitHelp")}
                  >
                    <NumericalInput step={1} width={400} />
                  </Form.Item>
                  <Form.Item
                    label={t("access.teams.form.secretManager", { defaultValue: "Secret Manager Settings" })}
                    name="secret_manager_settings"
                    help={
                      premiumUser
                        ? t("access.teams.form.secretManagerHelp")
                        : t("access.teams.form.secretManagerPremium")
                    }
                    rules={[
                      {
                        validator: async (_, value) => {
                          if (!value) {
                            return Promise.resolve();
                          }
                          try {
                            JSON.parse(value);
                            return Promise.resolve();
                          } catch (error) {
                            return Promise.reject(new Error(t("access.teams.form.validJson")));
                          }
                        },
                      },
                    ]}
                  >
                    <Input.TextArea
                      rows={4}
                      placeholder='{"namespace": "admin", "mount": "secret", "path_prefix": "litellm"}'
                      disabled={!premiumUser}
                    />
                  </Form.Item>
                  <Form.Item
                    label={
                      <span>
                        {t("access.teams.form.guardrails")}{" "}
                        <Tooltip title={t("access.teams.form.guardrailsTooltip")}>
                          <a
                            href="https://docs.litellm.ai/docs/proxy/guardrails/quick_start"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                          </a>
                        </Tooltip>
                      </span>
                    }
                    name="guardrails"
                    className="mt-8"
                    help={t("access.teams.form.guardrailsHelp")}
                  >
                    <Select
                      mode="tags"
                      style={{ width: "100%" }}
                      placeholder={t("access.teams.form.guardrailsPlaceholder")}
                      options={guardrailsList.map((name) => ({
                        value: name,
                        label: name,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item
                    label={
                      <span>
                        {t("access.teams.form.disableGlobalGuardrails")}{" "}
                        <Tooltip title={t("access.teams.form.disableGlobalGuardrailsTooltip")}>
                          <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                        </Tooltip>
                      </span>
                    }
                    name="disable_global_guardrails"
                    className="mt-4"
                    valuePropName="checked"
                    help={t("access.teams.form.disableGlobalGuardrailsHelp")}
                  >
                    <Switch
                      disabled={!premiumUser}
                      checkedChildren={
                        premiumUser ? t("access.common.yes") : t("access.teams.form.disableGlobalGuardrailsPremium")
                      }
                      unCheckedChildren={
                        premiumUser ? t("access.common.no") : t("access.teams.form.disableGlobalGuardrailsPremium")
                      }
                    />
                  </Form.Item>
                  {canViewPolicies && (
                    <Form.Item
                      label={
                        <span>
                          {t("access.teams.form.policies")}{" "}
                          <Tooltip title={t("access.teams.form.policiesTooltip")}>
                            <a
                              href="https://docs.litellm.ai/docs/proxy/guardrails/guardrail_policies"
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                            </a>
                          </Tooltip>
                        </span>
                      }
                      name="policies"
                      className="mt-8"
                      help={t("access.teams.form.policiesHelp")}
                    >
                      <Select
                        mode="tags"
                        style={{ width: "100%" }}
                        placeholder={t("access.teams.form.policiesPlaceholder")}
                        options={policiesList.map((name) => ({
                          value: name,
                          label: name,
                        }))}
                      />
                    </Form.Item>
                  )}
                  <Form.Item
                    label={
                      <span>
                        {t("access.teams.form.accessGroups")}{" "}
                        <Tooltip title={t("access.teams.form.accessGroupsTooltip")}>
                          <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                        </Tooltip>
                      </span>
                    }
                    name="access_group_ids"
                    className="mt-8"
                    help={t("access.teams.form.accessGroupsHelp")}
                  >
                    <AccessGroupSelector placeholder={t("access.teams.form.accessGroupsPlaceholder")} />
                  </Form.Item>
                  <Form.Item
                    label={
                      <span>
                        {t("access.teams.form.vectorStores")}{" "}
                        <Tooltip title={t("access.teams.form.vectorStoresTooltip")}>
                          <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                        </Tooltip>
                      </span>
                    }
                    name="allowed_vector_store_ids"
                    className="mt-8"
                    help={t("access.teams.form.vectorStoresHelp")}
                  >
                    <VectorStoreSelector
                      onChange={(values: string[]) => form.setFieldValue("allowed_vector_store_ids", values)}
                      value={form.getFieldValue("allowed_vector_store_ids")}
                      accessToken={accessToken || ""}
                      placeholder={t("access.teams.form.vectorStoresPlaceholder")}
                    />
                  </Form.Item>
                  <Form.Item
                    label={t("access.teams.form.passThroughRoutes")}
                    name="allowed_passthrough_routes"
                    className="mt-8"
                    tooltip={
                      !premiumUser
                        ? t("access.teams.form.passThroughRoutesPremium")
                        : !isProxyAdminRole(userRole || "")
                          ? t("access.teams.form.passThroughRoutesAdminOnly")
                          : undefined
                    }
                  >
                    <PassThroughRoutesSelector
                      accessToken={accessToken || ""}
                      placeholder={t("access.teams.form.passThroughRoutesPlaceholder")}
                      disabled={!premiumUser || !isProxyAdminRole(userRole || "")}
                    />
                  </Form.Item>
                </AccordionBody>
              </Accordion>

              <Accordion className="mt-8 mb-8">
                <AccordionHeader>
                  <b>{t("access.teams.form.mcpSettings")}</b>
                </AccordionHeader>
                <AccordionBody>
                  <Form.Item
                    label={
                      <span>
                        {t("access.teams.form.mcpServers")}{" "}
                        <Tooltip title={t("access.teams.form.mcpServersTooltip")}>
                          <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                        </Tooltip>
                      </span>
                    }
                    name="allowed_mcp_servers_and_groups"
                    className="mt-4"
                    help={t("access.teams.form.mcpServersHelp")}
                  >
                    <MCPServerSelector
                      onChange={(val: any) => form.setFieldValue("allowed_mcp_servers_and_groups", val)}
                      value={form.getFieldValue("allowed_mcp_servers_and_groups")}
                      accessToken={accessToken || ""}
                      placeholder={t("access.teams.form.mcpServersPlaceholder")}
                      allowAllProxyMcpServers={isProxyAdminRole(userRole || "")}
                    />
                  </Form.Item>

                  {/* Hidden field to register mcp_tool_permissions with the form */}
                  <Form.Item name="mcp_tool_permissions" initialValue={{}} hidden>
                    <Input type="hidden" />
                  </Form.Item>

                  <Form.Item
                    noStyle
                    shouldUpdate={(prevValues, currentValues) =>
                      prevValues.allowed_mcp_servers_and_groups !== currentValues.allowed_mcp_servers_and_groups ||
                      prevValues.mcp_tool_permissions !== currentValues.mcp_tool_permissions
                    }
                  >
                    {() => (
                      <div className="mt-6">
                        <MCPToolPermissions
                          accessToken={accessToken || ""}
                          selectedServers={form.getFieldValue("allowed_mcp_servers_and_groups")?.servers || []}
                          toolPermissions={form.getFieldValue("mcp_tool_permissions") || {}}
                          onChange={(toolPerms) => form.setFieldsValue({ mcp_tool_permissions: toolPerms })}
                        />
                      </div>
                    )}
                  </Form.Item>
                </AccordionBody>
              </Accordion>

              <Accordion className="mt-8 mb-8">
                <AccordionHeader>
                  <b>{t("access.teams.form.agentSettings")}</b>
                </AccordionHeader>
                <AccordionBody>
                  <Form.Item
                    label={
                      <span>
                        {t("access.teams.form.agents")}{" "}
                        <Tooltip title={t("access.teams.form.agentsTooltip")}>
                          <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                        </Tooltip>
                      </span>
                    }
                    name="allowed_agents_and_groups"
                    className="mt-4"
                    help={t("access.teams.form.agentsHelp")}
                  >
                    <AgentSelector
                      onChange={(val: any) => form.setFieldValue("allowed_agents_and_groups", val)}
                      value={form.getFieldValue("allowed_agents_and_groups")}
                      accessToken={accessToken || ""}
                      placeholder={t("access.teams.form.agentsPlaceholder")}
                    />
                  </Form.Item>
                </AccordionBody>
              </Accordion>

              <Accordion className="mt-8 mb-8">
                <AccordionHeader>
                  <b>{t("access.teams.form.searchToolSettings")}</b>
                </AccordionHeader>
                <AccordionBody>
                  <Form.Item
                    label={
                      <span>
                        {t("access.teams.form.searchTools")}{" "}
                        <Tooltip title={t("access.teams.form.searchToolsTooltip")}>
                          <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                        </Tooltip>
                      </span>
                    }
                    name="object_permission_search_tools"
                    className="mt-4"
                    help={t("access.teams.form.searchToolsHelp")}
                  >
                    <SearchToolSelector
                      onChange={(vals: string[]) => form.setFieldValue("object_permission_search_tools", vals)}
                      value={form.getFieldValue("object_permission_search_tools")}
                      accessToken={accessToken || ""}
                      placeholder={t("access.teams.form.searchToolsPlaceholder")}
                    />
                  </Form.Item>
                </AccordionBody>
              </Accordion>

              <Accordion className="mt-8 mb-8">
                <AccordionHeader>
                  <b>{t("access.teams.form.loggingSettings")}</b>
                </AccordionHeader>
                <AccordionBody>
                  <div className="mt-4">
                    <PremiumLoggingSettings
                      value={loggingSettings}
                      onChange={setLoggingSettings}
                      premiumUser={premiumUser}
                    />
                  </div>
                </AccordionBody>
              </Accordion>

              <Accordion key={`router-settings-accordion-${routerSettingsKey}`} className="mt-8 mb-8">
                <AccordionHeader>
                  <b>{t("access.teams.form.routerSettings")}</b>
                </AccordionHeader>
                <AccordionBody>
                  <div className="mt-4 w-full">
                    <RouterSettingsAccordion
                      key={routerSettingsKey}
                      accessToken={accessToken || ""}
                      value={routerSettings || undefined}
                      onChange={setRouterSettings}
                      modelData={
                        userModels.length > 0 ? { data: userModels.map((model) => ({ model_name: model })) } : undefined
                      }
                    />
                  </div>
                </AccordionBody>
              </Accordion>

              <Accordion className="mt-8 mb-8">
                <AccordionHeader>
                  <b>{t("access.teams.form.modelAliases")}</b>
                </AccordionHeader>
                <AccordionBody>
                  <div className="mt-4">
                    <Text type="secondary" style={{ fontSize: 14, marginBottom: 16, display: "block" }}>
                      {t("access.teams.form.modelAliasesHelp")}
                    </Text>
                    <ModelAliasManager
                      accessToken={accessToken || ""}
                      initialModelAliases={modelAliases}
                      onAliasUpdate={setModelAliases}
                      showExampleConfig={false}
                    />
                  </div>
                </AccordionBody>
              </Accordion>
            </>
            <div style={{ textAlign: "right", marginTop: "10px" }}>
              <Button htmlType="submit" data-testid="create-team-submit">
                {t("access.teams.actions.create", { defaultValue: "Create Team" })}
              </Button>
            </div>
          </Form>
        </Modal>
      )}
    </Content>
  );
};

export default Teams;
