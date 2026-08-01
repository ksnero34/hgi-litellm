import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestSpy } = vi.hoisted(() => ({
  requestSpy: vi.fn(),
}));

vi.mock("@/components/networking", () => ({
  getGlobalLitellmHeaderName: () => "Authorization",
  getProxyBaseUrl: () => "http://localhost:4000",
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

const personalKeyResponse = {
  logical_key_id: "key-1",
  key_alias: "My personal key",
  user_id: "user-1",
  team_id: "team-1",
  organization_id: "org-1",
  generation: 2,
  status: "active",
  expires: "2026-09-01T00:00:00Z",
};

describe("PersonalKeyDashboard", () => {
  beforeEach(() => {
    requestSpy.mockReset();
    requestSpy.mockResolvedValue(personalKeyResponse);
  });

  it("loads key details without exposing write controls in read-only mode", async () => {
    render(<PersonalKeyDashboard accessToken="sk-access" readOnly />);

    expect(await screen.findByText("My personal key")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rotate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(requestSpy).toHaveBeenCalledTimes(1);
      expect(requestSpy).toHaveBeenCalledWith("GET", "/internal/personal-key", {
        accessToken: "sk-access",
        body: undefined,
      });
    });
  });

  it("keeps write controls available for internal users", async () => {
    render(<PersonalKeyDashboard accessToken="sk-access" />);

    expect(await screen.findByRole("button", { name: "Rotate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("does not offer key creation to a read-only user without a key", async () => {
    requestSpy.mockResolvedValueOnce(null);

    render(<PersonalKeyDashboard accessToken="sk-access" readOnly />);

    expect(await screen.findByText("No personal key has been created.")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Optional key alias")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create personal key" })).not.toBeInTheDocument();
  });
});
