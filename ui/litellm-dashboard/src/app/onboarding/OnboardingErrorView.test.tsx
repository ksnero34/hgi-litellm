import React from "react";
import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "../../../tests/test-utils";
import { OnboardingErrorView } from "./OnboardingErrorView";

describe("OnboardingErrorView", () => {
  it("should show the failed to load invitation message", () => {
    renderWithProviders(<OnboardingErrorView />);
    expect(screen.getByText("초대 정보를 불러오지 못했습니다")).toBeInTheDocument();
  });

  it("should show the expiry description", () => {
    renderWithProviders(<OnboardingErrorView />);
    expect(screen.getByText("초대 링크가 올바르지 않거나 만료되었을 수 있습니다.")).toBeInTheDocument();
  });

  it("should render a Back to Login link pointing to /ui/login/", () => {
    renderWithProviders(<OnboardingErrorView />);
    const link = screen.getByRole("link", { name: "로그인으로 돌아가기" });
    expect(link).toHaveAttribute("href", "/ui/login/");
  });
});
