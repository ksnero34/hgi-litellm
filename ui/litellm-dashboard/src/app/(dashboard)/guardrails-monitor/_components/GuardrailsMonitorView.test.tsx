import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18n";
import { languageStorageKey } from "@/i18n/resources";
import { renderWithProviders, screen, waitFor } from "../../../../../tests/test-utils";
import GuardrailsMonitorView from "./GuardrailsMonitorView";
import * as networking from "@/components/networking";

vi.mock("@/components/networking", () => ({
  getGuardrailsUsageOverview: vi.fn(),
  formatDate: vi.fn((d: Date) => d.toISOString().slice(0, 10)),
}));

const mockGetGuardrailsUsageOverview = vi.mocked(networking.getGuardrailsUsageOverview);

describe("GuardrailsMonitorView", () => {
  beforeEach(() => {
    window.localStorage.setItem(languageStorageKey, "en");
    void i18n.changeLanguage("en");
  });
  it("should render overview and fetch guardrails usage when accessToken is provided", async () => {
    mockGetGuardrailsUsageOverview.mockResolvedValue({
      rows: [],
      chart: [],
      totalRequests: 0,
      totalBlocked: 0,
      passRate: 100,
    });

    renderWithProviders(<GuardrailsMonitorView accessToken="test-token" />);

    expect(await screen.findByRole("heading", { name: /Guardrails Monitor/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(mockGetGuardrailsUsageOverview).toHaveBeenCalled();
    });
  });

  it("should render without crashing when accessToken is null", async () => {
    renderWithProviders(<GuardrailsMonitorView accessToken={null} />);
    expect(await screen.findByRole("heading", { name: /Guardrails Monitor/i })).toBeInTheDocument();
  });
});
