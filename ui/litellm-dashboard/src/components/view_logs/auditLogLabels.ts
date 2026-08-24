import type { TFunction } from "i18next";

export const AUDIT_ACTION_TONE: Record<string, "success" | "info" | "error" | "warning" | "neutral"> = {
  created: "success",
  updated: "info",
  deleted: "error",
  rotated: "warning",
  blocked: "warning",
  unblocked: "success",
  creation_rejected: "error",
  sso_first_provisioned: "success",
  sso_department_changed: "info",
  sso_profile_synced: "neutral",
  sso_profile_created: "success",
};

export const AUDIT_ACTION_LABEL_KEYS: Record<string, string> = {
  created: "observabilityExtra.audit.action.created",
  updated: "observabilityExtra.audit.action.updated",
  deleted: "observabilityExtra.audit.action.deleted",
  rotated: "observabilityExtra.audit.action.rotated",
  blocked: "observabilityExtra.audit.action.blocked",
  unblocked: "observabilityExtra.audit.action.unblocked",
  creation_rejected: "observabilityExtra.audit.action.creationRejected",
  sso_first_provisioned: "observabilityExtra.audit.action.ssoFirstProvisioned",
  sso_department_changed: "observabilityExtra.audit.action.ssoDepartmentChanged",
  sso_profile_synced: "observabilityExtra.audit.action.ssoProfileSynced",
  sso_profile_created: "observabilityExtra.audit.action.ssoProfileCreated",
};

export const AUDIT_ACTION_FILTER_VALUES = [
  "created",
  "updated",
  "deleted",
  "rotated",
  "blocked",
  "unblocked",
  "creation_rejected",
  "sso_first_provisioned",
  "sso_department_changed",
  "sso_profile_synced",
  "sso_profile_created",
] as const;

export const AUDIT_TABLE_LABEL_KEYS: Record<string, string> = {
  LiteLLM_VerificationToken: "observabilityExtra.audit.tableName.keys",
  LiteLLM_TeamTable: "observabilityExtra.audit.tableName.teams",
  LiteLLM_TeamMembership: "observabilityExtra.audit.tableName.teamMemberships",
  LiteLLM_UserTable: "observabilityExtra.audit.tableName.users",
  LiteLLM_OrganizationTable: "observabilityExtra.audit.tableName.organizations",
  LiteLLM_OrganizationMembership: "observabilityExtra.audit.tableName.organizationMemberships",
  LiteLLM_ProxyModelTable: "observabilityExtra.audit.tableName.models",
  LiteLLM_CacheConfig: "observabilityExtra.audit.tableName.cacheSettings",
  LiteLLM_ConfigOverrides: "observabilityExtra.audit.tableName.configOverrides",
  LiteLLM_Config: "observabilityExtra.audit.tableName.proxyConfig",
  LiteLLM_SSOConfig: "observabilityExtra.audit.tableName.ssoConfig",
  LiteLLM_UISettings: "observabilityExtra.audit.tableName.uiSettings",
  CorporatePersonalKeyRegistry: "observabilityExtra.audit.tableName.personalKeyRegistry",
};

export const AUDIT_TABLE_FILTER_VALUES = [
  "LiteLLM_VerificationToken",
  "LiteLLM_TeamTable",
  "LiteLLM_TeamMembership",
  "LiteLLM_UserTable",
  "LiteLLM_OrganizationTable",
  "LiteLLM_OrganizationMembership",
  "LiteLLM_ProxyModelTable",
  "LiteLLM_CacheConfig",
  "LiteLLM_ConfigOverrides",
  "LiteLLM_Config",
  "LiteLLM_SSOConfig",
  "LiteLLM_UISettings",
  "CorporatePersonalKeyRegistry",
] as const;

export const getAuditActionLabel = (t: TFunction, action: string): string =>
  t(AUDIT_ACTION_LABEL_KEYS[action] ?? "observabilityExtra.audit.action.unknown");

export const getAuditTableNameLabel = (t: TFunction, tableName: string): string =>
  AUDIT_TABLE_LABEL_KEYS[tableName] ? t(AUDIT_TABLE_LABEL_KEYS[tableName]) : tableName;
