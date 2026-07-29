import { shellMessages } from "./shell";
import { guardrailsMessages } from "./guardrails";
import { settingsMessages } from "./settings";
import { observabilityMessages } from "./observability";
import { toolsModelsMessages } from "./toolsModels";
import { gatewayMessages } from "./gateway";
import { accessMessages } from "./access";
import { authMessages } from "./auth";
import { playgroundAgentsMessages } from "./playgroundAgents";
import { identityMessages } from "./identity";
import { identityAdminMessages } from "./identityAdmin";
import { hubSkillsMessages } from "./hubSkills";
import { interactionExtraMessages } from "./interactionExtra";
import { modelManagementMessages } from "./modelManagement";
import { operationsMessages } from "./operations";
import { observabilityExtraMessages } from "./observabilityExtra";
import { safetyPoliciesMessages } from "./safetyPolicies";
import { settingsExtraMessages } from "./settingsExtra";
import type { MessageCatalog } from "../types";

const areaCatalogs: readonly MessageCatalog[] = [
  gatewayMessages,
  observabilityMessages,
  toolsModelsMessages,
  guardrailsMessages,
  accessMessages,
  authMessages,
  settingsMessages,
  playgroundAgentsMessages,
  identityMessages,
  identityAdminMessages,
  hubSkillsMessages,
  interactionExtraMessages,
  modelManagementMessages,
  operationsMessages,
  observabilityExtraMessages,
  safetyPoliciesMessages,
  settingsExtraMessages,
];

export const enMessages: MessageCatalog = {
  ...shellMessages,
  ...Object.assign({}, ...areaCatalogs),
};
