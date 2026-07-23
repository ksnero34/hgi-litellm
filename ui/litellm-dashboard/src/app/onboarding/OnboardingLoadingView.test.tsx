import React from "react";
import { describe, it, expect } from "vitest";
import { renderWithProviders } from "../../../tests/test-utils";
import { OnboardingLoadingView } from "./OnboardingLoadingView";

describe("OnboardingLoadingView", () => {
  it("should render a spinner container", () => {
    const { container } = renderWithProviders(<OnboardingLoadingView />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it("should apply centering layout classes", () => {
    const { container } = renderWithProviders(<OnboardingLoadingView />);
    expect(container.firstChild).toHaveClass("flex", "justify-center");
  });
});
