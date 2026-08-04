import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/http/client";
import I18nProvider from "@/i18n/I18nProvider";
import type { ComponentProps } from "react";

const { requestSpy } = vi.hoisted(() => ({
  requestSpy: vi.fn(),
}));

vi.mock("@/components/networking", () => ({
  getGlobalLitellmHeaderName: () => "Authorization",
  getProxyBaseUrl: () => "http://localhost:4000",
}));

const copyToClipboardSpy = vi.fn();
vi.mock("@/utils/dataUtils", () => ({
  copyToClipboard: (...args: unknown[]) => copyToClipboardSpy(...args),
}));

vi.mock("@/components/molecules/message_manager", () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/lib/http/client", () => ({
  ApiError: class ApiError extends Error {},
  createApiClient: () => ({ request: requestSpy }),
}));

import PersonalKeyDashboard from "./PersonalKeyDashboard";

function renderDashboard(props: ComponentProps<typeof PersonalKeyDashboard>) {
  return render(
    <I18nProvider>
      <PersonalKeyDashboard {...props} />
    </I18nProvider>,
  );
}

const personalKeyResponse = {
  logical_key_id: "key-1",
  key_alias: "My personal key",
  user_id: "user-1",
  team_id: "team-1",
  organization_id: "org-1",
  generation: 2,
  status: "active",
  expires: "2026-09-01T00:00:00Z",
} as const;

describe("PersonalKeyDashboard", () => {
  beforeEach(() => {
    requestSpy.mockReset();
    copyToClipboardSpy.mockReset();
    requestSpy.mockResolvedValue(personalKeyResponse);
    window.localStorage.clear();
  });

  it("loads key details without exposing write controls in read-only mode", async () => {
    renderDashboard({ accessToken: "sk-access", readOnly: true });

    expect(await screen.findByText("My personal key")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "교체" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "삭제" })).not.toBeInTheDocument();
    expect(screen.getByText("상태")).toBeInTheDocument();
    expect(screen.getByText("활성")).toBeInTheDocument();

    await waitFor(() => {
      expect(requestSpy).toHaveBeenCalled();
      expect(requestSpy).toHaveBeenNthCalledWith(1, "GET", "/internal/personal-key", {
        accessToken: "sk-access",
        body: undefined,
      });
    });
  });

  it("keeps write controls available for internal users", async () => {
    renderDashboard({ accessToken: "sk-access" });

    expect(await screen.findByRole("button", { name: "교체" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "삭제" })).toBeInTheDocument();
  });

  it("does not offer key creation to a read-only user without a key", async () => {
    const notFound = Object.assign(new ApiError("Not Found"), { status: 404 });
    requestSpy.mockReset();
    requestSpy.mockRejectedValueOnce(notFound).mockRejectedValueOnce(notFound);

    renderDashboard({ accessToken: "sk-access", readOnly: true });

    expect(await screen.findByText("개인 키가 아직 생성되지 않았습니다.")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("선택 사항인 키 별칭")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "개인 키 생성" })).not.toBeInTheDocument();
  });

  it("uses the shared clipboard helper for newly revealed keys", async () => {
    requestSpy.mockReset();
    requestSpy
      .mockResolvedValueOnce(personalKeyResponse)
      .mockResolvedValueOnce(personalKeyResponse)
      .mockResolvedValueOnce({
        ...personalKeyResponse,
        key: "sk-personal-secret",
      });

    renderDashboard({ accessToken: "sk-access" });

    await userEvent.click(await screen.findByRole("button", { name: "교체" }));
    await userEvent.click(await screen.findByRole("button", { name: "복사" }));

    expect(copyToClipboardSpy).toHaveBeenCalledWith("sk-personal-secret", "개인 키를 복사했습니다");
  });
});
