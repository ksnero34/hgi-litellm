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

### 요청 상세의 캐시 표시

Logs 또는 Guardrails Monitor에서 요청을 열면 `Guardrails & Policy Compliance`의 각 평가 행에 분석 캐시 재사용 여부가 표시된다. 해당 입력의 모든 분석 구간을 캐시에서 읽으면 `Analysis cache hit (2/2)`, 일부만 읽으면 `Partial analysis cache hit (1/3)`처럼 표시한다. 괄호는 중복을 제외한 분석 구간 중 캐시에서 읽은 수와 전체 수다

이 배지는 검증을 통과한 로컬 메모리 또는 Redis 분석 결과를 실제로 읽은 경우에만 나타난다. 새 분석, 캐시 우회, 캐시 정보가 없는 이전 로그에는 적중 배지를 표시하지 않는다. 요청 내 중복 제거와 동시에 진행 중인 새 분석의 공유만으로 적중을 표시하지 않는다. 캐시 재사용 여부는 정책 판정과 별개이며 캐시 적중 이후에도 차단·마스킹·감사 처리는 유지된다

새 로그의 `guardrail_information[].analysis_cache`에 `status`, `hit_count`, `total_count`를 저장하며 요청 본문, 캐시 키와 비밀키는 포함하지 않는다. 기존 로그에는 소급 적용되지 않으며 새 이미지로 백엔드와 대시보드를 배포한 뒤 생성한 요청에서 확인할 수 있다

### 로그 마스킹과 긴 입력 처리 검증

병렬 검사 완료 순서에 따라 가역 치환 토큰을 재정렬할 때 `structured_messages`를 복제하면, Chat/Anthropic 통합 처리기가 원본 메시지를 새 구조로 오인하고 치환 결과의 반영을 건너뛸 수 있었다. 이제 이 참조는 유지하고 치환한 텍스트의 토큰만 정렬한다. 기존 요청 스냅샷 갱신과 비용 로그 저장까지 연결해 원문과 복원용 토큰 맵이 저장되지 않는지 검증한다. `logging_only`의 Chat/Responses 경로도 실제 요청은 유지하면서 로그용 스냅샷에 치환 결과를 반영한다

요청 상세의 타임라인과 평가 행은 각 입력의 정책 판정을 표시한다. 한 입력이 FLAGGED라고 같은 실행의 깨끗한 입력까지 FLAGGED로 표시하지 않으며, 실행 단위 집계는 상단 요약에서만 유지한다. 실제 요청 시각을 사용하고 추정으로 생성하던 1초 LLM 지연과 응답 시각은 제거했다

2026-09-06 로컬 `vmaca123/korean-pii-ner-v3` 분석기 검증에서 stride가 없으면 2,744자 입력 뒤쪽 이름을 놓쳤고, 앞뒤 이름 2개 중 앞쪽 1개만 찾았다. Presidio 서비스 환경에 `PRESIDIO_TRANSFORMER_NER_STRIDE=128`을 전달해 겹침 분할을 사용하자 동일 HTTP 검증에서 각각 1/1개와 2/2개를 탐지했다. 별도 동일 모델 검사에서는 4개 토큰 창으로 입력 끝까지 처리했고 이모지·CRLF 사례도 통과했다. Compose를 사용하면 이 변수를 서비스의 `environment`에 전달해야 한다

실제 로컬 분석기와 수정된 LiteLLM을 연결하고 2,048바이트 분석 구간을 사용한 추가 검증에서도 긴 입력의 이름과 ASCII 이메일이 모델 전달용 요청 및 저장용 요청에서 치환됐다. 동일 요청을 반복했을 때 평가 4개 모두 miss에서 hit로 바뀌었고 분석 호출 총수는 15회로 유지됐다. 합성 입력을 실제 NER/HTTP로 검사했으며 외부 LLM 호출은 포함하지 않는다

이 검증을 통과한 로컬 구성에만 검증 완료 플래그를 설정하고, 분석 버전은 모델·이미지·인식 규칙·stride 구성에 맞춰 갱신했다. 다른 배포에서는 해당 배포의 긴 입력 처리를 검증한 뒤 활성화해야 하며 모델이나 규칙을 바꾸면 분석 버전도 갱신해야 한다

### 차단 요청 로그와 상태 아이콘

타임라인과 평가 행에서 `PASSED`는 초록색 체크, `FLAGGED`는 주황색 경고, `BLOCKED`는 빨간색 X, `OBSERVED`는 보라색 정보 아이콘으로 표시한다. 탐지 후 마스킹하고 통과한 입력은 차단 아이콘을 사용하지 않는다

차단 원인이 된 개인정보는 예외를 발생시키기 전에 `<PERSON>` 같은 엔터티 치환자로 바꾸는 기존 처리를 유지한다. Chat, Anthropic Messages, Responses의 통합 검사에서 한 입력이 차단되더라도 다른 입력의 성공한 마스킹 결과를 요청 및 저장용 로그 스냅샷에 반영한다. 겹치는 입력은 긴 원문부터 치환해 앞선 치환이 뒤의 마스킹을 무효화하지 않도록 한다. 각 API의 비용 로그 직렬화 결과를 회귀 테스트로 검증한다

### Responses 이력과 스트리밍 출력

Responses의 `previous_response_id` 이력은 검사 전용 복사본으로 읽는다. 과거 메시지의 감사 결과를 현재 요청 로그에 보존하고 `conversation_history`로 표시하며, 모델에 전송할 때에는 기존 ID와 검사된 새 입력을 유지한다. 과거 메시지를 새 입력에 덧붙이지 않는다. 기존 이력 조회 실패와 차단 정책은 유지하며 제공자에 저장된 이력을 자동으로 수정하거나 재전송하지 않는다

Guardrails의 Presidio 생성·수정 화면에서 **스트리밍 출력 검사**를 선택할 수 있다. `presidio_streaming_output_mode`는 `off`, `windowed`, `full_buffer` 중 하나이며 기존 설정의 기본값은 `windowed`다. 이 설정은 출력 검사 콜백이 활성화된 스트리밍 응답에만 적용되며 입력 검사, 비스트리밍 출력 검사, 개인정보 치환 토큰 복원 설정을 변경하지 않는다

- `off`: 스트리밍 출력 검사를 생략한다
- `windowed`: 새 텍스트를 모아 제한된 크기의 문맥 창으로 검사하고, 아직 검사에 필요한 경계 부분은 보류한다. 전송 지점은 치환 후 문자열의 길이가 아니라 원문 위치로 관리한다
- `full_buffer`: 출력을 모아 검사·마스킹한 뒤 전달한다. 검사 완료 전에는 응답 본문을 전달하지 않아 첫 출력이 늦어진다

출력 검사는 새 응답을 요청 간 분석 캐시에 저장하는 데 의존하지 않는다. 같은 스트림의 완료 이벤트에는 검증된 마스킹 결과를 재사용하고 남은 부분만 검사한다. 도구 인자는 완성된 JSON 단위로 검사한다. 구간별 검사는 뒤에 생성될 전체 문맥을 볼 수 없으므로 전체 응답 검사와 같은 탐지 결과를 보장하지 않는다. 이미 전달된 부분을 회수할 수 없으며, 분석 창에서 안전하게 진행할 수 없거나 처리 상한을 넘으면 원문을 내보내지 않고 오류로 종료한다

새 로그의 `shared_analysis`는 공통 분석의 시작·종료 시각을 기록한다. 요청 상세에서는 이 구간을 한 번만 표시하고 개별 검사 시간과 구분한다. 측정된 가드레일 시간은 겹치는 구간을 합쳐 계산하므로 병렬 실행을 중복 합산하지 않는다. 시간 정보가 없는 과거 로그의 분석 시간은 복원하지 않으며, 검사 완료보다 이른 응답 종료 시각은 유효한 경과 시간으로 표시하지 않는다
