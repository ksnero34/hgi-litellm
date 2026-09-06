# Presidio 분석 캐시 구현·검증 보고서

## 1. 발견한 checkout과 기존 동작

작업 디렉터리는 `/home/min/hgi-litellm`, 시작 브랜치는 `hgi-v1.99.1`, SHA는 `575b709d9b494eb33571aea809ca252ee08116ef`였다. 사용자 제공 과거 SHA와 동일했고 `git status --short` 출력은 비어 있었다. reset, 운영 배포, 외부 push, 운영 Redis 데이터 삭제, 운영 secret 변경은 수행하지 않았다

기존 `_get_session_iterator`는 주 스레드의 `_session_lock` 내부에서 yield하여 HTTP를 직렬화했다. Native pre-call과 unified apply는 각각 semaphore를 만들었다. Responses history는 별도 요청 dictionary를 사용하고 instructions·현재 입력과 별도로 apply를 호출했다. Native는 `metadata.guardrail_config`를 읽고 unified는 `presidio_config=None`을 사용했다. 이 설정 차이는 유지했으며 dynamic body 병합 후 실제 분석 payload를 캐시 식별에 사용한다

Redis는 기존 `ProxyLogging.internal_usage_cache.dual_cache.redis_cache`와 native `DualCache.redis_cache`를 재사용한다. `helm/litellm/values.yaml`의 coordination Redis 설정을 발견했지만 실제 운영 Pod·Redis topology·Presidio 배포에 접속하지 않았다

## 2. 수정 파일과 동작

- `litellm/proxy/guardrails/guardrail_hooks/presidio.py`: 분석 일괄 준비, 요청 범위 dedupe 통합, bounded fragment 실행, deadline, 결과별 정책·마스킹·감사 유지, 취소 전파, 원문 포함 가능 debug/error body 제거
- `presidio_analysis_cache.py`: HMAC-SHA256 키, 인증 tenant 격리, TTL·최소 allowlist 스키마·offset 검증, Redis GET/SET EX pipeline, 같은 이벤트 루프의 single-flight와 취소 정리, 요청·분석·캐시 계측
- `presidio_analysis_context.py`와 `litellm/proxy/utils.py`: 인증된 `UserAPIKeyAuth.team_id`로 전체 pre-call 컨텍스트 생성, 여러 apply/복사된 history dictionary 공유, 종료 시 결과·pending·tenant·Redis 참조 정리
- `presidio_http.py`: loop별 session lease, 진행 중 세션 retirement, process 전체 HTTP 동시성·대기열·timeout·계측
- 기존 `test_presidio.py`와 새 cache/context/integration/http 시험 파일: 합성 데이터 기반 회귀시험
- `scripts/presidio_cache_benchmark.py`: 실제 격리 Redis 및 localhost HTTP 분석 서버 측정
- `ruff-strict-budget.json`, `type-discipline-budget.json`, `basedpyright-code-budget.json`: 저장소 지침에 따라 이번 변경에서 제거한 위반만큼 허용치 감소. 허용치를 올리지 않았다

캐시 hit에도 현재 threshold/BLOCK, anonymize, token/source map, 순서 정규화, 복원 조건과 fragment 감사가 실행된다. Prefetch 실패도 fragment별 실패 감사를 기록한다. 서로 다른 apply 호출의 분석·마스킹 HTTP를 합산한 요청 상한과 process 상한을 함께 적용한다. 원문을 다른 문자열로 교체하는 dynamic analyzer `text` override는 offset 안전성을 위해 거부한다

## 3. 설정·secret·운영 전제

[운영 설정 문서](presidio-analysis-cache.md)에 전체 변수·보안·용량·배포 검증 조건을 기록했다

공유 캐시는 기본 off다. 활성화하려면 `PRESIDIO_ANALYSIS_CACHE_ENABLED=true`, `PRESIDIO_ANALYSIS_CACHE_COMPLETE_ANALYSIS_VERIFIED=true`, 최소 32-byte HMAC secret, key version, analysis version, 기존 Redis client가 필요하다. Secret은 기존 `get_secret` 주입을 사용한다. 인증 tenant가 없거나 캐시 설정이 불완전하면 캐시를 우회하고 직접 분석한다. 후속 요청으로 Redis 미설정 시에는 제한된 로컬 메모리 backend를 추가했으며, 설정된 Redis의 연결 장애는 직접 분석으로 처리한다

기본값은 TTL 300초, 항목 64KiB, Redis pipeline timeout 0.2초, pre-call deadline 30초, guardrail 동시성 4, 전체 proxy pre-call scope의 합산 HTTP 상한 4, process HTTP 상한 16·대기열 64·HTTP timeout 10초다. 요청 분석은 최대 4096 fragment, Redis 준비 배치는 최대 128개로 제한한다. 여러 worker인 Pod의 상한은 worker 수와 process 설정의 곱이므로 Pod 예산에 맞춰 배분해야 한다

HMAC 키는 Redis 값 암호화나 값 무결성 인증을 제공하지 않는다. 위조된 빈 결과를 쓸 수 있는 Redis writer는 검사 우회 권한을 가진다. 내부망·ACL·TLS·메모리 상한·eviction·TTL·persistence·backup 보존 정책을 검토해야 한다

## 4. 실행한 시험과 정적 검사

전체 회귀 묶음 명령:

```bash
.venv/bin/python -m pytest \
  tests/test_litellm/proxy/guardrails/guardrail_hooks/test_presidio.py \
  tests/test_litellm/proxy/guardrails/guardrail_hooks/test_presidio_union_fix.py \
  tests/test_presidio_latency.py \
  tests/test_litellm/proxy/guardrails/guardrail_hooks/test_presidio_analysis_cache.py \
  tests/test_litellm/proxy/guardrails/guardrail_hooks/test_presidio_analysis_context.py \
  tests/test_litellm/proxy/guardrails/guardrail_hooks/test_presidio_analysis_integration.py \
  tests/test_litellm/proxy/guardrails/guardrail_hooks/test_presidio_http.py \
  tests/test_litellm/llms/openai/responses/test_openai_responses_guardrail_handler.py \
  tests/test_litellm/proxy/guardrails/guardrail_hooks/unified_guardrails/test_unified_guardrail.py \
  tests/test_litellm/proxy/utils/proxy_logging/test_pre_call_hook.py \
  tests/test_litellm/proxy/utils/proxy_logging/test_guardrail_pipeline.py \
  -q --disable-warnings
```

**최종 회귀시험: 360 passed, 1 warning, 101.86초.** 경고는 기존 FastAPI/Starlette 의존성 deprecation이다. 기존 fail-open/부분 성공 기대를 fail-closed 계약으로 수정했다. 모든 텍스트는 합성 데이터다. 모델 API 또는 실제 NER 서비스는 호출하지 않았다

새 HTTP 시험은 `check_pii` stub이 아닌 실제 `ClientSession`과 localhost 서버를 사용한다. 다른 thread/event loop의 공통 상한, 세션 close 경합, queue/deadline/cancellation을 포함한다. Cache 집중시험의 Redis는 메모리 합성 구현이며, Redis 손상·TTL·장애·single-flight 검증과 실제 Redis 측정은 구분한다. Unified Responses의 실제 변환 경로에서 history/instructions/current 입력이 인증 컨텍스트를 공유하는 시험도 포함한다

정적 검사 명령:

```bash
make check
make lint-budget-update LINT_BASE=HEAD
uv run --no-sync python scripts/ruff_strict_gate.py --base HEAD
uv run --no-sync python scripts/type_discipline_gate.py --base HEAD
uv run --no-sync python scripts/type_check_gate.py --base HEAD
```

추가로 수정 production 파일의 Ruff check/format, 새·수정 시험의 `ruff-tests.toml` 검사, Python compileall과 `git diff --check`를 실행했다. `--base HEAD`는 시작 checkout 대비 이번 작업의 증가분을 검사하며, 전체 코드가 타입 진단 0개라는 의미는 아니다. 최종 strict Ruff, LIT, Basedpyright 세 예산 게이트는 모두 `--base HEAD`로 통과했다

초기 `make check`는 staging 대비 브랜치 전체를 검사하여 실패했다. 당시 발견한 이번 Python 변경의 위반은 수정했다. 수정하지 않은 `ui/litellm-dashboard/src/app/(dashboard)/guardrails/_components/guardrail_info.tsx`에도 `max-lines` 위반 1개(842/800)가 있으며 전체 `make check` 성공으로 보고하지 않는다. 전체 기록은 이 checkout의 `.git/pre_commit_lint.log`에 남아 있다

## 5. 실제 측정과 합성 검증의 구분

```bash
LITELLM_LOCAL_MODEL_COST_MAP=True PYTHONPATH=. .venv/bin/python \
  scripts/presidio_cache_benchmark.py \
  --redis-server /home/min/.asdf/installs/redis/7.0.14/bin/redis-server \
  --output /tmp/presidio-cache-benchmark-release.json
```

Redis 7.0.14는 이 호스트에서 발견한 실행 파일이다. 다른 호스트에서는 해당 binary를 다시 발견해야 한다. 시험은 자체 임시 포트·디렉터리의 Redis만 시작하고 종료한다

각 모드 20요청, 고유 fragment 8개·위치 16개·동일 컨텍스트 추가 8개, 요청 동시성 1·분석 동시성 4, 합성 analyzer 대기 20ms 조건이다. 실제 Redis와 HTTP socket을 사용하지만 analyzer는 합성이다. Warm은 독립 engine/guardrail 인스턴스로 다른 Pod의 저장소 재사용을 모사한다. 실제 다중 Pod 네트워크 시험이나 실제 NER 지연/정확도 측정은 아니다

| 조건 | p50 ms | p95 ms | 실제 analyze HTTP 호출 |
| --- | ---: | ---: | ---: |
| Cold | 43.013 | 45.086 | 160 |
| Warm, independent instance | 0.553 | 0.696 | 0 |
| Redis process stopped | 42.801 | 43.630 | 160 |

[최종 측정 JSON](presidio-analysis-cache-benchmark.json)에 실제 Redis INFO 버전 7.0.14와 조건·counter를 함께 기록했다.

이 측정은 분석 orchestration 시간이다. LLM 왕복이나 전체 마스킹·복원 지연 개선 배율로 해석하지 않는다

## 6. 미검증 항목과 활성화 전 조건

실제 Presidio 서버·Korean NER/tokenizer 구현과 실행 환경을 발견하지 못했다. 따라서 실제 max_length/truncation/overflow/stride, 긴 입력 말미·청크 경계 PII, overlap 병합, 원문 offset 복원은 미검증이다. 이전 모델 revision과 tokenizer metadata만으로 운영 truncation을 128이라고 단정하지 않았다

운영 활성화 전에 불변 모델·recognizer·regex·정책 버전을 확정하고 긴 입력 전체 검사 및 offset 시험을 통과해야 한다. 서버가 조용히 자르는 성공 응답은 클라이언트 스키마 검증만으로 판별할 수 없다. Redis Cluster/Sentinel의 실제 ACL·TLS·failover·routing 시험과 부하·메모리 검증도 필요하다

Single-flight는 같은 이벤트 루프에서 공유한다. 여러 loop/process/Pod 사이 진행 중 miss는 중복될 수 있으며, 완료된 결과는 Redis로 공유한다. 분산 lock과 Redis 앞단의 로컬 L1은 추가하지 않았다. 후속 요청에 따라 Redis 미설정 시 사용할 별도의 인스턴스 로컬 TTL 캐시를 추가했다. 계측은 민감 label 없는 메모리 counter·시간 합계이고 Prometheus/OTel exporter나 운영 percentile histogram은 추가하지 않았다

## 7. Rollback

`PRESIDIO_ANALYSIS_CACHE_ENABLED=false`로 바꾸고 모든 worker를 재시작/설정 재로드한다. 기존 cache key는 TTL 만료에 맡긴다. Redis flush나 secret 변경은 필요하지 않다. bounded HTTP와 fail-closed 설정은 유지한다. 코드 전체를 되돌리면 과거 session 직렬화도 돌아오므로 캐시 문제는 기능 플래그 rollback을 우선한다

## 8. HTTP batch·NER batch 후속

현재는 miss마다 기존 단일 object `/analyze` 요청을 보낸다. 배열 요청이나 fragment 문자열 결합은 하지 않았다. HTTP batch는 배포 서버 API 지원을 확인한 뒤 miss만 보내고 fragment별 결과·오류·offset·deadline을 보존해야 한다. 실제 NER tensor batching은 padding, attention mask, overflow/stride, 원문 offset, overlap, GPU/CPU 메모리와 공정한 admission을 별도로 구현·검증해야 한다


## 후속 요청: Redis 없는 개발환경

Redis 미설정 시 요청 사이의 분석 결과를 로컬 메모리에서 재사용하도록 확장했다. 기본 상한은 인스턴스당 1024항목·직렬화 값 16MiB이고 공통 TTL은 300초다. 운영 Redis가 설정되면 그 클라이언트를 우선 사용한다. 기존 활성화·인증 tenant·HMAC·분석 완전성 검증 조건을 유지한다

실행 명령과 정책은 [운영 문서의 Redis-free development verification](presidio-analysis-cache.md#redis-free-development-verification)에 기록했다. 실제 로컬 HTTP 분석·마스킹 및 guardrail 복원·감사를 사용했으며, Redis 프로세스/연결과 실제 NER는 사용하지 않았다. 합성 분석 대기 20ms, 요청별 동일 fragment 2개, TTL 1초로 검증했다

후속 회귀시험: **198 passed, 1 warning, 43.43초**. 캐시 집중시험 41개를 포함한다. 수정 코드와 시험의 Ruff check/format은 통과했다

| Redis 없는 조건 | 요청 수 | 분석 HTTP 호출 | p50 / p95 ms |
| --- | ---: | ---: | ---: |
| Cold | 20 | 20 | 21.597 / 22.835 |
| Warm | 20 | 0 | 0.641 / 0.769 |

TTL 만료 뒤 추가 분석은 1회였고, 총 41요청의 82개 fragment에 대해 마스킹·복원·감사를 검증했다. [원본 로컬 측정 JSON](presidio-local-cache-validation.json)에 Redis 미설정·프로세스 미기동 조건을 기록했다

격리된 실제 Redis 경로도 재실행하여 cold 160회, 독립 인스턴스 warm 0회, Redis 종료 장애 160회 분석을 재확인했다. 로컬 fallback이 설정된 Redis의 동작을 바꾸지 않았다
