import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../tests/test-utils";
import SCIMConfig from "./SCIM";

vi.mock("./networking", () => ({
  keyCreateCall: vi.fn(),
}));

vi.mock("react-copy-to-clipboard", () => ({
  CopyToClipboard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("SCIMConfig", () => {
  it("should render the SCIM configuration title and derived tenant URL", () => {
    renderWithProviders(
      <SCIMConfig accessToken="token" userID="user" proxySettings={{ PROXY_BASE_URL: "https://proxy.example.com" }} />,
    );

    expect(screen.getByText("SCIM Configuration")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://proxy.example.com/scim/v2")).toBeInTheDocument();
    expect(screen.getByText("Create SCIM Token")).toBeInTheDocument();
  });
});
