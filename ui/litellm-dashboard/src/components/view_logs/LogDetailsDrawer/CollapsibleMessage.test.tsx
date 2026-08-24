import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { i18n } from "@/i18n/i18n";
import { CollapsibleMessage } from "./CollapsibleMessage";

describe("CollapsibleMessage", () => {
  it("should return null when content is empty", () => {
    const { container } = render(<CollapsibleMessage label="SYSTEM" content="" />);
    expect(container.innerHTML).toBe("");
  });

  it("should return null when content is undefined", () => {
    const { container } = render(<CollapsibleMessage label="SYSTEM" />);
    expect(container.innerHTML).toBe("");
  });

  it("should render the label and char count", () => {
    render(<CollapsibleMessage label="SYSTEM" content="Hello" />);
    expect(screen.getByText("SYSTEM")).toBeInTheDocument();
    expect(screen.getByText("(5 chars)")).toBeInTheDocument();
  });

  it("renders the character count in Korean", async () => {
    await i18n.changeLanguage("ko");
    const { unmount } = render(<CollapsibleMessage label="Reasoning" content="검토" />);
    expect(screen.getByText("(2자)")).toBeInTheDocument();
    unmount();
    await i18n.changeLanguage("en");
  });

  it("should show content when defaultExpanded is true", () => {
    render(<CollapsibleMessage label="SYSTEM" content="Visible text" defaultExpanded={true} />);
    expect(screen.getByText("Visible text")).toBeInTheDocument();
  });

  it("should toggle expanded state when header is clicked", async () => {
    const user = userEvent.setup();
    render(<CollapsibleMessage label="SYSTEM" content="Toggle me" defaultExpanded={false} />);

    // Content is rendered in DOM but collapsed by default
    expect(screen.getByText("Toggle me")).toBeInTheDocument();

    // Click the header to expand - should still show content
    await user.click(screen.getByText("SYSTEM"));
    expect(screen.getByText("Toggle me")).toBeInTheDocument();
  });

  it("should expand with Enter and collapse with Space from the keyboard", async () => {
    const user = userEvent.setup();
    render(<CollapsibleMessage label="SYSTEM" content="Toggle me" defaultExpanded={false} />);

    expect(screen.getByText("Toggle me")).not.toBeVisible();

    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByText("Toggle me")).toBeVisible();

    await user.keyboard(" ");
    expect(screen.getByText("Toggle me")).not.toBeVisible();
  });
});
