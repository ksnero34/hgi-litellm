# Presidio shared analysis cache operations

The initial checkout was clean on `hgi-v1.99.1`, commit `575b709d9b494eb33571aea809ca252ee08116ef`, matching the historical review reference. This work preserves the Presidio analyzer, Korean NER, regex recognizers, placeholder offsets, per-request token/source maps and fragment audit processing. Shared caching is opt-in and must remain disabled until the analyzer completeness gates below pass

## Deployment findings and activation gates

The repository contains the LiteLLM client and Helm coordination Redis configuration (`helm/litellm/values.yaml`). It does not establish the running Presidio server image, tokenizer loading options or Korean recognizer implementation. No production analyzer was queried during this validation. The previously supplied `vmaca123/korean-pii-ner-v3` revision `ebee0847b166f16041bffc9e1521d895d360d02e` is historical input, not a verified currently deployed revision

Before enabling shared results, record the analyzer image digest, model revision, tokenizer revision and loading arguments, regex/recognizer revision, server threshold/context/allow-list defaults and analysis policy version. Use one immutable analysis version identifying that combination. All pods sharing a version must target identical analyzer behavior; a rolling analyzer upgrade must use a new version before serving requests. Merely restarting pods does not invalidate Redis results

Validate actual `max_length`, `truncation`, `return_overflowing_tokens`, `stride` and tokenizer offset units against the deployed server. Historical metadata (`model_max_length=512`, serialized tokenizer truncation=128 and stride=0) cannot establish runtime truncation. Synthetic tests must place Korean and ASCII PII near the start, after 128 and 512 tokens, at the end of longer text, and across every chunk boundary. Assert overlap duplicates are merged without losing distinct entities and offsets map back to the original Unicode string, including emoji, CRLF, repeated spaces and combining characters. Compare whole-text coverage with the chunks actually processed. A syntactically valid response cannot prove full coverage; silently truncated empty or partial output must never be accepted as a complete cache entry. Fix or reject oversized requests server-side until completeness is demonstrated

Cache failure must continue through bounded direct inspection. Analyzer failure must reject the request before any internal or external LLM receives original PII. Keep `unreachable_fallback: fail_closed`; do not enable logging-only behavior as an enforcement substitute

## Redis security and capacity

Use the existing coordination Redis client/configuration, including its standalone, Sentinel or Cluster topology and secret resolution. Helm supports `general_settings.coordination_redis` and `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` fallback; gateway secrets can be injected through `gateway.envSecrets` or Kubernetes secret references in `gateway.extraEnv`. Resolve the HMAC secret through the existing `get_secret` mechanism and provision the same random server secret and version to every participating pod. Never put a literal production secret in a checked-in configuration or logs

Treat analysis spans, entity types and scores as sensitive metadata. Restrict Redis to the private network, require TLS with verified server identity and an ACL limited to the cache key prefix and required read/write commands. Restrict write permission to trusted analyzer-calling gateway processes. A writer who can forge an empty entity array can cause a cache-based inspection bypass. The HMAC cache key hides plaintext identifiers and makes guessing keys harder; it does not encrypt Redis values or authenticate their integrity. If the Redis write trust boundary includes untrusted writers or administrators, do not enable this cache until authenticated values with a separately managed integrity secret are implemented

Every cache write has a finite TTL. Configure a bounded `maxmemory`, monitor used memory, hit ratio, evictions and rejected writes, and choose eviction appropriate to the dedicated cache (for example `allkeys-lru`). Avoid placing an eviction-heavy analysis workload in a coordination Redis instance whose rate-limit/spend state must remain durable: use a separately capacity-managed supported coordination store or account for that shared-store risk before enabling. Set a conservative maximum entry size. Empty detections are valid entries; errors and malformed results are misses. Cache values must contain only schema version, analysis version and entity start/end/type/score, never original text, restoration maps, masked text or analyzer explanation/debug metadata

Choose persistence, snapshots, replicas, backup retention and deletion policy explicitly. TTL expiration in the live database does not remove already-created backups. Encrypt retained storage and backups, restrict backup readers and avoid public Redis endpoints. Rotate HMAC secrets by changing both secret and key version; let the old namespace expire without deleting unrelated Redis data

## Concurrency and failure behavior

`PRESIDIO_HTTP_MAX_CONCURRENCY` defaults to 16 active analyzer/anonymizer requests per Python process, `PRESIDIO_HTTP_MAX_QUEUE` to 64 waiting operations, and `PRESIDIO_HTTP_TIMEOUT_SECONDS` to 10 seconds. HTTP session ownership is per event loop; locks cover lookup and lease bookkeeping, and session retirement waits for active leases. Requests do not hold the session lock while performing HTTP. The full proxy pre-call scope currently has an aggregate HTTP cap of four; each guardrail can impose a lower `presidio_max_parallel_requests` cap. Both analyze and anonymize count against these shared limits across apply calls. Raising only a guardrail setting does not raise the parent scope cap; direct SDK scopes use their explicitly supplied cap

The process limit is shared across guardrail instances and event loops. A pod running multiple worker processes can issue up to the configured limit multiplied by worker count; choose `gateway.numWorkers: 1` for one literal pod cap or divide the budget between workers. Multiple pods still require analyzer-side admission/rate limits. Account for all other clients of the shared analyzer. Queue exhaustion and deadline expiration must fail closed and must not trigger unbounded retry

Redis lookup/storage errors bypass cache and preserve the same queue/concurrency/deadline bounds. A successful direct analysis remains usable when cache storage fails. Cache hits still pass through current thresholds, BLOCK policy, masking, token ordering, write-back and fragment audit paths. Cache does not contain message positions or per-request restoration state

## Rollback and follow-up

Set the guardrail cache setting to disabled, or restore server inheritance and disable the server cache flag, then restart/reload all participating gateway workers. A guardrail explicitly enabled in the GUI overrides the server enabled default; changing that default alone does not disable an explicit per-guardrail override. Existing keys expire by TTL; do not flush Redis or rotate secrets to roll back. Preserve the bounded HTTP execution and fail-closed setting. Reverting this patch restores the earlier serialized shared-session behavior and removes these performance protections, so prefer the feature flag for operational cache rollback

HTTP batch requests and model tensor batching are separate follow-ups. Current clients must continue sending one analyzer payload object per HTTP request; never concatenate fragments and never send arrays without a verified server API. A future HTTP batch endpoint should receive only cache misses, retain individual offsets/errors and enforce maximum batch size and deadlines. Actual NER tensor batching requires the deployed model server to batch compatible tokenized chunks with attention masks, padding limits, overflow/stride correctness, per-input offset restoration, fair admission and measured GPU/CPU memory behavior. Measure end-to-end latency and full-text detection equivalence independently of HTTP request-count reduction

## Configuration reference

Enable caching through the Presidio GUI setting or the inherited `PRESIDIO_ANALYSIS_CACHE_ENABLED=true` default only after the preceding gates pass, and explicitly attest them server-side with `PRESIDIO_ANALYSIS_CACHE_COMPLETE_ANALYSIS_VERIFIED=true`. Without a guardrail override the enabled default remains `false`; the completeness flag also defaults to `false`. With no configured Redis client, enabled caching uses a bounded instance-local memory store. Untrusted/absent authenticated tenant, missing secret or invalid cache configuration bypass result caching; no public fallback tenant is used

| Variable | Default | Purpose |
| --- | --- | --- |
| `PRESIDIO_ANALYSIS_CACHE_HMAC_SECRET` | unset | At least 32 UTF-8 bytes from existing secret injection; generate strong random material |
| `PRESIDIO_ANALYSIS_CACHE_KEY_VERSION` | unset | Nonsecret namespace for key rotation |
| `PRESIDIO_ANALYSIS_CACHE_ANALYSIS_VERSION` | unset | Immutable model, recognizer, regex, policy and analyzer behavior version |
| `PRESIDIO_ANALYSIS_CACHE_TTL_SECONDS` | `300` | TTL applied to every stored analysis |
| `PRESIDIO_ANALYSIS_CACHE_MAX_ENTRY_BYTES` | `65536` | Maximum serialized cache entry size |
| `PRESIDIO_ANALYSIS_CACHE_LOCAL_MAX_ENTRIES` | `1024` | Maximum entries per local backend instance |
| `PRESIDIO_ANALYSIS_CACHE_LOCAL_MAX_BYTES` | `16777216` | Maximum serialized value bytes per local backend instance |
| `PRESIDIO_ANALYSIS_CACHE_REDIS_TIMEOUT_SECONDS` | `0.2` | Bound each Redis pipeline operation |
| `PRESIDIO_PRE_CALL_TIMEOUT_SECONDS` | `30` | Shared request inspection budget, including cache, queue and analysis |
| `presidio_max_parallel_requests` | `4` | Guardrail configuration: concurrency shared across that request's apply calls |

Key version and analysis version accept 1–128 ASCII letters, digits, underscore, dot and hyphen. The key includes an HMAC-derived tenant namespace, never the plaintext tenant identifier. Deterministic JSON serialization preserves the exact effective analyzer payload, including text after existing placeholder processing and dynamic analysis options. No additional whitespace or Unicode normalization is applied. Native per-request `guardrail_config` and unified configuration behavior remain separate; only the payload actually sent determines analysis identity

Reads use a bounded nontransactional pipeline of individual GET operations; writes use pipelined SET with EX. This permits a Cluster-aware Redis client to route independent keys without cross-slot MGET or a global hash tag. A deployed Redis Cluster/Sentinel integration must still pass its own TLS, ACL, routing and failover tests before activation. Request dedupe state is temporary and cleared at request scope exit. Single-flight shares in-flight analysis between instances on the same event loop; separate event loops and worker processes may perform duplicate misses, while Redis shares completed results across all of them. There is no local L1 in front of configured Redis and no Redis distributed lock. When Redis is unconfigured, a separate bounded local backend retains results between requests on that guardrail instance; other instances/processes/Pods do not share those completed local results

Per-engine counters expose `cache_hit`, `cache_miss`, `cache_error`, `cache_invalid`, `cache_oversize`, `request_dedupe`, `analyze_calls`, `singleflight_shared`, `timeout`, `fallback` and `fail_closed` when those events occur. Timing accumulators expose operation counts and total elapsed seconds for Redis, queue, analyzer and analysis orchestration work. `guardrail_total` includes preparation, queueing, masking and write-back for each guardrail invocation; the deadline is shared across all pre-call invocations. `presidio_http.HTTP_METRICS.snapshot()` provides process-wide queue/HTTP duration sums and counts, queue rejection/timeout and HTTP cancellation/error counters. These contain no tenant, digest or text labels. They are process-memory instrumentation, not a newly registered Prometheus exporter or percentile histogram; wire a bounded-label telemetry adapter into the existing monitoring stack before relying on cluster-wide dashboards. The benchmark computes percentiles from external wall-clock samples

## Executed isolated integration measurement

Run from the repository root with the project's installed Python dependencies and a working Redis binary:

```bash
LITELLM_LOCAL_MODEL_COST_MAP=True PYTHONPATH=. .venv/bin/python scripts/presidio_cache_benchmark.py --redis-server /path/to/redis-server --repetitions 20 --output /tmp/presidio-cache-benchmark.json
```

The script starts its own Redis on a temporary localhost port with persistence disabled, plus an aiohttp analyzer on another localhost port. It deletes keys only inside that freshly created isolated Redis. It stops its Redis process to measure real connection-failure fallback and cleans up processes/sessions on exit. It does not call any production Redis, deployed analyzer or LLM

Executed with Redis 7.0.14 and aiohttp 3.14.3. Each of 20 requests per mode uses eight unique synthetic Korean/emoji/CRLF fragments at sixteen positions, followed by another eight-fragment analysis call sharing the same request context. Request concurrency is one, fragment analysis concurrency four, and each synthetic HTTP response sleeps 20 ms. Cold mode clears only this isolated Redis before each request. Warm mode uses a second independent AnalysisCache and guardrail instance sharing Redis. This models cross-pod result storage reuse in one process, not actual multi-pod networking

| Mode | Request p50 ms | Request p95 ms | Actual analyze HTTP calls | Maximum concurrent HTTP |
| --- | ---: | ---: | ---: | ---: |
| Cold | 43.013 | 45.086 | 160 | 4 |
| Warm, independent instance | 0.553 | 0.696 | 0 | 0 |
| Redis process stopped | 42.801 | 43.630 | 160 | 4 |

The script asserts cross-instance hits, bounded HTTP parallelism, request dedupe across repeated analysis calls, preserved Unicode offsets, finite TTLs, allowlisted stored fields, absence of plaintext tenant/text in stored keys/values, and request-context cleanup. Real sockets and Redis are exercised, while the analyzer is synthetic. These timings measure cache/HTTP orchestration only and are not measurements of Korean NER latency, recall, tensor batching, real deployment p95 or LLM masking/restoration. The separate regression suite covers guardrail policy/write-back paths; production NER completeness, topology failover, capacity and telemetry export remain activation gates


Full execution details and commands: [validation report](presidio-analysis-cache-validation.md). Final raw measurements: [benchmark JSON](presidio-analysis-cache-benchmark.json)


## Redis-free development verification

When caching is enabled and its authentication/HMAC/version/completeness prerequisites are met, an absent Redis client automatically selects local memory. This supersedes the initial implementation's request-only memoization when Redis was missing. `AnalysisCache.backend` reports the instance default backend; a Redis client supplied by the active request takes precedence. An unavailable configured Redis continues to bypass cache and inspect directly, so an Azure Redis outage never silently switches to local results

Local values use the same allowlisted JSON schema, validation, HMAC keys and TTL as Redis. Storage uses a thread lock, monotonic expiry and FIFO eviction, bounded by both entry count and serialized value bytes. The byte limit excludes Python object/key overhead, which is separately constrained by entry count; plan memory across all configured guardrail instances and workers. Only analysis metadata persists. Request token/source maps and plaintext do not enter this store. Restarting or replacing the guardrail instance drops its local cache

The main cache and completeness flags remain off by default. A development request still needs a trusted authenticated team; client metadata cannot provide one. Use the following synthetic verification without configuring or starting Redis, HMAC environment secrets, an LLM, or a real NER service:

```bash
LITELLM_LOCAL_MODEL_COST_MAP=True PYTHONPATH=. .venv/bin/python scripts/presidio_cache_benchmark.py --local --output /tmp/presidio-local-cache-validation.json
```

This command supplies synthetic test credentials/version/completeness settings in memory and runs actual localhost analyzer/anonymizer HTTP endpoints through the guardrail. It verifies repeated requests, duplicate fragments, masking/restoration/audit equivalence and real TTL expiry. Those synthetic settings do not verify or enable the deployed Korean NER. See [local results](presidio-local-cache-validation.json)


## Presidio GUI 설정

Guardrails에서 Presidio 가드레일을 생성하거나 선택하여 수정하면 분석 결과 캐시 설정을 볼 수 있다. 모드는 `서버 기본값 사용`, `사용`, `사용 안 함`이다. `서버 기본값 사용`은 `PRESIDIO_ANALYSIS_CACHE_ENABLED`를 상속하고, 나머지 두 선택은 해당 가드레일에만 명시적으로 적용한다. TTL은 1–86400초 범위이며 빈 값은 서버의 `PRESIDIO_ANALYSIS_CACHE_TTL_SECONDS`를 상속한다. 기존 가드레일은 새 필드가 없어도 이전 환경설정 동작을 유지한다.

저장되는 필드는 `litellm_params.presidio_analysis_cache_enabled`와 `litellm_params.presidio_analysis_cache_ttl_seconds`다. `null`은 서버 설정 상속을 뜻한다. 변경값은 저장·재조회와 런타임 갱신에 반영된다. 런타임에서 캐시 엔진을 교체하므로 로컬 메모리 결과는 초기화된다. 기존 Redis 항목의 남은 TTL은 변경하지 않으며 새로 저장되는 항목부터 변경된 TTL을 사용한다.

화면에는 서버 기본값과 캐시 준비 여부를 표시한다. 준비되지 않았다면 분석기 완전성 미검증, HMAC 비밀키 또는 키·분석 버전 누락/오류 등을 고정된 사유로 표시한다. 비밀키 값은 UI/API 응답에 포함하지 않으며 비밀키, 버전과 분석기 검증 확인은 기존 서버 secret/env 주입으로 관리한다. GUI에서 사용을 선택해도 서버 안전 조건이 부족하면 캐시는 우회하고 Presidio 직접 검사를 계속한다.

준비 여부는 UI 설정 API를 처리한 worker의 구성 상태이며 실제 cache hit, Redis 연결 성공, 모든 Pod의 일치 여부를 보장하지 않는다. 요청에 신뢰할 수 있는 인증 team이 없으면 캐시를 우회한다. Redis 미설정은 준비 실패 사유가 아니며 이 경우 로컬 메모리를 사용한다. Redis가 설정되어 있으면 Redis를 사용하고, Redis 장애 때는 직접 분석한다. 현재 hit/miss 카운터는 내부 메모리 계측이므로 이 화면의 설정 상태와 구분한다.

UI에서 끄거나 상속으로 되돌리는 경우에도 마스킹, 정책, 감사와 fail-closed 동작은 유지한다. 실제 분석기 검증 없이 GUI 활성화만으로 긴 입력 전체 검사 성공을 가정하지 않는다.


### GUI 변경 검증

관련 backend 4개 파일 시험은 305 passed(67.97초), UI 5개 파일은 28 passed였다. 실제 localhost HTTP 시험은 같은 합성 입력을 두 번씩 보냈을 때 GUI와 동일한 `사용` 설정에서 분석1회, `사용 안 함`으로 변경 후 추가2회, 서버 기본값 상속으로 다시 사용한 뒤 추가1회를 확인했다. 여섯 요청 모두 마스킹·감사 처리는 유지됐다. 생성 API의 명시값 저장, 편집의 null 상속 복귀, 취소 후 원래 값 복원, 다른 provider로 전환 시 Presidio 필드 제외도 시험했다.

```bash
LITELLM_LOCAL_MODEL_COST_MAP=True .venv/bin/python -m pytest -q \
  tests/test_litellm/proxy/guardrails/guardrail_hooks/test_presidio_analysis_cache.py \
  tests/test_litellm/proxy/guardrails/guardrail_hooks/test_presidio.py \
  tests/test_litellm/proxy/guardrails/guardrail_hooks/test_presidio_analysis_integration.py \
  tests/test_litellm/proxy/guardrails/test_guardrail_endpoints.py
```

Node 24.14.1 production build와 TypeScript 검사 및 정적 페이지 생성도 통과했다. API snapshot과 TypeScript API 타입은 backend에서 재생성했다. 실제 운영 Redis/NER/IdP 또는 AKS 배포 시험은 아니다. 실행 중인 기존 컨테이너에는 새 소스의 GUI가 자동으로 반영되지 않으므로 기존 배포 절차에 따라 새 이미지를 빌드해야 한다.

현재 브랜치 HEAD 대비 strict Ruff, LIT 타입 규율, basedpyright 및 테스트 품질 게이트를 확인했다. 이는 기존 코드 전체의 타입 오류가 0이라는 의미가 아니라 이번 변경이 해당 기준을 악화시키지 않았다는 의미다. 필수 budget 갱신 명령은 상한을 높이지 않았으며 이번 변경에서 감축 대상은 0건이었다. 설정 입력 검증의 타입 경계를 명확히 한 후 캐시 단위시험 51건을 재실행해 통과했다. 입력·출력·복원·감사 callback 초기화도 SDK 내부 mock 없이 실제 등록된 인스턴스로 검증한다.

최종 실제 callback 등록 시험으로 변경한 후 Presidio·HTTP 전체 169건과 생성·편집 UI API 연결 2건을 재실행해 통과했다. Dashboard 전체 ESLint 및 budget도 통과했으며 inline-object 상한은 기존 559를 유지했다. 예산 파일, suppression과 운영 설정은 변경하지 않았다.
