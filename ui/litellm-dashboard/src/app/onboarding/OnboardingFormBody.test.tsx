import React from "react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, waitFor } from "../../../tests/test-utils";
import { OnboardingFormBody } from "./OnboardingFormBody";

const defaultProps = {
  variant: "signup" as const,
  userEmail: "test@example.com",
  isPending: false,
  claimError: null,
  onSubmit: vi.fn(),
};

describe("OnboardingFormBody", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should show signup heading for signup variant", () => {
    renderWithProviders(<OnboardingFormBody {...defaultProps} />);
    expect(screen.getByRole("heading", { name: "계정 등록" })).toBeInTheDocument();
  });

  it("should show reset password heading for reset_password variant", () => {
    renderWithProviders(<OnboardingFormBody {...defaultProps} variant="reset_password" />);
    expect(screen.getByRole("heading", { name: "비밀번호 재설정" })).toBeInTheDocument();
  });

  it("should show the signup helper copy", () => {
    renderWithProviders(<OnboardingFormBody {...defaultProps} />);
    expect(screen.getByText("관리자 화면에 로그인할 계정을 등록하세요.")).toBeInTheDocument();
  });

  it("should show the reset password helper copy", () => {
    renderWithProviders(<OnboardingFormBody {...defaultProps} variant="reset_password" />);
    expect(screen.getByText("관리자 화면에 접속할 새 비밀번호를 설정하세요.")).toBeInTheDocument();
  });

  it("should pre-fill the email field with userEmail", async () => {
    renderWithProviders(<OnboardingFormBody {...defaultProps} userEmail="user@example.com" />);
    await waitFor(() => {
      expect(screen.getByLabelText("이메일 주소")).toHaveValue("user@example.com");
    });
  });

  it("should disable the email field", () => {
    renderWithProviders(<OnboardingFormBody {...defaultProps} />);
    expect(screen.getByLabelText("이메일 주소")).toBeDisabled();
  });

  it("should show claimError message when claimError is set", () => {
    renderWithProviders(<OnboardingFormBody {...defaultProps} claimError="Something went wrong" />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("should not show claimError message when claimError is null", () => {
    renderWithProviders(<OnboardingFormBody {...defaultProps} claimError={null} />);
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("should show a loading indicator on the submit button when isPending is true", () => {
    renderWithProviders(<OnboardingFormBody {...defaultProps} isPending={true} />);
    expect(screen.getByRole("img", { name: "loading" })).toBeInTheDocument();
  });

  it("should call onSubmit with the typed password on form submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(<OnboardingFormBody {...defaultProps} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("비밀번호"), "mypassword");
    await user.click(screen.getByRole("button", { name: "계정 등록" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ password: "mypassword" }));
    });
  });

  it("should show reset password on the submit button for reset_password variant", () => {
    renderWithProviders(<OnboardingFormBody {...defaultProps} variant="reset_password" />);
    expect(screen.getByRole("button", { name: "비밀번호 재설정" })).toBeInTheDocument();
  });
});
