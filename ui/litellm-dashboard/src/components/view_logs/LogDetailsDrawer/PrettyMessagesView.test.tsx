import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { i18n } from "@/i18n/i18n";
import { PrettyMessagesView } from "./PrettyMessagesView";

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  return {
    ...actual,
    message: {
      success: vi.fn(),
    },
  };
});

describe("PrettyMessagesView", () => {
  it("should render the component for standard chat completions", () => {
    const request = {
      messages: [{ role: "user", content: "Hello" }],
    };
    const response = {
      choices: [{ message: { role: "assistant", content: "Hi there!" } }],
    };

    render(<PrettyMessagesView request={request} response={response} />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Hi there!")).toBeInTheDocument();
  });

  it("renders input when request is a bare messages array (cold storage payload)", () => {
    const request = [{ role: "user", content: "Write me a poem" }];
    const response = {
      choices: [{ message: { role: "assistant", content: "A quiet moment." } }],
    };

    render(<PrettyMessagesView request={request} response={response} />);
    expect(screen.getByText("Write me a poem")).toBeInTheDocument();
    expect(screen.getByText("A quiet moment.")).toBeInTheDocument();
  });

  it("renders Responses API input and output in the pretty view", () => {
    const request = {
      input: [{ role: "user", type: "message", content: "ㅎㅇㅎㅇ" }],
      model: "openrouter/openai/gpt-oss-120b",
    };
    const response = {
      object: "response",
      output: [
        {
          type: "reasoning",
          content: [{ type: "reasoning_text", text: "Internal reasoning" }],
        },
        {
          role: "assistant",
          type: "message",
          content: [
            { type: "reasoning_text", text: "Nested reasoning" },
            { type: "output_text", text: "ㅎㅇ! 어떻게 도와줄까?" },
          ],
        },
      ],
    };

    render(<PrettyMessagesView request={request} response={response} />);

    expect(screen.getByText("ㅎㅇㅎㅇ")).toBeInTheDocument();
    expect(screen.getByText("ㅎㅇ! 어떻게 도와줄까?")).toBeInTheDocument();
    expect(screen.getByText("Internal reasoning")).toBeInTheDocument();
    expect(screen.getByText("Nested reasoning")).toBeInTheDocument();
  });

  it("renders a Responses API content block input as one user message", () => {
    const request = { input: [{ type: "input_text", text: "Direct input" }] };
    const response = {
      output: [{ role: "assistant", type: "message", content: [{ type: "output_text", text: "Reply" }] }],
    };

    render(<PrettyMessagesView request={request} response={response} />);

    expect(screen.getByText("Direct input")).toBeInTheDocument();
    expect(screen.getByText("Reply")).toBeInTheDocument();
  });

  it("renders Responses request tool calls and tool outputs", () => {
    const request = {
      input: [
        { role: "user", type: "message", content: "Run lookup" },
        {
          type: "function_call",
          call_id: "call_request",
          name: "lookup",
          arguments: '{"query":"internal"}',
        },
        {
          type: "function_call_output",
          call_id: "call_request",
          output: "Lookup complete",
        },
      ],
    };
    const response = {
      object: "response",
      output: [{ type: "message", content: [{ type: "output_text", text: "Done" }] }],
    };

    render(<PrettyMessagesView request={request} response={response} />);

    expect(screen.getByText("Run lookup")).toBeInTheDocument();
    expect(screen.getByText("lookup")).toBeInTheDocument();
    expect(screen.getByText('"internal"')).toBeInTheDocument();
    expect(screen.getByText("Lookup complete")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("renders Responses reasoning, tools, outputs, state, and unknown items", () => {
    const response = {
      object: "response",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [
        {
          type: "reasoning",
          content: [{ type: "reasoning_text", text: "Check the weather" }],
          summary: [{ type: "summary_text", text: "Weather lookup" }],
        },
        {
          type: "function_call",
          call_id: "call_1",
          name: "get_weather",
          arguments: '{"city":"Seoul"}',
        },
        {
          type: "function_call_output",
          call_id: "call_1",
          output: "Sunny",
        },
        {
          type: "provider_extension",
          payload: "preserved",
        },
      ],
    };

    render(<PrettyMessagesView request={{ input: "weather" }} response={response} />);

    expect(screen.getByText("Check the weather")).toBeInTheDocument();
    expect(screen.getByText("Weather lookup")).toBeInTheDocument();
    expect(screen.getByText("get_weather")).toBeInTheDocument();
    expect(screen.getByText('"Seoul"')).toBeInTheDocument();
    expect(screen.getByText("Sunny")).toBeInTheDocument();
    expect(screen.getByText(/max_output_tokens/)).toBeInTheDocument();
    expect(screen.getByText(/preserved/)).toBeInTheDocument();
  });

  it("renders root output_text and failed response details without output items", () => {
    const response = {
      object: "response",
      status: "failed",
      output_text: "Fallback answer",
      output: [],
      error: { message: "Provider failed after partial output" },
    };

    render(<PrettyMessagesView request={{ input: "test" }} response={response} />);

    expect(screen.getByText("Fallback answer")).toBeInTheDocument();
    expect(screen.getByText(/Provider failed after partial output/)).toBeInTheDocument();
  });

  it("localizes Responses status and character count while keeping Reasoning in English", async () => {
    await i18n.changeLanguage("ko");
    const response = {
      object: "response",
      status: "completed",
      output: [
        {
          type: "reasoning",
          content: [{ type: "reasoning_text", text: "검토" }],
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "완료했습니다" }],
        },
      ],
    };

    const { unmount } = render(<PrettyMessagesView request={{ input: "확인" }} response={response} />);

    expect(screen.getByText("Reasoning")).toBeInTheDocument();
    expect(screen.getByText("상태: 완료")).toBeInTheDocument();
    expect(screen.getByText("(2자)")).toBeInTheDocument();
    expect(screen.queryByText("리저닝")).not.toBeInTheDocument();

    unmount();
    await i18n.changeLanguage("en");
  });

  it("aggregates raw Responses SSE text and reasoning deltas", () => {
    const response = [
      { type: "response.reasoning_text.delta", delta: "Need " },
      { type: "response.reasoning_text.delta", delta: "context" },
      { type: "response.output_text.delta", delta: "Hello " },
      { type: "response.output_text.delta", delta: "world" },
      {
        type: "response.output_item.done",
        item: { type: "function_call", call_id: "call_sse", name: "search", arguments: '{"q":"docs"}' },
      },
      {
        type: "response.output_item.done",
        item: { type: "function_call_output", call_id: "call_sse", output: "Search complete" },
      },
      { type: "response.incomplete", incomplete_details: { reason: "max_output_tokens" } },
    ];

    render(<PrettyMessagesView request={{ input: "test" }} response={response} />);

    expect(screen.getByText("Need context")).toBeInTheDocument();
    expect(screen.getByText("Hello world")).toBeInTheDocument();
    expect(screen.getByText("search")).toBeInTheDocument();
    expect(screen.getByText('"docs"')).toBeInTheDocument();
    expect(screen.getByText("Search complete")).toBeInTheDocument();
    expect(screen.getByText(/max_output_tokens/)).toBeInTheDocument();
  });

  it("should render the realtime pretty view for realtime API responses", () => {
    const request = {};
    const response = {
      results: [
        {
          type: "session.created",
          session: {
            id: "sess_123",
            model: "gpt-4o-mini-realtime-preview",
            voice: "alloy",
            modalities: ["audio", "text"],
          },
        },
        {
          type: "response.done",
          response: {
            id: "resp_1",
            status: "completed",
            output: [
              {
                id: "item_1",
                role: "assistant",
                type: "message",
                content: [{ type: "audio", transcript: "Hello from realtime!" }],
              },
            ],
          },
        },
      ],
    };

    render(<PrettyMessagesView request={request} response={response} />);
    expect(screen.getByText("Session")).toBeInTheDocument();
    expect(screen.getByText("Hello from realtime!")).toBeInTheDocument();
    const modelElements = screen.getAllByText("gpt-4o-mini-realtime-preview");
    expect(modelElements.length).toBeGreaterThanOrEqual(1);
  });

  it("renders a Responses API log, whose body uses input/output instead of messages/choices", () => {
    const request = {
      model: "gpt-5.6",
      input: [{ role: "user", content: "Reply with exactly: hello from responses api" }],
    };
    const response = {
      output: [
        {
          id: "msg_070989277645d4ae",
          role: "assistant",
          type: "message",
          status: "completed",
          content: [{ text: "hello from responses api", type: "output_text", annotations: [] }],
        },
      ],
    };

    render(<PrettyMessagesView request={request} response={response} />);
    expect(screen.getByText("Reply with exactly: hello from responses api")).toBeInTheDocument();
    expect(screen.getByText("hello from responses api")).toBeInTheDocument();
    expect(screen.queryByText("No response data available")).not.toBeInTheDocument();
  });

  it("renders a Responses API tool call, whose output item is a function_call", () => {
    const request = {
      model: "gpt-5.6",
      input: [{ role: "user", content: "What is the weather in San Francisco? Use the tool." }],
    };
    const response = {
      output: [
        {
          id: "fc_08edf6c2312f1485",
          name: "get_weather",
          type: "function_call",
          status: "completed",
          call_id: "call_AtO0J9eNy5jgECXzBicMJM8W",
          arguments: '{"city":"San Francisco"}',
        },
      ],
    };

    render(<PrettyMessagesView request={request} response={response} />);
    expect(screen.getByText("What is the weather in San Francisco? Use the tool.")).toBeInTheDocument();
    expect(screen.getByText("get_weather")).toBeInTheDocument();
    expect(screen.queryByText("No response data available")).not.toBeInTheDocument();
  });

  it("renders instructions as the system turn and a bare string input", () => {
    const request = { model: "gpt-5.6", instructions: "You are terse.", input: "Say A" };
    const response = {
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "A" }] }],
    };

    render(<PrettyMessagesView request={request} response={response} />);
    expect(screen.getByText("You are terse.")).toBeInTheDocument();
    expect(screen.getByText("Say A")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("skips reasoning output items rather than rendering them as empty turns", () => {
    const request = { input: [{ role: "user", content: "Think then answer" }] };
    const response = {
      output: [
        { type: "reasoning", id: "rs_1", summary: [] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "answered" }] },
      ],
    };

    render(<PrettyMessagesView request={request} response={response} />);
    expect(screen.getByText("answered")).toBeInTheDocument();
    expect(screen.queryByText("No response data available")).not.toBeInTheDocument();
  });

  it("renders a Responses API follow-up turn carrying a prior function_call and its output", () => {
    const request = {
      input: [
        { role: "user", content: "What is the weather in San Francisco? Use the tool." },
        {
          type: "function_call",
          name: "get_weather",
          call_id: "call_AtO0J9eNy5jgECXzBicMJM8W",
          arguments: '{"city":"San Francisco"}',
        },
        { type: "function_call_output", call_id: "call_AtO0J9eNy5jgECXzBicMJM8W", output: '{"temp":18}' },
      ],
    };
    const response = {
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "It is 18 degrees." }] }],
    };

    render(<PrettyMessagesView request={request} response={response} />);
    expect(screen.getByText("It is 18 degrees.")).toBeInTheDocument();
    expect(screen.getByText('{"temp":18}')).toBeInTheDocument();
    expect(screen.getByText("TOOL")).toBeInTheDocument();
  });

  it("maps the developer and legacy function roles onto the roles the drawer renders", () => {
    const request = {
      messages: [
        { role: "developer", content: "Stay terse." },
        { role: "user", content: "Weather?" },
        { role: "function", name: "get_weather", content: '{"temp":18}' },
      ],
    };
    const response = { choices: [{ message: { role: "assistant", content: "18 degrees." } }] };

    render(<PrettyMessagesView request={request} response={response} />);
    expect(screen.getByText("Stay terse.")).toBeInTheDocument();
    expect(screen.getByText("TOOL")).toBeInTheDocument();
    expect(screen.queryByText("FUNCTION")).not.toBeInTheDocument();
  });

  it("still reports missing output when a Responses API log has an empty output array", () => {
    const request = { input: [{ role: "user", content: "Hello" }] };

    render(<PrettyMessagesView request={request} response={{ output: [] }} />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("No response data available")).toBeInTheDocument();
  });

  it("should render standard view when response has results but no realtime events", () => {
    const request = {
      messages: [{ role: "user", content: "Test" }],
    };
    const response = {
      results: [{ type: "some.other.type" }],
      choices: [{ message: { role: "assistant", content: "Reply" } }],
    };

    render(<PrettyMessagesView request={request} response={response} />);
    expect(screen.getByText("Test")).toBeInTheDocument();
    expect(screen.getByText("Reply")).toBeInTheDocument();
  });
});
