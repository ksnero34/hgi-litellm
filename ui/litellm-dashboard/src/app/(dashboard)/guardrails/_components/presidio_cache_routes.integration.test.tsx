import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as networking from "@/components/networking";
import AddGuardrailForm from "./add_guardrail_form";
import GuardrailInfoView from "./guardrail_info";

vi.mock("@/components/networking", () => ({
  createGuardrailCall: vi.fn(),
  modelAvailableCall: vi.fn().mockResolvedValue({ data: [] }),
  getGuardrailInfo: vi.fn(),
  getGuardrailUISettings: vi.fn(),
  getGuardrailProviderSpecificParams: vi.fn(),
  updateGuardrailCall: vi.fn(),
}));

describe("Presidio cache edit persistence", () => {
  it("discards canceled cache changes and sends explicit null overrides through the update API", async () => {
    const savedGuardrail = {
      guardrail_id: "cache-test",
      guardrail_name: "Cache test",
      guardrail_definition_location: "database",
      litellm_params: {
        guardrail: "presidio",
        mode: "pre_call",
        default_on: false,
        presidio_analysis_cache_enabled: true,
        presidio_analysis_cache_ttl_seconds: 90,
        presidio_streaming_output_mode: "full_buffer",
      },
    };
    vi.mocked(networking.getGuardrailInfo).mockResolvedValue(savedGuardrail);
    vi.mocked(networking.getGuardrailProviderSpecificParams).mockResolvedValue({});
    const settings = {
      supported_entities: [],
      supported_actions: [],
      pii_entity_categories: [],
      supported_modes: ["pre_call"],
    };
    vi.mocked(networking.getGuardrailUISettings).mockResolvedValue(settings);
    render(<GuardrailInfoView guardrailId="cache-test" accessToken="synthetic-token" isAdmin onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: /Edit/ }));
    expect(screen.getByLabelText("Cache mode")).toHaveValue("enabled");
    expect(screen.getByLabelText("TTL (seconds)")).toHaveValue(90);
    expect(screen.getByLabelText("Streaming output inspection")).toHaveValue("full_buffer");
    fireEvent.change(screen.getByLabelText("Streaming output inspection"), { target: { value: "off" } });
    fireEvent.change(screen.getByLabelText("Cache mode"), { target: { value: "disabled" } });
    fireEvent.change(screen.getByLabelText("TTL (seconds)"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: /Edit/ }));
    expect(screen.getByLabelText("Cache mode")).toHaveValue("enabled");
    expect(screen.getByLabelText("TTL (seconds)")).toHaveValue(90);
    expect(screen.getByLabelText("Streaming output inspection")).toHaveValue("full_buffer");
    fireEvent.change(screen.getByLabelText("Streaming output inspection"), { target: { value: "windowed" } });
    fireEvent.change(screen.getByLabelText("Cache mode"), { target: { value: "inherit" } });
    fireEvent.change(screen.getByLabelText("TTL (seconds)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/ }));
    await waitFor(() =>
      expect(networking.updateGuardrailCall).toHaveBeenCalledWith(
        "synthetic-token",
        "cache-test",
        expect.objectContaining({
          litellm_params: expect.objectContaining({
            presidio_analysis_cache_enabled: null,
            presidio_analysis_cache_ttl_seconds: null,
            presidio_streaming_output_mode: "windowed",
          }),
        }),
      ),
    );
  });
});

describe("Presidio cache creation", () => {
  it("sends enabled and TTL from the creation wizard to the API", async () => {
    vi.mocked(networking.getGuardrailProviderSpecificParams).mockResolvedValue({});
    const settings = {
      supported_entities: ["PERSON"],
      supported_actions: ["MASK"],
      pii_entity_categories: [],
      supported_modes: ["pre_call"],
    };
    vi.mocked(networking.getGuardrailUISettings).mockResolvedValue(settings);
    vi.mocked(networking.createGuardrailCall).mockResolvedValue({ guardrail_id: "created" });
    render(
      <AddGuardrailForm
        visible
        accessToken="synthetic-token"
        onClose={() => {}}
        onSuccess={() => {}}
        preset={{
          provider: "PresidioPII",
          guardrailNameSuggestion: "Cache creation",
          mode: "pre_call",
          defaultOn: false,
        }}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("Guardrail Name")).toHaveValue("Cache creation"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(await screen.findByLabelText("Cache mode"), { target: { value: "enabled" } });
    fireEvent.change(screen.getByLabelText("TTL (seconds)"), { target: { value: "45" } });
    expect(screen.getByLabelText("Streaming output inspection")).toHaveValue("windowed");
    fireEvent.change(screen.getByLabelText("Streaming output inspection"), { target: { value: "off" } });
    fireEvent.click(screen.getByText("PERSON"));
    fireEvent.click(await screen.findByRole("button", { name: "Create Guardrail" }));
    await waitFor(() =>
      expect(networking.createGuardrailCall).toHaveBeenCalledWith(
        "synthetic-token",
        expect.objectContaining({
          litellm_params: expect.objectContaining({
            presidio_analysis_cache_enabled: true,
            presidio_analysis_cache_ttl_seconds: 45,
            presidio_streaming_output_mode: "off",
          }),
        }),
      ),
    );
  });
});
