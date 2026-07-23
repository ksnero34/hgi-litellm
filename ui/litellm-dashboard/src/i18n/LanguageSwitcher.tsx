"use client";

import { useTranslation } from "react-i18next";
import { supportedLanguages, type SupportedLanguage } from "./resources";

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  return (
    <label className="flex h-[38px] items-center justify-between gap-3 px-3 text-[13px] text-foreground">
      <span>{t("language.label")}</span>
      <select
        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        aria-label={t("language.label")}
        value={i18n.resolvedLanguage === "en" ? "en" : "ko"}
        onChange={(event) => void i18n.changeLanguage(event.target.value as SupportedLanguage)}
      >
        {supportedLanguages.map((language) => (
          <option key={language} value={language}>
            {t(`language.${language}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
