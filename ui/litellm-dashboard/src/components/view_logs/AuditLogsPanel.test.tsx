import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, testQueryClient, waitFor } from "../../../tests/test-utils";
import AuditLogsPanel from "./AuditLogsPanel";

const uiAuditLogsCallMock = vi.fn();
const auditLogsTableMock = vi.fn();

vi.mock("../networking", () => ({
  uiAuditLogsCall: (...args: unknown[]) => uiAuditLogsCallMock(...args),
}));

vi.mock("./AuditLogsTable", () => ({
  AuditLogsTable: (props: unknown) => {
    auditLogsTableMock(props);
    return <div data-testid="audit-logs-table" />;
  },
}));

vi.mock("./AuditLogDrawer/AuditLogDrawer", () => ({
  AuditLogDrawer: () => null,
}));

describe("AuditLogsPanel", () => {
  beforeEach(() => {
    const emptyAuditLogsResponse = {
      audit_logs: [],
      total: 0,
      page: 1,
      page_size: 50,
      total_pages: 0,
    };

    vi.clearAllMocks();
    testQueryClient.clear();
    uiAuditLogsCallMock.mockResolvedValue(emptyAuditLogsResponse);
  });

  it("queries audit logs for admin viewers without a premium gate", async () => {
    renderWithProviders(
      <AuditLogsPanel accessToken="sk-test" token="tok-test" userRole="Admin Viewer" userID="user-1" isActive={true} />,
    );

    await waitFor(() => {
      expect(uiAuditLogsCallMock).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: "sk-test",
          page: 1,
          page_size: 50,
        }),
      );
    });

    expect(screen.getByText("Audit Logs")).toBeInTheDocument();
    expect(auditLogsTableMock).toHaveBeenCalled();
  });

  it("shows access denied instead of the enterprise preview for non-admin roles", async () => {
    renderWithProviders(
      <AuditLogsPanel
        accessToken="sk-test"
        token="tok-test"
        userRole="Internal User"
        userID="user-1"
        isActive={true}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Audit logs are available only to proxy administrators and admin viewers/i),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/Enterprise Feature/i)).not.toBeInTheDocument();
    expect(uiAuditLogsCallMock).not.toHaveBeenCalled();
  });

  it("surfaces query failures inline for authorized readers", async () => {
    uiAuditLogsCallMock.mockRejectedValueOnce(new Error("backend down"));

    renderWithProviders(
      <AuditLogsPanel accessToken="sk-test" token="tok-test" userRole="Admin" userID="user-1" isActive={true} />,
    );

    expect(await screen.findByText(/Failed to load audit logs: backend down/i)).toBeInTheDocument();
  });
});
