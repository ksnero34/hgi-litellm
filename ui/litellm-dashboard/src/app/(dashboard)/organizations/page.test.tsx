import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(dashboard)/hooks/useAuthorized", () => ({
  __esModule: true,
  default: () => ({
    accessToken: "sk-test",
    userRole: "Admin",
  }),
}));

vi.mock("./_components/OrganizationsPanel", () => ({
  __esModule: true,
  default: (props: { accessToken: string; userRole: string }) => (
    <div data-testid="organizations-panel" data-access-token={props.accessToken} data-user-role={props.userRole} />
  ),
}));

import OrganizationsPage from "./page";

describe("OrganizationsPage", () => {
  it("mounts OrganizationsPanel with the authorized organizations flow props", () => {
    render(<OrganizationsPage />);

    expect(screen.getByTestId("organizations-panel")).toHaveAttribute("data-access-token", "sk-test");
    expect(screen.getByTestId("organizations-panel")).toHaveAttribute("data-user-role", "Admin");
  });
});
