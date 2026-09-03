import { enMessages } from "./messages/en";
import { koMessages } from "./messages/ko";
import type { MessageCatalog } from "./messages/types";

export { type MessageCatalog } from "./messages/types";

export const supportedLanguages = ["ko", "en"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];
export const defaultLanguage: SupportedLanguage = "en";
export const languageStorageKey = "litellm-ui-language";

const toTranslationResource = (catalog: MessageCatalog) => ({
  translation: catalog,
});

export const resources = {
  en: toTranslationResource(enMessages),
  ko: toTranslationResource(koMessages),
} as const;
