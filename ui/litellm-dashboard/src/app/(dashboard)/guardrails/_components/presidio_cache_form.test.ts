import { STREAMING_OUTPUT, streamingMode, streamingPayload } from "./PresidioStreamingOutput";
import { describe, expect, it } from "vitest";
import { CACHE_ENABLED, CACHE_TTL, cacheFormValues, cachePayload, validCacheTtl } from "./presidio_cache_form";

describe("Presidio cache form persistence", () => {
  it("hydrates and saves explicit disabled without treating it as missing", () => {
    const saved = { [CACHE_ENABLED]: false, [CACHE_TTL]: 25 };
    expect(cachePayload(cacheFormValues(saved), "presidio")).toEqual(saved);
  });
  it("sends null when an existing override is cleared", () => {
    expect(cachePayload({ [CACHE_ENABLED]: null, [CACHE_TTL]: null }, "presidio")).toEqual({
      [CACHE_ENABLED]: null,
      [CACHE_TTL]: null,
    });
    expect(cacheFormValues({})).toEqual({ [CACHE_ENABLED]: null, [CACHE_TTL]: null });
  });
  it("does not save stale Presidio fields for other providers", () => {
    expect(cachePayload({ [CACHE_ENABLED]: true, [CACHE_TTL]: 25 }, "bedrock")).toEqual({});
  });
  it.each([null, undefined, "", 1, 86400])("accepts inherited or bounded TTL %s", (value) => {
    expect(validCacheTtl(value)).toBe(true);
  });
  it.each([0, -1, 86401, 1.5, Number.NaN, "300"])("rejects invalid TTL %s", (value) => {
    expect(validCacheTtl(value)).toBe(false);
  });
});

it("defaults absent streaming settings and excludes them from other providers", () => {
  expect(streamingMode(undefined)).toBe("windowed");
  expect(streamingPayload({ [STREAMING_OUTPUT]: "full_buffer" }, "presidio")).toEqual({
    [STREAMING_OUTPUT]: "full_buffer",
  });
  expect(streamingPayload({ [STREAMING_OUTPUT]: "off" }, "bedrock")).toEqual({});
});
