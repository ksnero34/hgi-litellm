import { renderWithProviders, screen } from "@/../tests/test-utils";
import { languageStorageKey } from "@/i18n/resources";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CategoryTable from "./CategoryTable";
import ContentCategoryConfiguration from "./ContentCategoryConfiguration";
import KeywordTable from "./KeywordTable";
import PatternTable from "./PatternTable";

describe("content filter tables", () => {
  beforeEach(() => {
    window.localStorage.setItem(languageStorageKey, "ko");
  });

  it("should render category details in the shared table and remove a category", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <CategoryTable
        categories={[
          {
            id: "category-1",
            category: "self_harm",
            display_name: "Self Harm",
            action: "BLOCK",
            severity_threshold: "high",
          },
        ]}
        onRemove={onRemove}
      />,
    );

    expect(await screen.findByRole("columnheader", { name: "카테고리" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "심각도 임계값" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveAttribute("data-slot", "table");
    expect(screen.getByText("Self Harm")).toBeInTheDocument();
    expect(screen.getByText("self_harm")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "삭제" }));

    expect(onRemove).toHaveBeenCalledWith("category-1");
  });

  it("should render keyword details in the shared table and remove a keyword", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <KeywordTable
        keywords={[{ id: "keyword-1", keyword: "secret", action: "MASK", description: "Sensitive term" }]}
        onActionChange={vi.fn()}
        onRemove={onRemove}
      />,
    );

    expect(await screen.findByRole("columnheader", { name: "키워드" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "설명(선택 사항)" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveAttribute("data-slot", "table");
    expect(screen.getByText("secret")).toBeInTheDocument();
    expect(screen.getByText("Sensitive term")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "삭제" }));

    expect(onRemove).toHaveBeenCalledWith("keyword-1");
  });

  it("should render pattern details in the shared table and remove a pattern", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <PatternTable
        patterns={[
          {
            id: "pattern-1",
            type: "custom",
            name: "email",
            display_name: "Email address",
            pattern: "[a-z]+@example\\.com",
            action: "BLOCK",
          },
        ]}
        onActionChange={vi.fn()}
        onRemove={onRemove}
      />,
    );

    expect(await screen.findByRole("columnheader", { name: "패턴 이름" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "정규식 패턴" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveAttribute("data-slot", "table");
    expect(screen.getByText("Email address")).toBeInTheDocument();
    expect(screen.getByText(/\[a-z\]\+@example/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "삭제" }));

    expect(onRemove).toHaveBeenCalledWith("pattern-1");
  });

  it("should render selected topic details in the shared table and remove a blocked topic", async () => {
    const onCategoryRemove = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <ContentCategoryConfiguration
        availableCategories={[
          {
            name: "violence",
            display_name: "Violence",
            description: "Violent content",
            default_action: "BLOCK",
          },
        ]}
        selectedCategories={[
          {
            id: "category-1",
            category: "violence",
            display_name: "Violence",
            action: "BLOCK",
            severity_threshold: "medium",
          },
        ]}
        onCategoryAdd={vi.fn()}
        onCategoryRemove={onCategoryRemove}
        onCategoryUpdate={vi.fn()}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Category" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Severity Threshold" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveAttribute("data-slot", "table");
    expect(screen.getByText("Violent content")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /remove/i }));

    expect(onCategoryRemove).toHaveBeenCalledWith("category-1");
  });

  it("should report a pattern action change", async () => {
    const onActionChange = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <PatternTable
        patterns={[{ id: "pattern-1", type: "prebuilt", name: "email", action: "BLOCK" }]}
        onActionChange={onActionChange}
        onRemove={vi.fn()}
      />,
    );

    await screen.findByRole("columnheader", { name: "동작" });
    await user.click(screen.getByRole("combobox"));
    const maskOptions = await screen.findAllByText("마스킹");
    await user.click(maskOptions[maskOptions.length - 1]);

    expect(onActionChange).toHaveBeenCalledWith("pattern-1", "MASK");
  });

  it("should report a keyword action change", async () => {
    const onActionChange = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <KeywordTable
        keywords={[{ id: "keyword-1", keyword: "secret", action: "BLOCK" }]}
        onActionChange={onActionChange}
        onRemove={vi.fn()}
      />,
    );

    await screen.findByRole("columnheader", { name: "동작" });
    await user.click(screen.getByRole("combobox"));
    const maskOptions = await screen.findAllByText("마스킹");
    await user.click(maskOptions[maskOptions.length - 1]);

    expect(onActionChange).toHaveBeenCalledWith("keyword-1", "action", "MASK");
  });

  it("should report category severity and action changes", async () => {
    const onSeverityChange = vi.fn();
    const onActionChange = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <CategoryTable
        categories={[
          {
            id: "category-1",
            category: "self_harm",
            display_name: "Self Harm",
            action: "BLOCK",
            severity_threshold: "high",
          },
        ]}
        onActionChange={onActionChange}
        onSeverityChange={onSeverityChange}
        onRemove={vi.fn()}
      />,
    );

    await screen.findByRole("columnheader", { name: "심각도 임계값" });
    await user.click(screen.getAllByRole("combobox")[0]);
    const lowOptions = await screen.findAllByText("낮음");
    await user.click(lowOptions[lowOptions.length - 1]);

    expect(onSeverityChange).toHaveBeenCalledWith("category-1", "low");

    await user.click(screen.getAllByRole("combobox")[1]);
    const maskOptions = await screen.findAllByText("마스킹");
    await user.click(maskOptions[maskOptions.length - 1]);

    expect(onActionChange).toHaveBeenCalledWith("category-1", "MASK");
  });
});
