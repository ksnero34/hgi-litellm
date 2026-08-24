import { renderWithProviders, screen, within } from "@/../tests/test-utils";
import { waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessGroupsPage } from "./AccessGroupsPage";
import type { AccessGroupResponse } from "@/app/(dashboard)/hooks/accessGroups/useAccessGroups";
import { i18n } from "@/i18n/i18n";
import { languageStorageKey } from "@/i18n/resources";

const mockAccessGroups: AccessGroupResponse[] = [
  {
    access_group_id: "ag-1",
    access_group_name: "Admin Group",
    description: "Administrators with full access",
    access_model_names: ["m1", "m2"],
    access_mcp_server_ids: ["s1"],
    access_agent_ids: ["a1"],
    assigned_team_ids: [],
    assigned_key_ids: [],
    created_at: "2024-01-15T10:00:00Z",
    created_by: "user-1",
    updated_at: "2024-01-20T12:00:00Z",
    updated_by: "user-1",
  },
  {
    access_group_id: "ag-2",
    access_group_name: "Read Only",
    description: "Read-only access to models",
    access_model_names: ["m1"],
    access_mcp_server_ids: [],
    access_agent_ids: [],
    assigned_team_ids: [],
    assigned_key_ids: [],
    created_at: "2024-01-10T09:00:00Z",
    created_by: null,
    updated_at: "2024-01-12T11:00:00Z",
    updated_by: null,
  },
];

const mockUseAccessGroups = vi.fn();
const mockUseDeleteAccessGroup = vi.fn();
const mockMutate = vi.fn();
const mockUseAuthorized = vi.fn();

vi.mock("@/app/(dashboard)/hooks/accessGroups/useAccessGroups", () => ({
  useAccessGroups: () => mockUseAccessGroups(),
}));

vi.mock("@/app/(dashboard)/hooks/accessGroups/useDeleteAccessGroup", () => ({
  useDeleteAccessGroup: () => mockUseDeleteAccessGroup(),
}));

vi.mock("@/app/(dashboard)/hooks/useAuthorized", () => ({
  default: () => mockUseAuthorized(),
}));

vi.mock("./AccessGroupsDetailsPage", () => ({
  AccessGroupDetail: ({ accessGroupId, onBack }: { accessGroupId: string; onBack: () => void }) => (
    <div data-testid="access-group-detail">
      <span>Detail for {accessGroupId}</span>
      <button onClick={onBack}>Back</button>
    </div>
  ),
}));

vi.mock("./access-group-create/AccessGroupCreateDialog", () => ({
  AccessGroupCreateDialog: ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) =>
    open ? (
      <div data-testid="create-access-group-modal">
        <button onClick={() => onOpenChange(false)}>Cancel</button>
      </div>
    ) : null,
}));

const makeGroups = (count: number): AccessGroupResponse[] =>
  Array.from({ length: count }, (_, index) => {
    const suffix = String(index + 1).padStart(2, "0");
    return {
      ...mockAccessGroups[0],
      access_group_id: `ag-${suffix}`,
      access_group_name: `Group ${suffix}`,
      description: `Group ${suffix} description`,
    };
  });

const openRowMenu = async (user: ReturnType<typeof userEvent.setup>, groupId: string) => {
  await user.click(screen.getByTestId(`access-group-actions-${groupId}`));
  return screen.findByTestId("access-group-action-delete");
};

describe("AccessGroupsPage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.setItem(languageStorageKey, "en");
    await i18n.changeLanguage("en");
    mockUseAccessGroups.mockReturnValue({ data: mockAccessGroups, isLoading: false });
    mockUseDeleteAccessGroup.mockReturnValue({ mutate: mockMutate, isPending: false });
    mockUseAuthorized.mockReturnValue({ userRole: "Admin", accessToken: "sk-test" });
  });

  it("renders the page title and subtitle", () => {
    renderWithProviders(<AccessGroupsPage />);
    expect(screen.getByRole("heading", { name: "Access Groups" })).toBeInTheDocument();
    expect(screen.getByText("Manage resource permissions for your organization")).toBeInTheDocument();
  });

  it("renders the access group page in Korean", async () => {
    localStorage.setItem(languageStorageKey, "ko");
    await i18n.changeLanguage("ko");

    renderWithProviders(<AccessGroupsPage />);

    expect(screen.getByRole("heading", { name: "액세스 그룹" })).toBeInTheDocument();
    expect(screen.getByText("조직의 리소스 권한을 관리합니다")).toBeInTheDocument();
    expect(screen.getByText("액세스 그룹 생성")).toBeInTheDocument();
  });

  it("shows the Create Access Group button for an admin", () => {
    renderWithProviders(<AccessGroupsPage />);
    expect(screen.getByRole("button", { name: /create access group/i })).toBeInTheDocument();
  });

  it("renders every access group row", () => {
    renderWithProviders(<AccessGroupsPage />);
    expect(screen.getByText("ag-1")).toBeInTheDocument();
    expect(screen.getByText("Admin Group")).toBeInTheDocument();
    expect(screen.getByText("ag-2")).toBeInTheDocument();
    expect(screen.getByText("Read Only")).toBeInTheDocument();
  });

  it("renders resource counts for each group", () => {
    renderWithProviders(<AccessGroupsPage />);
    const adminRow = screen.getByText("ag-1").closest("tr") as HTMLElement;
    expect(within(adminRow).getByTitle("2 Models")).toHaveTextContent("2");
    expect(within(adminRow).getByTitle("1 MCP Servers")).toHaveTextContent("1");
    expect(within(adminRow).getByTitle("1 Agents")).toHaveTextContent("1");
  });

  it("shows the expected column headers", () => {
    renderWithProviders(<AccessGroupsPage />);
    expect(screen.getByRole("columnheader", { name: /^ID$/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Name/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Resources/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Created/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Updated/i })).toBeInTheDocument();
  });

  it("filters by name", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccessGroupsPage />);
    await user.type(screen.getByPlaceholderText("Search groups by name, ID, or description..."), "Admin");
    expect(screen.getByText("Admin Group")).toBeInTheDocument();
    expect(screen.queryByText("Read Only")).not.toBeInTheDocument();
  });

  it("filters by ID", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccessGroupsPage />);
    await user.type(screen.getByPlaceholderText("Search groups by name, ID, or description..."), "ag-2");
    expect(screen.getByText("Read Only")).toBeInTheDocument();
    expect(screen.queryByText("Admin Group")).not.toBeInTheDocument();
  });

  it("filters by description", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccessGroupsPage />);
    await user.type(screen.getByPlaceholderText("Search groups by name, ID, or description..."), "read-only");
    expect(screen.getByText("Read Only")).toBeInTheDocument();
    expect(screen.queryByText("Admin Group")).not.toBeInTheDocument();
  });

  it("shows the filtered empty state when nothing matches", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccessGroupsPage />);
    await user.type(screen.getByPlaceholderText("Search groups by name, ID, or description..."), "no-such-group");
    expect(screen.getByText("No matching access groups")).toBeInTheDocument();
    expect(screen.queryByText("Admin Group")).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no groups", () => {
    mockUseAccessGroups.mockReturnValue({ data: [], isLoading: false });
    renderWithProviders(<AccessGroupsPage />);
    expect(screen.getByText("No access groups yet")).toBeInTheDocument();
  });

  it("renders loading skeletons on the initial load", () => {
    mockUseAccessGroups.mockReturnValue({ data: undefined, isLoading: true });
    renderWithProviders(<AccessGroupsPage />);
    expect(screen.getAllByTestId("skeleton-row").length).toBeGreaterThan(0);
    expect(screen.queryByText("Admin Group")).not.toBeInTheDocument();
  });

  it("opens and closes the create modal", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccessGroupsPage />);
    await user.click(screen.getByRole("button", { name: /create access group/i }));
    expect(screen.getByTestId("create-access-group-modal")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("create-access-group-modal")).not.toBeInTheDocument();
  });

  it("opens the detail view when the ID cell is clicked and returns via Back", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccessGroupsPage />);
    await user.click(screen.getByText("ag-1"));
    expect(screen.getByTestId("access-group-detail")).toBeInTheDocument();
    expect(screen.getByText("Detail for ag-1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByTestId("access-group-detail")).not.toBeInTheDocument();
    expect(screen.getByText("Admin Group")).toBeInTheDocument();
  });

  it("opens the delete modal from the row actions menu", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccessGroupsPage />);
    await user.click(await openRowMenu(user, "ag-1"));
    const dialog = screen.getByRole("dialog", { name: "Delete Access Group" });
    expect(
      within(dialog).getByText("Are you sure you want to delete this access group? This action cannot be undone."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Access Group Information")).toBeInTheDocument();
    expect(within(dialog).getByText("ag-1")).toBeInTheDocument();
    expect(within(dialog).getByText("Admin Group")).toBeInTheDocument();
  });

  it("closes the delete modal on cancel without deleting", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccessGroupsPage />);
    await user.click(await openRowMenu(user, "ag-1"));
    const dialog = screen.getByRole("dialog", { name: "Delete Access Group" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Delete Access Group" })).not.toBeInTheDocument();
    });
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("confirms deletion with the selected access group ID", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccessGroupsPage />);
    await user.click(await openRowMenu(user, "ag-1"));
    const dialog = screen.getByRole("dialog", { name: "Delete Access Group" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(mockMutate).toHaveBeenCalledWith("ag-1", expect.any(Object));
  });

  it("hides write actions for an admin viewer", () => {
    mockUseAuthorized.mockReturnValue({ userRole: "Admin Viewer", accessToken: "sk-test" });
    renderWithProviders(<AccessGroupsPage />);
    expect(screen.queryByRole("button", { name: /create access group/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-group-actions-ag-1")).not.toBeInTheDocument();
  });

  it("renders all rows when a later page search narrows the results", async () => {
    const user = userEvent.setup();
    const pagedGroups = makeGroups(11);
    mockUseAccessGroups.mockReturnValue({ data: pagedGroups, isLoading: false });
    renderWithProviders(<AccessGroupsPage />);

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("ag-11")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search groups by name, ID, or description..."), "Group 01");

    expect(screen.getByText("Group 01")).toBeInTheDocument();
    expect(screen.queryByText("Group 11")).not.toBeInTheDocument();
  });
});
