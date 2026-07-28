import asyncio
import hashlib
import json
from copy import deepcopy
from typing import Any, Dict, List

from fastapi import Request

from litellm._logging import verbose_proxy_logger
from litellm.proxy._types import (
    LitellmUserRoles,
    Member,
    NewTeamRequest,
    TeamMemberAddRequest,
    TeamMemberDeleteRequest,
    UserAPIKeyAuth,
)
from litellm.proxy.utils import PrismaClient
from litellm.repositories.team_repository import TeamRepository
from litellm.repositories.user_repository import UserRepository

SSO_MANAGED_TEAM_IDS_METADATA_KEY = "litellm_sso_managed_team_ids"
SSO_MANAGED_TEAM_METADATA_KEY = "litellm_sso_managed"
_TEAM_VALUE_KEYS = (
    "team_name",
    "team_alias",
    "name",
    "grpnm",
    "display_name",
    "team_id",
    "id",
    "value",
)
_TEAM_CONTAINER_KEYS = ("teams", "groups", "items", "values")


def _mapping_team_value(value: Dict[Any, Any]) -> Any:
    for key in _TEAM_VALUE_KEYS:
        if key in value:
            return value[key]
    for key in _TEAM_CONTAINER_KEYS:
        if key in value:
            return value[key]
    enabled_keys = [str(key) for key, enabled in value.items() if enabled is True]
    if enabled_keys:
        return enabled_keys
    return next(iter(value.values())) if len(value) == 1 else None


def normalize_sso_team_claim(raw_value: Any) -> List[str]:
    normalized: List[str] = []

    def append_value(value: Any) -> None:
        if value is None or isinstance(value, bool):
            return
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return
            if stripped[:1] in {"[", "{"}:
                try:
                    append_value(json.loads(stripped))
                    return
                except (json.JSONDecodeError, TypeError):
                    pass
            normalized.append(stripped)
            return
        if isinstance(value, (list, tuple, set)):
            for item in value:
                append_value(item)
            return
        if isinstance(value, dict):
            append_value(_mapping_team_value(value))
            return
        normalized.append(str(value).strip())

    append_value(raw_value)
    return list(dict.fromkeys(value for value in normalized if value))


def build_sso_team_id(team_name: str) -> str:
    normalized_name = " ".join(team_name.split()).casefold()
    digest = hashlib.sha256(normalized_name.encode("utf-8")).hexdigest()[:32]
    return f"litellm-sso-{digest}"


async def resolve_or_create_sso_teams(
    prisma_client: PrismaClient,
    team_claim_values: List[str],
) -> List[str]:
    resolved_team_ids: List[str] = []
    for claim_value in team_claim_values:
        existing_team = await TeamRepository(prisma_client).table.find_unique(where={"team_id": claim_value})
        if existing_team is None:
            existing_team = await TeamRepository(prisma_client).table.find_first(where={"team_alias": claim_value})
        if existing_team is not None:
            resolved_team_ids.append(existing_team.team_id)
            continue

        team_id = build_sso_team_id(claim_value)
        existing_team = await TeamRepository(prisma_client).table.find_unique(where={"team_id": team_id})
        if existing_team is None:
            from litellm.proxy.management_endpoints.team_endpoints import new_team

            creation_result = await asyncio.gather(
                new_team(
                    data=NewTeamRequest(
                        team_id=team_id,
                        team_alias=claim_value,
                        metadata={SSO_MANAGED_TEAM_METADATA_KEY: True, "source": "oidc"},
                    ),
                    http_request=Request(scope={"type": "http", "method": "POST"}),
                    user_api_key_dict=UserAPIKeyAuth(user_role=LitellmUserRoles.PROXY_ADMIN),
                ),
                return_exceptions=True,
            )
            if isinstance(creation_result[0], Exception):
                existing_team = await TeamRepository(prisma_client).table.find_unique(where={"team_id": team_id})
                if existing_team is None:
                    raise creation_result[0]
        resolved_team_ids.append(team_id)
    return list(dict.fromkeys(resolved_team_ids))


def _get_user_metadata(user_info: Any) -> Dict[str, Any]:
    metadata = getattr(user_info, "metadata", None)
    return deepcopy(metadata) if isinstance(metadata, dict) else {}


async def sync_sso_team_memberships(
    prisma_client: PrismaClient,
    user_info: Any,
    target_team_ids: List[str],
) -> None:
    from litellm.proxy.management_endpoints.team_endpoints import team_member_add, team_member_delete

    user_id: str | None = getattr(user_info, "user_id", None)
    if not user_id:
        return

    metadata = _get_user_metadata(user_info)
    previous_value = metadata.get(SSO_MANAGED_TEAM_IDS_METADATA_KEY, [])
    previous_team_ids = [str(team_id) for team_id in previous_value] if isinstance(previous_value, list) else []
    current_team_ids = getattr(user_info, "teams", None) or []
    target_set = set(target_team_ids)
    previous_set = set(previous_team_ids)
    current_set = set(current_team_ids)
    operation_failed = False

    for team_id in target_set - current_set:
        add_result = await asyncio.gather(
            team_member_add(
                data=TeamMemberAddRequest(
                    member=Member(user_id=user_id, role="user"),
                    team_id=team_id,
                ),
                user_api_key_dict=UserAPIKeyAuth(user_role=LitellmUserRoles.PROXY_ADMIN),
            ),
            return_exceptions=True,
        )
        if isinstance(add_result[0], Exception):
            operation_failed = True
            verbose_proxy_logger.error(f"Failed to add SSO user {user_id} to team {team_id}: {add_result[0]}")

    for team_id in (previous_set - target_set) & current_set:
        delete_result = await asyncio.gather(
            team_member_delete(
                data=TeamMemberDeleteRequest(team_id=team_id, user_id=user_id),
                user_api_key_dict=UserAPIKeyAuth(user_role=LitellmUserRoles.PROXY_ADMIN),
            ),
            return_exceptions=True,
        )
        if isinstance(delete_result[0], Exception):
            operation_failed = True
            verbose_proxy_logger.error(f"Failed to remove SSO user {user_id} from team {team_id}: {delete_result[0]}")

    if operation_failed:
        return

    metadata[SSO_MANAGED_TEAM_IDS_METADATA_KEY] = sorted(target_set)
    await UserRepository(prisma_client).table.update_many(
        where={"user_id": user_id},
        data={"metadata": metadata},
    )
