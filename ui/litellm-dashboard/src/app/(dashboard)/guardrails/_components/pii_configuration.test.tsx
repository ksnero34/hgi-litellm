import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import PiiConfiguration from "./pii_configuration";

describe("PiiConfiguration", () => {
  it("should render", () => {
    const { getByText } = render(
      <PiiConfiguration
        entities={[]}
        actions={[]}
        selectedEntities={[]}
        selectedActions={{}}
        onEntitySelect={() => {}}
        onActionSelect={() => {}}
        entityCategories={[]}
      />,
    );
    expect(getByText("Configure PII Protection")).toBeInTheDocument();
  });

  it("adds the exact custom Presidio entity type with MASK as its default action", async () => {
    const user = userEvent.setup();
    const onEntitySelect = vi.fn();
    const onActionSelect = vi.fn();

    render(
      <PiiConfiguration
        entities={["EMAIL_ADDRESS"]}
        actions={["MASK", "BLOCK"]}
        selectedEntities={[]}
        selectedActions={{}}
        onEntitySelect={onEntitySelect}
        onActionSelect={onActionSelect}
        entityCategories={[]}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "Custom PII type" }), "KORNAME");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onEntitySelect).toHaveBeenCalledWith("KORNAME");
    expect(onActionSelect).toHaveBeenCalledWith("KORNAME", "MASK");
  });

  it("shows saved custom entity types that are absent from the built-in catalog", () => {
    render(
      <PiiConfiguration
        entities={["EMAIL_ADDRESS"]}
        actions={["MASK", "BLOCK"]}
        selectedEntities={["KORNAME"]}
        selectedActions={{ KORNAME: "BLOCK" }}
        onEntitySelect={() => {}}
        onActionSelect={() => {}}
        entityCategories={[]}
      />,
    );

    expect(screen.getByText("KORNAME")).toBeInTheDocument();
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });
});
