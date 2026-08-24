# HGI LiteLLM v1.93.0 -> v1.94.0 커스터마이징 감사

## 1. 목적과 결론

이 문서는 `hgi-v1.93.0`의 HGI 커스터마이징을 정확한 OSS 기준점과 비교해 목록화하고, 각 기능이
`hgi-v1.94.0`에서 직접 이식, 재구현, 부분 구현, 누락, 회귀, 업스트림 등가, 의도적 제거 또는 신규 기능 중
어느 상태인지 실제 호출 경로, API, UI, 타입, Prisma 스키마, 마이그레이션과 테스트를 근거로 판정한다.

전체 결론은 다음과 같다.

- 1.93의 주요 기능은 1.94에 대부분 재구현되었고, 단순 cherry-pick이 아니라 새 업스트림 구조에 맞춰
  합치거나 나눈 커밋으로 이식되었다. patch-id가 완전히 같은 커밋은 없다.
- 1.94는 1.93보다 SSO 부서/조직 동기화, logging-only guardrail 감사, 캐시 만료 처리에서 더 엄격하다.
- 개인 키 게이트웨이, 조직 UI, 서비스 키 정책, `sub` 별칭 동기화와 비활성 팀 키 필터는 1.94 신규 기능이다.
- 감사 중 발견한 배포 및 유지보수 경계 결함은 Compose의 1.94 HGI 태그 갱신, customization manifest 보완,
  인증·키 관리 회귀 수정과 회귀 테스트로 조치했다. 일반 `/key/generate`의 user-owned key 차단은 별도
  personal-key gateway를 강제하는 의도된 1.94 정책이며 호환성 변경으로 명시한다.
- 스키마 변경은 additive하게 설계되었지만 실제 안정 버전 이미지로의 rollback, 실제 마이그레이션 실행,
  생성 Prisma client 호환성은 아직 증명되지 않았다.

## 2. 기준점, 계보와 신뢰도

| 대상 | 정확한 기준 | 판정 근거 | 신뢰도 |
|---|---|---|---|
| HGI 1.93 OSS 기준 | `v1.93.0` / `052b5a2169d8d3082e1d66e69f200a72b0c1e274` | 첫 HGI 커밋 `968a17f091`의 직접 부모, 태그와 release ref 일치 | 높음 |
| HGI 1.94 커스터마이징 기준 | `38f2e023f1179d06a199f3d5f02702c89c1a8a58` | `customizations/manifest.json.base_ref`, 첫 HGI 커밋 `b5ff5f7518`의 직접 부모 | 높음 |
| 1.94 rc 계보 기준 | `v1.94.0-rc.3` / `13fef68b12dbf8dc5e4b6f89401c8ac3158802a1` | HGI 브랜치와 rc.3의 merge-base | 높음, 단 커스텀 diff 기준으로 사용하면 안 됨 |

`38f2e023`에는 rc.3 이후의 업스트림 first-parent merge 8개가 포함된다. 따라서
`13fef68b..hgi-v1.94.0` 전체를 HGI 변경으로 계산하면 업스트림 변경을 HGI 기능으로 잘못 분류한다. 본 감사는
1.93은 `052b5a21..hgi-v1.93.0`, 1.94는 `38f2e023..hgi-v1.94.0`을 사용했다.

1.93에는 기준점 이후 HGI 커밋 34개, 1.94에는 기준점 이후 HGI 커밋 45개가 있다. `git cherry`와 안정적인
patch-id 비교에서는 정확히 같은 패치가 0개였다. 이는 누락의 증거가 아니라 업스트림 파일 이동과 커밋
통합/분할을 반영한 결과이므로 기능별 호출 경로로 재판정했다.

## 3. 버전별 기능 인벤토리

표의 OSS/HGI 열은 기능이 기준 OSS에 원래 있었는지와 HGI가 추가한 의미를 함께 표시한다.

| 기능 | 버전 | 주요 커밋 | 핵심 파일/호출 경로 | OSS/HGI 및 의도 | 테스트 근거 | 위험 |
|---|---|---|---|---|---|---|
| 폐쇄망 배포 및 Enterprise 배포물 제거 | 1.93 | `968a17f091`, `d0b3191`, `7eee2bb`, `c33213e` | `Dockerfile`, `docker-compose.yml`, `docker/Dockerfile.non_root`, `enterprise/` 삭제 | HGI; OSS 코드만으로 내부 게이트웨이 배포 | `test_dockerfile_non_root.py` | 이미지 태그와 실제 코드 불일치 가능 |
| 폐쇄망 배포 및 라이선스 경계 | 1.94 | `b5ff5f7518` | 위 파일 및 `pyproject.toml`, `uv.lock` | 재구현; Enterprise wheel/tree 미포함 | 동일 계열 테스트 | Compose tag 수정 완료, immutable digest 검증 필요 |
| OAuth2 및 UI SSO 라이선스 해제 | 1.93 | `968a17f091`, `41514f81b5` | `user_api_key_auth.py` -> `Oauth2Handler.check_oauth2_token`; `ui_sso.py` -> `customizations/sso.py` | HGI; premium gate와 무료 SSO 사용자 수 제한 제거 | OAuth2 무라이선스, SSO 사용자 수 테스트 | raw bearer debug logging |
| OIDC discovery/설정 | 1.93 | `b554f54344`, `18c6aa1dd6` 일부 | `customizations/oidc.py`; DB/env fallback, discovery, 명시 endpoint override | HGI; 커밋 제목과 실제 내용 불일치 | `test_oidc.py`, proxy setting 테스트 | SSRF/다운로드 제한 미흡 |
| OIDC/SSO | 1.94 | `b89c88424a`, `90c9e79905`, `74af1518b8` | `oidc.py`는 1.93과 동등; `ui_sso.py`, `sso_team_sync.py` | 재구현 및 강화; `sub`를 `user_alias`로 동기화 | OIDC, UI SSO, team sync 테스트 | unsigned claim 보조 추출 |
| SSO 팀 동기화 | 1.93 | `ecde1e1d39` | configurable `team_ids_jwt_field`; ID/alias 또는 hash 팀 생성; metadata 기반 managed team 교체 | HGI; 복수 팀 허용, 수동 팀 보존, org 미연결 | `test_sso_team_sync.py` | 실패가 nonblocking, 빈 claim이 managed 팀 제거 |
| SSO 부서/조직 동기화 | 1.94 | `b89c88424a`, `90c9e79905` | userinfo/access-token claim -> 정확히 한 부서 -> Human Organization/budget -> team/user/org membership -> audit -> 개인 키 재지정/캐시 무효화 | 재구현 및 강화 | claim, 조직, 동시 로그인, 누락 claim 테스트 | 다중 claim/cross-org alias 실제 통합 테스트 부족 |
| 가상 키 72시간 회전과 chain | 1.93 | `a17e101476`, `ea6cd9ee14` | `/key/{key}/regenerate`; deprecated token chain 유지 | HGI | rotation manager/e2e/endpoint/UI 테스트 | deprecated row 쓰기 실패 시 grace 상실 |
| 가상 키 정책/회전 | 1.94 | `7542c9b350` | `key_management_endpoints.py`, `KeyLifecycleSettings`, `RegenerateKeyModal` | 재구현 | 대응 backend/UI 테스트 | 일반 키 생성 호환성 회귀는 별도 신규 정책에서 발생 |
| 개인 키 게이트웨이 | 1.94 신규 | `377dfa73ee` 및 `895be3f9c4`~`3c1a6ee560` | `POST/GET/DELETE /internal/personal-key`, `POST /internal/personal-key/rotate`; `personal_key_endpoints.py`; `CorporatePersonalKeyRegistry`; UI `PersonalKeyDashboard` | HGI 신규; owner/team/org/model/MCP/expiry를 서버가 파생 | endpoint, policy, rotation integration, UI 테스트 | generic API 호환성, cache 실패, 상태 의미 문제 |
| 서비스 계정 키 | 1.94 신규 | `377dfa73ee`, `13c646202d` | `/key/service-account/generate`; team 필수, `user_id=None`, `key_type=llm_api`, service metadata | HGI 신규 정책 | key endpoint와 personal policy 테스트 | mutable metadata로 quota 분류 우회 가능 |
| 비활성/만료/삭제 키 표시 | 1.94 신규 | `c6919b4c61` | `/key/list` -> `_build_key_filter_conditions(active_only=...)` | HGI; 일반 팀 사용자의 비활성 키 숨김 | explicit `team_id` 테스트 | aggregate `include_team_keys` 경로는 부분 구현 |
| 모델 응답시간/TTFT 집계 | 1.93 | `329efe01a1`, `457210e95c` 일부 | spend writer -> daily tables -> common daily activity API -> `activity_metrics.tsx` | HGI | DB writer, activity endpoint/UI tests | 세 스키마/마이그레이션 불일치 위험 |
| 모델 응답시간/TTFT 집계 | 1.94 | `65a68781f0`, `708eda1360` | 위 경로, generated `schema.d.ts` 포함 | 재구현 | 대응 backend/UI tests | 실제 대용량/upgrade migration 검증 필요 |
| 정책 결정 저장과 usage | 1.93 | `1d4366a542` | policy resolution -> `_guardrail_policy_map` -> logging -> `LiteLLM_SpendLogPolicyIndex` -> `/guardrails/usage/*` | HGI; OSS 정책 관측성 | policy/versioning/usage/spend tests | logging-only 비동기 결과와 attribution 결함 |
| 키/팀 guardrail 및 policy OSS 허용 | 1.94 | `7542c9b350`, `efd6c4f45d` | `move_guardrails_to_metadata` -> key/team metadata -> `CustomGuardrail`; team endpoints metadata | 재구현/확장; project premium 경계는 유지 | pre-call, team endpoint tests | 1.93 팀 guardrail은 실제로 license-gated였음 |
| Presidio 사용자 PII label/번호 variant | 1.93 | `db183e8469`, `1a5d4f8ae2` | `pii_configuration.tsx`; Presidio entity base/number matching | HGI | UI 및 Presidio tests | 겹치는 prefix의 insertion-order 모호성 |
| Presidio input origin/scoped token/output 순서 | 1.93 | `2eb553692b`, `8adc9d3407`, `1757a08ff9`, `104e7ffa9b`, `33151121de` | Chat/Responses translation -> source metadata -> Presidio -> log viewer | HGI | handler/Presidio/viewer tests | Chat/Responses 외 API source 미지원 |
| Presidio governance/audit | 1.94 | `da8d8d8d7c` | 동일 의미를 새 구조에 재구현 | 재구현 | backend/UI tests | Responses streaming output source 누락 |
| logging-only guardrail 감사 | 1.93 | `ecde1e1d39` 일부, `bea0a2025f` | initializer -> logging callback -> Presidio -> standard logging -> spend usage/UI | HGI | deferred logging 및 viewer tests | 선택/attribution/비동기 저장/표시 다수 결함 |
| logging-only guardrail 감사 | 1.94 | `be47b4d8aa`~`c7c7da5973` | registry, custom logger, spend writer, monitor/viewer 전체 | 재구현 및 수정 | 관련 backend/UI regression tests | manifest에 후기 파일 다수 미등록 |
| Microsoft Purview 노출 | 1.93 | `1d4366a542` 일부 | upstream backend + HGI config model/garden/telemetry | HGI는 UI/설정/관측 노출 | `test_microsoft_purview.py` | secret 값은 reference 사용을 운영에서 강제해야 함 |
| Microsoft Purview 노출 | 1.94 | `a1e79949ed` | generic guardrail create/list/info/update 및 provider-specific UI params | 재구현 | backend 및 dashboard wiring tests | 전용 endpoint는 없음; generic 경로 사용 |
| Responses API 로그/PII 관측성 | 1.93 | `fd6c90a6c3`, `0868c056db`, `d8e1afcee0` | Responses guardrail handler; `LogDetailsDrawer`, pretty utils, localized status | HGI | Responses handler/pretty-view tests | streaming source 일부 누락 |
| Responses API 로그/PII 관측성 | 1.94 | `9992ca9888`, `da8d8d8d7c` | UI/i18n과 backend가 두 그룹으로 분할 | 재구현 | generated types 및 UI tests | 없음이 아니라 커밋 분할에 주의 |
| 소유한 spend log 상세 접근 | 1.93 | `7bccb0d04d` | spend detail route authorization | HGI | route/detail tests | ownership 판정 변화 위험 |
| 소유한 spend log 상세 접근 | 1.94 | `f887f26359` | 같은 의도를 새 경로에 적용 | 직접 이식에 가까운 재구현 | 대응 tests | 낮음 |
| Prisma v2/migration job 안정화 | 1.93 | `31a0bca801`, `c52bc8b80b`, `7eee2bbd38` 일부 | `prisma_migration.py`, proxy CLI, Helm migration job | HGI | CLI/migration/Helm tests | 실제 DB upgrade 미검증 |
| Prisma v2/migration job 안정화 | 1.94 | `f2483c1b00` | 새 업스트림에 재구현 | 재구현 | 대응 tests | 실제 DB 및 stock rollback 검증 필요 |
| 대시보드 i18n/폐쇄망 UI | 1.93 | `db62d823f8`, `eded7af590`, `3ac8c0e273`, `ac69efa96b` | `I18nProvider`, en/ko resources, leftnav 및 기능 화면 | HGI | resource parity와 component tests | 광범위한 파일 소유 |
| 대시보드 i18n/폐쇄망 UI | 1.94 | `09a0723703`, `9992ca9888`, `d2f4529a31`, `e2113cbada`, `f90953efd1` | App Router/MCP 이동 반영, team UI 추가 | 재구현/확장 | i18n 및 component tests | manifest 경로 최신화 필요 |
| customization 동기화 도구 | 1.93 | `41514f81b5` | `customizations/`, `scripts/hgi/sync_upstream.py`, `tests/hgi` | HGI 유지보수 | sync tool tests | manifest 정확성에 의존 |
| customization 동기화 도구 | 1.94 | `d6921dafcf`, `0f562e4c39`, `783142184c` | base SHA 기록, 경로 갱신 | 직접 이식 | sync tests | 현재 실제 `check` 실패 |

## 4. 1.93 -> 1.94 마이그레이션 상태

| 기능군 | 상태 | 판정 |
|---|---|---|
| 폐쇄망/Enterprise 제거/비-root 이미지 | 재구현, 배포 설정 수정 | 코드 경계를 유지하고 Compose를 HGI 1.94 태그로 갱신; registry digest는 별도 검증 필요 |
| OAuth2/UI SSO 무라이선스 | 재구현 | premium gate 및 사용자 수 제한 제거 유지 |
| OIDC discovery/명시 endpoint | 직접 이식 | `oidc.py` 의미 동일 |
| SSO team sync | 재구현/강화 | 복수 팀에서 정확히 한 부서와 Human Organization 모델로 변경 |
| `sub` identity provenance | 신규 | `sub`를 `user_alias`로 저장하며 LiteLLM `user_id`는 바꾸지 않음 |
| 가상 키 72h rotation chain | 재구현 | ancestor retarget과 cache 제약 포함 |
| 일반 사용자/team key 발급 | 의도적 정책 변경 | `/key/generate`의 user-owned key 발급을 차단하고 `/internal/personal-key`로 일원화; 명시적 403 회귀 테스트 고정 |
| 개인/서비스 키 | 신규 | 별도 endpoint, registry, UI, 정책 추가 |
| 조직 한도 | upstream 기능 활용 + 신규 연결 | 개인/서비스 키가 team/org를 상속; 실제 부하/한도 통합 검증은 미완료 |
| key/team guardrail OSS | 재구현/수정 | 1.93의 team license gate를 1.94에서 수정 |
| policy 결정 저장 | 재구현/강화 | 후기 logging-only 수정 포함 |
| Presidio PII label/origin/token | 재구현 | 주요 의미 유지, API surface coverage는 부분적 |
| Presidio logging-only 감사 | 재구현/다수 결함 수정 | 1.93 구현을 그대로 이식하지 않고 의미 상태를 복구 |
| Purview UI/config | 재구현 | upstream backend 위 HGI 노출 유지 |
| Responses pretty/audit | 재구현 | UI와 backend 커밋이 분리됨 |
| 모델 성능 metrics | 재구현 | DB/API/type/UI/test 연결 확인 |
| spend-log 상세 권한 | 직접 이식에 가까운 재구현 | 소유자 접근 유지 |
| Prisma v2/Helm migration | 재구현 | 정적 테스트 존재, 실제 DB 검증 필요 |
| 대시보드 i18n/MCP clipboard | 재구현 | MCP App Router 경로 이동 후 clipboard 동작 유지 |
| custom Responses routing override | 의도적 제거 | 1.93 최종 커밋 `1daaa15`에서 이미 제거, 1.94는 upstream routing 사용 |
| customization manifest | 수정 완료 | 후기 신규 기능, 감사·rollback 도구와 수정 경로를 소유 그룹에 등록하고 `check`로 검증 |

## 5. 수용 기준 판정

| 수용 기준 | 결과 | 근거/남은 작업 |
|---|---|---|
| 1.93의 모든 발견 가능한 HGI 기능 목록화 | 충족 | 34개 커밋을 기능군과 실제 파일 diff로 분류 |
| 1.94에서 각 1.93 기능 상태 판정 | 충족 | 위 migration table; patch-id 대신 실제 경로 사용 |
| 정확한 OSS 기준 사용 | 충족 | 1.93 `052b5a21`, 1.94 `38f2e023`; rc.3와 구분 |
| SSO `orgnm/sub/team` provenance 추적 | 충족 | configurable claim, userinfo/access-token fallback, `sub` alias, org sync 경로 확인 |
| org 한도 및 개인/admin/service key lifecycle 추적 | 부분 충족 | 코드 경로 확인; 실제 Redis/DB/조직 한도 e2e는 미실행 |
| generic endpoint bypass와 cache 추적 | 부분 충족 | session marker, generic key 차단, expiry-bounded cache 확인; 실패/다중 worker 실증 필요 |
| inactive/deleted/blocked/expired UI/API 가시성 | 부분 충족 | 상태별 query 확인; aggregate team key 경로 결함 존재 |
| MCP permission과 clipboard | 충족, 보안 e2e 미실행 | managed personal key의 team MCP 상속 및 relocated clipboard 코드 확인 |
| key/team guardrail 및 OSS/Enterprise 경계 | 충족 | team OSS fix와 project premium 유지 확인 |
| API/UI/type/Prisma 통합 | 정적 기준 충족 | personal OpenAPI generated types와 3개 Prisma schema 확인 |
| 테스트 및 빌드 | 정적·회귀 범위 충족 | 통합 변경 경로 658개, guardrail/Presidio/deferred 237개, dashboard production build 통과; 실제 DB/Redis e2e는 미실행 |
| rollback 가능성 입증 | 미충족 | 안정 이미지 tag/digest와 실제 schema clone 검증 필요 |

## 6. 스키마, generated artifact와 라이선스 경계

1.94는 `CorporatePersonalKeyRegistry`를 root `schema.prisma`, `litellm/proxy/schema.prisma`,
`litellm-proxy-extras/litellm_proxy_extras/schema.prisma`에 동일하게 추가하고
`20260725010000_corporate_personal_key_registry/migration.sql`을 제공한다. core table의 FK나 trigger를 추가하지 않아
stock OSS가 이 독립 테이블을 무시할 수 있도록 설계했다. 성능 metrics column과
`LiteLLM_SpendLogPolicyIndex`도 세 스키마 및 migration과 함께 관리된다.

대시보드 generated `ui/litellm-dashboard/src/lib/http/schema.d.ts`에는 다음 항목이 확인된다.

- `/internal/personal-key`, `/internal/personal-key/rotate`, `/internal/personal-key/metrics`
- `PersonalKeyCreateRequest`, `PersonalKeyCreateResponse`, `PersonalKeyRotateResponse`, `PersonalKeyView`
- 평균 response time과 TTFT 필드
- SSO `user_alias`, `sso_user_id` 필드

그러나 현재 호환성 테스트는 migration SQL이 additive인지 문자열 수준에서 확인할 뿐 실제 migration deploy,
Prisma client generate, 세 스키마의 의미 parity, 기존 데이터가 있는 DB upgrade를 수행하지 않는다. generated
schema는 patch로 옮기지 않고 대상 upstream에서 재생성해야 한다.

`enterprise/` 배포물과 wheel은 제거되어 있고 HGI 기능은 `litellm/`, `ui/`, root MIT 경계 안에 구현되어 있다.
조직/guardrail의 upstream OSS endpoint를 활용하며 Enterprise 구현을 import하거나 복사하는 경로는 발견하지
못했다. 다만 OSS로 허용한 key/team guardrail/policy 필드의 목록과 project premium 경계를 regression test로 계속
고정해야 한다.

## 7. 확인된 결함과 조치 상태

상태는 최종 검증 결과를 기준으로 하며, 외부 환경이 필요한 검증은 구현 완료와 분리해 명시한다.

| 우선순위 | 결함 | 영향 | 상태/권고 |
|---|---|---|---|
| P0 | `docker-compose.yml`이 `hgi-v1.93.0.1` 이미지 참조 | build 없이 실행하면 1.94 코드가 아닌 구버전 배포 | 수정 완료; repository-evidenced `hgi-v1.94.0.2`로 갱신. immutable registry digest는 미입증이므로 운영 전 확인 필수 |
| P0 | customization manifest에 후기 변경 53개 경로 미등록 | 다음 upstream sync가 개인 키/guardrail/org/team 변경을 유실할 수 있음 | 수정 완료; 최종 customization 경로를 그룹에 등록하고 manifest check 통과 |
| P1 | `/key/generate`가 user-owned key를 거부 | 1.93 internal/user-owned key 발급 integration에 403 호환성 변경 | 의도된 정책으로 확정; `/internal/personal-key`를 강제하며 non-admin과 admin user-owned 요청의 명시적 403 테스트 추가 |
| P1 | personal key 생성이 같은 사용자의 모든 active non-UI key를 차단 | 수동/team/service key까지 예고 없이 폐기되어 서비스 장애 가능 | 수정 완료; HGI managed personal-key metadata 또는 stale registry lineage만 차단하고 unrelated key 보존 테스트 추가 |
| P1 | service 분류가 덮어쓸 수 있는 metadata에만 의존 | `/key/update`로 distributed quota 강제 해제 가능 | 수정 완료; server-owned `personal_key` service marker 보존 및 regression test 추가 |
| P1 | OAuth2 debug log에 raw bearer와 introspection 응답 기록 | 자격 증명 유출 | 수정 완료; token/응답 대신 validation 성공 여부만 기록하고 로그 redaction 테스트 추가 |
| P1 | OIDC discovery가 HTTP/private/loopback을 허용 | SSRF와 내부 endpoint 접근 | 미수정 위험 수용 필요; 폐쇄망/private IdP 호환성 때문에 일괄 차단하지 않았으며 HTTPS/host allowlist·redirect/size 정책을 배포 threat model에서 결정해야 함 |
| P1 | equivalent SSO 부서 claim을 source별 raw 값으로 중복 판정 | `Sales`와 ` sales `가 같은 부서인데도 로그인 거부 | 수정 완료; deterministic team ID와 같은 whitespace/case canonicalization 후 exactly-one 판정 |
| P1 | MCP access group grant가 명시적 team ceiling 밖 server를 union | team 제한을 우회해 key 권한 확대 | 수정 완료; team ceiling이 있으면 access-group 결과를 교집합으로 제한, teamless/all-proxy 동작 보존 |
| P1 | generic rotate에서 deprecated row 저장 실패를 삼킴 | 성공 응답에도 72h grace가 즉시 사라짐 | 수정 완료; deprecated-key 저장 실패를 호출자에게 전파하고 failure-path test 추가 |
| P1 | personal cache invalidation 실패를 best-effort로 처리 | DB commit 뒤 실패를 응답 오류로 바꾸면 안전하지 않은 재시도를 유발; 반대로 stale auth 가능 | 설계 유지; 오류 로그는 남기되 운영 계측·retry와 Redis multi-worker fault test는 후속 필요 |
| P2 | inactive team key filter가 explicit `team_id`에만 적용 | aggregate UI에서 blocked/expired service key 노출 | 수정 완료; non-admin `include_team_keys` 전체 경로에 active-only filter 적용 |
| P2 | personal delete가 blocked live row로 남고 registry만 삭제 | personal GET은 404, admin inventory는 deleted가 아닌 blocked | 검토 중; 상태 계약을 정하고 UI/API/test 일치 |
| P2 | `grace_keys` metrics가 모든 deprecated key를 집계 | personal metric이 virtual/service rotation까지 포함 | 검토 중; personal metadata/registry로 범위 제한 |
| P2 | registry의 blocked 상태가 쓰이지 않음 | schema 상태와 실제 lifecycle 불일치 | 검토 중; 상태 제거 또는 일관된 전이 구현 |
| P2 | unsigned access-token/Microsoft `sub` 보조 추출 | 팀/별칭 claim provenance가 별도로 검증되지 않음 | threat model 검토 중; 검증된 claims source 우선 사용 |
| P2 | Presidio origin은 Chat/Responses에 집중 | 다른 API surface와 Responses streaming source 정보 누락 | 후속 구현 필요 |
| P3 | 과거 custom range의 `proxy_track_cost_callback.py` CRLF가 diff-check에서 whitespace로 보임 | 전체 파일 개행 변환 시 무관한 대형 diff 발생 | 현 diff에는 포함하지 않음; working diff-check는 통과하며 개행 정리는 별도 기계적 커밋으로 분리 권고 |

정정 사항: generic key delete가 local cache만 삭제한다는 초기 의심은 확인 결과 사실이 아니다.
`UserApiKeyCache.delete_cache()`는 `DualCache.delete_cache()`를 통해 in-memory와 Redis 삭제를 호출한다. 다만
각 pod의 in-memory cache 전파는 pub/sub 유무에 좌우되므로 multi-worker 검증 항목은 남는다.

## 8. rollback 및 stock OSS 호환성

정적 구조와 운영 도구 기준으로 stock rollback은 조건부 가능하지만, 운영 가능한 이미지/DB 조합은 아직
입증되지 않았다. `CorporatePersonalKeyRegistry`와 HGI 통계 테이블은 additive하고 core table FK/trigger를
추가하지 않으므로 stock OSS가 독립 테이블을 무시할 수 있다. 반면 key/team metadata의 HGI guardrail 값,
`allow_team_guardrail_config`, active `microsoft_purview`와 이를 참조하는 production policy는 명시적 처리 없이
rollback하면 의미 손실 또는 기동 후 정책 차이를 만들 수 있다.

`scripts/hgi/rollback_guardrail_metadata.py`는 다음 안전 계약을 구현한다.

- `inspect`, `cleanup`, `restore`를 제공하고 mutation은 명시적 `--apply`에서만 수행한다.
- live schema와 적용 migration을 preflight하며 restore도 backup header가 아니라 대상 DB를 다시 확인한다.
- key metadata의 `disable_global_guardrails`, `guardrails`, `policies`, team의 동일 필드와
  `opted_out_global_guardrails`, `allow_team_guardrail_config`만 대상으로 한다.
- active `microsoft_purview` 또는 이를 add/remove/pipeline에서 참조하는 production policy가 있으면 cleanup을
  hard-block하며 override를 제공하지 않는다.
- apply 전에 allowlist subset backup을 mode `0600`으로 쓰고 flush/fsync한다. 표준 출력은 count, field name,
  SHA-256 축약 식별자만 표시하며 metadata 값이나 raw key 식별자를 출력하지 않는다.
- cleanup과 restore는 diff 기반이며 반복 실행 시 no-op이다. backup은 복구에 필요한 hashed token/team id와
  allowlist 값만 포함하므로 보안 저장소에서 제한적으로 보관해야 한다.

`customizations/runbooks/hgi_guardrail_rollback.md`는 production clone에서 inspect -> dry-run -> backup/apply ->
stock digest 기동 -> HGI digest 복귀/restore를 먼저 검증하도록 한다. repository에서 확인되는 HGI tag는
`docker.litellm.ai/berriai/litellm:hgi-v1.94.0.2`지만 tag는 immutable하지 않고 registry digest 및 stable stock
1.94 image provenance를 로컬 이력이나 제공된 tar metadata만으로 증명할 수 없다. 따라서 실제 pull/digest 대조,
PostgreSQL clone migration/startup, Redis multi-worker 검증 전에는 rollback readiness를 `조건부/미입증`으로
유지한다. 운영 DB cleanup, 운영 Redis flush, image 교체는 수행하지 않았다.

## 9. 테스트 및 빌드 결과

실행으로 확인한 결과는 다음과 같다.

- 변경된 OAuth2, SSO, MCP, key-management, personal-key 통합 회귀: 658 passed, 2 warnings
- guardrail, Presidio, deferred logging 관련 suite: 237 passed, 1 warning
- rollback/manifest 등 `tests/hgi`: 21 passed
- 초기 SSO/personal focused baseline: 54 passed
- `python scripts/hgi/sync_upstream.py check`: 통과
- `git diff --check`: 통과
- dashboard `npm run build`: TypeScript 검사와 50개 static route를 포함해 통과

남은 외부 통합 검증은 실제 PostgreSQL clone의 HGI upgrade/stock startup/HGI restore, Redis 최소 2-worker에서
login·rotate·delete·grace·SSO 이동 cache invalidation, 실제 OIDC/Purview provider, 그리고 승인된 registry digest로
health/version을 확인하는 것이다. 이 항목들은 로컬 mock/static 테스트 결과로 성공을 주장하지 않는다.

## 10. 불확실성과 부정적 발견

- 1.94 정식 `v1.94.0` tag가 아니라 post-rc.3 commit `38f2e023`이 HGI 기준이다. 문서에서 단순히
  “v1.94.0에서 분기”라고만 표현하면 재현성이 부족하다.
- commit subject만으로 기능을 분류할 수 없다. 특히 `b554f54344 feat: ttft average show`는 실제로 OIDC
  discovery와 SSO UI/API 변경을 포함한다.
- exact patch-id 일치가 0개이므로 “동일 커밋 cherry-pick”이라고 주장할 근거가 없다.
- 1.93의 team guardrail은 UI/metadata가 있어도 backend premium check가 남아 완전한 OSS 기능이 아니었다.
- 1.93 logging-only 감사 구현은 선택, attribution, callback 등록, 비동기 persistence, label, raw-log 보존과
  monitor 표시에서 여러 결함이 있었으므로 1.93 패치를 그대로 복원해서는 안 된다.
- Purview HGI 변경은 새 backend 자체가 아니라 upstream backend의 dashboard/config/telemetry 노출이 중심이다.
- 개인 키 migration의 additive 설계만으로 stock rollback 성공을 단정할 수 없다.
- 안정 rollback image tag/digest, 실제 registry 접근 가능성, 실제 migration result가 아직 제공되지 않았다.
- 테스트 파일 존재는 runtime 성공의 증거가 아니다. 위에 기록한 회귀 suite와 dashboard build는 통과했지만
  실제 DB, Redis, registry 및 외부 provider 동작을 대신하지 않는다.
- OIDC/Purview/provider를 실제 외부 서비스와 호출한 증거가 없어 네트워크, secret, issuer, Graph API 동작은
  정적 감사 범위 밖이다.

## 11. v1.95.0 업스트림 통합

`hgi-v1.95.0`은 upstream `release/v1.95.0`의
`72a4a55f43ea7266de589f005d0d33624fe5d555`를 새 기준점으로 사용했다. 1.94 HGI 변경을 기능 그룹별로
재적용했으며 Enterprise 배포물 제거, unrestricted OAuth/OIDC/SAML, 개인 키 정책과 회전, Purview와 Presidio,
폐쇄망 UI, 대시보드 i18n, 성능 지표, Prisma v2 migration, spend-log 접근 제어와 observability scope를 유지했다.

v1.95에서 SSO entitlement와 사용자 수 검사가 공통 경로로 정리되고 SAML에도 적용된 변경은 HGI 정책과
충돌하므로 라이선스 및 5인 제한만 제거했다. OAuth state/nonce, OIDC issuer/audience/signature, SAML assertion
검증과 권한·팀 동기화 검사는 제거하지 않았다. 운영 배포에서는 OAuth/OIDC 또는 SAML 중 구성한 로그인
방식을 사용하며, HGI의 무제한 정책은 선택한 프로토콜과 무관하게 동일하게 적용된다.

통합 커밋은 다음 기능 단위로 유지한다.

- `chore(hgi): remove enterprise distribution`
- `feat(hgi): enable unrestricted OIDC authentication`
- `feat(hgi): add virtual key policy and rotation controls`
- `feat(hgi): add Microsoft Purview guardrails`
- `feat(hgi): support closed-network dashboard`
- `feat(hgi): extend Presidio governance and audit`
- `feat(hgi): localize and simplify the closed-network dashboard`
- `feat(hgi): add model response time and ttft metrics`
- `fix(hgi): backport spend reliability fixes`
- `fix(hgi): harden Prisma v2 migrations`
- `fix(hgi): authorize owned spend log details`
- `fix(observability): scope oidc user usage and logs`

API schema는 v1.95 코드에서 다시 생성했다. 새로 추가된 관리자·identity, model/credential/health, MCP,
logs/audit, tool policy/routing, access group, memory, retry/fallback 화면도 `src/i18n` 리소스를 사용하도록
이식했다. 실제 IdP, PostgreSQL clone, Redis 다중 worker, registry digest 검증은 이전 감사와 마찬가지로
별도 운영 통합 검증 항목이다.

## 12. v1.97.0 업스트림 통합

`hgi-v1.97.0`은 upstream tag `v1.97.0`의
`ef84494d52c6708e4e9f4a54ce551a265995ad8f`를 기준점으로 사용한다. tag commit은 upstream
`stable/1.97.x` 및 release ref와 일치한다. upstream tag를 두 번째 parent로 하는 `--no-ff` merge에서
1.96.2 HGI 변경을 1.97의 중앙 authorization, App Router dashboard, Prisma proxy-extras 구조에 맞춰
재구성했다.

Enterprise 배포물과 dependency는 포함하지 않았다. 공통 OAuth2/SSO entitlement 및 사용자 수 제한,
Organizations premium gate, OSS Audit Logs premium gate는 제거된 상태를 유지하며 OAuth state/nonce,
OIDC issuer/audience/signature, SAML assertion, RBAC 검증은 유지한다. SSO 부서 claim과 Human quota pool
Organization/Team 동기화, 수동 협업 Team 및 서비스 키 보존, 개인 키 registry/quota/rotation/deprecated-key
grace, spend key-hash scope, Presidio source attribution과 fail-closed 처리, policy usage, Purview, 응답시간/TTFT
지표를 보존했다.

1.97의 주요 구조 변경에 따라 IP allowlist는 새 중앙 authorization helper에 연결했고, key rotation lineage와
active token 갱신은 같은 transaction에서 처리한다. deprecated-key mapping은 multi-worker 정합성을 위해
매 요청 authoritative DB lookup을 유지한다. Audit Logs는 Enterprise 구현 대신 OSS repository와 allowlist,
redaction, actor-key hashing, mandatory failure observation을 사용한다. dashboard는 `NuqsAdapter`를 수용하되
폐쇄망 production build가 외부 Google Fonts를 요청하지 않도록 원격 font dependency를 제외한다. upstream
Prisma migration과 lockfile은 1.97 의존성 그래프에서 다시 생성하며 generated API schema와
`_experimental/out`은 upstream/generated 경계를 따른다.

## 13. v1.98.0 업스트림 통합

`hgi-v1.98.0`은 upstream `v1.98.0`의
`d8f71d7bdbd7c9873d98293f83d64c6db72847e6`을 두 번째 parent로 병합한다. `v1.98.0`,
`release/v1.98.0`, `rc/1.98.0`은 같은 commit을 가리키며 tag object가 아닌 lightweight tag이므로 tag 자체의
GPG 서명은 검증할 수 없다. 1.97 HGI merge commit
`469b8189b5d166a7875f8442a8d448ab9af0f002`에서 `--no-ff` merge를 시작했고 rebase나 squash를 사용하지
않았다.

1.98의 bulk daily-spend upsert, access-group 동기화, key/team cache invalidation, dashboard App Router와 새
component 구조를 수용했다. HGI의 응답시간/TTFT 집계는 새 bulk upsert counter와 spend column으로 옮겼고,
key 재발급에서는 active token 변경과 deprecated lineage 생성을 동일 transaction에 유지했다. 수동 재발급은
transaction, cache 무효화, access-group 동기화 뒤 key-management hook을 기다린다. 자동 회전은 내부 job의
재발급 단계에서 hook을 중복 호출하지 않고 rotation metadata 갱신 뒤 한 번 호출한다.

unrestricted OAuth/OIDC/SSO와 managed-team claim 동기화, 중앙 authorization을 통한 IP allowlist, managed
personal/service key 보호와 key-list scope, OSS audit repository와 mandatory DB persistence, key-hash 기반
observability scope, Presidio fail-closed와 Purview, guardrail usage tracking을 유지했다. dashboard는
Admin Viewer의 Playground를 숨기고 한국어/영어 label과 badge를 분리하며 same-origin API와 폐쇄망 build
구조를 유지한다. v1.98에서 삭제된 audit table display export는 HGI i18n audit label helper로 대체했고,
managed personal key edit에서 ownership, team, organization, lifecycle mutation field를 다시 제외했다.

`uv.lock`, dashboard `package-lock.json`, OpenAPI `schema.d.ts`는 v1.98 코드와 Node 24.19.0 환경에서 정식
명령으로 재생성했다. `litellm-enterprise` dependency와 `enterprise/`, `litellm/proxy/enterprise/` source tree는
포함하지 않으며 `_experimental/out`은 upstream v1.98 결과와 일치시킨다. 실제 PostgreSQL, Redis 다중 worker,
OIDC IdP, secret manager, email provider, Purview/Graph API는 로컬 unit/mock 검증을 대체할 수 없으므로 운영
통합 검증 항목으로 남긴다.

검증에서는 backend collection 1,023건, 기존 auth/IP 144건, HGI focused backend 1,686 passed/4 skipped,
rotation·hook 재검증 36 passed/1 skipped, Presidio·Purview·guardrail usage focused 261건을 확인했다. HGI focused
backend의 나머지 1건은 `.env`의 `db:5432` PostgreSQL에 연결할 수 없어 실패한 deprecated-key DB E2E이며 코드
assertion 실패가 아니다. dashboard는 주 focused 672건, audit 25건, response detail 31건, key-edit refactor 60건을
각각 통과했다. Node 24.19.0 production build는 외부 proxy를 실패 주소로 고정한 상태에서 TypeScript 검사와
51개 static page 생성을 통과했고, Turbopack의 AVIF 무최적화 경고 1건만 남았다. 최종 staged `make pre-commit`은
Node heap을 8GB로 지정해 통과했으며 reviewer 재검토의 blocking finding은 0건이다.

### 13.1 Dashboard post-merge 재감사

v1.97 HGI와 v1.98 upstream을 다시 3-way 비교한 결과, 최초 merge에서 upstream과 동일해진 dashboard 경로를
추가로 발견했다. 모델별 평균 response time/TTFT 카드와 count-weighted 집계, request-log team/user scope,
Presidio custom entity, guardrail logging-only 관찰 결과와 UTC 날짜 처리, 비관리자 Usage 범위, Admin Viewer의
비용 발생 action 제한, 폐쇄망 font/link 정책을 v1.98 component 구조에 다시 이식했다. v1.97에서 번역을 사용하던
파일은 삭제된 Access Group modal을 제외하고 모두 v1.98 대응 component 또는 대체 Dialog에서 i18n resource를
사용하도록 복구했다. reviewer가 추가로 찾은 Models + Endpoints table column 번역 주입도 직접 검증해 반영했다.

재검증에서는 핵심 회귀 및 i18n suite 173건과 model table 26건이 통과했다. Node 24.19.0 production build는
TypeScript 검사와 51개 static page 생성을 다시 통과했고 AVIF 무최적화 경고 1건만 유지됐다. sandbox build는
Turbopack의 local port bind 제한으로 실패했으며 같은 명령을 제한 없이 재실행해 성공을 확인했다.
