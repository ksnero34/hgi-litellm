from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import jwt
import pytest

from litellm.proxy.customizations.sso_team_sync import (
    SSO_MANAGED_TEAM_IDS_METADATA_KEY,
    build_sso_team_id,
    normalize_sso_team_claim,
    resolve_or_create_sso_teams,
    sync_sso_team_memberships,
)
from litellm.proxy.management_endpoints.ui_sso import (
    SSOAuthenticationHandler,
    generic_response_convertor,
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
    access_token = jwt.encode({"grpnm": {"name": "IT지원파트"}}, "test-secret-with-at-least-32-bytes", algorithm="HS256")

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
    table.find_unique = AsyncMock(
        side_effect=[
            SimpleNamespace(team_id="existing-id"),
            None,
            None,
            None,
        ]
    )
    table.find_first = AsyncMock(
        side_effect=[
            SimpleNamespace(team_id="alias-team-id"),
            None,
        ]
    )
    repository = MagicMock()
    repository.table = table

    with (
        patch("litellm.proxy.customizations.sso_team_sync.TeamRepository", return_value=repository),
        patch("litellm.proxy.management_endpoints.team_endpoints.new_team", new_callable=AsyncMock) as new_team,
    ):
        resolved = await resolve_or_create_sso_teams(
            prisma_client=MagicMock(),
            team_claim_values=["existing-id", "existing-alias", "신규부서"],
        )

    assert resolved == ["existing-id", "alias-team-id", build_sso_team_id("신규부서")]
    new_team.assert_awaited_once()
    assert new_team.await_args.kwargs["data"].team_alias == "신규부서"


@pytest.mark.asyncio
async def test_sync_sso_team_memberships_only_removes_previously_managed_teams():
    user_info = SimpleNamespace(
        user_id="user-1",
        teams=["old-sso-team", "manual-team"],
        metadata={SSO_MANAGED_TEAM_IDS_METADATA_KEY: ["old-sso-team"]},
    )
    user_repository = MagicMock()
    user_repository.table.update_many = AsyncMock()

    with (
        patch("litellm.proxy.customizations.sso_team_sync.UserRepository", return_value=user_repository),
        patch("litellm.proxy.management_endpoints.team_endpoints.team_member_add", new_callable=AsyncMock) as add,
        patch("litellm.proxy.management_endpoints.team_endpoints.team_member_delete", new_callable=AsyncMock) as delete,
    ):
        await sync_sso_team_memberships(
            prisma_client=MagicMock(),
            user_info=user_info,
            target_team_ids=["new-sso-team"],
        )

    assert add.await_args.kwargs["data"].team_id == "new-sso-team"
    assert delete.await_args.kwargs["data"].team_id == "old-sso-team"
    persisted_metadata = user_repository.table.update_many.await_args.kwargs["data"]["metadata"]
    assert persisted_metadata[SSO_MANAGED_TEAM_IDS_METADATA_KEY] == ["new-sso-team"]


@pytest.mark.asyncio
async def test_missing_configured_team_claim_preserves_existing_memberships():
    result = SimpleNamespace(
        team_ids=["unrelated-access-group"],
        sso_team_mapping_configured=True,
        sso_team_claim_present=False,
    )
    user_info = SimpleNamespace(user_id="user-1", teams=["existing-team"])

    with patch("litellm.proxy.management_endpoints.ui_sso.add_missing_team_member", new_callable=AsyncMock) as add:
        await SSOAuthenticationHandler.add_user_to_teams_from_sso_response(result=result, user_info=user_info)

    add.assert_not_awaited()
