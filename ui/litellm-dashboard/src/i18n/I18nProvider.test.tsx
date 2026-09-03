import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useTranslation } from "react-i18next";
import { beforeEach, describe, expect, it } from "vitest";
import I18nProvider from "./I18nProvider";
import { i18n } from "./i18n";
import { languageStorageKey } from "./resources";

function Probe() {
  const { t, i18n: instance } = useTranslation();
  return <button onClick={() => void instance.changeLanguage("en")}>{t("account.logout")}</button>;
}

describe("I18nProvider", () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage("ko");
  });

  it("uses English by default and persists language changes", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    const button = await screen.findByRole("button", { name: "Log out" });
    await user.click(button);
    expect(await screen.findByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(localStorage.getItem(languageStorageKey)).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("uses English for an unsupported persisted language", async () => {
    localStorage.setItem(languageStorageKey, "unsupported");
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(await screen.findByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
  });

  it("falls back to English when a Korean key is missing", () => {
    i18n.addResource("en", "translation", "fallback.only", "English fallback");
    expect(i18n.t("fallback.only", { lng: "ko" })).toBe("English fallback");
  });
});
