import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import jwt
import pytest

from litellm.proxy._types import SSOUserDefinedValues
from litellm.proxy.customizations.sso_team_sync import (
    SSO_MANAGED_TEAM_IDS_METADATA_KEY,
    build_sso_team_id,
    normalize_sso_team_claim,
    ensure_human_organization,
    resolve_or_create_sso_teams,
    sync_sso_team_memberships,
)
from litellm.proxy.management_endpoints.ui_sso import (
    SSOAuthenticationHandler,
    generic_response_convertor,
    get_user_info_from_db,
    process_sso_jwt_access_token,
)
from litellm.types.proxy.management_endpoints.ui_sso import TeamMappings


@pytest.mark.parametrize(
    "raw_value, expected",
    [
        ("IT지원파트", ["IT지원파트"]),
        (["IT지원파트", "AI플랫폼파트"], ["IT지원파트", "AI플랫폼파트"]),
        ({"grpnm": "IT지원파트"}, ["IT지원파트"]),
        ({"teams": [{"name": "IT지원파트"}, {"team_alias": "AI플랫폼파트"}]}, ["IT지원파트", "AI플랫폼파트"]),
        ('[{"grpnm":"IT지원파트"}]', ["IT지원파트"]),
        ({"IT지원파트": True, "미사용": False}, ["IT지원파트"]),
        (None, []),
    ],
)
def test_normalize_sso_team_claim(raw_value, expected):
    assert normalize_sso_team_claim(raw_value) == expected


def test_build_sso_team_id_is_stable_and_case_insensitive():
    assert build_sso_team_id("IT지원파트") == build_sso_team_id("  it지원파트 ")


@pytest.mark.asyncio
async def test_ensure_human_organization_serializes_metadata_for_prisma_json_input():
    prisma_client = MagicMock()
    prisma_client.db.litellm_budgettable.upsert = AsyncMock()
    prisma_client.db.litellm_organizationtable.upsert = AsyncMock()

    await ensure_human_organization(prisma_client)

    organization_create = prisma_client.db.litellm_organizationtable.upsert.await_args.kwargs["data"]["create"]
    assert organization_create["metadata"] == json.dumps({"quota_pool_type": "human"})


def test_generic_response_convertor_supports_string_team_name_claim():
    jwt_handler = MagicMock()
    jwt_handler.get_all_jwt_team_ids.return_value = []

    result = generic_response_convertor(
        response={"preferred_username": "user", "email": "user@example.com", "grpnm": "IT지원파트"},
        jwt_handler=jwt_handler,
        team_mappings=TeamMappings(team_ids_jwt_field="grpnm"),
    )

    assert result.team_ids == ["IT지원파트"]
    assert result.sso_team_mapping_configured is True
    assert result.sso_team_claim_present is True
    assert result.sso_team_claim_values == ["IT지원파트"]


def test_process_sso_jwt_access_token_reads_team_claim_when_userinfo_omits_it():
    result = SimpleNamespace(
        team_ids=[],
        user_role=None,
        sso_team_mapping_configured=True,
        sso_team_claim_present=False,
        sso_team_claim_values=[],
    )
    access_token = jwt.encode(
        {"grpnm": {"name": "IT지원파트"}}, "test-secret-with-at-least-32-bytes", algorithm="HS256"
    )

    process_sso_jwt_access_token(
        access_token_str=access_token,
        sso_jwt_handler=None,
        result=result,
        team_mappings=TeamMappings(team_ids_jwt_field="grpnm"),
    )

    assert result.sso_team_claim_present is True
    assert result.sso_team_claim_values == ["IT지원파트"]
    assert result.team_ids == ["IT지원파트"]


@pytest.mark.asyncio
async def test_resolve_or_create_sso_teams_reuses_id_alias_and_creates_missing_team():
    table = MagicMock()
    table.find_unique = AsyncMock(side_effect=[None, None])
    table.find_first = AsyncMock(return_value=None)
    repository = MagicMock()
    repository.table = table

    with (
        patch(
            "litellm.proxy.customizations.sso_team_sync.ensure_human_organization",
            new_callable=AsyncMock,
            return_value="human-default",
        ),
        patch("litellm.proxy.customizations.sso_team_sync.TeamRepository", return_value=repository),
        patch("litellm.proxy.management_endpoints.team_endpoints.new_team", new_callable=AsyncMock) as new_team,
    ):
        resolved = await resolve_or_create_sso_teams(
            prisma_client=MagicMock(),
            team_claim_values=["신규부서"],
        )

    assert resolved == [build_sso_team_id("신규부서")]
    new_team.assert_awaited_once()
    assert new_team.await_args.kwargs["data"].team_alias == "신규부서"
    assert new_team.await_args.kwargs["data"].organization_id == "human-default"


@pytest.mark.asyncio
async def test_sync_sso_team_memberships_moves_department_without_deleting_keys():
    user_info = SimpleNamespace(
        user_id="user-1",
        user_email="user@example.com",
        teams=["old-sso-team", "manual-team"],
        metadata={SSO_MANAGED_TEAM_IDS_METADATA_KEY: ["old-sso-team"]},
    )
    teams = {
        "old-sso-team": SimpleNamespace(
            members_with_roles=[
                {"user_id": "user-1", "role": "user"},
                {"user_id": "other-user", "role": "user"},
            ]
        ),
        "new-sso-team": SimpleNamespace(members_with_roles=[{"user_id": "new-team-user", "role": "user"}]),
    }
    tx = MagicMock()
    tx.execute_raw = AsyncMock()
    tx.query_raw = AsyncMock()
    tx.litellm_teamtable.find_unique = AsyncMock(side_effect=lambda where: teams[where["team_id"]])
    tx.litellm_teamtable.update = AsyncMock()
    tx.litellm_teammembership.delete_many = AsyncMock()
    tx.litellm_teammembership.upsert = AsyncMock()
    tx.litellm_organizationmembership.upsert = AsyncMock()
    tx.litellm_usertable.update_many = AsyncMock()
    tx.litellm_usertable.find_unique = AsyncMock(return_value=user_info)
    tx.litellm_auditlog.create = AsyncMock()
    tx.corporatepersonalkeyregistry.find_unique = AsyncMock(
        return_value=SimpleNamespace(active_token_hash="active-key-hash")
    )
    tx.corporatepersonalkeyregistry.update = AsyncMock()
    tx.litellm_deprecatedverificationtoken.find_many = AsyncMock(return_value=[])
    tx.litellm_verificationtoken.update = AsyncMock()
    tx.litellm_verificationtoken.delete_many = AsyncMock()
    transaction = MagicMock()
    transaction.__aenter__ = AsyncMock(return_value=tx)
    transaction.__aexit__ = AsyncMock(return_value=None)
    prisma_client = MagicMock()
    prisma_client.db.tx.return_value = transaction

    with (
        patch("litellm.proxy.management_endpoints.team_endpoints.team_member_add", new_callable=AsyncMock) as add,
        patch("litellm.proxy.management_endpoints.team_endpoints.team_member_delete", new_callable=AsyncMock) as delete,
        patch("litellm.proxy.auth.auth_checks._delete_cache_key_object", new_callable=AsyncMock),
    ):
        await sync_sso_team_memberships(
            prisma_client=prisma_client,
            user_info=user_info,
            target_team_ids=["new-sso-team"],
        )

    add.assert_not_awaited()
    delete.assert_not_awaited()
    tx.litellm_verificationtoken.delete_many.assert_not_awaited()
    team_updates = {
        call.kwargs["where"]["team_id"]: json.loads(call.kwargs["data"]["members_with_roles"])
        for call in tx.litellm_teamtable.update.await_args_list
    }
    assert team_updates["old-sso-team"] == [{"user_id": "other-user", "role": "user"}]
    assert team_updates["new-sso-team"] == [
        {"user_id": "new-team-user", "role": "user"},
        {"user_id": "user-1", "role": "user"},
    ]
    tx.litellm_teammembership.delete_many.assert_awaited_once_with(
        where={"user_id": "user-1", "team_id": "old-sso-team"}
    )
    tx.litellm_teammembership.upsert.assert_awaited_once()
    persisted_metadata = json.loads(tx.litellm_usertable.update_many.await_args.kwargs["data"]["metadata"])
    assert persisted_metadata[SSO_MANAGED_TEAM_IDS_METADATA_KEY] == ["new-sso-team"]
    persisted_audit_values = json.loads(tx.litellm_auditlog.create.await_args.kwargs["data"]["updated_values"])
    assert persisted_audit_values["previous_department_team_ids"] == ["old-sso-team"]
    assert persisted_audit_values["department_team_ids"] == ["new-sso-team"]
    assert persisted_audit_values["result"] == "success"
    assert tx.litellm_usertable.update_many.await_args.kwargs["data"]["organization_id"] == "human-default"
    assert tx.litellm_usertable.update_many.await_args.kwargs["data"]["teams"] == {
        "set": ["manual-team", "new-sso-team"]
    }
    tx.litellm_verificationtoken.update.assert_awaited_once_with(
        where={"token": "active-key-hash"},
        data={
            "team_id": "new-sso-team",
            "organization_id": "human-default",
            "updated_by": "oidc-sso",
        },
    )
    tx.corporatepersonalkeyregistry.update.assert_awaited_once_with(
        where={"user_id": "user-1"},
        data={"department_team_id": "new-sso-team", "organization_id": "human-default"},
    )


@pytest.mark.asyncio
async def test_missing_configured_team_claim_preserves_existing_memberships():
    result = SimpleNamespace(
        team_ids=["unrelated-access-group"],
        sso_team_mapping_configured=True,
        sso_team_claim_present=False,
    )
    user_info = SimpleNamespace(
        user_id="user-1",
        teams=["existing-team"],
        metadata={SSO_MANAGED_TEAM_IDS_METADATA_KEY: ["existing-team"]},
    )

    with patch("litellm.proxy.management_endpoints.ui_sso.add_missing_team_member", new_callable=AsyncMock) as add:
        await SSOAuthenticationHandler.add_user_to_teams_from_sso_response(result=result, user_info=user_info)

    add.assert_not_awaited()
    assert result.team_ids == ["existing-team"]


@pytest.mark.parametrize(
    "metadata",
    [
        {},
        {SSO_MANAGED_TEAM_IDS_METADATA_KEY: []},
        {SSO_MANAGED_TEAM_IDS_METADATA_KEY: ["department-a", "department-b"]},
    ],
)
@pytest.mark.asyncio
async def test_missing_configured_team_claim_rejects_first_or_inconsistent_provisioning(metadata):
    result = SimpleNamespace(
        team_ids=[],
        sso_team_mapping_configured=True,
        sso_team_claim_present=False,
    )
    user_info = SimpleNamespace(user_id="user-1", teams=[], metadata=metadata)

    with pytest.raises(ValueError, match="exactly one managed department"):
        await SSOAuthenticationHandler.add_user_to_teams_from_sso_response(result=result, user_info=user_info)


@pytest.mark.asyncio
async def test_configured_department_sync_failure_fails_sso_provisioning():
    result = SimpleNamespace(
        id="subject-1",
        email="user@example.com",
        sso_team_mapping_configured=True,
    )
    user_info = SimpleNamespace(user_id="subject-1")

    with (
        patch(
            "litellm.proxy.management_endpoints.ui_sso.get_existing_user_info_from_db",
            new_callable=AsyncMock,
            return_value=user_info,
        ),
        patch.object(
            SSOAuthenticationHandler,
            "upsert_sso_user",
            new_callable=AsyncMock,
            return_value=user_info,
        ),
        patch.object(
            SSOAuthenticationHandler,
            "add_user_to_teams_from_sso_response",
            new_callable=AsyncMock,
            side_effect=RuntimeError("department sync failed"),
        ),
    ):
        with pytest.raises(RuntimeError, match="department sync failed"):
            await get_user_info_from_db(
                result=result,
                prisma_client=MagicMock(),
                user_api_key_cache=MagicMock(),
                proxy_logging_obj=MagicMock(),
                user_email="user@example.com",
                user_defined_values=None,
            )


@pytest.mark.asyncio
async def test_concurrent_sso_insert_reloads_existing_subject():
    concurrent_user = SimpleNamespace(user_id="subject-1")
    repository = MagicMock()
    repository.table.find_unique = AsyncMock(return_value=concurrent_user)

    with (
        patch(
            "litellm.proxy.management_endpoints.ui_sso.insert_sso_user",
            new_callable=AsyncMock,
            side_effect=RuntimeError("unique constraint"),
        ),
        patch(
            "litellm.proxy.management_endpoints.ui_sso.UserRepository",
            return_value=repository,
        ),
    ):
        result = await SSOAuthenticationHandler.upsert_sso_user(
            result={"id": "subject-1"},
            user_info=None,
            user_email="user@example.com",
            user_defined_values=SSOUserDefinedValues(
                models=[],
                user_id="subject-1",
                user_email="user@example.com",
                user_role="internal_user",
                max_budget=None,
                budget_duration=None,
            ),
            prisma_client=MagicMock(),
        )

    assert result is concurrent_user
