import type { ColumnFiltersState, PaginationState } from "@tanstack/react-table";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AuditLogsTable } from "./AuditLogsTable";
import type { AuditLogEntry } from "./AuditLogsTableColumns";

const ROWS: AuditLogEntry[] = [
  {
    id: "log-1",
    updated_at: "2026-07-20T12:00:00Z",
    changed_by: "default_user_id",
    changed_by_api_key: "sk-hash-abc",
    action: "created",
    table_name: "LiteLLM_TeamTable",
    object_id: "team-obj-123",
    before_value: {},
    updated_values: { foo: "bar", success: true },
  },
  {
    id: "log-2",
    updated_at: "2026-07-20T11:00:00Z",
    changed_by: "user-42",
    changed_by_api_key: "sk-hash-def",
    action: "deleted",
    table_name: "LiteLLM_UserTable",
    object_id: "user-obj-456",
    before_value: { a: 1, success: false },
    updated_values: {},
  },
  {
    id: "log-3",
    updated_at: "2026-07-20T10:00:00Z",
    changed_by: "admin-user",
    changed_by_api_key: "sk-hash-ghi",
    action: "blocked",
    table_name: "CorporatePersonalKeyRegistry",
    object_id: "personal-key-1",
    before_value: { success: true },
    updated_values: { success: true },
  },
  {
    id: "log-4",
    updated_at: "2026-07-20T09:00:00Z",
    changed_by: "admin-user",
    changed_by_api_key: "sk-hash-jkl",
    action: "unblocked",
    table_name: "LiteLLM_TeamMembership",
    object_id: "team-1",
    before_value: { success: true },
    updated_values: { success: true },
  },
  {
    id: "log-5",
    updated_at: "2026-07-20T08:00:00Z",
    changed_by: "admin-user",
    changed_by_api_key: "sk-hash-mno",
    action: "creation_rejected",
    table_name: "LiteLLM_OrganizationMembership",
    object_id: "org-1:user-1",
    before_value: { success: false },
    updated_values: { success: false },
  },
];

const FIRST_PAGE: PaginationState = { pageIndex: 0, pageSize: 50 };

function renderTable(overrides: Partial<React.ComponentProps<typeof AuditLogsTable>> = {}) {
  const props: React.ComponentProps<typeof AuditLogsTable> = {
    data: ROWS,
    rowCount: ROWS.length,
    isLoading: false,
    isRefreshing: false,
    pagination: FIRST_PAGE,
    onPaginationChange: vi.fn(),
    columnFilters: [],
    onColumnFiltersChange: vi.fn(),
    onRefresh: vi.fn(),
    onViewLog: vi.fn(),
    ...overrides,
  };
  render(<AuditLogsTable {...props} />);
  return props;
}

describe("AuditLogsTable", () => {
  it("renders each audit column with the migrated shared cells", () => {
    renderTable();

    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Deleted")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("Unblocked")).toBeInTheDocument();
    expect(screen.getByText("Creation Rejected")).toBeInTheDocument();
    expect(screen.getByText("Teams")).toBeInTheDocument();
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Personal Key Registry")).toBeInTheDocument();
    expect(screen.getByText("Team Memberships")).toBeInTheDocument();
    expect(screen.getByText("Organization Memberships")).toBeInTheDocument();
    expect(screen.getAllByText("Success").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Failure").length).toBeGreaterThan(0);
    expect(screen.getByText("Default Proxy Admin")).toBeInTheDocument();
    expect(screen.getByText("user-42")).toBeInTheDocument();
    expect(screen.getByText("team-obj-123")).toBeInTheDocument();
    expect(screen.getByText("sk-hash-abc")).toBeInTheDocument();
  });

  it("opens the detail drawer from the Object ID identity cell with the full row", async () => {
    const user = userEvent.setup();
    const props = renderTable();

    await user.click(screen.getByText("team-obj-123"));

    expect(props.onViewLog).toHaveBeenCalledTimes(1);
    expect(props.onViewLog).toHaveBeenCalledWith(ROWS[0]);
  });

  it("drives the shared footer from the server rowCount and reports page changes", async () => {
    const user = userEvent.setup();
    const onPaginationChange = vi.fn();
    renderTable({ rowCount: 120, onPaginationChange });

    // ceil(120 / 50) = 3 pages, proving rowCount (not data length) feeds the footer
    expect(screen.getByTestId("pagination-page")).toHaveTextContent("Page 1 of 3");

    await user.click(screen.getByTestId("pagination-next"));
    expect(onPaginationChange).toHaveBeenCalledTimes(1);
  });

  it("shows skeleton rows while loading and no data rows", () => {
    renderTable({ isLoading: true, data: [] });

    expect(screen.getAllByTestId("skeleton-row").length).toBeGreaterThan(0);
    expect(screen.queryByText("No audit logs yet")).toBeNull();
  });

  it("uses a distinct empty state for unfiltered vs filtered-empty results", () => {
    const { unmount } = render(
      <AuditLogsTable
        data={[]}
        rowCount={0}
        isLoading={false}
        isRefreshing={false}
        pagination={FIRST_PAGE}
        onPaginationChange={vi.fn()}
        columnFilters={[]}
        onColumnFiltersChange={vi.fn()}
        onRefresh={vi.fn()}
        onViewLog={vi.fn()}
      />,
    );
    expect(screen.getByText("No audit logs yet")).toBeInTheDocument();
    unmount();

    renderTable({ data: [], rowCount: 0, columnFilters: [{ id: "action", value: "created" }] });
    expect(screen.getByText("No matching audit logs")).toBeInTheDocument();
  });

  it("renders active filter chips with human-readable labels", () => {
    const filters: ColumnFiltersState = [
      { id: "action", value: "creation_rejected" },
      { id: "table_name", value: "CorporatePersonalKeyRegistry" },
      { id: "success", value: "true" },
    ];
    renderTable({ columnFilters: filters });

    const chip = screen.getByTestId("filter-chip-action");
    expect(chip).toHaveTextContent("Action:");
    expect(chip).toHaveTextContent("Creation Rejected");
    const resourceChip = screen.getByTestId("filter-chip-table_name");
    expect(resourceChip).toHaveTextContent("Resource Type:");
    expect(resourceChip).toHaveTextContent("Personal Key Registry");
    const successChip = screen.getByTestId("filter-chip-success");
    expect(successChip).toHaveTextContent("Result:");
    expect(successChip).toHaveTextContent("Success");
  });

  it("commits a text filter through the filter drawer and reports it to the parent", async () => {
    const user = userEvent.setup();
    const onColumnFiltersChange = vi.fn();
    renderTable({ onColumnFiltersChange });

    await user.click(screen.getByTestId("datatable-filters-trigger"));
    await user.type(await screen.findByPlaceholderText("Enter resource ID…"), "obj-9");
    await user.click(screen.getByTestId("filter-drawer-apply"));

    expect(onColumnFiltersChange).toHaveBeenCalledTimes(1);
    const arg = onColumnFiltersChange.mock.calls[0][0];
    const committed = typeof arg === "function" ? arg([]) : arg;
    expect(committed).toEqual([{ id: "object_id", value: "obj-9" }]);
  });

  it("commits success and date filters through the filter drawer", async () => {
    const user = userEvent.setup();
    const onColumnFiltersChange = vi.fn();
    renderTable({ onColumnFiltersChange });

    await user.click(screen.getByTestId("datatable-filters-trigger"));
    const filterComboboxes = await screen.findAllByRole("combobox");
    await user.click(filterComboboxes[2]);
    const failureOptions = await screen.findAllByText("Failure");
    await user.click(failureOptions.at(-1)!);
    await user.type(screen.getByLabelText("Start Date"), "2026-07-01");
    await user.type(screen.getByLabelText("End Date"), "2026-07-31");
    await user.click(screen.getByTestId("filter-drawer-apply"));

    const arg = onColumnFiltersChange.mock.calls[0][0];
    const committed = typeof arg === "function" ? arg([]) : arg;
    expect(committed).toEqual([
      { id: "success", value: "false" },
      { id: "start_date", value: "2026-07-01" },
      { id: "end_date", value: "2026-07-31" },
    ]);
  });
});
