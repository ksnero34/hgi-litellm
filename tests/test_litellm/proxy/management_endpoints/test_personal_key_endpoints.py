import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from prisma import Prisma
from pydantic import ValidationError

from litellm.constants import UI_SESSION_TOKEN_TEAM_ID
from litellm.proxy._types import LitellmUserRoles, UserAPIKeyAuth
from litellm.proxy.db.prisma_client import PrismaWrapper
from litellm.proxy.management_endpoints.key_management_endpoints import (
    _reject_managed_personal_key_mutation,
    _reject_session_generic_key_read,
)
from litellm.proxy.management_endpoints.personal_key_endpoints import (
    _audit,
    _count_active_personal_keys,
    _count_personal_grace_keys,
    _delete_deprecated_personal_keys,
    _invalidate_personal_key_cache,
    _load_scope,
    _retarget_deprecated_personal_keys,
    _resolve_personal_key_alias,
    _rotation_grace,
    _target_user_id,
    _writer_database,
    create_personal_key,
)
from litellm.types.proxy.management_endpoints.personal_key_endpoints import PersonalKeyCreateRequest


def test_personal_key_request_rejects_policy_fields():
    for field, value in (
        ("team_id", "other-team"),
        ("models", ["all"]),
        ("duration", "365d"),
        ("tpm_limit", 1000),
        ("organization_id", "other-org"),
        ("service_account", True),
    ):
        with pytest.raises(ValidationError):
            PersonalKeyCreateRequest.model_validate({field: value})


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("action", "result", "success"),
    [("created", "success", True), ("creation_rejected", "duplicate", False)],
)
async def test_personal_key_audit_stores_explicit_success(action: str, result: str, success: bool):
    audit_table = SimpleNamespace(create=AsyncMock())

    await _audit(
        SimpleNamespace(litellm_auditlog=audit_table),
        "actor-1",
        "user-1",
        "logical-key-1",
        action,
        result,
        success,
    )

    stored = audit_table.create.await_args.kwargs["data"]
    assert stored["action"] == action
    assert json.loads(stored["updated_values"])["success"] is success


@pytest.mark.parametrize("requested_alias", [None, "", "   "])
def test_blank_personal_key_alias_defaults_to_sso_subject(requested_alias: str | None):
    assert _resolve_personal_key_alias(requested_alias, "oidc-sub-123") == "oidc-sub-123"


def test_explicit_personal_key_alias_takes_precedence_over_sso_subject():
    assert _resolve_personal_key_alias("my-personal-key", "oidc-sub-123") == "my-personal-key"


@pytest.mark.asyncio
async def test_create_personal_key_persists_sso_subject_as_default_alias(monkeypatch: pytest.MonkeyPatch):
    from litellm.proxy import proxy_server
    from litellm.proxy.management_endpoints import personal_key_endpoints

    user = SimpleNamespace(
        user_id="user-1",
        user_alias="oidc-sub-123",
        user_role=LitellmUserRoles.INTERNAL_USER.value,
        metadata={"litellm_sso_managed_team_ids": ["department-1"]},
    )
    team = SimpleNamespace(team_id="department-1", organization_id="human-default")
    verification_tokens = SimpleNamespace(
        find_many=AsyncMock(
            return_value=[
                SimpleNamespace(
                    token="managed-personal-hash",
                    metadata={
                        "personal_key": {
                            "owner_type": "user",
                            "key_purpose": "personal_llm",
                            "logical_key_id": "legacy-logical-id",
                            "generation": 1,
                            "lifecycle": "active",
                        }
                    },
                ),
                SimpleNamespace(token="manual-key-hash", metadata={}),
                SimpleNamespace(token="team-key-hash", metadata={"key_origin": "team"}),
                SimpleNamespace(
                    token="service-key-hash",
                    metadata={
                        "personal_key": {
                            "owner_type": "service",
                            "key_purpose": "service_account",
                        }
                    },
                ),
            ]
        ),
        update_many=AsyncMock(),
        create=AsyncMock(),
    )
    registries = SimpleNamespace(
        find_unique=AsyncMock(return_value=None),
        create=AsyncMock(),
    )
    transaction = SimpleNamespace(
        execute_raw=AsyncMock(),
        litellm_usertable=SimpleNamespace(find_unique=AsyncMock(return_value=user)),
        litellm_teamtable=SimpleNamespace(find_unique=AsyncMock(return_value=team)),
        litellm_organizationtable=SimpleNamespace(find_unique=AsyncMock(return_value=SimpleNamespace())),
        corporatepersonalkeyregistry=registries,
        litellm_verificationtoken=verification_tokens,
        litellm_auditlog=SimpleNamespace(create=AsyncMock()),
    )
    transaction_context = MagicMock()
    transaction_context.__aenter__ = AsyncMock(return_value=transaction)
    transaction_context.__aexit__ = AsyncMock(return_value=None)
    database = SimpleNamespace(tx=MagicMock(return_value=transaction_context))

    async def create_registry(data):
        return SimpleNamespace(**data)

    async def create_token(data):
        return SimpleNamespace(**data, created_at=None, updated_at=None)

    registries.create.side_effect = create_registry
    verification_tokens.create.side_effect = create_token
    monkeypatch.setattr(proxy_server, "prisma_client", SimpleNamespace())
    monkeypatch.setattr(personal_key_endpoints, "_writer_database", lambda _: database)
    monkeypatch.setattr(personal_key_endpoints, "_invalidate_personal_key_cache", AsyncMock())

    response = await create_personal_key(
        data=PersonalKeyCreateRequest(key_alias=None),
        auth=UserAPIKeyAuth(
            user_id="user-1",
            user_role=LitellmUserRoles.INTERNAL_USER,
            is_session_token=True,
        ),
    )

    create_data = verification_tokens.create.await_args.kwargs["data"]
    assert create_data["key_alias"] == "oidc-sub-123"
    assert response.key_alias == "oidc-sub-123"
    audit_data = transaction.litellm_auditlog.create.await_args.kwargs["data"]
    assert '"success": true' in audit_data["updated_values"]
    verification_tokens.update_many.assert_awaited_once_with(
        where={"token": {"in": ["managed-personal-hash"]}},
        data={"blocked": True, "updated_by": "user-1"},
    )


def test_session_user_can_only_manage_own_personal_key():
    auth = UserAPIKeyAuth(
        user_id="user-1",
        user_role=LitellmUserRoles.INTERNAL_USER,
        is_session_token=True,
    )

    assert _target_user_id(None, auth) == "user-1"
    assert _target_user_id("user-1", auth) == "user-1"

    with pytest.raises(HTTPException) as error:
        _target_user_id("user-2", auth)

    assert error.value.status_code == 403


def test_standard_sso_ui_session_can_manage_own_personal_key():
    auth = UserAPIKeyAuth(
        user_id="user-1",
        user_role=LitellmUserRoles.INTERNAL_USER,
        team_id=UI_SESSION_TOKEN_TEAM_ID,
        is_session_token=False,
    )

    assert _target_user_id(None, auth) == "user-1"


def test_non_session_key_cannot_manage_personal_key():
    auth = UserAPIKeyAuth(
        user_id="user-1",
        user_role=LitellmUserRoles.INTERNAL_USER,
        is_session_token=False,
    )

    with pytest.raises(HTTPException) as error:
        _target_user_id(None, auth)

    assert error.value.status_code == 403


def test_proxy_admin_can_issue_personal_key_on_behalf():
    auth = UserAPIKeyAuth(
        user_id="admin-1",
        user_role=LitellmUserRoles.PROXY_ADMIN,
        is_session_token=True,
    )

    assert _target_user_id("user-2", auth) == "user-2"


def test_managed_personal_key_cannot_bypass_personal_key_lifecycle_api():
    key_row = type(
        "UserOwnedKey",
        (),
        {
            "user_id": "user-1",
            "team_id": "department-1",
            "metadata": {
                "personal_key": {
                    "owner_type": "user",
                    "key_purpose": "personal_llm",
                    "logical_key_id": "logical-1",
                    "generation": 1,
                    "lifecycle": "active",
                }
            },
        },
    )()

    with pytest.raises(HTTPException) as error:
        _reject_managed_personal_key_mutation(key_row)

    assert error.value.status_code == 403


def test_legacy_user_owned_key_remains_compatible_with_generic_lifecycle_api():
    key_row = type(
        "LegacyUserOwnedKey",
        (),
        {
            "user_id": "user-1",
            "team_id": "department-1",
            "metadata": {},
        },
    )()

    result = _reject_managed_personal_key_mutation(key_row)

    assert result is None
    assert key_row.user_id == "user-1"
    assert key_row.team_id == "department-1"
    assert key_row.metadata == {}


def test_ui_session_cannot_use_generic_key_read_api():
    auth = UserAPIKeyAuth(
        user_id="user-1",
        user_role=LitellmUserRoles.INTERNAL_USER,
        is_session_token=True,
    )

    with pytest.raises(HTTPException) as error:
        _reject_session_generic_key_read(auth)

    assert error.value.status_code == 403


def test_personal_key_transactions_use_the_writer_prisma_client():
    database = Prisma()
    wrapper = PrismaWrapper(
        original_prisma=database,
        iam_token_db_auth=False,
    )
    prisma_client = type("PrismaClientStub", (), {"db": wrapper})()

    assert _writer_database(prisma_client) is database


def test_internal_viewer_can_read_but_cannot_mutate_personal_key():
    auth = UserAPIKeyAuth(
        user_id="viewer-1",
        user_role=LitellmUserRoles.INTERNAL_USER_VIEW_ONLY,
        is_session_token=True,
    )

    assert _target_user_id(None, auth, read_only=True) == "viewer-1"

    with pytest.raises(HTTPException) as error:
        _target_user_id(None, auth)

    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_admin_manual_org_team_can_resolve_personal_key_scope():
    user = SimpleNamespace(user_id="admin-1", metadata={}, teams=["admin-team"], team_id=None)
    team = SimpleNamespace(team_id="admin-team", organization_id="admin-org")
    database = SimpleNamespace(
        litellm_usertable=SimpleNamespace(find_unique=AsyncMock(return_value=user)),
        litellm_organizationmembership=SimpleNamespace(
            find_many=AsyncMock(return_value=[SimpleNamespace(organization_id="admin-org")])
        ),
        litellm_teamtable=SimpleNamespace(find_many=AsyncMock(return_value=[team])),
        litellm_organizationtable=SimpleNamespace(find_unique=AsyncMock(return_value=SimpleNamespace())),
    )

    resolved_user, resolved_team, organization_id = await _load_scope(
        database,
        "admin-1",
        allow_manual_scope=True,
    )

    assert resolved_user is user
    assert resolved_team is team
    assert organization_id == "admin-org"
    database.litellm_organizationmembership.find_many.assert_awaited_once_with(where={"user_id": "admin-1"})
    database.litellm_teamtable.find_many.assert_awaited_once_with(where={"team_id": {"in": ("admin-team",)}})


@pytest.mark.asyncio
async def test_admin_manual_scope_uses_org_backed_team_without_organization_membership():
    user = SimpleNamespace(user_id="admin-1", metadata={}, teams=["admin-team"], team_id=None)
    team = SimpleNamespace(team_id="admin-team", organization_id="admin-org")
    database = SimpleNamespace(
        litellm_usertable=SimpleNamespace(find_unique=AsyncMock(return_value=user)),
        litellm_organizationmembership=SimpleNamespace(find_many=AsyncMock(return_value=[])),
        litellm_teamtable=SimpleNamespace(find_many=AsyncMock(return_value=[team])),
        litellm_organizationtable=SimpleNamespace(find_unique=AsyncMock(return_value=SimpleNamespace())),
    )

    _, resolved_team, organization_id = await _load_scope(database, "admin-1", allow_manual_scope=True)

    assert resolved_team is team
    assert organization_id == "admin-org"
    database.litellm_teamtable.find_many.assert_awaited_once_with(where={"team_id": {"in": ("admin-team",)}})


@pytest.mark.asyncio
async def test_admin_manual_scope_ignores_non_organization_team_memberships():
    user = SimpleNamespace(user_id="admin-1", metadata={}, teams=["admin-team", "collaboration-team"], team_id=None)
    organization_team = SimpleNamespace(team_id="admin-team", organization_id="admin-org")
    collaboration_team = SimpleNamespace(team_id="collaboration-team", organization_id=None)
    database = SimpleNamespace(
        litellm_usertable=SimpleNamespace(find_unique=AsyncMock(return_value=user)),
        litellm_organizationmembership=SimpleNamespace(
            find_many=AsyncMock(return_value=[SimpleNamespace(organization_id="admin-org")])
        ),
        litellm_teamtable=SimpleNamespace(find_many=AsyncMock(return_value=[organization_team, collaboration_team])),
        litellm_organizationtable=SimpleNamespace(find_unique=AsyncMock(return_value=SimpleNamespace())),
    )

    _, resolved_team, organization_id = await _load_scope(database, "admin-1", allow_manual_scope=True)

    assert resolved_team is organization_team
    assert organization_id == "admin-org"


@pytest.mark.asyncio
async def test_admin_manual_scope_rejects_team_outside_organization_memberships():
    user = SimpleNamespace(user_id="admin-1", metadata={}, teams=["admin-team"], team_id=None)
    team = SimpleNamespace(team_id="admin-team", organization_id="team-org")
    database = SimpleNamespace(
        litellm_usertable=SimpleNamespace(find_unique=AsyncMock(return_value=user)),
        litellm_organizationmembership=SimpleNamespace(
            find_many=AsyncMock(return_value=[SimpleNamespace(organization_id="member-org")])
        ),
        litellm_teamtable=SimpleNamespace(find_many=AsyncMock(return_value=[team])),
    )

    with pytest.raises(HTTPException) as error:
        await _load_scope(database, "admin-1", allow_manual_scope=True)

    assert error.value.status_code == 409
    assert error.value.detail == "The administrator's team is outside their organization memberships"


@pytest.mark.asyncio
async def test_admin_manual_scope_requires_discoverable_team_membership():
    user = SimpleNamespace(user_id="admin-1", metadata={}, teams=[], team_id=None)
    database = SimpleNamespace(
        litellm_usertable=SimpleNamespace(find_unique=AsyncMock(return_value=user)),
        litellm_organizationmembership=SimpleNamespace(find_many=AsyncMock(return_value=[])),
    )

    with pytest.raises(HTTPException) as error:
        await _load_scope(database, "admin-1", allow_manual_scope=True)

    assert error.value.status_code == 409
    assert error.value.detail == "The administrator must belong to exactly one organization-backed team"


@pytest.mark.asyncio
@pytest.mark.parametrize("team_count", [0, 2])
async def test_admin_manual_scope_requires_exactly_one_org_team(team_count: int):
    teams = [
        SimpleNamespace(team_id=f"admin-team-{index}", organization_id="admin-org", members_with_roles=[])
        for index in range(team_count)
    ]
    user = SimpleNamespace(
        user_id="admin-1",
        metadata={},
        teams=[team.team_id for team in teams],
        team_id=None,
    )
    database = SimpleNamespace(
        litellm_usertable=SimpleNamespace(find_unique=AsyncMock(return_value=user)),
        litellm_organizationmembership=SimpleNamespace(
            find_many=AsyncMock(return_value=[SimpleNamespace(organization_id="admin-org")])
        ),
        litellm_teamtable=SimpleNamespace(find_many=AsyncMock(return_value=teams)),
    )

    with pytest.raises(HTTPException) as error:
        await _load_scope(database, "admin-1", allow_manual_scope=True)

    assert error.value.status_code == 409
    assert error.value.detail == "The administrator must belong to exactly one organization-backed team"


@pytest.mark.asyncio
async def test_missing_sso_team_metadata_returns_stable_conflict():
    database = SimpleNamespace(
        litellm_usertable=SimpleNamespace(
            find_unique=AsyncMock(return_value=SimpleNamespace(user_id="user-1", metadata={}))
        )
    )

    with pytest.raises(HTTPException) as error:
        await _load_scope(database, "user-1")

    assert error.value.status_code == 409
    assert error.value.detail == "The user must have exactly one OIDC-managed department team"


def test_rotation_grace_is_capped_at_old_key_expiry():
    now = datetime(2026, 8, 1, tzinfo=timezone.utc)
    old_expires = now + timedelta(hours=2)
    configured_revoke_at = now + timedelta(hours=72)

    revoke_at, has_grace = _rotation_grace(old_expires, configured_revoke_at, now)

    assert revoke_at == old_expires
    assert has_grace is True


def test_rotation_grace_rejects_already_expired_old_key():
    now = datetime(2026, 8, 1, tzinfo=timezone.utc)
    old_expires = now - timedelta(seconds=1)

    revoke_at, has_grace = _rotation_grace(old_expires, now + timedelta(hours=72), now)

    assert revoke_at == old_expires
    assert has_grace is False


@pytest.mark.asyncio
async def test_expired_rotation_removes_ancestors_without_creating_deprecated_mapping():
    deprecated_tokens = SimpleNamespace(
        delete_many=AsyncMock(),
        upsert=AsyncMock(),
        update_many=AsyncMock(),
    )
    database = SimpleNamespace(litellm_deprecatedverificationtoken=deprecated_tokens)
    revoke_at = datetime(2026, 8, 1, tzinfo=timezone.utc)

    await _retarget_deprecated_personal_keys(
        database,
        "old-hash",
        "new-hash",
        ("ancestor-1", "ancestor-2"),
        revoke_at,
        False,
    )

    deprecated_tokens.delete_many.assert_awaited_once_with(where={"token": {"in": ["ancestor-1", "ancestor-2"]}})
    deprecated_tokens.upsert.assert_not_awaited()
    deprecated_tokens.update_many.assert_not_awaited()


@pytest.mark.asyncio
async def test_valid_rotation_uses_capped_revoke_at_for_old_key_mapping():
    deprecated_tokens = SimpleNamespace(
        delete_many=AsyncMock(),
        upsert=AsyncMock(),
        update_many=AsyncMock(),
    )
    database = SimpleNamespace(litellm_deprecatedverificationtoken=deprecated_tokens)
    capped_revoke_at = datetime(2026, 8, 1, 2, tzinfo=timezone.utc)

    await _retarget_deprecated_personal_keys(
        database,
        "old-hash",
        "new-hash",
        (),
        capped_revoke_at,
        True,
    )

    deprecated_tokens.upsert.assert_awaited_once_with(
        where={"token": "old-hash"},
        data={
            "create": {
                "token": "old-hash",
                "active_token_id": "new-hash",
                "revoke_at": capped_revoke_at,
            },
            "update": {"active_token_id": "new-hash", "revoke_at": capped_revoke_at},
        },
    )
    deprecated_tokens.delete_many.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_deprecated_personal_keys_removes_every_ancestor_mapping():
    deprecated_tokens = SimpleNamespace(
        find_many=AsyncMock(
            return_value=(
                SimpleNamespace(token="ancestor-1"),
                SimpleNamespace(token="ancestor-2"),
            )
        ),
        delete_many=AsyncMock(),
    )
    database = SimpleNamespace(litellm_deprecatedverificationtoken=deprecated_tokens)

    hashes = await _delete_deprecated_personal_keys(database, "active-hash")

    assert hashes == ("ancestor-1", "ancestor-2")
    deprecated_tokens.find_many.assert_awaited_once_with(where={"active_token_id": "active-hash"})
    deprecated_tokens.delete_many.assert_awaited_once_with(where={"token": {"in": ["ancestor-1", "ancestor-2"]}})


@pytest.mark.asyncio
async def test_cache_invalidation_is_best_effort_and_continues_after_failure():
    invalidate = AsyncMock(side_effect=(RuntimeError("cache unavailable"), None))

    await _invalidate_personal_key_cache(("old-hash", "ancestor-hash"), invalidate)

    assert invalidate.await_args_list[0].args == ("old-hash",)
    assert invalidate.await_args_list[1].args == ("ancestor-hash",)


@pytest.mark.asyncio
async def test_active_personal_key_count_requires_unblocked_unexpired_token():
    verification_tokens = SimpleNamespace(count=AsyncMock(return_value=3))
    database = SimpleNamespace(litellm_verificationtoken=verification_tokens)
    now = datetime(2026, 8, 1, tzinfo=timezone.utc)

    count = await _count_active_personal_keys(database, ("active-1", "expired-1", "blocked-1"), now)

    assert count == 3
    verification_tokens.count.assert_awaited_once_with(
        where={
            "token": {"in": ("active-1", "expired-1", "blocked-1")},
            "blocked": False,
            "expires": {"gt": now},
        }
    )


@pytest.mark.asyncio
async def test_personal_grace_key_count_is_scoped_to_active_personal_keys():
    deprecated_tokens = SimpleNamespace(count=AsyncMock(return_value=2))
    database = SimpleNamespace(litellm_deprecatedverificationtoken=deprecated_tokens)
    now = datetime(2026, 8, 1, tzinfo=timezone.utc)

    count = await _count_personal_grace_keys(database, ("personal-active-1", "personal-active-2"), now)

    assert count == 2
    deprecated_tokens.count.assert_awaited_once_with(
        where={
            "active_token_id": {"in": ("personal-active-1", "personal-active-2")},
            "revoke_at": {"gt": now},
        }
    )


@pytest.mark.asyncio
async def test_personal_grace_key_count_skips_query_without_active_personal_keys():
    deprecated_tokens = SimpleNamespace(count=AsyncMock())
    database = SimpleNamespace(litellm_deprecatedverificationtoken=deprecated_tokens)

    count = await _count_personal_grace_keys(database, (), datetime(2026, 8, 1, tzinfo=timezone.utc))

    assert count == 0
    deprecated_tokens.count.assert_not_awaited()
