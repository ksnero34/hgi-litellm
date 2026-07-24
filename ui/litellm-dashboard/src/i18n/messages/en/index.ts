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
];

export const enMessages: MessageCatalog = {
  ...shellMessages,
  ...Object.assign({}, ...areaCatalogs),
};
