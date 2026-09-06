# HGI LiteLLM 커스터마이징 운영 가이드

현재 통합 기준은 upstream `v1.100.0`의 `e4f25265704e2b2c6cf6e81be2e4c5cffff896f4`를 반영한 `codex/hgi-v1.100.0` 브랜치다. 원본 `hgi-v1.99.1`은 Presidio 변경을 커밋한 `049202135a`에서 보존한다. 운영 배포는 별도 절차이며, 이번 작업은 로컬 worktree에서 수행했다. 커스텀 변경은 `customizations/manifest.json`의 기능 그룹별 소유 경로로 관리한다.

최근 릴리즈 통합은 기존 커스텀 tip과 새 upstream tag를 부모로 남기는 merge 방식이다. 이 저장소는 릴리즈 계보의 자연 merge-base가 manifest의 직전 upstream 기준보다 오래될 수 있으므로, 정확한 `base_ref`로 3-way tree를 계산하고 충돌과 clean merge를 함께 검토한다. 아래 `sync_upstream.py apply`는 기능별 커밋으로 재적용하는 대안이다. 두 방식을 혼합하지 않고, 어느 방식을 사용해도 manifest와 기능 회귀시험을 통과해야 한다.

## 현재 버전 테스트

테스트는 운영 저장소와 분리한 clone 또는 worktree에서 실행한다. 실행 전에 `git rev-parse --short HEAD`로 검증할 branch tip을 기록한다.

`.env`의 최소 예시는 다음과 같다.

```dotenv
LITELLM_MASTER_KEY=sk-change-me
UI_USERNAME=admin
UI_PASSWORD=change-me
LITELLM_KEY_ROTATION_GRACE_PERIOD=72h
```

OIDC까지 검증하려면 IdP에 `http://localhost:4000/sso/callback`을 redirect URI로 등록하고 다음 값을 추가한다.

```dotenv
GENERIC_CLIENT_ID=litellm
GENERIC_CLIENT_SECRET=change-me
GENERIC_DISCOVERY_URL=https://idp.example.com/.well-known/openid-configuration
PROXY_ADMIN_ID=admin-user-id
```

Discovery를 제공하지 않는 IdP는 `GENERIC_AUTHORIZATION_ENDPOINT`, `GENERIC_TOKEN_ENDPOINT`,
`GENERIC_USERINFO_ENDPOINT`를 각각 지정한다. Discovery와 개별 endpoint를 함께 설정하면 개별 endpoint가 우선한다.

로컬 이미지를 빌드하고 실행한다.

```bash
git switch codex/hgi-v1.100.0
git rev-parse --short HEAD
docker compose build litellm
docker compose up -d db litellm
docker compose ps
curl --fail http://localhost:4000/health/liveliness
```

브라우저에서 `http://localhost:4000/ui`에 접속해 다음 순서로 확인한다.

1. 로컬 관리자 로그인과 OIDC 로그인이 모두 가능한지 확인한다.
2. 서로 다른 OIDC 사용자 6명 이상이 로그인할 수 있는지 확인한다.
3. 가상 키 생성 또는 수정 화면에서 guardrail과 policy를 지정한다.
4. 해당 키로 모델 요청을 보내 guardrail 또는 policy가 적용되는지 확인한다.
5. 키 재발급 화면의 유예 기간 기본값이 `72h`인지 확인하고 재발급한다.
6. 신규 키와 이전 키가 모두 성공하는지 확인한다.
7. 테스트에서는 유예 기간을 `30s`로 다시 재발급해 30초 뒤 이전 키가 거부되고 신규 키만 성공하는지 확인한다.
8. Guardrails 화면에서 Microsoft Purview를 생성하고 저장된 설정을 다시 열어 값이 유지되는지 확인한다.
9. 외부 Docs, Blog, Support 링크와 Enterprise 표기가 노출되지 않는지 확인한다.

가상 키 호출은 실제 배포 모델 이름으로 확인한다.

```bash
curl --fail http://localhost:4000/v1/models \
  -H "Authorization: Bearer ${OLD_VIRTUAL_KEY}"
curl --fail http://localhost:4000/v1/models \
  -H "Authorization: Bearer ${NEW_VIRTUAL_KEY}"
```

자동 테스트는 다음 묶음으로 실행한다.

```bash
pytest -q \
  tests/test_litellm/proxy/auth/test_user_api_key_auth.py \
  tests/test_litellm/proxy/customizations/test_oidc.py \
  tests/test_litellm/proxy/common_utils/test_key_rotation_manager.py \
  tests/test_litellm/proxy/guardrails/guardrail_hooks/test_microsoft_purview.py \
  tests/test_litellm/proxy/management_endpoints/test_key_management_endpoints.py \
  tests/test_litellm/proxy/management_endpoints/test_ui_sso.py \
  tests/test_litellm/proxy/ui_crud_endpoints/test_proxy_setting_endpoints.py \
  tests/hgi/test_sync_upstream.py

cd ui/litellm-dashboard
npm test -- --run \
  src/components/organisms/RegenerateKeyModal.test.tsx \
  src/components/templates/key_edit_view.test.tsx \
  src/components/Navbar/UserDropdown/UserDropdown.test.tsx \
  src/components/SidebarAccountMenu/SidebarAccountMenu.test.tsx
npm run build
```

## 업스트림 반영

먼저 현재 커스텀 변경이 manifest에 모두 포함되는지 확인한다.

```bash
python scripts/hgi/sync_upstream.py check
```

업스트림 원격을 갱신한 뒤 새 브랜치와 전용 worktree를 만든다.

```bash
git fetch upstream --tags
python scripts/hgi/sync_upstream.py apply \
  --upstream-ref upstream/main \
  --branch hgi-upstream-sync \
  --worktree ../hgi-litellm-upstream-sync
```

도구는 라이선스 경계, OIDC, 가상 키 제어, Purview, 폐쇄망 UI, 유지보수 도구 순서로 독립 커밋을 만든다. Enterprise 디렉터리는 새 업스트림에 추가된 파일까지 통째로 제거한다. 충돌이 발생하면 해당 기능 그룹에서 즉시 멈추므로 어느 커스터마이징이 영향을 받았는지 알 수 있다.

마지막 커밋은 새 업스트림의 정확한 commit SHA를 manifest의 `base_ref`에 기록한다. 따라서 다음 동기화 때는 새 기준 이후의 커스텀 diff만 다시 계산한다.

새 worktree에서는 API 스키마를 다시 생성하고 전체 검증을 실행한다.

```bash
make pre-commit
```

`ui/litellm-dashboard/src/lib/http/schema.d.ts`는 생성물이므로 patch로 옮기지 않고 새 업스트림 코드에서 다시 생성한다. `make pre-commit` 완료 후 남은 diff를 검토해 생성물 커밋 또는 기능 그룹 커밋에 포함한다.

## 충돌 관리 원칙

- `customizations/manifest.json`에 없는 커스텀 경로가 생기면 `check`가 실패한다.
- 커스텀 기능은 가능한 한 새 모듈에 두고 업스트림 파일에는 import 또는 등록 지점만 남긴다.
- 하나의 파일을 여러 기능 그룹이 공동 소유하지 않는다.
- API 스키마와 빌드 산출물은 patch로 관리하지 않고 새 기준에서 재생성한다.
- 업스트림 통합 브랜치는 기능 그룹별 커밋을 유지한 채 검증 후 배포 브랜치로 승격한다.

## 대시보드 다국어 관리

대시보드의 사용자 노출 문구는 `ui/litellm-dashboard/src/i18n/`의 언어별 리소스로 관리한다. 컴포넌트에
한국어나 영어 문구를 직접 추가하지 않고 `react-i18next`의 번역 키를 사용한다. 새 화면을 한글화할 때는 영어
리소스를 fallback 기준으로 먼저 정의하고 같은 키를 한국어 리소스에 추가한다.

기본 언어는 한국어이며 사용자가 선택한 언어는 브라우저 로컬 스토리지에 저장한다. 지원하지 않는 값이나 번역이
누락된 키는 영어로 fallback한다. Ant Design locale과 문서의 `lang` 속성도 같은 언어 설정을 사용해야 한다.


## v1.100.0 독립 개발환경

원본 worktree는 `/home/min/hgi-litellm`, 신규 worktree는 `/home/min/hgi-litellm-v1.100.0`이다. 각 worktree는 별도 `.venv`와 `node_modules`를 사용하며 `.env`와 운영 secret을 복사하지 않는다. Node는 `>=24.14.1`, npm은 `>=11.10.0`이 필요하다.

```bash
cd /home/min/hgi-litellm-v1.100.0
uv sync --frozen --extra proxy --group proxy-dev --group e2e-dev
uv run --no-sync prisma generate --schema litellm/proxy/schema.prisma
cd ui/litellm-dashboard
npm ci
LITELLM_PYTHON=/home/min/hgi-litellm-v1.100.0/.venv/bin/python npm run gen:api
```

이 호스트에서 검증에 사용한 Node 24.14.1은 공식 SHA-256을 확인해 `/tmp/hgi-node24/node-v24.14.1-linux-x64`에 풀었다. 해당 세션에서는 `PATH=/tmp/hgi-node24/node-v24.14.1-linux-x64/bin:$PATH`를 앞에 붙인다. `/tmp` 정리 후에는 위 버전 조건을 충족하는 Node를 다시 준비한다.

롤백은 원본 worktree의 `hgi-v1.99.1` / `049202135a`를 사용하는 것으로 가능하다. 새 worktree를 지우거나 원본 브랜치를 reset할 필요는 없다. 운영 DB 마이그레이션과 AKS 배포는 수행하지 않았다.

신규 upstream `scan_raw_request`는 기본 false를 유지한다. 이 옵션은 mutation 결과를 적용하지 않는 block 전용 검사 경로이므로 마스킹 Presidio에 활성화하지 않는다. Presidio 분석 캐시의 운영 활성화 조건과 긴 입력 NER 검증 조건은 `docs/guardrails/presidio-analysis-cache.md`를 계속 적용한다.
