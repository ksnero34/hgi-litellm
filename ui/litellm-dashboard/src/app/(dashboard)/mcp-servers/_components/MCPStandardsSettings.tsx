"use client";

import { MCPServer } from "@/components/mcp_tools/types";

export interface RequiredFieldDef {
  key: string;
  label: string;
  description: string;
  labelKey: string;
  descriptionKey: string;
  check: (server: MCPServer) => boolean;
}

export interface FieldGroup {
  label: string;
  labelKey: string;
  fields: RequiredFieldDef[];
}

export const FIELD_GROUPS: FieldGroup[] = [
  {
    label: "Documentation",
    labelKey: "toolsModels.mcp.standards.groups.documentation",
    fields: [
      {
        key: "description",
        label: "Description",
        description: "Must have a non-empty description",
        labelKey: "toolsModels.mcp.standards.fields.description.label",
        descriptionKey: "toolsModels.mcp.standards.fields.description.description",
        check: (s) => !!s.description?.trim(),
      },
      {
        key: "alias",
        label: "Alias",
        description: "Must have a display alias",
        labelKey: "toolsModels.mcp.standards.fields.alias.label",
        descriptionKey: "toolsModels.mcp.standards.fields.alias.description",
        check: (s) => !!s.alias?.trim(),
      },
    ],
  },
  {
    label: "Source",
    labelKey: "toolsModels.mcp.standards.groups.source",
    fields: [
      {
        key: "source_url",
        label: "GitHub / Source URL",
        description: "Must link to a source repository",
        labelKey: "toolsModels.mcp.standards.fields.sourceUrl.label",
        descriptionKey: "toolsModels.mcp.standards.fields.sourceUrl.description",
        check: (s) => !!s.source_url?.trim(),
      },
    ],
  },
  {
    label: "Connection",
    labelKey: "toolsModels.mcp.standards.groups.connection",
    fields: [
      {
        key: "url",
        label: "Server URL",
        description: "Must have a URL configured",
        labelKey: "toolsModels.mcp.standards.fields.serverUrl.label",
        descriptionKey: "toolsModels.mcp.standards.fields.serverUrl.description",
        check: (s) => !!s.url?.trim(),
      },
    ],
  },
  {
    label: "Security",
    labelKey: "toolsModels.mcp.standards.groups.security",
    fields: [
      {
        key: "auth_type",
        label: "Auth configured",
        description: "Must use authentication (not 'none')",
        labelKey: "toolsModels.mcp.standards.fields.authConfigured.label",
        descriptionKey: "toolsModels.mcp.standards.fields.authConfigured.description",
        check: (s) => !!s.auth_type && s.auth_type !== "none",
      },
    ],
  },
];

export const MCP_REQUIRED_FIELD_DEFS: RequiredFieldDef[] = FIELD_GROUPS.flatMap((g) => g.fields);

export const SETTINGS_KEY = "mcp_required_fields";
