import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

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

import OrganizationsTable from "./organizations";

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};

describe("OrganizationsTable", () => {
  it("should render the OrganizationsTable component", () => {
    const { getByText } = renderWithQueryClient(<OrganizationsTable userRole="Admin" accessToken={null} />);

    expect(getByText("+ Create New Organization")).toBeInTheDocument();
  });

  it.each(["Admin", "proxy_admin", "Org Admin", "org_admin"])(
    "shows organization management for %s without an Enterprise license",
    (userRole) => {
      renderWithQueryClient(<OrganizationsTable userRole={userRole} accessToken={null} />);

      expect(screen.getByText("+ Create New Organization")).toBeInTheDocument();
      expect(screen.queryByText(/LiteLLM Enterprise feature/)).not.toBeInTheDocument();
    },
  );

  it.each(["internal_user", "internal_user_viewer", "proxy_admin_viewer"])(
    "does not expose organization creation to %s",
    (userRole) => {
      renderWithQueryClient(<OrganizationsTable userRole={userRole} accessToken={null} />);

      expect(screen.queryByText("+ Create New Organization")).not.toBeInTheDocument();
    },
  );
});
