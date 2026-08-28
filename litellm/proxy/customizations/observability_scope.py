from dataclasses import dataclass

from litellm.proxy._types import (
    LiteLLM_TeamTable,
    LiteLLM_UserTable,
    LitellmUserRoles,
    UserAPIKeyAuth,
)
from litellm.proxy.customizations.personal_key_policy import (
    SSO_MANAGED_TEAM_IDS_METADATA_KEY,
    resolve_department_team_id,
)
from litellm.proxy.utils import PrismaClient
from litellm.repositories.team_repository import TeamRepository
from litellm.repositories.verification_token_repository import VerificationTokenRepository


@dataclass(frozen=True, slots=True)
class ObservabilityScope:
    unrestricted: bool
    oidc_managed: bool
    user_id: str | None
    managed_team_id: str | None
    team_key_hashes: tuple[tuple[str, tuple[str, ...]], ...]
    allowed_key_hashes: tuple[str, ...]

    def key_hashes_for_team(self, team_id: str) -> tuple[str, ...]:
        return next((key_hashes for candidate, key_hashes in self.team_key_hashes if candidate == team_id), ())

    def can_view_team(self, team_id: str) -> bool:
        return self.unrestricted or any(candidate == team_id for candidate, _ in self.team_key_hashes)


def _is_current_member(user_id: str, team: LiteLLM_TeamTable) -> bool:
    return any(member.user_id == user_id for member in team.members_with_roles)


def _is_team_admin(user_api_key_dict: UserAPIKeyAuth, team: LiteLLM_TeamTable) -> bool:
    from litellm.proxy.management_endpoints.common_utils import _is_user_team_admin

    return _is_user_team_admin(user_api_key_dict=user_api_key_dict, team_obj=team)


async def _get_user(prisma_client: PrismaClient, user_api_key_dict: UserAPIKeyAuth) -> LiteLLM_UserTable | None:
    from litellm.proxy.auth.auth_checks import get_user_object
    from litellm.proxy.proxy_server import proxy_logging_obj, user_api_key_cache

    user_id = user_api_key_dict.user_id
    if user_id is None:
        return None
    return await get_user_object(
        user_id=user_id,
        prisma_client=prisma_client,
        user_api_key_cache=user_api_key_cache,
        user_id_upsert=False,
        proxy_logging_obj=proxy_logging_obj,
        check_db_only=True,
    )


async def resolve_observability_scope(
    prisma_client: PrismaClient,
    user_api_key_dict: UserAPIKeyAuth,
    user: LiteLLM_UserTable | None = None,
) -> ObservabilityScope:
    if user_api_key_dict.user_role in (
        LitellmUserRoles.PROXY_ADMIN,
        LitellmUserRoles.PROXY_ADMIN_VIEW_ONLY,
    ):
        return ObservabilityScope(True, False, user_api_key_dict.user_id, None, (), ())

    if user_api_key_dict.user_role not in (
        LitellmUserRoles.INTERNAL_USER,
        LitellmUserRoles.INTERNAL_USER_VIEW_ONLY,
    ):
        return ObservabilityScope(False, False, user_api_key_dict.user_id, None, (), ())

    try:
        resolved_user = user or await _get_user(prisma_client=prisma_client, user_api_key_dict=user_api_key_dict)
    except Exception:
        return ObservabilityScope(False, False, user_api_key_dict.user_id, None, (), ())
    if resolved_user is None:
        return ObservabilityScope(False, False, user_api_key_dict.user_id, None, (), ())

    metadata = resolved_user.metadata if isinstance(resolved_user.metadata, dict) else {}
    oidc_managed = SSO_MANAGED_TEAM_IDS_METADATA_KEY in metadata
    managed_team_id: str | None = None
    if oidc_managed:
        try:
            managed_team_id = resolve_department_team_id(metadata)
        except ValueError:
            return ObservabilityScope(False, True, resolved_user.user_id, None, (), ())

    unique_team_ids = tuple(dict.fromkeys(resolved_user.teams))
    team_rows = (
        await TeamRepository(prisma_client).table.find_many(where={"team_id": {"in": list(unique_team_ids)}})
        if unique_team_ids
        else []
    )
    parsed_teams = tuple(LiteLLM_TeamTable(**row.model_dump()) for row in team_rows)
    current_teams = tuple(team for team in parsed_teams if _is_current_member(resolved_user.user_id, team))

    own_key_rows = await VerificationTokenRepository(prisma_client).table.find_many(
        where={"user_id": resolved_user.user_id}
    )
    own_key_hashes_by_team = {
        team_id: tuple(row.token for row in own_key_rows if row.team_id == team_id and row.token)
        for team_id in unique_team_ids
    }

    if oidc_managed:
        managed_is_current = any(team.team_id == managed_team_id for team in current_teams)
        manual_admin_teams = tuple(
            team
            for team in current_teams
            if team.team_id != managed_team_id and _is_team_admin(user_api_key_dict=user_api_key_dict, team=team)
        )
        manual_team_key_rows = (
            await VerificationTokenRepository(prisma_client).table.find_many(
                where={"team_id": {"in": [team.team_id for team in manual_admin_teams]}}
            )
            if manual_admin_teams
            else []
        )
        managed_hashes = own_key_hashes_by_team.get(managed_team_id, ()) if managed_is_current else ()
        managed_team_keys = (
            ((managed_team_id, managed_hashes),) if managed_team_id is not None and managed_is_current else ()
        )
        team_key_hashes = (
            *managed_team_keys,
            *(
                (
                    team.team_id,
                    tuple(row.token for row in manual_team_key_rows if row.team_id == team.team_id and row.token),
                )
                for team in manual_admin_teams
            ),
        )
        allowed = tuple(dict.fromkeys(key_hash for _, key_hashes in team_key_hashes for key_hash in key_hashes))
        return ObservabilityScope(False, True, resolved_user.user_id, managed_team_id, team_key_hashes, allowed)

    permitted_teams = tuple(
        team for team in current_teams if _is_team_admin(user_api_key_dict=user_api_key_dict, team=team)
    )
    permitted_team_rows = (
        await VerificationTokenRepository(prisma_client).table.find_many(
            where={"team_id": {"in": [team.team_id for team in permitted_teams]}}
        )
        if permitted_teams
        else []
    )
    own_hashes = tuple(row.token for row in own_key_rows if row.token)
    team_key_hashes = tuple(
        (
            team.team_id,
            tuple(row.token for row in permitted_team_rows if row.team_id == team.team_id and row.token),
        )
        for team in permitted_teams
    )
    allowed = tuple(dict.fromkeys((*own_hashes, *(key_hash for _, hashes in team_key_hashes for key_hash in hashes))))
    return ObservabilityScope(False, False, resolved_user.user_id, None, team_key_hashes, allowed)
