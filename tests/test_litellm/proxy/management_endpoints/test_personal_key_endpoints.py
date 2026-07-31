import pytest
from fastapi import HTTPException
from prisma import Prisma
from pydantic import ValidationError

from litellm.proxy._types import LitellmUserRoles, UserAPIKeyAuth
from litellm.proxy.db.prisma_client import PrismaWrapper
from litellm.proxy.management_endpoints.key_management_endpoints import (
    _reject_managed_personal_key_mutation,
    _reject_session_generic_key_read,
)
from litellm.proxy.management_endpoints.personal_key_endpoints import (
    _target_user_id,
    _writer_database,
)
from litellm.types.proxy.management_endpoints.personal_key_endpoints import PersonalKeyCreateRequest


def test_personal_key_request_rejects_policy_fields():
    for field, value in (
        ("team_id", "other-team"),
        ("models", ["all"]),
        ("duration", "365d"),
        ("tpm_limit", 1000),
        ("organization_id", "other-org"),
        ("service_account", True),
    ):
        with pytest.raises(ValidationError):
            PersonalKeyCreateRequest.model_validate({field: value})


def test_session_user_can_only_manage_own_personal_key():
    auth = UserAPIKeyAuth(
        user_id="user-1",
        user_role=LitellmUserRoles.INTERNAL_USER,
        is_session_token=True,
    )

    assert _target_user_id(None, auth) == "user-1"
    assert _target_user_id("user-1", auth) == "user-1"

    with pytest.raises(HTTPException) as error:
        _target_user_id("user-2", auth)

    assert error.value.status_code == 403


def test_non_session_key_cannot_manage_personal_key():
    auth = UserAPIKeyAuth(
        user_id="user-1",
        user_role=LitellmUserRoles.INTERNAL_USER,
        is_session_token=False,
    )

    with pytest.raises(HTTPException) as error:
        _target_user_id(None, auth)

    assert error.value.status_code == 403


def test_proxy_admin_can_issue_personal_key_on_behalf():
    auth = UserAPIKeyAuth(
        user_id="admin-1",
        user_role=LitellmUserRoles.PROXY_ADMIN,
        is_session_token=True,
    )

    assert _target_user_id("user-2", auth) == "user-2"


def test_managed_personal_key_cannot_bypass_personal_key_lifecycle_api():
    key_row = type(
        "UserOwnedKey",
        (),
        {
            "user_id": "user-1",
            "team_id": "department-1",
            "metadata": {
                "personal_key": {
                    "owner_type": "user",
                    "key_purpose": "personal_llm",
                    "logical_key_id": "logical-1",
                    "generation": 1,
                    "lifecycle": "active",
                }
            },
        },
    )()

    with pytest.raises(HTTPException) as error:
        _reject_managed_personal_key_mutation(key_row)

    assert error.value.status_code == 403


def test_legacy_user_owned_key_remains_compatible_with_generic_lifecycle_api():
    key_row = type(
        "LegacyUserOwnedKey",
        (),
        {
            "user_id": "user-1",
            "team_id": "department-1",
            "metadata": {},
        },
    )()

    _reject_managed_personal_key_mutation(key_row)


def test_ui_session_cannot_use_generic_key_read_api():
    auth = UserAPIKeyAuth(
        user_id="user-1",
        user_role=LitellmUserRoles.INTERNAL_USER,
        is_session_token=True,
    )

    with pytest.raises(HTTPException) as error:
        _reject_session_generic_key_read(auth)

    assert error.value.status_code == 403


def test_personal_key_transactions_use_the_writer_prisma_client():
    database = Prisma()
    wrapper = PrismaWrapper(
        original_prisma=database,
        iam_token_db_auth=False,
    )
    prisma_client = type("PrismaClientStub", (), {"db": wrapper})()

    assert _writer_database(prisma_client) is database
