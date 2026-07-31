import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from prisma import Prisma
from prisma.errors import PrismaError
from prisma.models import (
    CorporatePersonalKeyRegistry,
    LiteLLM_TeamTable,
    LiteLLM_UserTable,
    LiteLLM_VerificationToken,
)
from prisma.types import LiteLLM_AuditLogCreateInput
from pydantic import TypeAdapter, ValidationError

if TYPE_CHECKING:
    from litellm.proxy.utils import PrismaClient

from litellm._logging import verbose_proxy_logger
from litellm.constants import LENGTH_OF_LITELLM_GENERATED_KEY, UI_SESSION_TOKEN_TEAM_ID
from litellm.proxy._types import LitellmUserRoles, UserAPIKeyAuth, hash_token
from litellm.proxy.auth.auth_utils import abbreviate_api_key
from litellm.proxy.auth.user_api_key_auth import user_api_key_auth
from litellm.proxy.customizations.personal_key_policy import (
    PersonalKeyLifecycle,
    PersonalKeyRegistryStatus,
    build_personal_key_metadata,
    human_organization_id,
    personal_key_expiry,
    personal_key_revoke_at,
    read_personal_key_metadata,
    resolve_department_team_id,
)
from litellm.proxy.db.prisma_client import PrismaWrapper
from litellm.proxy.db.routing_prisma_wrapper import RoutingPrismaWrapper
from litellm.types.proxy.management_endpoints.personal_key_endpoints import (
    PersonalKeyCreateRequest,
    PersonalKeyCreateResponse,
    PersonalKeyDeleteResponse,
    PersonalKeyMetrics,
    PersonalKeyRotateResponse,
    PersonalKeyView,
)

router = APIRouter()
PersonalKeyAuth = Annotated[UserAPIKeyAuth, Depends(user_api_key_auth)]
PersonalKeyUserId = Annotated[str | None, Query()]
_JSON_OBJECT_ADAPTER = TypeAdapter(dict[str, object])


def _is_proxy_admin(auth: UserAPIKeyAuth) -> bool:
    return auth.user_role in {LitellmUserRoles.PROXY_ADMIN, LitellmUserRoles.PROXY_ADMIN.value}


def _target_user_id(requested_user_id: str | None, auth: UserAPIKeyAuth) -> str:
    caller_user_id = auth.user_id
    if not _is_proxy_admin(auth) and auth.user_role not in {
        LitellmUserRoles.INTERNAL_USER,
        LitellmUserRoles.INTERNAL_USER.value,
    }:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only internal users and proxy administrators can manage personal keys",
        )
    if requested_user_id is not None and requested_user_id != caller_user_id and not _is_proxy_admin(auth):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="A personal key can only be managed by its owner"
        )
    target = requested_user_id or caller_user_id
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="The authenticated principal has no user owner"
        )
    if not _is_proxy_admin(auth) and not auth.is_session_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Personal keys can only be managed from an authenticated UI session",
        )
    return target


def _writer_database(prisma_client: "PrismaClient") -> Prisma:
    database = prisma_client.db
    if isinstance(database, RoutingPrismaWrapper):
        return database.writer.original_prisma
    if isinstance(database, PrismaWrapper):
        return database.original_prisma
    raise TypeError("Unsupported Prisma database wrapper")


def _json_object(value: object) -> dict[str, object]:
    try:
        if isinstance(value, str):
            return _JSON_OBJECT_ADAPTER.validate_json(value)
        return _JSON_OBJECT_ADAPTER.validate_python(value)
    except ValidationError:
        return {}


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _personal_key_status(
    token_row: LiteLLM_VerificationToken,
    expires: datetime,
) -> Literal["active", "blocked", "expired"]:
    if bool(token_row.blocked):
        return "blocked"
    if _as_utc(expires) <= datetime.now(timezone.utc):
        return "expired"
    return "active"


def _view_from_rows(
    registry: CorporatePersonalKeyRegistry,
    token_row: LiteLLM_VerificationToken,
) -> PersonalKeyView:
    expires = token_row.expires
    if not isinstance(expires, datetime):
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Personal key expiry is missing")
    return PersonalKeyView(
        logical_key_id=str(registry.logical_key_id),
        key_alias=token_row.key_alias,
        user_id=str(registry.user_id),
        team_id=str(token_row.team_id),
        organization_id=str(token_row.organization_id),
        generation=int(registry.generation),
        status=_personal_key_status(token_row, expires),
        expires=expires,
        created_at=token_row.created_at,
        updated_at=token_row.updated_at,
    )


async def _load_scope(
    db: Prisma,
    user_id: str,
) -> tuple[LiteLLM_UserTable, LiteLLM_TeamTable, str]:
    user_row = await db.litellm_usertable.find_unique(where={"user_id": user_id})
    if user_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Internal user not found")
    try:
        department_team_id = resolve_department_team_id(_json_object(user_row.metadata))
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    team_row = await db.litellm_teamtable.find_unique(where={"team_id": department_team_id})
    if team_row is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="OIDC department team not found")
    organization_id = human_organization_id()
    if team_row.organization_id != organization_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="OIDC department team is not assigned to the Human organization",
        )
    organization_row = await db.litellm_organizationtable.find_unique(where={"organization_id": organization_id})
    if organization_row is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Human organization not found")
    return user_row, team_row, organization_id


async def _audit(
    db: Prisma,
    actor_user_id: str,
    target_user_id: str,
    logical_key_id: str,
    action: str,
    result: str,
) -> None:
    audit_data: LiteLLM_AuditLogCreateInput = {
        "id": str(uuid.uuid4()),
        "updated_at": datetime.now(timezone.utc),
        "changed_by": actor_user_id,
        "changed_by_api_key": "",
        "table_name": "CorporatePersonalKeyRegistry",
        "object_id": logical_key_id,
        "action": action,
        "updated_values": json.dumps(
            {
                "target_user_id": target_user_id,
                "owner_type": "user",
                "key_purpose": "personal_llm",
                "result": result,
            }
        ),
    }
    await db.litellm_auditlog.create(data=audit_data)


async def _registry_and_token(
    db: Prisma,
    user_id: str,
) -> tuple[CorporatePersonalKeyRegistry, LiteLLM_VerificationToken]:
    registry = await db.corporatepersonalkeyregistry.find_unique(where={"user_id": user_id})
    if registry is None or registry.active_token_hash is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Personal key not found")
    token_row = await db.litellm_verificationtoken.find_unique(where={"token": registry.active_token_hash})
    if token_row is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Personal key registry is inconsistent")
    metadata = read_personal_key_metadata(_json_object(token_row.metadata))
    if metadata is None or metadata.logical_key_id != registry.logical_key_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Personal key ownership metadata is inconsistent"
        )
    return registry, token_row


@router.post(
    "/internal/personal-key",
    tags=["personal key management"],
    response_model=PersonalKeyCreateResponse,
)
async def create_personal_key(
    data: PersonalKeyCreateRequest,
    auth: PersonalKeyAuth,
) -> PersonalKeyCreateResponse:
    from litellm.proxy.proxy_server import prisma_client

    if prisma_client is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database is not connected")
    database = _writer_database(prisma_client)
    target_user_id = _target_user_id(data.user_id, auth)
    actor_user_id = auth.user_id or "proxy-admin"
    plaintext = f"sk-{secrets.token_urlsafe(LENGTH_OF_LITELLM_GENERATED_KEY)}"
    token_hash = hash_token(plaintext)
    logical_key_id = str(uuid.uuid4())
    expires = personal_key_expiry()
    legacy_token_hashes: tuple[str, ...] = ()
    try:
        async with database.tx() as tx:
            await tx.execute_raw("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", target_user_id)
            user_row, team_row, organization_id = await _load_scope(tx, target_user_id)
            if (
                target_user_id != actor_user_id
                and getattr(user_row, "user_role", None) != LitellmUserRoles.INTERNAL_USER.value
            ):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Administrators can issue on-behalf personal keys only for internal users",
                )
            existing_registry = await tx.corporatepersonalkeyregistry.find_unique(where={"user_id": target_user_id})
            if existing_registry is not None and existing_registry.active_token_hash is not None:
                existing_token = await tx.litellm_verificationtoken.find_unique(
                    where={"token": existing_registry.active_token_hash}
                )
                if (
                    existing_token is not None
                    and existing_token.blocked is not True
                    and existing_token.expires is not None
                    and _as_utc(existing_token.expires) > datetime.now(timezone.utc)
                ):
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="The user already has an active personal key",
                    )
                await tx.corporatepersonalkeyregistry.delete(where={"user_id": target_user_id})
            legacy_tokens = await tx.litellm_verificationtoken.find_many(
                where={
                    "user_id": target_user_id,
                    "AND": [
                        {"OR": [{"blocked": False}, {"blocked": None}]},
                        {
                            "OR": [
                                {"expires": None},
                                {"expires": {"gt": datetime.now(timezone.utc)}},
                            ]
                        },
                        {
                            "OR": [
                                {"team_id": None},
                                {"team_id": {"not": UI_SESSION_TOKEN_TEAM_ID}},
                            ]
                        },
                    ],
                }
            )
            legacy_token_hashes = tuple(token.token for token in legacy_tokens)
            if legacy_token_hashes:
                await tx.litellm_verificationtoken.update_many(
                    where={"token": {"in": list(legacy_token_hashes)}},
                    data={"blocked": True, "updated_by": actor_user_id},
                )
            registry = await tx.corporatepersonalkeyregistry.create(
                data={
                    "user_id": target_user_id,
                    "logical_key_id": logical_key_id,
                    "active_token_hash": token_hash,
                    "generation": 1,
                    "status": PersonalKeyRegistryStatus.ACTIVE.value,
                    "department_team_id": team_row.team_id,
                    "organization_id": organization_id,
                }
            )
            metadata = build_personal_key_metadata(
                existing_metadata={},
                logical_key_id=logical_key_id,
                generation=1,
                lifecycle=PersonalKeyLifecycle.ACTIVE,
            )
            token_row = await tx.litellm_verificationtoken.create(
                data={
                    "token": token_hash,
                    "key_name": abbreviate_api_key(plaintext),
                    "key_alias": data.key_alias,
                    "expires": expires,
                    "models": ["all-team-models"],
                    "aliases": json.dumps({}),
                    "config": json.dumps({}),
                    "permissions": json.dumps({}),
                    "metadata": json.dumps(metadata),
                    "model_spend": json.dumps({}),
                    "model_max_budget": json.dumps({}),
                    "budget_fallbacks": json.dumps({}),
                    "router_settings": json.dumps({}),
                    "user_id": target_user_id,
                    "team_id": team_row.team_id,
                    "organization_id": organization_id,
                    "blocked": False,
                    "allowed_cache_controls": [],
                    "allowed_routes": [],
                    "policies": [],
                    "access_group_ids": [],
                    "key_type": "llm_api",
                    "rotation_count": 0,
                    "auto_rotate": False,
                    "created_by": actor_user_id,
                    "updated_by": actor_user_id,
                }
            )
            await _audit(tx, actor_user_id, target_user_id, logical_key_id, "created", "success")
    except HTTPException as error:
        if error.status_code == status.HTTP_409_CONFLICT:
            existing = await database.corporatepersonalkeyregistry.find_unique(where={"user_id": target_user_id})
            if existing is not None:
                try:
                    await _audit(
                        database,
                        actor_user_id,
                        target_user_id,
                        str(existing.logical_key_id),
                        "creation_rejected",
                        "duplicate",
                    )
                except PrismaError as audit_error:
                    verbose_proxy_logger.error("Failed to audit rejected personal key creation: %s", audit_error)
        raise
    except (AttributeError, PrismaError, RuntimeError, TypeError, ValueError) as error:
        existing = await database.corporatepersonalkeyregistry.find_unique(where={"user_id": target_user_id})
        if existing is not None:
            try:
                await _audit(
                    database,
                    actor_user_id,
                    target_user_id,
                    str(existing.logical_key_id),
                    "creation_rejected",
                    "duplicate",
                )
            except PrismaError as audit_error:
                verbose_proxy_logger.error("Failed to audit rejected personal key creation: %s", audit_error)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The user already has a personal key",
            ) from error
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Personal key creation failed",
        ) from error
    if legacy_token_hashes:
        from litellm.proxy.auth.auth_checks import _delete_cache_key_object
        from litellm.proxy.proxy_server import proxy_logging_obj, user_api_key_cache

        for legacy_token_hash in legacy_token_hashes:
            await _delete_cache_key_object(
                hashed_token=legacy_token_hash,
                user_api_key_cache=user_api_key_cache,
                proxy_logging_obj=proxy_logging_obj,
            )
    view = _view_from_rows(registry, token_row)
    return PersonalKeyCreateResponse(**view.model_dump(), key=plaintext)


@router.get(
    "/internal/personal-key",
    tags=["personal key management"],
    response_model=PersonalKeyView,
)
async def get_personal_key(
    auth: PersonalKeyAuth,
    user_id: PersonalKeyUserId = None,
) -> PersonalKeyView:
    from litellm.proxy.proxy_server import prisma_client

    if prisma_client is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database is not connected")
    database = _writer_database(prisma_client)
    target_user_id = _target_user_id(user_id, auth)
    registry, token_row = await _registry_and_token(database, target_user_id)
    return _view_from_rows(registry, token_row)


@router.post(
    "/internal/personal-key/rotate",
    tags=["personal key management"],
    response_model=PersonalKeyRotateResponse,
)
async def rotate_personal_key(
    auth: PersonalKeyAuth,
    user_id: PersonalKeyUserId = None,
) -> PersonalKeyRotateResponse:
    from litellm.proxy.auth.auth_checks import _delete_cache_key_object
    from litellm.proxy.proxy_server import prisma_client, proxy_logging_obj, user_api_key_cache

    if prisma_client is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database is not connected")
    database = _writer_database(prisma_client)
    target_user_id = _target_user_id(user_id, auth)
    actor_user_id = auth.user_id or "proxy-admin"
    plaintext = f"sk-{secrets.token_urlsafe(LENGTH_OF_LITELLM_GENERATED_KEY)}"
    new_hash = hash_token(plaintext)
    expires = personal_key_expiry()
    revoke_at = personal_key_revoke_at()
    old_hash = ""
    ancestor_hashes: tuple[str, ...] = ()
    async with database.tx() as tx:
        await tx.execute_raw("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", target_user_id)
        registry, token_row = await _registry_and_token(tx, target_user_id)
        old_hash = str(registry.active_token_hash)
        next_generation = int(registry.generation) + 1
        logical_key_id = str(registry.logical_key_id)
        metadata = build_personal_key_metadata(
            existing_metadata=_json_object(token_row.metadata),
            logical_key_id=logical_key_id,
            generation=next_generation,
            lifecycle=PersonalKeyLifecycle.ACTIVE,
        )
        ancestors = await tx.litellm_deprecatedverificationtoken.find_many(
            where={"active_token_id": old_hash, "revoke_at": {"gt": datetime.now(timezone.utc)}}
        )
        ancestor_hashes = tuple(str(row.token) for row in ancestors)
        await tx.litellm_verificationtoken.update(
            where={"token": old_hash},
            data={
                "token": new_hash,
                "key_name": abbreviate_api_key(plaintext),
                "expires": expires,
                "metadata": json.dumps(metadata),
                "rotation_count": {"increment": 1},
                "last_rotation_at": datetime.now(timezone.utc),
                "updated_by": actor_user_id,
            },
        )
        await tx.litellm_deprecatedverificationtoken.upsert(
            where={"token": old_hash},
            data={
                "create": {
                    "token": old_hash,
                    "active_token_id": new_hash,
                    "revoke_at": revoke_at,
                },
                "update": {
                    "active_token_id": new_hash,
                    "revoke_at": revoke_at,
                },
            },
        )
        if ancestor_hashes:
            await tx.litellm_deprecatedverificationtoken.update_many(
                where={"token": {"in": list(ancestor_hashes)}},
                data={"active_token_id": new_hash},
            )
        registry = await tx.corporatepersonalkeyregistry.update(
            where={"user_id": target_user_id},
            data={
                "active_token_hash": new_hash,
                "generation": next_generation,
                "department_team_id": token_row.team_id,
                "organization_id": token_row.organization_id,
                "status": PersonalKeyRegistryStatus.ACTIVE.value,
            },
        )
        token_row = await tx.litellm_verificationtoken.find_unique(where={"token": new_hash})
        if token_row is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Rotated personal key is missing",
            )
        await _audit(tx, actor_user_id, target_user_id, logical_key_id, "rotated", "success")
    for cached_hash in (old_hash, *ancestor_hashes):
        await _delete_cache_key_object(
            hashed_token=cached_hash,
            user_api_key_cache=user_api_key_cache,
            proxy_logging_obj=proxy_logging_obj,
        )
    view = _view_from_rows(registry, token_row)
    return PersonalKeyRotateResponse(**view.model_dump(), key=plaintext, previous_key_revoke_at=revoke_at)


@router.delete(
    "/internal/personal-key",
    tags=["personal key management"],
    response_model=PersonalKeyDeleteResponse,
)
async def delete_personal_key(
    auth: PersonalKeyAuth,
    user_id: PersonalKeyUserId = None,
) -> PersonalKeyDeleteResponse:
    from litellm.proxy.auth.auth_checks import _delete_cache_key_object
    from litellm.proxy.proxy_server import prisma_client, proxy_logging_obj, user_api_key_cache

    if prisma_client is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database is not connected")
    database = _writer_database(prisma_client)
    target_user_id = _target_user_id(user_id, auth)
    actor_user_id = auth.user_id or "proxy-admin"
    async with database.tx() as tx:
        await tx.execute_raw("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", target_user_id)
        registry, _ = await _registry_and_token(tx, target_user_id)
        token_hash = str(registry.active_token_hash)
        logical_key_id = str(registry.logical_key_id)
        await tx.litellm_verificationtoken.update(
            where={"token": token_hash},
            data={"blocked": True, "updated_by": actor_user_id},
        )
        await tx.corporatepersonalkeyregistry.delete(where={"user_id": target_user_id})
        await _audit(tx, actor_user_id, target_user_id, logical_key_id, "deleted", "success")
    await _delete_cache_key_object(
        hashed_token=token_hash,
        user_api_key_cache=user_api_key_cache,
        proxy_logging_obj=proxy_logging_obj,
    )
    return PersonalKeyDeleteResponse(deleted=True, logical_key_id=logical_key_id)


@router.get(
    "/internal/personal-key/metrics",
    tags=["personal key management"],
    response_model=PersonalKeyMetrics,
)
async def get_personal_key_metrics(
    auth: PersonalKeyAuth,
) -> PersonalKeyMetrics:
    from litellm.proxy.proxy_server import prisma_client

    if not _is_proxy_admin(auth):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only proxy administrators can view metrics")
    if prisma_client is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database is not connected")
    database = _writer_database(prisma_client)
    now = datetime.now(timezone.utc)
    active_personal_keys = await database.corporatepersonalkeyregistry.count(
        where={"status": PersonalKeyRegistryStatus.ACTIVE.value}
    )
    active_registries = await database.corporatepersonalkeyregistry.find_many(
        where={
            "status": PersonalKeyRegistryStatus.ACTIVE.value,
            "active_token_hash": {"not": None},
        }
    )
    active_token_hashes = tuple(
        registry.active_token_hash for registry in active_registries if registry.active_token_hash is not None
    )
    expiring_within_seven_days = await database.litellm_verificationtoken.count(
        where={
            "token": {"in": active_token_hashes},
            "blocked": False,
            "expires": {
                "gt": now,
                "lte": now + timedelta(days=7),
            },
        }
    )
    grace_keys = await database.litellm_deprecatedverificationtoken.count(where={"revoke_at": {"gt": now}})
    return PersonalKeyMetrics(
        active_personal_keys=active_personal_keys,
        expiring_within_seven_days=expiring_within_seven_days,
        grace_keys=grace_keys,
    )
