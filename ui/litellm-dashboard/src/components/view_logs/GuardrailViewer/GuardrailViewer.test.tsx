import { getMeasuredOverhead } from "./guardrailTiming";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "../../../../tests/test-utils";
import {
  makeBedrockResponse,
  makeEntity,
  makeGuardrailInformation,
  type GuardrailInformation,
} from "@/components/view_logs/GuardrailViewer/__tests__/fixtures";
import GuardrailViewer from "@/components/view_logs/GuardrailViewer/GuardrailViewer";

// We will mock child components selectively for some tests to assert prop passthrough,
// but also run an integration-style render without mocks.
const PresidioPath = "@/components/view_logs/GuardrailViewer/PresidioDetectedEntities";
const BedrockPath = "@/components/view_logs/GuardrailViewer/BedrockGuardrailDetails";

describe("GuardrailViewer", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("merges nested intervals while excluding gaps and repeated shared analysis", () => {
    const shared = { start_time: 1, end_time: 2 };
    const entries = [
      { start_time: 1.2, end_time: 1.8, shared_analysis: shared },
      { start_time: 1.3, end_time: 1.4, shared_analysis: shared },
      { start_time: 3, end_time: 3.5 },
    ];
    expect(getMeasuredOverhead(entries)).toBe(1.5);
  });

  it("shows header, status pill, and duration", () => {
    const data = makeGuardrailInformation({ duration: 1.23456, guardrail_status: "success" });
    renderWithProviders(<GuardrailViewer data={data} />);

    expect(screen.getByText("Guardrails & Policy Compliance")).toBeInTheDocument();
    // header shows passed count
    expect(screen.getByText(/1 Passed/)).toBeInTheDocument();
    // The PASSED badge in the evaluation card
    expect(screen.getByText("PASSED")).toBeInTheDocument();

    // duration displays in ms format: Math.round(1.23456 * 1000) = 1235
    expect(screen.getByText("1235ms")).toBeInTheDocument();
  });

  it.each([
    { action: "passed", mode: "pre_call", label: "Passed", color: "text-success" },
    { action: "flagged", mode: "pre_call", label: "Flagged", color: "text-warning" },
    { action: "blocked", mode: "pre_call", label: "Blocked", color: "text-destructive" },
    { action: "flagged", mode: "logging_only", label: "Observed", color: "text-purple-700" },
  ] as const)("uses the $label icon consistently in the timeline and evaluation", ({ action, mode, label, color }) => {
    const overrides: Partial<GuardrailInformation> = {
      guardrail_status: action === "blocked" ? "guardrail_intervened" : "success",
      usage_action: action,
      guardrail_event: mode,
    };
    renderWithProviders(<GuardrailViewer data={makeGuardrailInformation(overrides)} />);
    const icons = screen.getAllByRole("img", { name: label });
    expect(icons).toHaveLength(2);
    for (const icon of icons) {
      expect(icon).toHaveClass(color);
      if (action !== "blocked") expect(icon).not.toHaveClass("text-destructive");
    }
  });

  it("distinguishes a guardrail execution error from a policy block", () => {
    const data = makeGuardrailInformation({ guardrail_status: "error", guardrail_event: "pre_call" });
    renderWithProviders(<GuardrailViewer data={data} />);
    const icons = screen.getAllByRole("img", { name: "Flagged: guardrail execution error" });
    expect(icons).toHaveLength(2);
    for (const icon of icons) expect(icon).toHaveClass("text-warning");
    expect(screen.queryByRole("img", { name: "Blocked" })).not.toBeInTheDocument();
  });

  it("counts shared analysis once and measures the union of concurrent check intervals", () => {
    const common: Partial<GuardrailInformation> = {
      guardrail_event: "pre_call",
      guardrail_run_id: "shared-run",
      shared_analysis: { start_time: 100, end_time: 101 },
      start_time: 101,
      end_time: 101.003,
      duration: 0.003,
    };
    const overlap = { ...common, start_time: 101.001, end_time: 101.004 };
    renderWithProviders(
      <GuardrailViewer data={[makeGuardrailInformation(common), makeGuardrailInformation(overlap)]} />,
    );
    expect(screen.getByText("Shared analysis: pii-rail")).toBeVisible();
    expect(screen.getByText("1000ms")).toBeVisible();
    expect(screen.getByText("Measured guardrail time: 1004ms")).toBeVisible();
    expect(screen.getAllByText("Individual check: 3ms")).toHaveLength(2);
    expect(screen.getAllByText(/^T\+/).map((element) => element.textContent)).toEqual([
      "T+1000ms",
      "T+1003ms",
      "T+1004ms",
    ]);
  });

  it("measures overlapping legacy checks without adding their durations", () => {
    const first = { start_time: 100, end_time: 100.003, duration: 0.003 };
    const second = { start_time: 100.001, end_time: 100.004, duration: 0.003 };
    renderWithProviders(<GuardrailViewer data={[makeGuardrailInformation(first), makeGuardrailInformation(second)]} />);
    expect(screen.getByText("Measured guardrail time: 4ms")).toBeVisible();
    expect(screen.getAllByText("3ms")).toHaveLength(2);
    expect(screen.queryByText(/Shared analysis:/)).not.toBeInTheDocument();
  });

  it("ignores invalid intervals and does not show a response before pre-call checks finish", () => {
    const valid: Partial<GuardrailInformation> = {
      guardrail_event: "pre_call",
      start_time: 100,
      end_time: 101.233,
      duration: 0.0001,
      shared_analysis: { start_time: 102, end_time: 100 },
    };
    const invalid = { ...valid, start_time: NaN, end_time: NaN };
    renderWithProviders(
      <GuardrailViewer
        data={[makeGuardrailInformation(valid), makeGuardrailInformation(invalid)]}
        logEntry={{ request_id: "bad-end", startTime: "1970-01-01T00:01:40Z", endTime: "1970-01-01T00:01:40Z" }}
      />,
    );
    expect(screen.getByText("Measured guardrail time: 1233ms")).toBeVisible();
    expect(screen.getAllByText("<1ms")).toHaveLength(2);
    expect(screen.getAllByText(/^T\+/).map((element) => element.textContent)).toEqual(["T+0ms", "T+1233ms"]);
    expect(screen.queryByText(/Shared analysis:/)).not.toBeInTheDocument();
  });

  it("does not invent measured time when legacy logs have no valid intervals", () => {
    const invalid = { start_time: NaN, end_time: NaN, duration: 0.002 };
    renderWithProviders(<GuardrailViewer data={makeGuardrailInformation(invalid)} />);
    expect(screen.getByText("Measured guardrail time unavailable")).toBeVisible();
    expect(screen.getByText("2ms")).toBeVisible();
    expect(screen.queryByText(/^T\+/)).not.toBeInTheDocument();
  });

  it("shows cached analysis on a blocked evaluation without changing its policy outcome", async () => {
    const user = userEvent.setup();
    const overrides: Partial<GuardrailInformation> = {
      guardrail_status: "blocked",
      usage_action: "blocked",
      analysis_cache: { status: "hit", hit_count: 2, total_count: 2 },
    };
    const data = makeGuardrailInformation(overrides);
    renderWithProviders(<GuardrailViewer data={data} />);

    const badge = screen.getByText("Analysis cache hit (2/2)");
    expect(badge).toBeVisible();
    expect(screen.getByText("BLOCKED")).toBeVisible();
    expect(screen.getByText("1 Blocked")).toBeVisible();
    await user.hover(badge);
    expect(
      await screen.findByText(
        "Reused cached Presidio analysis for 2 of 2 text fragments. Policy checks and anonymization still run.",
      ),
    ).toBeVisible();
  });

  it("distinguishes partial cache reuse for a chunked input", () => {
    const overrides: Partial<GuardrailInformation> = {
      analysis_cache: { status: "partial", hit_count: 1, total_count: 3 },
    };
    const data = makeGuardrailInformation(overrides);
    renderWithProviders(<GuardrailViewer data={data} />);

    expect(screen.getByText("Partial analysis cache hit (1/3)")).toBeVisible();
    expect(screen.queryByText(/^Analysis cache hit/)).not.toBeInTheDocument();
  });

  it.each([undefined, { status: "miss" as const, hit_count: 0, total_count: 1 }])(
    "does not claim cached analysis for an old log or fresh analysis: %j",
    (analysisCache) => {
      const overrides: Partial<GuardrailInformation> = { analysis_cache: analysisCache };
      const data = makeGuardrailInformation(overrides);
      renderWithProviders(<GuardrailViewer data={data} />);

      expect(screen.queryByText(/analysis cache hit/i)).not.toBeInTheDocument();
      expect(screen.getByText("Guardrails & Policy Compliance")).toBeVisible();
    },
  );

  it("shows masked Presidio detections as flagged when the guardrail call succeeded", () => {
    const data = makeGuardrailInformation({
      guardrail_status: "success",
      usage_action: "flagged",
      masked_entity_count: { EMAIL_ADDRESS: 1 },
    });

    renderWithProviders(<GuardrailViewer data={data} />);

    expect(screen.getByText("FLAGGED")).toBeInTheDocument();
    expect(screen.getByText("1 Flagged")).toBeInTheDocument();
    expect(screen.getByText("0 Passed")).toBeInTheDocument();
  });

  it("shows logging-only detections as observed after the response is returned", () => {
    const data = [
      makeGuardrailInformation({
        guardrail_run_id: "run-1",
        guardrail_event: "pre_call",
        usage_action: "passed",
      }),
      makeGuardrailInformation({
        guardrail_run_id: "run-1",
        guardrail_event: "logging_only",
        usage_action: "flagged",
      }),
    ];

    renderWithProviders(<GuardrailViewer data={data} />);

    expect(screen.getByText("1 guardrail evaluated")).toBeInTheDocument();
    expect(screen.getByText("1 Observed")).toBeInTheDocument();
    expect(screen.getByText("0 Passed")).toBeInTheDocument();
    expect(screen.getAllByText("OBSERVED")).toHaveLength(2);
    expect(screen.getAllByText("PASSED")).toHaveLength(2);
    expect(screen.queryByText(/Post-call guardrail:/)).not.toBeInTheDocument();

    const responseReturned = screen.getByText("Response returned");
    const loggingAudit = screen.getByText(/Logging-only audit:/);
    expect(responseReturned.compareDocumentPosition(loggingAudit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps input outcomes separate while aggregating the run summary", () => {
    const cleanInput: Partial<GuardrailInformation> = {
      guardrail_run_id: "mixed",
      guardrail_name: "clean-input",
      guardrail_event: "pre_call",
      usage_action: "passed",
      masked_entity_count: {},
    };
    const detectedInput: Partial<GuardrailInformation> = {
      ...cleanInput,
      guardrail_name: "pii-input",
      usage_action: "flagged",
      masked_entity_count: { PERSON: 1 },
    };
    renderWithProviders(
      <GuardrailViewer data={[makeGuardrailInformation(cleanInput), makeGuardrailInformation(detectedInput)]} />,
    );
    expect(screen.getByText("1 guardrail evaluated")).toBeVisible();
    expect(screen.getByText("1 Flagged")).toBeVisible();
    expect(screen.getAllByText("PASSED")).toHaveLength(2);
    expect(screen.getAllByText("FLAGGED")).toHaveLength(2);
  });

  it.each([undefined, { request_id: "invalid", startTime: "invalid", endTime: "invalid" }])(
    "does not fabricate request or model timing without valid timestamps: %j",
    (logEntry) => {
      renderWithProviders(
        <GuardrailViewer
          logEntry={logEntry}
          data={makeGuardrailInformation({
            guardrail_event: "pre_call",
            start_time: 100,
            end_time: 100.008,
          })}
        />,
      );
      expect(screen.getAllByText(/^T\+/).map((element) => element.textContent)).toEqual(["T+8ms"]);
      expect(screen.getByText("LLM call")).toBeVisible();
      expect(screen.getByText("Response returned")).toBeVisible();
    },
  );

  it("uses recorded request times and orders concurrent guardrail completions", () => {
    const slowInput: Partial<GuardrailInformation> = {
      guardrail_name: "slow",
      guardrail_event: "pre_call",
      start_time: 100.001,
      end_time: 100.008,
    };
    const fastInput: Partial<GuardrailInformation> = {
      ...slowInput,
      guardrail_name: "fast",
      start_time: 100.002,
      end_time: 100.004,
    };
    renderWithProviders(
      <GuardrailViewer
        logEntry={{ request_id: "timed", startTime: "1970-01-01T00:01:40Z", endTime: "1970-01-01T00:01:42Z" }}
        data={[makeGuardrailInformation(slowInput), makeGuardrailInformation(fastInput)]}
      />,
    );
    expect(screen.getAllByText(/^T\+/).map((element) => element.textContent)).toEqual([
      "T+0ms",
      "T+4ms",
      "T+8ms",
      "T+2000ms",
    ]);
    expect(
      screen
        .getByText("Pre-call guardrail: fast")
        .compareDocumentPosition(screen.getByText("Pre-call guardrail: slow")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("calculates and displays masked entity totals", async () => {
    const user = userEvent.setup();
    const data = makeGuardrailInformation({
      masked_entity_count: { EMAIL_ADDRESS: 2, PHONE_NUMBER: 1 },
    });
    renderWithProviders(<GuardrailViewer data={data} />);

    // In collapsed state, the match count badge is visible
    expect(screen.getByText("3 matched")).toBeInTheDocument();

    // Expand the evaluation card to see entity details
    await user.click(screen.getByText("pii-rail"));
    // summary chips for each entry inside expanded card
    expect(screen.getByText("EMAIL_ADDRESS: 2")).toBeInTheDocument();
    expect(screen.getByText("PHONE_NUMBER: 1")).toBeInTheDocument();
  });

  it("hides matched badge when count is zero/empty", () => {
    const data = makeGuardrailInformation({ masked_entity_count: {} });
    renderWithProviders(<GuardrailViewer data={data} />);

    expect(screen.queryByText(/matched/)).not.toBeInTheDocument();
  });

  it("toggles evaluation card open/closed on click", async () => {
    const user = userEvent.setup();
    const data = makeGuardrailInformation({
      masked_entity_count: { EMAIL_ADDRESS: 2 },
    });
    renderWithProviders(<GuardrailViewer data={data} />);

    // Initially collapsed — masked entity details not visible
    expect(screen.queryByText("EMAIL_ADDRESS: 2")).not.toBeInTheDocument();

    // Click to expand
    await user.click(screen.getByText("pii-rail"));
    expect(screen.getByText("EMAIL_ADDRESS: 2")).toBeInTheDocument();

    // Click again to collapse
    await user.click(screen.getByText("pii-rail"));
    await waitFor(() => {
      expect(screen.queryByText("EMAIL_ADDRESS: 2")).not.toBeInTheDocument();
    });
  });

  it("defaults to presidio provider when guardrail_provider is undefined", async () => {
    vi.doMock(PresidioPath, () => ({
      __esModule: true,
      default: ({ entities }: any) => <div data-testid="presidio-mock">presidio {entities?.length}</div>,
    }));
    const { default: Component } = await import("@/components/view_logs/GuardrailViewer/GuardrailViewer");

    const data = makeGuardrailInformation({
      guardrail_provider: undefined,
      guardrail_response: [makeEntity(), makeEntity()],
    });
    renderWithProviders(<Component data={data} />);

    // Expand the card to see provider-specific content
    const user = userEvent.setup();
    await user.click(screen.getByText("pii-rail"));
    expect(screen.getByTestId("presidio-mock")).toHaveTextContent("presidio 2");
  });

  it('renders PresidioDetectedEntities when provider="presidio" and response has entities', async () => {
    vi.doMock(PresidioPath, () => ({
      __esModule: true,
      default: ({ entities }: any) => <div data-testid="presidio-mock">count:{entities?.length}</div>,
    }));
    const { default: Component } = await import("@/components/view_logs/GuardrailViewer/GuardrailViewer");

    const data = makeGuardrailInformation({
      guardrail_provider: "presidio",
      guardrail_response: [makeEntity()],
    });
    renderWithProviders(<Component data={data} />);

    // Expand the card to see provider-specific content
    const user = userEvent.setup();
    await user.click(screen.getByText("pii-rail"));
    expect(screen.getByTestId("presidio-mock")).toHaveTextContent("count:1");
  });

  it('renders BedrockGuardrailDetails when provider="bedrock"', async () => {
    vi.doMock(BedrockPath, () => ({
      __esModule: true,
      default: ({ response }: any) => <div data-testid="bedrock-mock">{response?.action ?? "no-action"}</div>,
    }));
    const { default: Component } = await import("@/components/view_logs/GuardrailViewer/GuardrailViewer");

    const data = makeGuardrailInformation({
      guardrail_provider: "bedrock",
      guardrail_response: makeBedrockResponse({ action: "GUARDRAIL_INTERVENED" }),
    });
    renderWithProviders(<Component data={data} />);

    // Expand the card to see provider-specific content
    const user = userEvent.setup();
    await user.click(screen.getByText("pii-rail"));
    expect(screen.getByTestId("bedrock-mock")).toHaveTextContent("GUARDRAIL_INTERVENED");
  });

  it("unknown provider renders neither Presidio nor Bedrock details", async () => {
    const user = userEvent.setup();
    const data = makeGuardrailInformation({
      guardrail_provider: "unknown",
    });
    renderWithProviders(<GuardrailViewer data={data} />);
    // Header still present
    expect(screen.getByText("Guardrails & Policy Compliance")).toBeInTheDocument();

    // Expand the card
    await user.click(screen.getByText("pii-rail"));
    // No Presidio or Bedrock sections
    expect(screen.queryByText(/Detected Entities/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Raw Bedrock Guardrail Response/)).not.toBeInTheDocument();
  });

  it("renders without crashing when guardrail_mode is null", () => {
    const data = makeGuardrailInformation({ guardrail_mode: null });
    renderWithProviders(<GuardrailViewer data={data} />);

    expect(screen.getByText("Guardrails & Policy Compliance")).toBeInTheDocument();
    // Null mode should display as dash
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders without crashing when guardrail_mode is an object", () => {
    const data = makeGuardrailInformation({
      guardrail_mode: { default: "pre_call", tags: {} },
    });
    renderWithProviders(<GuardrailViewer data={data} />);

    expect(screen.getByText("Guardrails & Policy Compliance")).toBeInTheDocument();
    expect(screen.getByText("PRE-CALL")).toBeInTheDocument();
  });

  it("renders without crashing when guardrail_mode is an array and shows in both timeline buckets", () => {
    const data = makeGuardrailInformation({
      guardrail_mode: ["pre_call", "post_call"],
    });
    renderWithProviders(<GuardrailViewer data={data} />);

    expect(screen.getByText("Guardrails & Policy Compliance")).toBeInTheDocument();
    // Mode badge shows first element formatted
    expect(screen.getByText("PRE-CALL")).toBeInTheDocument();
    // Entry should appear in both pre-call and post-call timeline sections
    expect(screen.getByText(/Pre-call guardrail:/)).toBeInTheDocument();
    expect(screen.getByText(/Post-call guardrail:/)).toBeInTheDocument();
  });

  it("shows semantic input scopes and counts one run as one guardrail", async () => {
    const user = userEvent.setup();
    const data = [
      makeGuardrailInformation({
        guardrail_run_id: "run-1",
        guardrail_event: "pre_call",
        guardrail_mode: ["pre_call", "post_call"],
        input_source: {
          type: "message",
          message_index: 0,
          role: "system",
          content_index: null,
          path: "messages[0].content",
          scope: "system_prompt",
        },
      }),
      makeGuardrailInformation({
        guardrail_run_id: "run-1",
        guardrail_event: "pre_call",
        guardrail_mode: ["pre_call", "post_call"],
        input_source: {
          type: "message",
          message_index: 1,
          role: "user",
          content_index: 0,
          path: "messages[1].content[0].text",
          scope: "current_user_prompt",
        },
      }),
      makeGuardrailInformation({
        guardrail_run_id: "run-1",
        guardrail_event: "pre_call",
        guardrail_mode: ["pre_call", "post_call"],
        input_source: {
          type: "message",
          message_index: 1,
          role: "user",
          content_index: 1,
          path: "messages[1].content[1].text",
          scope: "environment_context",
        },
      }),
    ];

    renderWithProviders(<GuardrailViewer data={data} />);

    expect(screen.getByText("1 guardrail evaluated")).toBeInTheDocument();
    expect(screen.getByText("3 inputs scanned")).toBeInTheDocument();
    expect(screen.getByText("SYSTEM PROMPT")).toBeInTheDocument();
    expect(screen.getByText("CURRENT USER PROMPT")).toBeInTheDocument();
    expect(screen.getByText("ENVIRONMENT CONTEXT")).toBeInTheDocument();
    expect(screen.queryByText(/Post-call guardrail:/)).not.toBeInTheDocument();

    await user.click(screen.getByText("CURRENT USER PROMPT"));
    expect(screen.getByText("messages[1].content[0].text")).toBeInTheDocument();
  });

  it("keeps legacy input source labels when scope is absent", () => {
    const data = makeGuardrailInformation({
      input_source: {
        type: "message",
        message_index: 1,
        role: "user",
        content_index: 0,
        path: "messages[1].content[0].text",
      },
    });

    renderWithProviders(<GuardrailViewer data={data} />);

    expect(screen.getByText("USER · Message 2 · Content 1")).toBeInTheDocument();
  });

  it("integration: renders with real Bedrock details without mocks", async () => {
    const user = userEvent.setup();
    const data = makeGuardrailInformation({
      guardrail_provider: "bedrock",
      guardrail_response: makeBedrockResponse({
        action: "NONE",
        outputs: [{ text: "ok" }],
      }),
    });
    renderWithProviders(<GuardrailViewer data={data} />);

    // Expand the card to reveal Bedrock details
    await user.click(screen.getByText("pii-rail"));

    // Bedrock summary bits
    expect(screen.getByText("Outputs")).toBeInTheDocument();
    expect(screen.getByText("ok")).toBeInTheDocument();
  });
});
