export interface PiiEntity {
  name: string;
  category: string;
}

export interface PiiEntityCategory {
  category: string;
  entities: string[];
}

export interface PiiConfigurationProps {
  entities: string[];
  actions: string[];
  selectedEntities: string[];
  selectedActions: { [key: string]: string };
  onEntitySelect: (entity: string) => void;
  onActionSelect: (entity: string, action: string) => void;
  entityCategories?: PiiEntityCategory[];
}

export type GuardrailMode =
  | string
  | string[]
  | { tags?: Record<string, string | string[]>; default?: string | string[] | null };

export interface Guardrail {
  guardrail_id: string;
  guardrail_name: string | null;
  litellm_params: {
    guardrail: string;
    mode: GuardrailMode;
    default_on: boolean;
    pii_entities_config?: { [key: string]: string };
    [key: string]: any;
  };
  guardrail_info: Record<string, any> | null;
  created_at?: string;
  updated_at?: string;
  guardrail_definition_location: GuardrailDefinitionLocation;
}

export enum GuardrailDefinitionLocation {
  DB = "db",
  CONFIG = "config",
}

export interface PresidioCacheSettings {
  enabled_by_default: boolean;
  ttl_seconds: number;
  prerequisites_ready: boolean;
  unavailable_reasons: string[];
}

export interface GuardrailSettings {
  presidio_analysis_cache?: PresidioCacheSettings;
  supported_entities: string[];
  supported_actions: string[];
  supported_modes: string[];
  supported_modes_by_provider?: Record<string, string[]>;
  pii_entity_categories: Array<{
    category: string;
    entities: string[];
  }>;
  content_filter_settings?: {
    prebuilt_patterns: Array<{
      name: string;
      display_name: string;
      category: string;
      description: string;
    }>;
    pattern_categories: string[];
    supported_actions: string[];
    content_categories?: Array<{
      name: string;
      display_name: string;
      description: string;
      default_action: string;
    }>;
  };
}
