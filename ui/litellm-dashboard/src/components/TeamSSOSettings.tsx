import React, { useEffect, useState } from "react";
import { EditOutlined, SaveOutlined } from "@ant-design/icons";
import { Button, Card, Col, InputNumber, Row, Select, Spin, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import BudgetDurationDropdown, { getBudgetDurationLabel } from "./common_components/budget_duration_dropdown";
import { ModelSelect } from "./ModelSelect/ModelSelect";
import { getModelDisplayName } from "./key_team_helpers/fetch_available_models_team_key";
import NotificationsManager from "./molecules/notifications_manager";
import { getDefaultTeamSettings, updateDefaultTeamSettings, Organization } from "./networking";
import OrganizationDropdown from "./common_components/OrganizationDropdown";
import { useOrganizations } from "@/app/(dashboard)/hooks/organizations/useOrganizations";

const { Text, Title } = Typography;

interface TeamSSOSettingsProps {
  accessToken: string | null;
  userID: string;
  userRole: string;
}

const PERMISSION_OPTIONS = [
  "/key/generate",
  "/key/update",
  "/key/delete",
  "/key/regenerate",
  "/key/service-account/generate",
  "/key/{key_id}/regenerate",
  "/key/block",
  "/key/unblock",
  "/key/bulk_update",
  "/key/{key_id}/reset_spend",
  "/key/info",
  "/key/list",
  "/key/aliases",
  "/team/daily/activity",
];

interface SettingRowProps {
  label: string;
  description: string;
  isEditing: boolean;
  viewContent: React.ReactNode;
  editContent: React.ReactNode;
}

const SettingRow: React.FC<SettingRowProps> = ({ label, description, isEditing, viewContent, editContent }) => (
  <Row className="py-5 border-b border-gray-100 last:border-0">
    <Col span={8} className="pr-6">
      <div className="text-sm font-semibold text-gray-900">{label}</div>
      <div className="text-xs text-gray-500 mt-1 leading-relaxed">{description}</div>
    </Col>
    <Col span={16} className="flex items-center">
      <div className="w-full">{isEditing ? editContent : viewContent}</div>
    </Col>
  </Row>
);

const NotSet = ({ label }: { label: string }) => <Text className="text-gray-400 italic">{label}</Text>;

const renderTags = (values: string[], emptyLabel: string, displayFn?: (value: string) => string) => {
  if (!values || values.length === 0) return <NotSet label={emptyLabel} />;
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <Tag key={value} color="blue">
          {displayFn ? displayFn(value) : value}
        </Tag>
      ))}
    </div>
  );
};

const getOrganizationLabel = (organizationId: string, organizations: Organization[] | undefined): string => {
  const organization = organizations?.find((org) => org.organization_id === organizationId);
  return organization?.organization_alias ? `${organization.organization_alias} (${organizationId})` : organizationId;
};

interface SettingsValues {
  max_budget: number | null;
  budget_duration: string | null;
  tpm_limit: number | null;
  rpm_limit: number | null;
  models: string[];
  team_member_permissions: string[];
  organization_id: string | null;
}

const DEFAULT_VALUES: SettingsValues = {
  max_budget: null,
  budget_duration: null,
  tpm_limit: null,
  rpm_limit: null,
  models: [],
  team_member_permissions: [],
  organization_id: null,
};

const TeamSSOSettings: React.FC<TeamSSOSettingsProps> = ({ accessToken }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState<boolean>(true);
  const [values, setValues] = useState<SettingsValues>(DEFAULT_VALUES);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editedValues, setEditedValues] = useState<SettingsValues>(DEFAULT_VALUES);
  const [saving, setSaving] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<boolean>(false);
  const { data: organizations, isLoading: isOrganizationsLoading } = useOrganizations();

  useEffect(() => {
    const fetchSettings = async () => {
      if (!accessToken) {
        setLoading(false);
        return;
      }

      try {
        const data = await getDefaultTeamSettings(accessToken);
        const fetched = { ...DEFAULT_VALUES, ...(data.values || {}) };
        setValues(fetched);
        setEditedValues(fetched);
      } catch (error) {
        console.error("Error fetching team SSO settings:", error);
        setFetchError(true);
        NotificationsManager.fromBackend(
          t("auth.teamDefaults.errors.fetch", { defaultValue: "Failed to fetch team settings" }),
        );
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, [accessToken, t]);

  const handleSave = async () => {
    if (!accessToken) return;

    setSaving(true);
    try {
      const updatedSettings = await updateDefaultTeamSettings(accessToken, editedValues);
      const newValues = { ...DEFAULT_VALUES, ...(updatedSettings.settings || {}) };
      setValues(newValues);
      setEditedValues(newValues);
      setIsEditing(false);
      NotificationsManager.success(
        t("auth.teamDefaults.notifications.saved", { defaultValue: "Default team settings updated successfully" }),
      );
    } catch (error) {
      console.error("Error updating team settings:", error);
      NotificationsManager.fromBackend(
        t("auth.teamDefaults.errors.save", { defaultValue: "Failed to update team settings" }),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedValues(values);
  };

  const update = <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => {
    setEditedValues((previous) => ({ ...previous, [key]: value }));
  };

  const notSetLabel = t("auth.teamDefaults.notSet", { defaultValue: "Not set" });

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spin size="large" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <Card>
        <Text>
          {t("auth.teamDefaults.errors.noSettings", {
            defaultValue: "No team settings available or you do not have permission to view them.",
          })}
        </Text>
      </Card>
    );
  }

  return (
    <Card styles={{ body: { padding: 32 } }}>
      <div className="flex justify-between items-start mb-2">
        <div>
          <Title level={3} className="m-0 text-gray-900">
            {t("auth.teamDefaults.title", { defaultValue: "Default Team Settings" })}
          </Title>
          <Text className="text-gray-500 mt-1 block">
            {t("auth.teamDefaults.subtitle", {
              defaultValue: "These settings will be applied by default when creating new teams.",
            })}
          </Text>
        </div>
        <div>
          {isEditing ? (
            <div className="flex gap-3">
              <Button onClick={handleCancel} disabled={saving}>
                {t("auth.teamDefaults.actions.cancel", { defaultValue: "Cancel" })}
              </Button>
              <Button type="primary" onClick={handleSave} loading={saving} icon={<SaveOutlined />}>
                {t("auth.teamDefaults.actions.saveChanges", { defaultValue: "Save Changes" })}
              </Button>
            </div>
          ) : (
            <Button onClick={() => setIsEditing(true)} icon={<EditOutlined />}>
              {t("auth.teamDefaults.actions.editSettings", { defaultValue: "Edit Settings" })}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-8">
        <div className="mb-8">
          <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
            {t("auth.teamDefaults.sections.budget", { defaultValue: "Budget & Rate Limits" })}
          </div>
          <div className="border-t border-gray-100">
            <SettingRow
              label={t("auth.teamDefaults.maxBudget.label", { defaultValue: "Max Budget" })}
              description={t("auth.teamDefaults.maxBudget.description", {
                defaultValue: "Maximum budget (in USD) for new automatically created teams.",
              })}
              isEditing={isEditing}
              viewContent={
                values.max_budget != null ? (
                  <Text>${Number(values.max_budget).toLocaleString()}</Text>
                ) : (
                  <NotSet label={notSetLabel} />
                )
              }
              editContent={
                <InputNumber
                  className="w-full"
                  style={{ maxWidth: 320 }}
                  value={editedValues.max_budget}
                  onChange={(value) => update("max_budget", value)}
                  placeholder={notSetLabel}
                  prefix="$"
                  min={0}
                />
              }
            />

            <SettingRow
              label={t("auth.teamDefaults.budgetDuration.label", { defaultValue: "Budget Duration" })}
              description={t("auth.teamDefaults.budgetDuration.description", {
                defaultValue: "How frequently the team's budget resets.",
              })}
              isEditing={isEditing}
              viewContent={
                values.budget_duration ? (
                  <Text>{getBudgetDurationLabel(values.budget_duration)}</Text>
                ) : (
                  <NotSet label={notSetLabel} />
                )
              }
              editContent={
                <BudgetDurationDropdown
                  value={editedValues.budget_duration || null}
                  onChange={(v) => update("budget_duration", v ?? null)}
                  style={{ maxWidth: 320 }}
                />
              }
            />

            <SettingRow
              label={t("auth.teamDefaults.tpmLimit.label", { defaultValue: "TPM Limit" })}
              description={t("auth.teamDefaults.tpmLimit.description", {
                defaultValue: "Maximum tokens per minute allowed across all models.",
              })}
              isEditing={isEditing}
              viewContent={
                values.tpm_limit != null ? (
                  <Text>{values.tpm_limit.toLocaleString()}</Text>
                ) : (
                  <NotSet label={notSetLabel} />
                )
              }
              editContent={
                <InputNumber
                  className="w-full"
                  style={{ maxWidth: 320 }}
                  value={editedValues.tpm_limit}
                  onChange={(value) => update("tpm_limit", value)}
                  placeholder={notSetLabel}
                  min={0}
                />
              }
            />

            <SettingRow
              label={t("auth.teamDefaults.rpmLimit.label", { defaultValue: "RPM Limit" })}
              description={t("auth.teamDefaults.rpmLimit.description", {
                defaultValue: "Maximum requests per minute allowed across all models.",
              })}
              isEditing={isEditing}
              viewContent={
                values.rpm_limit != null ? (
                  <Text>{values.rpm_limit.toLocaleString()}</Text>
                ) : (
                  <NotSet label={notSetLabel} />
                )
              }
              editContent={
                <InputNumber
                  className="w-full"
                  style={{ maxWidth: 320 }}
                  value={editedValues.rpm_limit}
                  onChange={(value) => update("rpm_limit", value)}
                  placeholder={notSetLabel}
                  min={0}
                />
              }
            />
          </div>
        </div>

        <div className="mb-8">
          <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
            {t("auth.teamDefaults.sections.access", { defaultValue: "Access & Permissions" })}
          </div>
          <div className="border-t border-gray-100">
            <SettingRow
              label={t("auth.teamDefaults.organization.label", { defaultValue: "Default Organization" })}
              description={t("auth.teamDefaults.organization.description", {
                defaultValue: "Teams created without an explicit organization are assigned to this organization.",
              })}
              isEditing={isEditing}
              viewContent={
                values.organization_id ? (
                  <Text>{getOrganizationLabel(values.organization_id, organizations)}</Text>
                ) : (
                  <NotSet label={notSetLabel} />
                )
              }
              editContent={
                <OrganizationDropdown
                  organizations={organizations}
                  loading={isOrganizationsLoading}
                  value={editedValues.organization_id ?? undefined}
                  onChange={(organizationId) => update("organization_id", organizationId || null)}
                  placeholder="Select an organization"
                  style={{ maxWidth: 320 }}
                />
              }
            />

            <SettingRow
              label={t("auth.teamDefaults.models.label", { defaultValue: "Models" })}
              description={t("auth.teamDefaults.models.description", {
                defaultValue: "Default list of models that new teams can access.",
              })}
              isEditing={isEditing}
              viewContent={renderTags(values.models, notSetLabel, getModelDisplayName)}
              editContent={
                <ModelSelect
                  value={editedValues.models || []}
                  onChange={(value) => update("models", value)}
                  context="global"
                  style={{ width: "100%" }}
                  options={{ includeSpecialOptions: true }}
                />
              }
            />

            <SettingRow
              label={t("auth.teamDefaults.permissions.label", { defaultValue: "Team Member Permissions" })}
              description={t("auth.teamDefaults.permissions.description", {
                defaultValue:
                  "Default permissions granted to members of newly created teams. /key/info and /key/health are always included.",
              })}
              isEditing={isEditing}
              viewContent={renderTags(values.team_member_permissions, notSetLabel)}
              editContent={
                <Select
                  mode="multiple"
                  style={{ width: "100%" }}
                  value={editedValues.team_member_permissions || []}
                  onChange={(value) => update("team_member_permissions", value)}
                  placeholder={t("auth.teamDefaults.permissions.placeholder", { defaultValue: "Select permissions" })}
                  tagRender={({ label, closable, onClose }) => (
                    <Tag color="blue" closable={closable} onClose={onClose} className="mr-1 mt-1 mb-1">
                      {label}
                    </Tag>
                  )}
                >
                  {PERMISSION_OPTIONS.map((option) => (
                    <Select.Option key={option} value={option}>
                      {option}
                    </Select.Option>
                  ))}
                </Select>
              }
            />
          </div>
        </div>
      </div>
    </Card>
  );
};

export default TeamSSOSettings;
