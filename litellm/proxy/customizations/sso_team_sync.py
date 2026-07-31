import asyncio
import hashlib
import json
import uuid
from copy import deepcopy
from datetime import datetime, timezone
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
from litellm.proxy.customizations.personal_key_policy import human_organization_id
from litellm.proxy.utils import PrismaClient
from litellm.repositories.team_repository import TeamRepository

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
HUMAN_ORGANIZATION_ALIAS = "Human quota pool"
HUMAN_ORGANIZATION_BUDGET_SUFFIX = "-budget"


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


async def ensure_human_organization(prisma_client: PrismaClient) -> str:
    organization_id = human_organization_id()
    budget_id = f"{organization_id}{HUMAN_ORGANIZATION_BUDGET_SUFFIX}"
    await prisma_client.db.litellm_budgettable.upsert(
        where={"budget_id": budget_id},
        data={
            "create": {
                "budget_id": budget_id,
                "created_by": "oidc-sso",
                "updated_by": "oidc-sso",
            },
            "update": {},
        },
    )
    await prisma_client.db.litellm_organizationtable.upsert(
        where={"organization_id": organization_id},
        data={
            "create": {
                "organization_id": organization_id,
                "organization_alias": HUMAN_ORGANIZATION_ALIAS,
                "budget_id": budget_id,
                "metadata": {"quota_pool_type": "human"},
                "models": [],
                "created_by": "oidc-sso",
                "updated_by": "oidc-sso",
            },
            "update": {},
        },
    )
    return organization_id


async def resolve_or_create_sso_teams(
    prisma_client: PrismaClient,
    team_claim_values: List[str],
) -> List[str]:
    if len(team_claim_values) != 1:
        raise ValueError("OIDC user_orgnm must contain exactly one department")
    organization_id = await ensure_human_organization(prisma_client)
    resolved_team_ids: List[str] = []
    for claim_value in team_claim_values:
        existing_team = await TeamRepository(prisma_client).table.find_unique(where={"team_id": claim_value})
        if existing_team is None:
            existing_team = await TeamRepository(prisma_client).table.find_first(where={"team_alias": claim_value})
        if existing_team is not None:
            if existing_team.organization_id != organization_id:
                metadata = getattr(existing_team, "metadata", None)
                if not isinstance(metadata, dict) or metadata.get(SSO_MANAGED_TEAM_METADATA_KEY) is not True:
                    raise ValueError(f"OIDC department team {existing_team.team_id} belongs to another scope")
                await TeamRepository(prisma_client).table.update(
                    where={"team_id": existing_team.team_id},
                    data={"organization_id": organization_id},
                )
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
                        organization_id=organization_id,
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
    if len(target_team_ids) != 1:
        raise ValueError("OIDC user_orgnm must resolve to exactly one department team")

    target_set = set(target_team_ids)
    organization_id = human_organization_id()
    active_token_hash: str | None = None
    deprecated_token_hashes: tuple[str, ...] = ()
    async with prisma_client.db.tx() as tx:
        await tx.execute_raw("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", user_id)
        current_user = await tx.litellm_usertable.find_unique(where={"user_id": user_id})
        if current_user is None:
            raise ValueError(f"SSO user {user_id} no longer exists")
        metadata = _get_user_metadata(current_user)
        previous_value = metadata.get(SSO_MANAGED_TEAM_IDS_METADATA_KEY, [])
        previous_team_ids = [str(team_id) for team_id in previous_value] if isinstance(previous_value, list) else []
        previous_set = set(previous_team_ids)
        current_set = set(current_user.teams or [])
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
                verbose_proxy_logger.error(
                    f"Failed to remove SSO user {user_id} from team {team_id}: {delete_result[0]}"
                )

        if operation_failed:
            raise RuntimeError(f"SSO department membership synchronization failed for {user_id}")

        metadata[SSO_MANAGED_TEAM_IDS_METADATA_KEY] = sorted(target_set)
        await tx.litellm_organizationmembership.upsert(
            where={
                "user_id_organization_id": {
                    "user_id": user_id,
                    "organization_id": organization_id,
                }
            },
            data={
                "create": {
                    "user_id": user_id,
                    "organization_id": organization_id,
                    "user_role": LitellmUserRoles.INTERNAL_USER.value,
                },
                "update": {},
            },
        )
        await tx.litellm_usertable.update_many(
            where={"user_id": user_id},
            data={"metadata": metadata, "organization_id": organization_id},
        )
        audit_action = (
            "sso_first_provisioned"
            if not previous_set
            else "sso_department_changed"
            if previous_set != target_set
            else "sso_profile_synced"
        )
        await tx.litellm_auditlog.create(
            data={
                "id": str(uuid.uuid4()),
                "updated_at": datetime.now(timezone.utc),
                "changed_by": user_id,
                "changed_by_api_key": "",
                "table_name": "LiteLLM_UserTable",
                "object_id": user_id,
                "action": audit_action,
                "updated_values": {
                    "organization_id": organization_id,
                    "previous_department_team_ids": sorted(previous_set),
                    "department_team_ids": sorted(target_set),
                    "added_team_ids": sorted(target_set - previous_set),
                    "removed_team_ids": sorted(previous_set - target_set),
                    "result": "success",
                },
            }
        )
        registry = await tx.corporatepersonalkeyregistry.find_unique(where={"user_id": user_id})
        if registry is not None and registry.active_token_hash is not None:
            active_token_hash = registry.active_token_hash
            deprecated_tokens = await tx.litellm_deprecatedverificationtoken.find_many(
                where={
                    "active_token_id": active_token_hash,
                    "revoke_at": {"gt": datetime.now(timezone.utc)},
                }
            )
            deprecated_token_hashes = tuple(token.token for token in deprecated_tokens)
            await tx.litellm_verificationtoken.update(
                where={"token": active_token_hash},
                data={
                    "team_id": target_team_ids[0],
                    "organization_id": organization_id,
                    "updated_by": "oidc-sso",
                },
            )
            await tx.corporatepersonalkeyregistry.update(
                where={"user_id": user_id},
                data={
                    "department_team_id": target_team_ids[0],
                    "organization_id": organization_id,
                },
            )
    if active_token_hash is not None:
        from litellm.proxy.auth.auth_checks import _delete_cache_key_object
        from litellm.proxy.proxy_server import proxy_logging_obj, user_api_key_cache

        for token_hash in (active_token_hash, *deprecated_token_hashes):
            await _delete_cache_key_object(
                hashed_token=token_hash,
                user_api_key_cache=user_api_key_cache,
                proxy_logging_obj=proxy_logging_obj,
            )
