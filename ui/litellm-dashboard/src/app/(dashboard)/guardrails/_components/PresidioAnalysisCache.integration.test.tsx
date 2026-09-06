import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import PresidioAnalysisCache from "./PresidioAnalysisCache";
import { type GuardrailFormValues } from "./GuardrailFormField";
import { CACHE_ENABLED, CACHE_TTL, cacheFormValues, cachePayload } from "./presidio_cache_form";

function Form({ save }: { save: (values: object) => void }) {
  const form = useForm<GuardrailFormValues>({
    defaultValues: cacheFormValues({ [CACHE_ENABLED]: true, [CACHE_TTL]: 30 }),
  });
  return (
    <form onSubmit={form.handleSubmit((values) => save(cachePayload(values, "presidio")))}>
      <PresidioAnalysisCache
        control={form.control}
        settings={{
          enabled_by_default: false,
          ttl_seconds: 300,
          prerequisites_ready: false,
          unavailable_reasons: ["analysis_not_verified"],
        }}
      />
      <button type="submit">Save cache</button>
    </form>
  );
}

describe("Presidio cache controls", () => {
  it("hydrates overrides and saves explicit inheritance while showing prerequisite status", async () => {
    const save = vi.fn();
    render(<Form save={save} />);
    expect(screen.getByRole("combobox")).toHaveValue("enabled");
    expect(screen.getByRole("spinbutton")).toHaveValue(30);
    expect(screen.getByRole("status")).toHaveTextContent("Full-input analysis has not been verified");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "inherit" } });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save cache" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ [CACHE_ENABLED]: null, [CACHE_TTL]: null }));
  });
  it("shows saved disabled values without editable controls", () => {
    render(<PresidioAnalysisCache values={{ [CACHE_ENABLED]: false, [CACHE_TTL]: 20 }} />);
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
