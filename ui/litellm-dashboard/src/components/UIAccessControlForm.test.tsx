import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../tests/test-utils";
import UIAccessControlForm from "./UIAccessControlForm";

vi.mock("./networking", () => ({
  getSSOSettings: vi.fn().mockResolvedValue({ values: {} }),
  updateSSOSettings: vi.fn(),
}));

describe("UIAccessControlForm", () => {
  it("should render the access mode form copy", async () => {
    renderWithProviders(<UIAccessControlForm accessToken="token" onSuccess={vi.fn()} />);

    expect(
      screen.getByText(
        "Configure who can access the UI interface and how group information is extracted from JWT tokens.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Update UI Access Control")).toBeInTheDocument();
  });
});
