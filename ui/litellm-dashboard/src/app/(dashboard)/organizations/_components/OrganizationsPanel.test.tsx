import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { Organization } from "@/components/networking";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type OrganizationsTableComponent from "./OrganizationsTable";
import type OrganizationInfoViewComponent from "@/components/organization/organization_view";

vi.mock("@/components/vector_store_management/VectorStoreSelector", () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock("@/components/mcp_server_management/MCPServerSelector", () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock("@/app/(dashboard)/hooks/useAuthorized", () => ({
  default: () => ({
    accessToken: null,
    userId: null,
    userRole: null,
  }),
}));
type OrganizationsTableProps = React.ComponentProps<typeof OrganizationsTableComponent>;
type OrganizationInfoViewProps = React.ComponentProps<typeof OrganizationInfoViewComponent>;

let capturedTableProps: OrganizationsTableProps | null = null;
vi.mock("./OrganizationsTable", () => ({
  __esModule: true,
  default: (props: OrganizationsTableProps) => {
    capturedTableProps = props;
    return (
      <div>
        <div data-testid="organizations-table">isLoading:{String(props.isLoading)}</div>
        <button type="button" onClick={() => props.onOrganizationClick("org-1")}>
          Open org
        </button>
      </div>
    );
  },
}));
const mockOrgInfoView = vi.fn<(props: OrganizationInfoViewProps) => void>();
vi.mock("@/components/organization/organization_view", () => ({
  __esModule: true,
  default: (props: OrganizationInfoViewProps) => {
    mockOrgInfoView(props);
    return (
      <div
        data-testid="organization-info-view"
        data-organization-id={props.organizationId}
        data-is-org-admin={String(props.is_org_admin)}
        data-is-proxy-admin={String(props.is_proxy_admin)}
      />
    );
  },
}));
vi.mock("@/components/organization/org-create/OrgCreateDialog", () => ({
  __esModule: true,
  OrgCreateDialog: () => null,
}));
vi.mock("@/app/(dashboard)/hooks/organizations/useOrganizations", () => ({
  organizationKeys: {
    lists: () => ["organizations", "list"],
  },
  useOrganizations: vi.fn(),
}));
vi.mock("@/app/(dashboard)/hooks/models/useModels", () => ({
  useUserModels: () => ({ data: [] }),
}));

// The selected org is URL-derived (?org=) via useOrgDetailRouting. Next's real useSearchParams
// re-renders subscribers on history.pushState/replaceState; mirror that so URL changes propagate.
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  const LOCATION_CHANGE_EVENT = "test-locationchange";
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method].bind(window.history);
    window.history[method] = (...args: Parameters<History["pushState"]>) => {
      original(...args);
      window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
    };
  }
  const subscribe = (onChange: () => void) => {
    window.addEventListener(LOCATION_CHANGE_EVENT, onChange);
    window.addEventListener("popstate", onChange);
    return () => {
      window.removeEventListener(LOCATION_CHANGE_EVENT, onChange);
      window.removeEventListener("popstate", onChange);
    };
  };
  return {
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search)),
  };
});

import OrganizationsPanel from "./OrganizationsPanel";
import { useOrganizations } from "@/app/(dashboard)/hooks/organizations/useOrganizations";

const mockUseOrganizations = vi.mocked(useOrganizations);
const organizations: Organization[] = [
  {
    organization_id: "org-1",
    organization_alias: "Acme",
    budget_id: "budget-1",
    metadata: {},
    models: [],
    spend: 0,
    model_spend: {},
    created_at: "2024-01-01T00:00:00Z",
    created_by: "admin@example.com",
    updated_at: "2024-01-01T00:00:00Z",
    updated_by: "admin@example.com",
    litellm_budget_table: null,
    teams: null,
    users: null,
    members: null,
  },
];
const loadedOrganizations = { data: organizations, isLoading: false } as ReturnType<typeof useOrganizations>;

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};

beforeEach(() => {
  capturedTableProps = null;
  mockOrgInfoView.mockClear();
  window.history.replaceState(null, "", "/organizations/");
});

describe("OrganizationsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the organizations UI for a non-premium session", () => {
    mockUseOrganizations.mockReturnValue(loadedOrganizations);

    renderWithQueryClient(<OrganizationsPanel userRole="Internal User" accessToken="sk-test" />);

    expect(screen.queryByText("Click on “Organization ID” to view organization details.")).not.toBeInTheDocument();
    expect(screen.getByTestId("organizations-table")).toHaveTextContent("isLoading:false");
    expect(screen.queryByText("+ Create New Organization")).not.toBeInTheDocument();
  });

  it("shows the create button for a proxy admin", () => {
    mockUseOrganizations.mockReturnValue(loadedOrganizations);

    renderWithQueryClient(<OrganizationsPanel userRole="Admin" accessToken={null} />);

    expect(screen.getByText("+ Create New Organization")).toBeInTheDocument();
  });

  it("hides the proxy-admin-only create button from an org admin alias", () => {
    mockUseOrganizations.mockReturnValue(loadedOrganizations);

    renderWithQueryClient(<OrganizationsPanel userRole="org_admin" accessToken="sk-test" />);

    expect(screen.queryByText("+ Create New Organization")).not.toBeInTheDocument();
  });

  it("passes org-admin detail permissions for an org admin selection", async () => {
    const user = userEvent.setup();
    mockUseOrganizations.mockReturnValue(loadedOrganizations);
    renderWithQueryClient(<OrganizationsPanel userRole="Org Admin" accessToken="sk-test" />);

    await user.click(screen.getByRole("button", { name: "Open org" }));

    expect(screen.getByTestId("organization-info-view")).toHaveAttribute("data-is-org-admin", "true");
    expect(screen.getByTestId("organization-info-view")).toHaveAttribute("data-is-proxy-admin", "false");
  });

  it("resolves the loading skeleton to false when the query is disabled (no token)", () => {
    mockUseOrganizations.mockReturnValue(loadedOrganizations);
    renderWithQueryClient(<OrganizationsPanel userRole="Admin" accessToken={null} />);

    // A disabled React Query keeps isPending true forever; feeding isLoading avoids a stuck skeleton.
    expect(screen.getByTestId("organizations-table")).toHaveTextContent("isLoading:false");
  });
});

describe("OrganizationsPanel - org detail deep link (?org=)", () => {
  it("clicking an organization pushes ?org= and opens the detail view", () => {
    renderWithQueryClient(<OrganizationsPanel userRole="Admin" accessToken={null} />);

    act(() => capturedTableProps?.onOrganizationClick("org-deep-link"));

    expect(window.location.search).toContain("org=org-deep-link");
    expect(mockOrgInfoView).toHaveBeenLastCalledWith(expect.objectContaining({ organizationId: "org-deep-link" }));
  });

  it("opens the org detail directly from a ?org= deep link", () => {
    window.history.replaceState(null, "", "/organizations/?org=org-from-url");
    renderWithQueryClient(<OrganizationsPanel userRole="Admin" accessToken={null} />);

    expect(mockOrgInfoView).toHaveBeenLastCalledWith(
      expect.objectContaining({ organizationId: "org-from-url", editOrg: false }),
    );
    expect(screen.queryByTestId("organizations-table")).not.toBeInTheDocument();
  });

  it("closing the org detail removes ?org= and returns to the list", () => {
    window.history.replaceState(null, "", "/organizations/?org=org-from-url");
    renderWithQueryClient(<OrganizationsPanel userRole="Admin" accessToken={null} />);

    act(() => mockOrgInfoView.mock.calls.at(-1)?.[0].onClose());

    expect(window.location.search).not.toContain("org=");
    expect(screen.queryByTestId("organization-info-view")).not.toBeInTheDocument();
    expect(screen.getByTestId("organizations-table")).toBeInTheDocument();
  });

  it("the edit action opens the detail in edit mode with ?org= set", () => {
    renderWithQueryClient(<OrganizationsPanel userRole="Admin" accessToken={null} />);

    act(() => capturedTableProps?.onEditClick("org-edit"));

    expect(window.location.search).toContain("org=org-edit");
    expect(mockOrgInfoView).toHaveBeenLastCalledWith(
      expect.objectContaining({ organizationId: "org-edit", editOrg: true }),
    );
  });

  it("a plain row click after leaving an edit view via browser history does not reopen in edit mode", () => {
    renderWithQueryClient(<OrganizationsPanel userRole="Admin" accessToken={null} />);

    act(() => capturedTableProps?.onEditClick("org-edit"));
    expect(mockOrgInfoView).toHaveBeenLastCalledWith(expect.objectContaining({ editOrg: true }));

    act(() => window.history.pushState(null, "", "/organizations/"));
    act(() => capturedTableProps?.onOrganizationClick("org-plain"));

    expect(mockOrgInfoView).toHaveBeenLastCalledWith(
      expect.objectContaining({ organizationId: "org-plain", editOrg: false }),
    );
  });
});
