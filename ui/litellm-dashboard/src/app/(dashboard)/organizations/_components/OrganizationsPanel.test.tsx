import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { Organization } from "@/components/networking";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("./OrganizationsTable", () => ({
  __esModule: true,
  default: (props: { isLoading: boolean; onOrganizationClick: (organizationId: string) => void }) => (
    <div>
      <div data-testid="organizations-table">isLoading:{String(props.isLoading)}</div>
      <button type="button" onClick={() => props.onOrganizationClick("org-1")}>
        Open org
      </button>
    </div>
  ),
}));
vi.mock("@/components/organization/org-create/OrgCreateDialog", () => ({
  __esModule: true,
  OrgCreateDialog: () => null,
}));
vi.mock("@/components/organization/organization_view", () => ({
  __esModule: true,
  default: (props: { organizationId: string; is_org_admin: boolean; is_proxy_admin: boolean }) => (
    <div
      data-testid="organization-info-view"
      data-organization-id={props.organizationId}
      data-is-org-admin={String(props.is_org_admin)}
      data-is-proxy-admin={String(props.is_proxy_admin)}
    />
  ),
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
