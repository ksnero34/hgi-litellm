import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DashboardHeader } from "./DashboardHeader";

const { mockUsePluginMode, mockUseUISettings, state } = vi.hoisted(() => {
  const state = {
    plugins: [] as { name: string; display_name: string; url: string }[],
    enableChatUI: false,
    isControlPlane: false,
    selectedWorker: null as { id: string } | null,
  };
  return {
    state,
    mockUsePluginMode: vi.fn(() => ({ mode: "ai-gateway", setMode: vi.fn(), plugins: state.plugins })),
    mockUseUISettings: vi.fn(() => ({ data: { values: { enable_chat_ui: state.enableChatUI } } })),
  };
});

vi.mock("@/contexts/PluginModeContext", () => ({ usePluginMode: mockUsePluginMode }));
vi.mock("@/app/(dashboard)/hooks/uiSettings/useUISettings", () => ({ useUISettings: mockUseUISettings }));
vi.mock("next/navigation", () => ({ usePathname: () => "/ui/" }));
vi.mock("@/utils/migratedPages", () => ({ migratedHref: (seg: string) => `/ui/${seg}` }));
vi.mock("@/hooks/useWorker", () => ({
  useWorker: () => ({ isControlPlane: state.isControlPlane, selectedWorker: state.selectedWorker }),
}));
vi.mock("@/components/Navbar/NotificationsBell/NotificationsBell", () => ({ NotificationsBell: () => null }));
vi.mock("@/components/Navbar/WorkerDropdown/WorkerDropdown", () => ({ default: () => null }));

describe("DashboardHeader breadcrumb", () => {
  afterEach(() => {
    state.plugins = [];
    state.enableChatUI = false;
    state.isControlPlane = false;
    state.selectedWorker = null;
  });

  it("roots the breadcrumb in the AI Gateway selector (with a Chat option) and drops the static section crumb when the selector is available", async () => {
    state.enableChatUI = true;
    render(<DashboardHeader page="logs" />);

    expect(screen.getByText("Logs")).toBeInTheDocument();
    expect(screen.queryByText("Observability")).not.toBeInTheDocument();

    const selector = screen.getByRole("button", { name: /AI Gateway/i });
    act(() => {
      fireEvent.click(selector);
    });
    expect(await screen.findByText("Chat")).toBeInTheDocument();
  });

  it("keeps the AI Gateway selector at the root even when there is nothing to switch to (discovery)", () => {
    render(<DashboardHeader page="logs" />);

    expect(screen.getByRole("button", { name: /AI Gateway/i })).toBeInTheDocument();
    expect(screen.getByText("Logs")).toBeInTheDocument();
    expect(screen.queryByText("Observability")).not.toBeInTheDocument();
  });

  it("does not expose external product or community links in the closed-network header", () => {
    render(<DashboardHeader page="logs" />);

    expect(screen.queryByRole("link", { name: "Docs" })).not.toBeInTheDocument();
    expect(screen.queryByText("Blog")).not.toBeInTheDocument();
    expect(screen.queryByText("Support")).not.toBeInTheDocument();
  });

  it("renders the tools divider centered rather than stretched to the top of the row", () => {
    state.isControlPlane = true;
    state.selectedWorker = { id: "worker-1" };
    const { container } = render(<DashboardHeader page="logs" />);

    const separators = container.querySelectorAll('[data-slot="separator"][data-orientation="vertical"]');
    expect(separators).toHaveLength(1);
    expect(separators[0].className).not.toMatch(/self-stretch/);
    expect(separators[0].className).toContain("data-vertical:self-center");
  });
});
