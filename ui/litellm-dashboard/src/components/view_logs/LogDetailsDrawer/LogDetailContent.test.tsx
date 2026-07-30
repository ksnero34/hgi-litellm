import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18n";
import { languageStorageKey } from "@/i18n/resources";
import { renderWithProviders } from "../../../../tests/test-utils";
import { LogDetailContent } from "./LogDetailContent";
import type { LogEntry } from "../columns";

vi.mock("../GuardrailViewer/GuardrailViewer", () => ({
  default: ({ data }: { data: unknown }) => <div data-testid="guardrail-viewer">{JSON.stringify(data)}</div>,
}));

const createLogEntry = (overrides: Partial<LogEntry> = {}): LogEntry =>
  ({
    request_id: "chatcmpl-test-id",
    api_key: "api-key",
    team_id: "team-id",
    model: "gpt-4",
    model_id: "gpt-4",
    call_type: "chat",
    spend: 0,
    total_tokens: 10,
    prompt_tokens: 5,
    completion_tokens: 5,
    startTime: "2025-11-14T00:00:00Z",
    endTime: "2025-11-14T00:00:01Z",
    cache_hit: "miss",
    request_duration_ms: 1000,
    messages: [{ role: "user", content: "hello" }],
    response: { choices: [{ message: { content: "hi" } }] },
    metadata: { status: "success" },
    request_tags: {},
    custom_llm_provider: "openai",
    api_base: "https://api.example.com",
    ...overrides,
  }) as LogEntry;

describe("LogDetailContent", () => {
  beforeEach(() => {
    window.localStorage.setItem(languageStorageKey, "en");
    void i18n.changeLanguage("en");
  });

  it("should render the component successfully", () => {
    renderWithProviders(<LogDetailContent logEntry={createLogEntry()} />);

    expect(screen.getByText(i18n.t("observability.logs.request_details"))).toBeInTheDocument();
  });

  it("should display Request Details with model, provider, and call type", () => {
    renderWithProviders(
      <LogDetailContent
        logEntry={createLogEntry({
          model: "gpt-4o",
          custom_llm_provider: "anthropic",
          call_type: "completion",
        })}
      />,
    );

    expect(screen.getByText("gpt-4o")).toBeInTheDocument();
    expect(screen.getByText("anthropic")).toBeInTheDocument();
    expect(screen.getByText("completion")).toBeInTheDocument();
  });

  it("should display the virtual key alias and hash", () => {
    renderWithProviders(
      <LogDetailContent
        logEntry={createLogEntry({
          api_key: "fallback-key-hash",
          metadata: {
            status: "success",
            user_api_key: "key-hash",
            user_api_key_alias: "customer-key",
          },
        })}
      />,
    );

    expect(screen.getByText("customer-key")).toBeInTheDocument();
    expect(screen.getByText("key-hash")).toBeInTheDocument();
  });

  it("should display error alert when request has failed", () => {
    renderWithProviders(
      <LogDetailContent
        logEntry={createLogEntry({
          metadata: {
            status: "failure",
            error_information: {
              error_code: "rate_limit",
              error_message: "Too many requests",
              error_class: "RateLimitError",
            },
          },
        })}
      />,
    );

    expect(screen.getByText(i18n.t("observability.logs.request_failed"))).toBeInTheDocument();
    expect(screen.getByText("rate_limit")).toBeInTheDocument();
    expect(screen.getByText("Too many requests")).toBeInTheDocument();
  });

  it("should display tags section when request_tags has entries", () => {
    renderWithProviders(
      <LogDetailContent
        logEntry={createLogEntry({
          request_tags: { env: "prod", version: "1.0" },
        })}
      />,
    );

    expect(screen.getByText(i18n.t("observability.logs.tags"))).toBeInTheDocument();
    expect(screen.getByText("env: prod")).toBeInTheDocument();
    expect(screen.getByText("version: 1.0")).toBeInTheDocument();
  });

  it("should not display tags section when request_tags is empty", () => {
    renderWithProviders(<LogDetailContent logEntry={createLogEntry({ request_tags: {} })} />);

    expect(screen.queryByText(i18n.t("observability.logs.tags"))).not.toBeInTheDocument();
  });

  it("should display Metrics section with tokens and cost", () => {
    renderWithProviders(
      <LogDetailContent
        logEntry={createLogEntry({
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          spend: 0.002,
        })}
      />,
    );

    expect(screen.getByText(i18n.t("observability.logs.metrics"))).toBeInTheDocument();
    expect(screen.getAllByText("$0.00200000").length).toBeGreaterThanOrEqual(1);
  });

  it("should show Input Tokens and Output Tokens for anthropic_messages when uncached text_tokens exist", () => {
    renderWithProviders(
      <LogDetailContent
        logEntry={createLogEntry({
          call_type: "anthropic_messages",
          prompt_tokens: 34548,
          completion_tokens: 28,
          total_tokens: 34576,
          spend: 0.01107885,
          metadata: {
            status: "success",
            additional_usage_values: {
              prompt_tokens_details: { text_tokens: 3 },
              cache_read_input_tokens: 34462,
              cache_creation_input_tokens: 83,
            },
          },
        })}
      />,
    );

    expect(screen.getByText(i18n.t("observability.logs.input_tokens"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("observability.logs.output_tokens"))).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("28")).toBeInTheDocument();
    // Combined TokenFlow line should not appear (would include "prompt tokens")
    expect(screen.queryByText(/prompt tokens \+ .* completion tokens/)).not.toBeInTheDocument();
  });

  it("should display ConfigInfoMessage when no messages, response, or error and not loading", () => {
    renderWithProviders(
      <LogDetailContent
        logEntry={createLogEntry({
          messages: [],
          response: {},
          metadata: {},
        })}
      />,
    );

    expect(screen.getByText("Request/Response Data Not Available")).toBeInTheDocument();
  });

  it("should not display ConfigInfoMessage when isLoadingDetails is true even without data", () => {
    renderWithProviders(
      <LogDetailContent
        logEntry={createLogEntry({
          messages: [],
          response: {},
          metadata: {},
        })}
        isLoadingDetails={true}
      />,
    );

    expect(screen.queryByText("Request/Response Data Not Available")).not.toBeInTheDocument();
  });

  it("should display loading state when isLoadingDetails is true", () => {
    renderWithProviders(<LogDetailContent logEntry={createLogEntry()} isLoadingDetails={true} />);

    expect(screen.getByText(i18n.t("observability.logs.loading_request_response_data"))).toBeInTheDocument();
  });

  it("should display Request & Response section with Pretty and JSON view modes", () => {
    renderWithProviders(<LogDetailContent logEntry={createLogEntry()} />);

    expect(screen.getByText(i18n.t("observability.logs.request_response"))).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: i18n.t("observability.logs.pretty") })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: i18n.t("observability.logs.json") })).toBeInTheDocument();
  });

  it("should display Request and Response tabs when JSON view is selected", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LogDetailContent logEntry={createLogEntry()} />);

    await user.click(screen.getByText(i18n.t("observability.logs.json")));

    expect(screen.getByRole("tab", { name: i18n.t("observability.logs.request") })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: i18n.t("observability.logs.response") })).toBeInTheDocument();
  });

  it("should display response not available message when no response and Response tab is selected", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <LogDetailContent
        logEntry={createLogEntry({
          response: {},
          metadata: { status: "success" },
        })}
      />,
    );

    await user.click(screen.getByText(i18n.t("observability.logs.json")));
    await user.click(screen.getByRole("tab", { name: i18n.t("observability.logs.response") }));

    expect(screen.getByText(i18n.t("observability.logs.response_data_not_available"))).toBeInTheDocument();
  });

  it("should display Metadata section when metadata has keys", () => {
    renderWithProviders(
      <LogDetailContent
        logEntry={createLogEntry({
          metadata: { status: "success", custom_key: "value" },
        })}
      />,
    );

    expect(screen.getByText(i18n.t("observability.logs.metadata"))).toBeInTheDocument();
  });

  it("should display IP address when requester_ip_address is present", () => {
    renderWithProviders(
      <LogDetailContent
        logEntry={createLogEntry({
          requester_ip_address: "192.168.1.1",
        })}
      />,
    );

    expect(screen.getByText("192.168.1.1")).toBeInTheDocument();
  });

  it("should display guardrail label when guardrail data exists", () => {
    renderWithProviders(
      <LogDetailContent
        logEntry={createLogEntry({
          metadata: {
            status: "success",
            guardrail_information: {
              guardrail_name: "PII Filter",
              masked_entity_count: { PERSON: 2 },
            },
          },
        })}
      />,
    );

    expect(screen.getByText("PII Filter")).toBeInTheDocument();
    expect(screen.getByText(i18n.t("observability.logs.masked_count", { count: 2 }))).toBeInTheDocument();
  });

  it("should display cache hit information when cache_hit is true", () => {
    renderWithProviders(
      <LogDetailContent
        logEntry={createLogEntry({
          cache_hit: "true",
          metadata: {
            status: "success",
            additional_usage_values: {
              cache_read_input_tokens: 100,
              cache_creation_input_tokens: 0,
            },
          },
        })}
      />,
    );

    expect(screen.getByText(i18n.t("observability.logs.cache_hit"))).toBeInTheDocument();
    expect(screen.getByText("true")).toBeInTheDocument();
    expect(screen.getByText(i18n.t("observability.logs.cache_read_tokens"))).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("should display LiteLLM Overhead when litellm_overhead_time_ms is in metadata", () => {
    renderWithProviders(
      <LogDetailContent
        logEntry={createLogEntry({
          metadata: {
            status: "success",
            litellm_overhead_time_ms: 42.5,
          },
        })}
      />,
    );

    expect(screen.getByText(i18n.t("observability.logs.litellm_overhead"))).toBeInTheDocument();
    expect(screen.getByText("42.50 ms")).toBeInTheDocument();
  });

  it("should not display LiteLLM Overhead when litellm_overhead_time_ms is absent from metadata", () => {
    renderWithProviders(<LogDetailContent logEntry={createLogEntry({ metadata: { status: "success" } })} />);

    expect(screen.queryByText(i18n.t("observability.logs.litellm_overhead"))).not.toBeInTheDocument();
  });

  const retriesItem = () =>
    screen.getByText(i18n.t("observability.logs.retries")).closest(".ant-descriptions-item") as HTMLElement;

  it("should display attempted_retries / max_retries for Retries when attempted_retries > 0", () => {
    renderWithProviders(
      <LogDetailContent
        logEntry={createLogEntry({ metadata: { status: "success", attempted_retries: 2, max_retries: 3 } })}
      />,
    );

    expect(within(retriesItem()).getByText("2 / 3")).toBeInTheDocument();
  });

  it("should display a green 'None' tag for Retries when attempted_retries is 0", () => {
    renderWithProviders(
      <LogDetailContent logEntry={createLogEntry({ metadata: { status: "success", attempted_retries: 0 } })} />,
    );

    const noneTag = within(retriesItem()).getByText(i18n.t("observability.logs.none"));
    expect(noneTag.closest(".ant-tag")).toHaveClass("ant-tag-green");
  });

  it("should display '-' for Retries when attempted_retries is absent from metadata", () => {
    renderWithProviders(<LogDetailContent logEntry={createLogEntry({ metadata: { status: "success" } })} />);

    expect(within(retriesItem()).getByText("-")).toBeInTheDocument();
  });

  it("should display start and end time in ISO format", () => {
    renderWithProviders(
      <LogDetailContent
        logEntry={createLogEntry({
          startTime: "2025-11-14T12:00:00.000Z",
          endTime: "2025-11-14T12:00:01.500Z",
        })}
      />,
    );

    expect(screen.getByText(i18n.t("observability.logs.start_time"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("observability.logs.end_time"))).toBeInTheDocument();
    const dateElements = screen.getAllByText((content) => content.includes("2025-11-14"));
    expect(dateElements.length).toBeGreaterThanOrEqual(2);
  });

  it("should display Vector Store Requests when vector store data exists", () => {
    renderWithProviders(
      <LogDetailContent
        logEntry={createLogEntry({
          metadata: {
            status: "success",
            vector_store_request_metadata: [
              {
                query: "test query",
                vector_store_id: "vs-123",
                custom_llm_provider: "openai",
                start_time: 1700000000,
                end_time: 1700000001,
                vector_store_search_response: { data: [], search_query: "test" },
              },
            ],
          },
        })}
      />,
    );

    expect(screen.getByText("Vector Store Requests")).toBeInTheDocument();
  });

  it("should display provider as dash when custom_llm_provider is absent", () => {
    renderWithProviders(
      <LogDetailContent
        logEntry={createLogEntry({
          custom_llm_provider: undefined,
        })}
      />,
    );

    const descriptions = screen.getByText(i18n.t("observability.logs.provider")).closest(".ant-descriptions-item");
    expect(descriptions).toBeInTheDocument();
    expect(within(descriptions as HTMLElement).getByText("-")).toBeInTheDocument();
  });
});
