from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from litellm.proxy._types import LitellmTableNames, LitellmUserRoles, UserAPIKeyAuth
from litellm.proxy.management_endpoints.audit_logging_endpoints import (
    get_audit_log_by_id,
    get_audit_logs,
)


class _AuditRow:
    def __init__(self, row_id: str = "audit-1") -> None:
        self.row_id = row_id

    def model_dump(self) -> dict[str, object]:
        return {
            "id": self.row_id,
            "updated_at": datetime(2026, 8, 11, tzinfo=timezone.utc),
            "changed_by": "admin@example.com",
            "changed_by_api_key": "hashed-key",
            "action": "updated",
            "table_name": "LiteLLM_TeamTable",
            "object_id": "team-1",
            "before_value": {"team_alias": "before"},
            "updated_values": {"team_alias": "after", "success": True},
        }


def _auth(role: LitellmUserRoles) -> UserAPIKeyAuth:
    return UserAPIKeyAuth(user_role=role.value, user_id="actor-1")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "role",
    [LitellmUserRoles.PROXY_ADMIN, LitellmUserRoles.PROXY_ADMIN_VIEW_ONLY],
)
async def test_audit_list_allows_admin_read_roles(monkeypatch: pytest.MonkeyPatch, role: LitellmUserRoles) -> None:
    table = SimpleNamespace(find_many=AsyncMock(return_value=[_AuditRow()]), count=AsyncMock(return_value=1))
    monkeypatch.setattr(
        "litellm.proxy.proxy_server.prisma_client", SimpleNamespace(db=SimpleNamespace(litellm_auditlog=table))
    )

    response = await get_audit_logs(
        auth=_auth(role),
        page=2,
        page_size=25,
        changed_by="admin@example.com",
        actor=None,
        changed_by_api_key=None,
        action="updated",
        table_name="LiteLLM_TeamTable",
        resource_type=None,
        object_id="team-1",
        resource_id=None,
        object_team_id="team-1",
        object_key_hash="hashed-key",
        start_date=datetime(2026, 8, 1, tzinfo=timezone.utc),
        end_date=datetime(2026, 8, 12, tzinfo=timezone.utc),
        success=True,
        sort_order="desc",
    )

    assert response.total == 1
    assert response.audit_logs[0].object_id == "team-1"
    assert response.audit_logs[0].success is True
    table.find_many.assert_awaited_once_with(
        where={
            "changed_by": "admin@example.com",
            "action": "updated",
            "table_name": "LiteLLM_TeamTable",
            "object_id": "team-1",
            "updated_at": {
                "gte": datetime(2026, 8, 1, tzinfo=timezone.utc),
                "lte": datetime(2026, 8, 12, tzinfo=timezone.utc),
            },
            "AND": [
                {
                    "OR": [
                        {"before_value": {"path": ["success"], "equals": True}},
                        {"updated_values": {"path": ["success"], "equals": True}},
                    ]
                },
                {
                    "OR": [
                        {
                            "AND": [
                                {"table_name": LitellmTableNames.TEAM_MEMBERSHIP_TABLE_NAME.value},
                                {"object_id": "team-1"},
                            ]
                        },
                        {"before_value": {"path": ["team_id"], "equals": "team-1"}},
                        {"updated_values": {"path": ["team_id"], "equals": "team-1"}},
                    ]
                },
                {
                    "OR": [
                        {"object_id": "hashed-key"},
                        {"before_value": {"path": ["token_id"], "equals": "hashed-key"}},
                        {"updated_values": {"path": ["token_id"], "equals": "hashed-key"}},
                    ]
                },
            ],
        },
        order={"updated_at": "desc"},
        skip=25,
        take=25,
    )


@pytest.mark.asyncio
async def test_audit_list_filters_personal_key_rejection_by_success(monkeypatch: pytest.MonkeyPatch) -> None:
    row = _AuditRow("rejected-1")
    row.model_dump = lambda: {
        **_AuditRow("rejected-1").model_dump(),
        "action": "creation_rejected",
        "table_name": "CorporatePersonalKeyRegistry",
        "updated_values": {"result": "duplicate", "success": False},
    }
    table = SimpleNamespace(find_many=AsyncMock(return_value=[row]), count=AsyncMock(return_value=1))
    monkeypatch.setattr(
        "litellm.proxy.proxy_server.prisma_client", SimpleNamespace(db=SimpleNamespace(litellm_auditlog=table))
    )

    response = await get_audit_logs(
        auth=_auth(LitellmUserRoles.PROXY_ADMIN),
        page=1,
        page_size=50,
        changed_by=None,
        actor=None,
        changed_by_api_key=None,
        action="creation_rejected",
        table_name="CorporatePersonalKeyRegistry",
        resource_type=None,
        object_id=None,
        resource_id=None,
        object_team_id=None,
        object_key_hash=None,
        start_date=None,
        end_date=None,
        success=False,
        sort_order="desc",
    )

    assert response.audit_logs[0].success is False
    assert table.find_many.await_args.kwargs["where"]["AND"] == [
        {
            "OR": [
                {"before_value": {"path": ["success"], "equals": False}},
                {"updated_values": {"path": ["success"], "equals": False}},
            ]
        }
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["created", "deleted"])
async def test_team_member_actions_filter_by_membership_object_id(monkeypatch: pytest.MonkeyPatch, action: str) -> None:
    table = SimpleNamespace(find_many=AsyncMock(return_value=[_AuditRow()]), count=AsyncMock(return_value=1))
    monkeypatch.setattr(
        "litellm.proxy.proxy_server.prisma_client", SimpleNamespace(db=SimpleNamespace(litellm_auditlog=table))
    )

    await get_audit_logs(
        auth=_auth(LitellmUserRoles.PROXY_ADMIN_VIEW_ONLY),
        page=1,
        page_size=50,
        changed_by=None,
        actor=None,
        changed_by_api_key=None,
        action=action,
        table_name=LitellmTableNames.TEAM_MEMBERSHIP_TABLE_NAME.value,
        resource_type=None,
        object_id=None,
        resource_id=None,
        object_team_id="team-1",
        object_key_hash=None,
        start_date=None,
        end_date=None,
        success=None,
        sort_order="desc",
    )

    where = table.find_many.await_args.kwargs["where"]
    assert where["action"] == action
    assert where["AND"] == [
        {
            "OR": [
                {
                    "AND": [
                        {"table_name": LitellmTableNames.TEAM_MEMBERSHIP_TABLE_NAME.value},
                        {"object_id": "team-1"},
                    ]
                },
                {"before_value": {"path": ["team_id"], "equals": "team-1"}},
                {"updated_values": {"path": ["team_id"], "equals": "team-1"}},
            ]
        }
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "role",
    [
        LitellmUserRoles.INTERNAL_USER,
        LitellmUserRoles.ORG_ADMIN,
        LitellmUserRoles.TEAM,
    ],
)
async def test_audit_list_rejects_non_admin_roles(role: LitellmUserRoles) -> None:
    with pytest.raises(HTTPException) as error:
        await get_audit_logs(
            auth=_auth(role),
            page=1,
            page_size=50,
            changed_by=None,
            actor=None,
            changed_by_api_key=None,
            action=None,
            table_name=None,
            resource_type=None,
            object_id=None,
            resource_id=None,
            object_team_id=None,
            object_key_hash=None,
            start_date=None,
            end_date=None,
            success=None,
            sort_order="desc",
        )
    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_audit_detail_is_read_only_and_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    table = SimpleNamespace(find_unique=AsyncMock(return_value=None))
    monkeypatch.setattr(
        "litellm.proxy.proxy_server.prisma_client", SimpleNamespace(db=SimpleNamespace(litellm_auditlog=table))
    )

    with pytest.raises(HTTPException) as error:
        await get_audit_log_by_id("missing", _auth(LitellmUserRoles.PROXY_ADMIN_VIEW_ONLY))
    assert error.value.status_code == 404
