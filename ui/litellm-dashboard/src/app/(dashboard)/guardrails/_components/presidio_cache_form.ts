export const CACHE_ENABLED = "presidio_analysis_cache_enabled";
export const CACHE_TTL = "presidio_analysis_cache_ttl_seconds";
export const isPresidioCacheField = (name: string): boolean => name === CACHE_ENABLED || name === CACHE_TTL;

export const cacheFormValues = (params: Record<string, unknown>) => ({
  [CACHE_ENABLED]: typeof params[CACHE_ENABLED] === "boolean" ? params[CACHE_ENABLED] : null,
  [CACHE_TTL]: typeof params[CACHE_TTL] === "number" ? params[CACHE_TTL] : null,
});

export const cachePayload = (values: Record<string, unknown>, provider: string) =>
  provider === "presidio" ? cacheFormValues(values) : {};

export const validCacheTtl = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  value === "" ||
  (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 86400);
