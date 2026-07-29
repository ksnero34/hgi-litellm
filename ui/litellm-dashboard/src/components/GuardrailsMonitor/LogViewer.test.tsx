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
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByText("A very long guardrail input"));

    const latestProps = drawerSpy.mock.calls.at(-1)?.[0] as {
      open: boolean;
      logEntry: { request_id: string; messages: string; response: string };
    };
    expect(latestProps.open).toBe(true);
    expect(latestProps.logEntry.request_id).toBe("request-1");
    expect(latestProps.logEntry.messages).toBe("A very long guardrail input");
    expect(latestProps.logEntry.response).toBe("A response");
  });

  it("uses the selected UTC calendar day without shifting it by the browser timezone", () => {
    expect(getGuardrailLogDateRange("2026-07-28", "2026-07-28")).toEqual({
      startTime: "2026-07-28 00:00:00",
      endTime: "2026-07-28 23:59:59",
    });
  });
});
