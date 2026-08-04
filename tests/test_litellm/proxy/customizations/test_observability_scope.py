from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from litellm.proxy._types import (
    LiteLLM_TeamTable,
    LiteLLM_UserTable,
    LitellmUserRoles,
    Member,
    UserAPIKeyAuth,
)
from litellm.proxy.customizations.observability_scope import resolve_observability_scope


@pytest.mark.asyncio
async def test_oidc_scope_separates_department_owner_keys_from_manual_team_service_keys():
    user = LiteLLM_UserTable(
        user_id="user-1",
        teams=["department", "service-team", "stale-team"],
        metadata={"litellm_sso_managed_team_ids": ["department"]},
    )
    teams = [
        LiteLLM_TeamTable(
            team_id="department",
            members_with_roles=[Member(user_id="user-1", role="user"), Member(user_id="coworker", role="user")],
        ),
        LiteLLM_TeamTable(
            team_id="service-team",
            members_with_roles=[Member(user_id="user-1", role="user")],
        ),
    ]
    own_keys = [
        SimpleNamespace(token="own-department", team_id="department", user_id="user-1"),
        SimpleNamespace(token="own-manual", team_id="service-team", user_id="user-1"),
    ]
    service_keys = [SimpleNamespace(token="service-key", team_id="service-team", user_id=None)]
    token_find_many = AsyncMock(side_effect=[own_keys, service_keys])
    team_find_many = AsyncMock(return_value=teams)

    with (
        patch(
            "litellm.proxy.customizations.observability_scope._get_user",
            new_callable=AsyncMock,
            return_value=user,
        ),
        patch(
            "litellm.proxy.customizations.observability_scope.TeamRepository",
            return_value=SimpleNamespace(table=SimpleNamespace(find_many=team_find_many)),
        ),
        patch(
            "litellm.proxy.customizations.observability_scope.VerificationTokenRepository",
            return_value=SimpleNamespace(table=SimpleNamespace(find_many=token_find_many)),
        ),
    ):
        scope = await resolve_observability_scope(
            prisma_client=MagicMock(),
            user_api_key_dict=UserAPIKeyAuth(user_id="user-1", user_role=LitellmUserRoles.INTERNAL_USER),
        )

    assert scope.key_hashes_for_team("department") == ("own-department",)
    assert scope.key_hashes_for_team("service-team") == ("service-key",)
    assert scope.key_hashes_for_team("stale-team") == ()
    assert scope.allowed_key_hashes == ("own-department", "service-key")
    assert token_find_many.await_args_list[1].kwargs["where"] == {
        "team_id": {"in": ["service-team"]},
        "user_id": None,
    }


@pytest.mark.asyncio
async def test_oidc_scope_with_invalid_managed_team_metadata_is_empty():
    user = LiteLLM_UserTable(
        user_id="user-1",
        teams=["department", "other-department"],
        metadata={"litellm_sso_managed_team_ids": ["department", "other-department"]},
    )

    with patch(
        "litellm.proxy.customizations.observability_scope._get_user",
        new_callable=AsyncMock,
        return_value=user,
    ):
        scope = await resolve_observability_scope(
            prisma_client=MagicMock(),
            user_api_key_dict=UserAPIKeyAuth(user_id="user-1", user_role=LitellmUserRoles.INTERNAL_USER),
        )

    assert scope.oidc_managed is True
    assert scope.allowed_key_hashes == ()
    assert scope.team_key_hashes == ()


@pytest.mark.asyncio
async def test_proxy_admin_observability_scope_remains_unrestricted():
    with patch(
        "litellm.proxy.customizations.observability_scope._get_user",
        new_callable=AsyncMock,
    ) as get_user:
        scope = await resolve_observability_scope(
            prisma_client=MagicMock(),
            user_api_key_dict=UserAPIKeyAuth(user_id="admin", user_role=LitellmUserRoles.PROXY_ADMIN),
        )

    assert scope.unrestricted is True
    get_user.assert_not_awaited()
