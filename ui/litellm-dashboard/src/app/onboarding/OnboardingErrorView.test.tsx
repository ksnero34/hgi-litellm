import React from "react";
import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "../../../tests/test-utils";
import { OnboardingErrorView } from "./OnboardingErrorView";

describe("OnboardingErrorView", () => {
  it("should show the failed to load invitation message", () => {
    renderWithProviders(<OnboardingErrorView />);
    expect(screen.getByText("Failed to load invitation")).toBeInTheDocument();
  });

  it("should show the expiry description", () => {
    renderWithProviders(<OnboardingErrorView />);
    expect(screen.getByText("The invitation link may be invalid or expired.")).toBeInTheDocument();
  });

  it("should render a Back to Login link pointing to /ui/login", () => {
    renderWithProviders(<OnboardingErrorView />);
    const link = screen.getByRole("link", { name: "Back to Login" });
    expect(link).toHaveAttribute("href", "/ui/login");
  });
});
