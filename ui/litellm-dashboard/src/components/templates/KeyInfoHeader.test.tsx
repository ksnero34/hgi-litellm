import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../tests/test-utils";
import { KeyInfoHeader, KeyInfoData } from "./KeyInfoHeader";

const MOCK_DATA: KeyInfoData = {
  keyName: "My Test Key",
  keyId: "sk-1234567890abcdef",
  userId: "user-abc-123",
  userEmail: "test@example.com",
  userAlias: null,
  createdBy: "admin@example.com",
  createdAt: "Oct 29, 2025 at 1:26 AM",
  lastUpdated: "Oct 29, 2025 at 1:47 AM",
  lastActive: "Oct 29, 2025 at 2:00 AM",
  expires: "Never",
};

describe("KeyInfoHeader", () => {
  it("should render", () => {
    renderWithProviders(<KeyInfoHeader data={MOCK_DATA} />);
    expect(screen.getByText("My Test Key")).toBeInTheDocument();
  });

  it("should render the key ID with prefix", () => {
    renderWithProviders(<KeyInfoHeader data={MOCK_DATA} />);
    expect(screen.getByText(/키 ID:/)).toBeInTheDocument();
    expect(screen.getByText(/sk-1234567890abcdef/)).toBeInTheDocument();
  });

  it("should render all metadata fields", () => {
    renderWithProviders(<KeyInfoHeader data={MOCK_DATA} />);
    expect(screen.getByText("사용자")).toBeInTheDocument();
    expect(screen.getByText("test@example.com")).toBeInTheDocument();
    expect(screen.getByText("생성 시각")).toBeInTheDocument();
    expect(screen.getByText("생성자")).toBeInTheDocument();
    expect(screen.getByText("만료")).toBeInTheDocument();
    expect(screen.getByText("마지막 수정")).toBeInTheDocument();
    expect(screen.getByText("마지막 사용")).toBeInTheDocument();
  });

  describe("back button", () => {
    it("should render with default text", () => {
      renderWithProviders(<KeyInfoHeader data={MOCK_DATA} />);
      expect(screen.getByRole("button", { name: /키 목록으로 돌아가기/i })).toBeInTheDocument();
    });

    it("should render with custom text", () => {
      renderWithProviders(<KeyInfoHeader data={MOCK_DATA} backButtonText="Back to Dashboard" />);
      expect(screen.getByRole("button", { name: /back to dashboard/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /back to keys/i })).not.toBeInTheDocument();
    });

    it("should call onBack when clicked", async () => {
      const onBack = vi.fn();
      renderWithProviders(<KeyInfoHeader data={MOCK_DATA} onBack={onBack} />);
      await userEvent.click(screen.getByRole("button", { name: /키 목록으로 돌아가기/i }));
      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });

  describe("action buttons", () => {
    it("should show Regenerate and Delete buttons by default", () => {
      renderWithProviders(<KeyInfoHeader data={MOCK_DATA} />);
      expect(screen.getByRole("button", { name: /키 교체/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /키 삭제/i })).toBeInTheDocument();
    });

    it("should show Regenerate and Delete buttons when canModifyKey is true", () => {
      renderWithProviders(<KeyInfoHeader data={MOCK_DATA} canModifyKey={true} />);
      expect(screen.getByRole("button", { name: /키 교체/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /키 삭제/i })).toBeInTheDocument();
    });

    it("should hide Regenerate and Delete buttons when canModifyKey is false", () => {
      renderWithProviders(<KeyInfoHeader data={MOCK_DATA} canModifyKey={false} />);
      expect(screen.queryByRole("button", { name: /키 교체/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /키 삭제/i })).not.toBeInTheDocument();
    });

    it("should call onRegenerate when Regenerate Key is clicked", async () => {
      const onRegenerate = vi.fn();
      renderWithProviders(<KeyInfoHeader data={MOCK_DATA} onRegenerate={onRegenerate} />);
      await userEvent.click(screen.getByRole("button", { name: /키 교체/i }));
      expect(onRegenerate).toHaveBeenCalledTimes(1);
    });

    it("should call onDelete when Delete Key is clicked", async () => {
      const onDelete = vi.fn();
      renderWithProviders(<KeyInfoHeader data={MOCK_DATA} onDelete={onDelete} />);
      await userEvent.click(screen.getByRole("button", { name: /키 삭제/i }));
      expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it("should disable Regenerate button when regenerateDisabled is true", () => {
      renderWithProviders(<KeyInfoHeader data={MOCK_DATA} regenerateDisabled={true} />);
      expect(screen.getByRole("button", { name: /키 교체/i })).toBeDisabled();
    });

    it("should not disable Regenerate button by default", () => {
      renderWithProviders(<KeyInfoHeader data={MOCK_DATA} />);
      expect(screen.getByRole("button", { name: /키 교체/i })).not.toBeDisabled();
    });
  });

  describe("Create New Key button", () => {
    it("should show when onCreateNew is provided", () => {
      renderWithProviders(<KeyInfoHeader data={MOCK_DATA} onCreateNew={vi.fn()} />);
      expect(screen.getByRole("button", { name: /새 키 만들기/i })).toBeInTheDocument();
    });

    it("should hide when onCreateNew is not provided", () => {
      renderWithProviders(<KeyInfoHeader data={MOCK_DATA} />);
      expect(screen.queryByRole("button", { name: /새 키 만들기/i })).not.toBeInTheDocument();
    });

    it("should call onCreateNew when clicked", async () => {
      const onCreateNew = vi.fn();
      renderWithProviders(<KeyInfoHeader data={MOCK_DATA} onCreateNew={onCreateNew} />);
      await userEvent.click(screen.getByRole("button", { name: /새 키 만들기/i }));
      expect(onCreateNew).toHaveBeenCalledTimes(1);
    });
  });

  describe("default_user_id handling", () => {
    it("should show Default Proxy Admin tag for User when userId is default_user_id and no alias/email", () => {
      const data = { ...MOCK_DATA, userId: "default_user_id", userEmail: "", userAlias: null };
      renderWithProviders(<KeyInfoHeader data={data} />);
      expect(screen.getAllByText("Default Proxy Admin").length).toBeGreaterThanOrEqual(1);
    });

    it("should show Default Proxy Admin tag for Created By when value is default_user_id", () => {
      const data = { ...MOCK_DATA, createdBy: "default_user_id" };
      renderWithProviders(<KeyInfoHeader data={data} />);
      expect(screen.getAllByText("Default Proxy Admin").length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("User field fallbacks", () => {
    it("should display userAlias as primary when set, overriding email and userId", () => {
      const data = { ...MOCK_DATA, userAlias: "alice" };
      renderWithProviders(<KeyInfoHeader data={data} />);
      expect(screen.getByText("alice")).toBeInTheDocument();
      expect(screen.queryByText("test@example.com")).not.toBeInTheDocument();
    });

    it("should display userEmail when alias is null", () => {
      renderWithProviders(<KeyInfoHeader data={MOCK_DATA} />);
      expect(screen.getByText("test@example.com")).toBeInTheDocument();
    });

    it("should fall back to userId when alias and email are missing", () => {
      const data = { ...MOCK_DATA, userEmail: "", userAlias: null };
      renderWithProviders(<KeyInfoHeader data={data} />);
      expect(screen.getByText("user-abc-123")).toBeInTheDocument();
    });

    it("should show '-' when alias, email, and userId are all empty", () => {
      const data = { ...MOCK_DATA, userId: "", userEmail: "", userAlias: null };
      renderWithProviders(<KeyInfoHeader data={data} />);
      expect(screen.getByText("-")).toBeInTheDocument();
    });
  });
});
