"use client";

import { PropsWithChildren, useEffect } from "react";
import { I18nextProvider } from "react-i18next";
import { i18n, i18nReady } from "./i18n";
import { defaultLanguage, languageStorageKey, supportedLanguages, type SupportedLanguage } from "./resources";

const isSupported = (value: string | null): value is SupportedLanguage =>
  supportedLanguages.some((language) => language === value);

const resolveLanguage = (stored: string | null): SupportedLanguage => {
  if (isSupported(stored)) return stored;
  if (stored === null) return defaultLanguage;
  return "en";
};

export default function I18nProvider({ children }: PropsWithChildren) {
  useEffect(() => {
    const stored = window.localStorage.getItem(languageStorageKey);
    const language = resolveLanguage(stored);
    void i18nReady.then(() => i18n.changeLanguage(language));
    document.documentElement.lang = language;
    const updateDocument = (next: string) => {
      document.documentElement.lang = next;
      window.localStorage.setItem(languageStorageKey, next);
    };
    i18n.on("languageChanged", updateDocument);
    return () => i18n.off("languageChanged", updateDocument);
  }, []);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
