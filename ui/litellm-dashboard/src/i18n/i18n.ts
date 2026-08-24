import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import { defaultLanguage, resources } from "./resources";

export const i18n = createInstance();
export const i18nReady = i18n.use(initReactI18next).init({
  resources,
  lng: defaultLanguage,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});
