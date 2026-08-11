import json
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, model_validator

from litellm.proxy._types import CommonProxyErrors, LitellmTableNames, LitellmUserRoles, UserAPIKeyAuth
from litellm.proxy.auth.user_api_key_auth import user_api_key_auth

router = APIRouter()
AuditLogAuth = Annotated[UserAPIKeyAuth, Depends(user_api_key_auth)]


class AuditLogResponse(BaseModel):
    id: str
    updated_at: datetime
    changed_by: str
    changed_by_api_key: str
    action: str
    table_name: str
    object_id: str
    success: bool
    before_value: object | None = None
    updated_values: object | None = None

    @model_validator(mode="before")
    @classmethod
    def read_success_from_payload(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value
        updated_values = value.get("updated_values")
        parsed_updated_values = updated_values
        if isinstance(updated_values, str):
            try:
                parsed_updated_values = json.loads(updated_values)
            except (TypeError, json.JSONDecodeError):
                parsed_updated_values = None
        stored_success = parsed_updated_values.get("success") if isinstance(parsed_updated_values, dict) else None
        return {**value, "success": stored_success if isinstance(stored_success, bool) else True}


class PaginatedAuditLogResponse(BaseModel):
    audit_logs: list[AuditLogResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


def _require_audit_reader(auth: UserAPIKeyAuth) -> None:
    allowed_roles = {
        LitellmUserRoles.PROXY_ADMIN,
        LitellmUserRoles.PROXY_ADMIN.value,
        LitellmUserRoles.PROXY_ADMIN_VIEW_ONLY,
        LitellmUserRoles.PROXY_ADMIN_VIEW_ONLY.value,
    }
    if auth.user_role not in allowed_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Audit logs require proxy administrator access"
        )


def _json_field_condition(field_name: str, value: object) -> dict[str, object]:
    return {
        "OR": [
            {"before_value": {"path": [field_name], "equals": value}},
            {"updated_values": {"path": [field_name], "equals": value}},
        ]
    }


def _key_hash_condition(value: str) -> dict[str, object]:
    return {
        "OR": [
            {"object_id": value},
            {"before_value": {"path": ["token_id"], "equals": value}},
            {"updated_values": {"path": ["token_id"], "equals": value}},
        ]
    }


def _team_id_condition(value: str) -> dict[str, object]:
    return {
        "OR": [
            {
                "AND": [
                    {"table_name": LitellmTableNames.TEAM_MEMBERSHIP_TABLE_NAME.value},
                    {"object_id": value},
                ]
            },
            {"before_value": {"path": ["team_id"], "equals": value}},
            {"updated_values": {"path": ["team_id"], "equals": value}},
        ]
    }


@router.get("/audit", tags=["Audit Logging"], response_model=PaginatedAuditLogResponse)
async def get_audit_logs(
    auth: AuditLogAuth,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    changed_by: str | None = Query(None),
    actor: str | None = Query(None),
    changed_by_api_key: str | None = Query(None),
    action: str | None = Query(None),
    table_name: str | None = Query(None),
    resource_type: str | None = Query(None),
    object_id: str | None = Query(None),
    resource_id: str | None = Query(None),
    object_team_id: str | None = Query(None),
    object_key_hash: str | None = Query(None),
    start_date: Annotated[datetime | None, Query()] = None,
    end_date: Annotated[datetime | None, Query()] = None,
    success: bool | None = Query(None),
    sort_order: Literal["asc", "desc"] = Query("desc"),
) -> PaginatedAuditLogResponse:
    from litellm.proxy.proxy_server import prisma_client

    _require_audit_reader(auth)
    if prisma_client is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"message": CommonProxyErrors.db_not_connected_error.value},
        )
    scalar_filters = {
        key: value
        for key, value in {
            "changed_by": actor or changed_by,
            "changed_by_api_key": changed_by_api_key,
            "action": action,
            "table_name": resource_type or table_name,
            "object_id": resource_id or object_id,
        }.items()
        if value is not None
    }
    date_filter = {key: value for key, value in {"gte": start_date, "lte": end_date}.items() if value is not None}
    json_filters = [
        *([_json_field_condition("success", success)] if success is not None else []),
        *([_team_id_condition(object_team_id)] if object_team_id is not None else []),
        *([_key_hash_condition(object_key_hash)] if object_key_hash is not None else []),
    ]
    where: dict[str, object] = {
        **scalar_filters,
        **({"updated_at": date_filter} if date_filter else {}),
        **({"AND": json_filters} if json_filters else {}),
    }
    rows = await prisma_client.db.litellm_auditlog.find_many(
        where=where,
        order={"updated_at": sort_order},
        skip=(page - 1) * page_size,
        take=page_size,
    )
    total = await prisma_client.db.litellm_auditlog.count(where=where)
    return PaginatedAuditLogResponse(
        audit_logs=[AuditLogResponse.model_validate(row.model_dump()) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size,
    )


@router.get("/audit/{audit_id}", tags=["Audit Logging"], response_model=AuditLogResponse)
async def get_audit_log_by_id(audit_id: str, auth: AuditLogAuth) -> AuditLogResponse:
    from litellm.proxy.proxy_server import prisma_client

    _require_audit_reader(auth)
    if prisma_client is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"message": CommonProxyErrors.db_not_connected_error.value},
        )
    row = await prisma_client.db.litellm_auditlog.find_unique(where={"id": audit_id})
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit log not found")
    return AuditLogResponse.model_validate(row.model_dump())
