import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../tests/test-utils";
import { getGuardrailLogDateRange, LogViewer } from "./LogViewer";

const drawerSpy = vi.fn();

vi.mock("@/components/view_logs/LogDetailsDrawer", () => ({
  LogDetailsDrawer: (props: unknown) => {
    drawerSpy(props);
    return null;
  },
}));

describe("LogViewer", () => {
  beforeEach(() => {
    drawerSpy.mockClear();
  });

  it("opens log details immediately from the guardrail summary row", () => {
    renderWithProviders(
      <LogViewer
        accessToken="token"
        startDate="2026-07-28"
        endDate="2026-07-28"
        logs={[
          {
            id: "request-1",
            timestamp: "2026-07-28T12:00:00Z",
            action: "flagged",
            model: "gpt-5.4",
            input_snippet: "A very long guardrail input",
            output_snippet: "A response",
            api_key: "hashed-key",
            key_alias: "customer-key",
            team_id: "team-1",
            team_alias: "customer-team",
            guardrail_information: [
              {
                guardrail_name: "presidio-pii",
                guardrail_event: "logging_only",
                usage_action: "flagged",
                input_source: { scope: "current_user_prompt" },
                analysis_cache: { status: "hit", hit_count: 1, total_count: 1 },
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getAllByText("Observed")).toHaveLength(2);
    expect(screen.getByText("Logging only")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Flagged" }));
    expect(screen.getByText("No logs to display. Adjust filters or date range.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Observed" }));
    fireEvent.click(screen.getByText("A very long guardrail input"));

    const latestProps = drawerSpy.mock.calls.at(-1)?.[0] as {
      open: boolean;
      logEntry: {
        request_id: string;
        api_key: string;
        team_id: string;
        messages: string;
        response: string;
        metadata: Record<string, unknown>;
      };
    };
    expect(latestProps.open).toBe(true);
    expect(latestProps.logEntry.request_id).toBe("request-1");
    expect(latestProps.logEntry.messages).toBe("A very long guardrail input");
    expect(latestProps.logEntry.response).toBe("A response");
    expect(latestProps.logEntry.api_key).toBe("hashed-key");
    expect(latestProps.logEntry.team_id).toBe("team-1");
    expect(latestProps.logEntry.metadata).toMatchObject({
      user_api_key: "hashed-key",
      user_api_key_alias: "customer-key",
      user_api_key_team_alias: "customer-team",
      guardrail_information: [
        {
          guardrail_name: "presidio-pii",
          guardrail_event: "logging_only",
          usage_action: "flagged",
          input_source: { scope: "current_user_prompt" },
          analysis_cache: { status: "hit", hit_count: 1, total_count: 1 },
        },
      ],
    });
  });

  it("uses the selected UTC calendar day without shifting it by the browser timezone", () => {
    expect(getGuardrailLogDateRange("2026-07-28", "2026-07-28")).toEqual({
      startTime: "2026-07-28 00:00:00",
      endTime: "2026-07-28 23:59:59",
    });
  });
});
