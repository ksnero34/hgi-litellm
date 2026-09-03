import { render } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";

const { authorizedUser, personalKeyDashboardSpy, userDashboardSpy } = vi.hoisted(() => ({
  authorizedUser: {
    userRole: "Admin",
  },
  personalKeyDashboardSpy: vi.fn((_props: Record<string, unknown>) => null),
  userDashboardSpy: vi.fn((_props: Record<string, unknown>) => null),
}));

vi.mock("@/components/PersonalKeyDashboard", () => ({
  default: (props: Record<string, unknown>) => personalKeyDashboardSpy(props),
}));

vi.mock("@/components/user_dashboard", () => ({
  default: (props: Record<string, unknown>) => userDashboardSpy(props),
}));

// AuthContext is still hydrating: userID has not been populated yet (the regression).
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    userID: null,
    userRole: "",
    userEmail: null,
    accessToken: null,
    premiumUser: false,
    setUserRole: vi.fn(),
    setUserEmail: vi.fn(),
  }),
}));

// useAuthorized decodes the cookie synchronously, so identity is already available.
vi.mock("@/app/(dashboard)/hooks/useAuthorized", () => ({
  default: () => ({
    isLoading: false,
    isAuthorized: true,
    token: "jwt",
    accessToken: "sk-access",
    userId: "u-123",
    userEmail: "admin@example.com",
    userRole: authorizedUser.userRole,
    premiumUser: false,
    disabledPersonalKeyCreation: false,
    showSSOBanner: false,
  }),
}));

vi.mock("@/app/(dashboard)/hooks/teams/useTeams", () => ({
  teamListCall: vi.fn(() => new Promise(() => {})),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

import ApiKeysDashboard from "./ApiKeysDashboard";

describe("ApiKeysDashboard identity source", () => {
  beforeEach(() => {
    authorizedUser.userRole = "Admin";
    personalKeyDashboardSpy.mockClear();
    userDashboardSpy.mockClear();
  });

  it("passes the useAuthorized userID through even while AuthContext.userID is still null", () => {
    render(<ApiKeysDashboard />);

    expect(userDashboardSpy).toHaveBeenCalled();
    const props = userDashboardSpy.mock.calls[0][0];
    expect(props.userID).toBe("u-123");
  });

  it.each(["Internal Viewer", "internal_user_viewer"])(
    "routes %s to a read-only personal key dashboard",
    (userRole) => {
      authorizedUser.userRole = userRole;

      render(<ApiKeysDashboard />);

      expect(personalKeyDashboardSpy).toHaveBeenCalledWith({ accessToken: "sk-access", readOnly: true });
      expect(userDashboardSpy).not.toHaveBeenCalled();
    },
  );

  it.each(["Internal User", "internal_user"])("keeps %s personal key management writable", (userRole) => {
    authorizedUser.userRole = userRole;

    render(<ApiKeysDashboard />);

    expect(personalKeyDashboardSpy).toHaveBeenCalledWith({ accessToken: "sk-access", readOnly: false });
    expect(userDashboardSpy).not.toHaveBeenCalled();
  });
});
