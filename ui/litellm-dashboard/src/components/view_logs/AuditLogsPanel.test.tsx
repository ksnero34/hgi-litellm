import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, testQueryClient } from "../../../tests/test-utils";
import AuditLogsPanel from "./AuditLogsPanel";

vi.mock("../networking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../networking")>();
  return {
    ...actual,
    uiAuditLogsCall: vi.fn(),
    uiAuditLogByIdCall: vi.fn(),
  };
});

import { uiAuditLogByIdCall, uiAuditLogsCall } from "../networking";

const auditRows = [
  {
    id: "audit-1",
    updated_at: "2026-08-10T00:00:00Z",
    changed_by: "default_user_id",
    changed_by_api_key: "sk-hash-1",
    action: "created",
    table_name: "LiteLLM_TeamTable",
    object_id: "team-123",
    before_value: {},
    updated_values: { success: true, name: "Team One" },
  },
];

const defaultProps = {
  accessToken: "sk-test",
  token: "jwt-test",
  userRole: "Admin",
  userID: "user-1",
  isActive: true,
};

describe("AuditLogsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testQueryClient.clear();
    vi.mocked(uiAuditLogsCall).mockResolvedValue({
      audit_logs: auditRows,
      total: auditRows.length,
      page: 1,
      page_size: 50,
      total_pages: 1,
    });
    vi.mocked(uiAuditLogByIdCall).mockResolvedValue(auditRows[0]);
  });

  it("loads audit logs for allowed readers", async () => {
    renderWithProviders(<AuditLogsPanel {...defaultProps} />);

    await waitFor(() =>
      expect(uiAuditLogsCall).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: "sk-test",
          page: 1,
          page_size: 50,
          params: expect.objectContaining({ sort_order: "desc" }),
        }),
      ),
    );

    expect(await screen.findByText("team-123")).toBeInTheDocument();
  });

  it("blocks audit logs for org admins", () => {
    renderWithProviders(<AuditLogsPanel {...defaultProps} userRole="org_admin" />);

    expect(
      screen.getByText("Audit logs are available only to proxy administrators and admin viewers."),
    ).toBeInTheDocument();
    expect(uiAuditLogsCall).not.toHaveBeenCalled();
  });

  it("passes actor, result, and date filters to the server query", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AuditLogsPanel {...defaultProps} />);

    await waitFor(() => expect(uiAuditLogsCall).toHaveBeenCalledTimes(1));
    await user.click(screen.getByTestId("datatable-filters-trigger"));
    await user.type(await screen.findByPlaceholderText("Enter actor…"), "proxy-admin");
    const filterComboboxes = await screen.findAllByRole("combobox");
    await user.click(filterComboboxes[2]);
    await user.click(await screen.findByText("Failure"));
    await user.type(screen.getByLabelText("Start Date"), "2026-08-01");
    await user.type(screen.getByLabelText("End Date"), "2026-08-10");
    await user.click(screen.getByTestId("filter-drawer-apply"));

    await waitFor(() =>
      expect(uiAuditLogsCall).toHaveBeenLastCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            changed_by: "proxy-admin",
            success: false,
            start_date: "2026-08-01 00:00:00",
            end_date: "2026-08-10 23:59:59",
            sort_order: "desc",
          }),
        }),
      ),
    );
  });

  it("shows an error state when the audit logs query fails", async () => {
    vi.mocked(uiAuditLogsCall).mockRejectedValueOnce(new Error("boom"));
    renderWithProviders(<AuditLogsPanel {...defaultProps} />);

    expect(await screen.findByText("Failed to load audit logs: boom")).toBeInTheDocument();
  });

  it("fetches audit log details when a row is opened", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AuditLogsPanel {...defaultProps} />);

    await user.click(await screen.findByText("team-123"));

    await waitFor(() =>
      expect(uiAuditLogByIdCall).toHaveBeenCalledWith({
        accessToken: "sk-test",
        auditId: "audit-1",
      }),
    );

    expect(await screen.findAllByText("Resource ID")).not.toHaveLength(0);
  });
});
