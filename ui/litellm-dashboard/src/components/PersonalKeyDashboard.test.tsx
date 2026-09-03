import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import I18nProvider from "@/i18n/I18nProvider";

const { copyToClipboardMock, deleteSpy, getSpy, postSpy, toastFromErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  copyToClipboardMock: vi.fn(),
  deleteSpy: vi.fn(),
  getSpy: vi.fn(),
  postSpy: vi.fn(),
  toastFromErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@/components/networking", () => ({
  getGlobalLitellmHeaderName: () => "Authorization",
  getProxyBaseUrl: () => "http://localhost:4000",
}));

vi.mock("@/utils/dataUtils", () => ({
  copyToClipboard: (...args: unknown[]) => copyToClipboardMock(...args),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    fromError: (...args: unknown[]) => toastFromErrorMock(...args),
  },
}));

vi.mock("@/lib/http/client", () => {
  class ApiError extends Error {
    status: number;
    body: unknown;

    constructor(message: string, status: number, body: unknown) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.body = body;
    }
  }

  return {
    ApiError,
    createApiClient: () => ({
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      delete: (...args: unknown[]) => deleteSpy(...args),
    }),
  };
});

import { ApiError } from "@/lib/http/client";
import PersonalKeyDashboard from "./PersonalKeyDashboard";

const personalKeyResponse = {
  logical_key_id: "key-1",
  key_alias: "My personal key",
  user_id: "user-1",
  team_id: "team-1",
  organization_id: "org-1",
  generation: 2,
  status: "active",
  expires: "2026-09-01T00:00:00Z",
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-15T00:00:00Z",
} as const;

const createdPersonalKeyResponse = {
  ...personalKeyResponse,
  key: "sk-personal-secret",
  key_alias: "New alias",
} as const;

const rotatedPersonalKeyResponse = {
  ...personalKeyResponse,
  key: "sk-rotated-secret",
  previous_key_revoke_at: "2026-09-05T00:00:00Z",
} as const;

function renderDashboard(readOnly = false) {
  return render(
    <I18nProvider>
      <PersonalKeyDashboard accessToken="sk-access" readOnly={readOnly} />
    </I18nProvider>,
  );
}

describe("PersonalKeyDashboard", () => {
  beforeEach(() => {
    copyToClipboardMock.mockReset();
    deleteSpy.mockReset();
    getSpy.mockReset();
    postSpy.mockReset();
    toastFromErrorMock.mockReset();
    toastSuccessMock.mockReset();
    getSpy.mockResolvedValue(personalKeyResponse);
  });

  it("loads key details without exposing write controls in read-only mode", async () => {
    renderDashboard(true);

    expect(await screen.findByText("My personal key")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rotate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();

    await waitFor(() => {
      expect(getSpy).toHaveBeenCalledWith("/internal/personal-key", {
        accessToken: "sk-access",
      });
    });
  });

  it("treats a 404 as an empty writable state instead of an error", async () => {
    getSpy.mockRejectedValue(new ApiError("Not Found", 404, {}));

    renderDashboard(false);

    expect(await screen.findByPlaceholderText("Optional key alias")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create personal key" })).toBeInTheDocument();
    expect(toastFromErrorMock).not.toHaveBeenCalled();
  });

  it("surfaces non-404 load failures to the user instead of masking them as empty", async () => {
    getSpy.mockRejectedValue(new Error("backend unavailable"));

    renderDashboard(false);

    expect(await screen.findByText("Personal key request failed")).toBeInTheDocument();
    expect(screen.getByText("backend unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create personal key" })).not.toBeInTheDocument();
    expect(toastFromErrorMock).toHaveBeenCalledTimes(1);
  });

  it("creates a personal key from the empty state and copies the revealed secret", async () => {
    const user = userEvent.setup();

    getSpy.mockRejectedValue(new ApiError("Not Found", 404, {}));
    postSpy.mockResolvedValueOnce(createdPersonalKeyResponse);

    renderDashboard(false);

    await user.type(await screen.findByPlaceholderText("Optional key alias"), "  New alias  ");
    await user.click(screen.getByRole("button", { name: "Create personal key" }));

    expect(postSpy).toHaveBeenCalledWith("/internal/personal-key", {
      accessToken: "sk-access",
      body: {
        key_alias: "New alias",
      },
    });
    expect(await screen.findByDisplayValue("sk-personal-secret")).toBeInTheDocument();
    expect(screen.getByText("New alias")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(copyToClipboardMock).toHaveBeenCalledWith("sk-personal-secret", "Personal key copied");
    expect(toastSuccessMock).toHaveBeenCalledWith("Personal key created");
  });

  it("rotates an existing personal key and shows the grace-period message", async () => {
    const user = userEvent.setup();

    postSpy.mockResolvedValueOnce(rotatedPersonalKeyResponse);

    renderDashboard(false);

    await user.click(await screen.findByRole("button", { name: "Rotate" }));

    expect(postSpy).toHaveBeenCalledWith("/internal/personal-key/rotate", {
      accessToken: "sk-access",
    });
    expect(await screen.findByDisplayValue("sk-rotated-secret")).toBeInTheDocument();
    expect(screen.getByText(/The previous key works until/)).toBeInTheDocument();
    expect(toastSuccessMock).toHaveBeenCalledWith("Personal key rotated");
  });

  it("deletes an existing personal key only after the confirmation dialog action", async () => {
    const user = userEvent.setup();

    deleteSpy.mockResolvedValueOnce({
      deleted: true,
      logical_key_id: personalKeyResponse.logical_key_id,
    });

    renderDashboard(false);

    await user.click(await screen.findByRole("button", { name: "Delete" }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Delete and immediately block this personal key?")).toBeInTheDocument();
    expect(deleteSpy).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith("/internal/personal-key", {
        accessToken: "sk-access",
      });
    });
    expect(await screen.findByPlaceholderText("Optional key alias")).toBeInTheDocument();
    expect(toastSuccessMock).toHaveBeenCalledWith("Personal key deleted");
  });
});
