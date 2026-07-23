import { readFileSync } from "node:fs";
import { globSync } from "glob";
import { describe, expect, it } from "vitest";
import { enMessages } from "./messages/en";
import { koMessages } from "./messages/ko";
import { resources } from "./resources";

const migratedPrefixes = [
  "access.",
  "auth.",
  "gateway.",
  "guardrails.",
  "observability.",
  "playgroundAgents.",
  "settings.",
  "toolsModels.",
] as const;

function extractReferencedTranslationKeys(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(/\bt\(\s*["\x27]([^"\x27]+)["\x27]/g)]
    .map((match) => match[1])
    .filter((key) => migratedPrefixes.some((prefix) => key.startsWith(prefix)));
}

function getMissingTranslationKeys(): string[] {
  const referencedKeys = globSync("src/**/*.{ts,tsx}", {
    ignore: ["src/**/*.test.*", "src/i18n/messages/**"],
  }).flatMap(extractReferencedTranslationKeys);

  return [...new Set(referencedKeys)].filter((key) => !(key in resources.en.translation)).sort();
}

describe("resources", () => {
  it("exposes the merged resource map for both locales", () => {
    expect(resources.en.translation).toMatchObject(enMessages);
    expect(resources.ko.translation).toMatchObject(koMessages);
  });

  it("keeps resource catalogs flat string maps", () => {
    const nonStringEntries = Object.entries(resources.en.translation).filter(([, value]) => typeof value !== "string");
    expect(nonStringEntries).toEqual([]);
  });

  it("exposes translated keys referenced by migrated screens", () => {
    expect(resources.en.translation["auth.login.title"]).toBe("Login");
    expect(resources.ko.translation["auth.account.logout"]).toBe("로그아웃");
    expect(resources.en.translation["access.budgets.create"]).toBe("Create Budget");
    expect(resources.en.translation["observability.logs.request"]).toBe("Request");
  });

  it("defines every static migrated translation key referenced by source files", () => {
    expect(getMissingTranslationKeys()).toEqual([]);
  });

  it("keeps locale key sets aligned", () => {
    expect(Object.keys(resources.en.translation).sort()).toEqual(Object.keys(resources.ko.translation).sort());
  });
});
