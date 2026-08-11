import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from litellm.proxy._types import LiteLLM_AuditLogs, LitellmTableNames
from litellm.proxy.management_helpers.audit_logs import (
    _safe_actor_key,
    _successful_audit_value,
    create_audit_log_for_update,
)


def test_key_audit_uses_allowlist_and_removes_secrets() -> None:
    value = _successful_audit_value(
        {
            "token": "sk-plaintext",
            "key": "sk-another-plaintext",
            "authorization": "Bearer secret",
            "client_secret": "secret",
            "metadata": {"password": "secret"},
            "key_alias": "service-key",
            "team_id": "team-1",
            "blocked": False,
        },
        LitellmTableNames.KEY_TABLE_NAME,
    )

    assert value == {"key_alias": "service-key", "team_id": "team-1", "blocked": False, "success": True}
    assert "sk-plaintext" not in str(value)


def test_actor_plaintext_key_is_hashed() -> None:
    actor_key = _safe_actor_key("sk-plaintext")
    assert actor_key != "sk-plaintext"
    assert actor_key == _safe_actor_key("sk-plaintext")


def test_organization_audit_removes_metadata_and_credentials() -> None:
    value = _successful_audit_value(
        {
            "organization_id": "org-1",
            "organization_alias": "Engineering",
            "models": ["model-a"],
            "metadata": {"client_secret": "secret"},
            "password": "secret",
        },
        LitellmTableNames.ORGANIZATION_TABLE_NAME,
    )

    assert value == {
        "organization_id": "org-1",
        "organization_alias": "Engineering",
        "models": ["model-a"],
        "success": True,
    }


def test_organization_membership_audit_keeps_only_link_fields() -> None:
    value = _successful_audit_value(
        {
            "organization_id": "org-1",
            "user_id": "user-1",
            "user_role": "org_admin",
            "budget_id": "budget-1",
            "metadata": {"authorization": "secret"},
        },
        LitellmTableNames.ORGANIZATION_MEMBERSHIP_TABLE_NAME,
    )

    assert value == {
        "organization_id": "org-1",
        "user_id": "user-1",
        "user_role": "org_admin",
        "budget_id": "budget-1",
        "success": True,
    }


@pytest.mark.asyncio
async def test_mandatory_audit_persistence_failure_is_observable(monkeypatch: pytest.MonkeyPatch) -> None:
    table = SimpleNamespace(create=AsyncMock(side_effect=RuntimeError("audit database failure")))
    repository = MagicMock(return_value=SimpleNamespace(table=table))
    logger = MagicMock()
    monkeypatch.setattr("litellm.proxy.proxy_server.prisma_client", SimpleNamespace())
    monkeypatch.setattr("litellm.proxy.management_helpers.audit_logs.AuditLogRepository", repository)
    monkeypatch.setattr("litellm.proxy.management_helpers.audit_logs.verbose_proxy_logger", logger)

    stored = await create_audit_log_for_update(
        LiteLLM_AuditLogs(
            id="audit-1",
            updated_at=datetime.now(timezone.utc),
            action="created",
            table_name=LitellmTableNames.KEY_TABLE_NAME,
            object_id="key-hash",
            updated_values=json.dumps({"key_alias": "service-key"}),
            success=True,
        ),
        mandatory=True,
    )

    assert stored is False
    logger.error.assert_called_once()
    assert logger.error.call_args.args[:3] == (
        "audit_persistence_failed mandatory=%s object_id=%s error=%s",
        True,
        "key-hash",
    )
