"""
Tests for KeyManagementEventHooks.

Validates that email and secret manager operations are independent and non-blocking.
"""

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import litellm
from litellm.proxy.hooks.key_management_event_hooks import KeyManagementEventHooks
from litellm.secret_managers.base_secret_manager import BaseSecretManager


class RecordingSecretManager(BaseSecretManager):
    def __init__(self) -> None:
        self.rotate_calls: list[dict[str, object | None]] = []

    async def async_read_secret(
        self,
        secret_name: str,
        optional_params: dict | None = None,
        timeout: float | None = None,
    ) -> str | None:
        return "existing-secret"

    def sync_read_secret(
        self,
        secret_name: str,
        optional_params: dict | None = None,
        timeout: float | None = None,
    ) -> str | None:
        return "existing-secret"

    async def async_write_secret(
        self,
        secret_name: str,
        secret_value: str,
        description: str | None = None,
        optional_params: dict | None = None,
        timeout: float | None = None,
        tags: dict | list | None = None,
    ) -> dict[str, Any]:
        return {"status": "success"}

    async def async_delete_secret(
        self,
        secret_name: str,
        recovery_window_in_days: int | None = 7,
        optional_params: dict | None = None,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        return {"status": "deleted"}

    async def async_rotate_secret(
        self,
        current_secret_name: str,
        new_secret_name: str,
        new_secret_value: str,
        optional_params: dict | None = None,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        self.rotate_calls.append(
            {
                "current_secret_name": current_secret_name,
                "new_secret_name": new_secret_name,
                "new_secret_value": new_secret_value,
                "optional_params": optional_params,
            }
        )
        return {"status": "success"}


def _configure_secret_manager_state(
    monkeypatch: pytest.MonkeyPatch,
    *,
    secret_manager_client: BaseSecretManager | None,
    settings: object,
    key_management_system: object | None,
) -> None:
    monkeypatch.setattr(litellm, "secret_manager_client", secret_manager_client)
    monkeypatch.setattr(litellm, "_key_management_system", key_management_system)
    monkeypatch.setattr(litellm, "_key_management_settings", settings)


class TestKeyManagementEventHooksIndependentOperations:
    """Tests that email and secret manager operations are independent."""

    @pytest.mark.asyncio
    async def test_email_failure_does_not_block_secret_manager(self):
        """
        Test that if email sending fails, secret manager operation still runs.

        This validates the independent operation design where one failure
        does not block the other operation.
        """
        secret_manager_called = {"called": False}

        # Mock the email method to raise an exception
        async def mock_send_email_raises(*args, **kwargs):
            raise Exception("Email service unavailable")

        # Mock the secret manager method to track if it was called
        async def mock_store_secret(*args, **kwargs):
            secret_manager_called["called"] = True

        # Create mock objects for the hook parameters
        mock_data = MagicMock()
        mock_data.key_alias = "test-key-alias"
        mock_data.team_id = None
        mock_data.send_invite_email = True

        mock_response = MagicMock()
        mock_response.model_dump.return_value = {
            "key": "sk-test",
            "token": "test-token",
        }
        mock_response.model_dump_json.return_value = '{"key": "sk-test"}'
        mock_response.token_id = "token-123"
        mock_response.key = "sk-test-key"

        mock_user_api_key_dict = MagicMock()
        mock_user_api_key_dict.user_id = "user-123"
        mock_user_api_key_dict.api_key = "api-key-123"

        with (
            patch.object(
                KeyManagementEventHooks,
                "_send_key_created_email",
                side_effect=mock_send_email_raises,
            ),
            patch.object(
                KeyManagementEventHooks,
                "_store_virtual_key_in_secret_manager",
                side_effect=mock_store_secret,
            ),
            patch.object(
                KeyManagementEventHooks,
                "_is_email_sending_enabled",
                return_value=True,
            ),
            patch("litellm.store_audit_logs", False),
            patch(
                "litellm.proxy.hooks.key_management_event_hooks.verbose_proxy_logger"
            ),
        ):
            # Should not raise even though email fails
            await KeyManagementEventHooks.async_key_generated_hook(
                data=mock_data,
                response=mock_response,
                user_api_key_dict=mock_user_api_key_dict,
            )

        # Secret manager should have been called despite email failure
        assert secret_manager_called["called"] is True

    @pytest.mark.asyncio
    async def test_secret_manager_failure_does_not_block_email(self):
        """
        Test that if secret manager fails, email operation still runs.

        This validates the independent operation design where one failure
        does not block the other operation.
        """
        email_called = {"called": False}

        # Mock the email method to track if it was called
        async def mock_send_email(*args, **kwargs):
            email_called["called"] = True

        # Mock the secret manager method to raise an exception
        async def mock_store_secret_raises(*args, **kwargs):
            raise Exception("Secret manager unavailable")

        # Create mock objects for the hook parameters
        mock_data = MagicMock()
        mock_data.key_alias = "test-key-alias"
        mock_data.team_id = None
        mock_data.send_invite_email = True

        mock_response = MagicMock()
        mock_response.model_dump.return_value = {
            "key": "sk-test",
            "token": "test-token",
        }
        mock_response.model_dump_json.return_value = '{"key": "sk-test"}'
        mock_response.token_id = "token-123"
        mock_response.key = "sk-test-key"

        mock_user_api_key_dict = MagicMock()
        mock_user_api_key_dict.user_id = "user-123"
        mock_user_api_key_dict.api_key = "api-key-123"

        with (
            patch.object(
                KeyManagementEventHooks,
                "_send_key_created_email",
                side_effect=mock_send_email,
            ),
            patch.object(
                KeyManagementEventHooks,
                "_store_virtual_key_in_secret_manager",
                side_effect=mock_store_secret_raises,
            ),
            patch.object(
                KeyManagementEventHooks,
                "_is_email_sending_enabled",
                return_value=True,
            ),
            patch("litellm.store_audit_logs", False),
            patch(
                "litellm.proxy.hooks.key_management_event_hooks.verbose_proxy_logger"
            ),
        ):
            # Should not raise even though secret manager fails
            await KeyManagementEventHooks.async_key_generated_hook(
                data=mock_data,
                response=mock_response,
                user_api_key_dict=mock_user_api_key_dict,
            )

        # Email should have been called despite secret manager failure
        assert email_called["called"] is True


@pytest.mark.parametrize("premium_user", (True, False))
@pytest.mark.asyncio
async def test_key_generated_audit_log_is_not_licensed_by_premium_status(
    monkeypatch: pytest.MonkeyPatch,
    premium_user: bool,
):
    from litellm.proxy._types import GenerateKeyRequest, GenerateKeyResponse, UserAPIKeyAuth

    monkeypatch.setattr("litellm.store_audit_logs", None)
    monkeypatch.setattr("litellm.proxy.proxy_server.premium_user", premium_user)
    monkeypatch.delenv("LITELLM_STORE_AUDIT_LOGS", raising=False)

    captured_audit_logs = []
    stored_secrets = []

    async def capture_audit_log(request_data, mandatory: bool = False):
        captured_audit_logs.append(
            {
                "request_data": request_data,
                "mandatory": mandatory,
            }
        )

    async def capture_store_secret(
        secret_name: str,
        secret_token: str,
        team_id: str | None = None,
    ) -> None:
        stored_secrets.append(
            {
                "secret_name": secret_name,
                "secret_token": secret_token,
                "team_id": team_id,
            }
        )

    monkeypatch.setattr(
        "litellm.proxy.management_helpers.audit_logs.create_audit_log_for_update",
        capture_audit_log,
    )
    monkeypatch.setattr(
        KeyManagementEventHooks,
        "_store_virtual_key_in_secret_manager",
        capture_store_secret,
    )

    response = GenerateKeyResponse(key="sk-test-key", token_id="token-123")
    await KeyManagementEventHooks.async_key_generated_hook(
        data=GenerateKeyRequest(),
        response=response,
        user_api_key_dict=UserAPIKeyAuth(api_key="sk-admin-key", user_id="admin"),
    )

    assert captured_audit_logs == []
    assert stored_secrets == [
        {
            "secret_name": "virtual-key-token-123",
            "secret_token": "sk-test-key",
            "team_id": None,
        }
    ]


class TestRotateVirtualKeyInSecretManager:
    """Tests for _rotate_virtual_key_in_secret_manager with team_id support."""

    @pytest.mark.asyncio
    async def test_rotate_virtual_key_with_team_id(self, monkeypatch: pytest.MonkeyPatch):
        """Test that team_id is passed to async_rotate_secret."""
        from litellm.types.secret_managers.main import (
            KeyManagementSettings,
            KeyManagementSystem,
        )

        mock_secret_manager = RecordingSecretManager()
        _configure_secret_manager_state(
            monkeypatch,
            secret_manager_client=mock_secret_manager,
            key_management_system=KeyManagementSystem.HASHICORP_VAULT,
            settings=KeyManagementSettings(
                store_virtual_keys=True,
                prefix_for_stored_virtual_keys="litellm/",
            ),
        )

        current_secret_name = "virtual-key-old"
        new_secret_name = "virtual-key-new"
        new_secret_value = "sk-new-key-value"
        team_id = "team-123"
        team_settings = {
            "namespace": "team-namespace",
            "mount": "kv-team",
            "path_prefix": "teams/custom",
        }
        requested_team_ids = []

        async def capture_optional_params(requested_team_id: str | None):
            requested_team_ids.append(requested_team_id)
            return team_settings

        monkeypatch.setattr(
            KeyManagementEventHooks,
            "_get_secret_manager_optional_params",
            capture_optional_params,
        )

        await KeyManagementEventHooks._rotate_virtual_key_in_secret_manager(
            current_secret_name=current_secret_name,
            new_secret_name=new_secret_name,
            new_secret_value=new_secret_value,
            team_id=team_id,
        )

        assert requested_team_ids == [team_id]
        assert mock_secret_manager.rotate_calls == [
            {
                "current_secret_name": "litellm/virtual-key-old",
                "new_secret_name": "litellm/virtual-key-new",
                "new_secret_value": new_secret_value,
                "optional_params": team_settings,
            }
        ]

    @pytest.mark.asyncio
    async def test_rotate_virtual_key_without_team_id(self, monkeypatch: pytest.MonkeyPatch):
        """Test that None team_id is handled correctly."""
        from litellm.types.secret_managers.main import (
            KeyManagementSettings,
            KeyManagementSystem,
        )

        mock_secret_manager = RecordingSecretManager()
        _configure_secret_manager_state(
            monkeypatch,
            secret_manager_client=mock_secret_manager,
            key_management_system=KeyManagementSystem.HASHICORP_VAULT,
            settings=KeyManagementSettings(
                store_virtual_keys=True,
                prefix_for_stored_virtual_keys="litellm/",
            ),
        )

        current_secret_name = "virtual-key-old"
        new_secret_name = "virtual-key-new"
        new_secret_value = "sk-new-key-value"
        requested_team_ids = []

        async def capture_optional_params(requested_team_id: str | None):
            requested_team_ids.append(requested_team_id)

        monkeypatch.setattr(
            KeyManagementEventHooks,
            "_get_secret_manager_optional_params",
            capture_optional_params,
        )

        await KeyManagementEventHooks._rotate_virtual_key_in_secret_manager(
            current_secret_name=current_secret_name,
            new_secret_name=new_secret_name,
            new_secret_value=new_secret_value,
            team_id=None,
        )

        assert requested_team_ids == [None]
        assert mock_secret_manager.rotate_calls == [
            {
                "current_secret_name": "litellm/virtual-key-old",
                "new_secret_name": "litellm/virtual-key-new",
                "new_secret_value": new_secret_value,
                "optional_params": None,
            }
        ]

    @pytest.mark.asyncio
    async def test_rotate_virtual_key_in_key_rotated_hook(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """Test that async_key_rotated_hook passes team_id to _rotate_virtual_key_in_secret_manager."""
        from litellm.proxy._types import (
            GenerateKeyResponse,
            LiteLLM_VerificationToken,
            RegenerateKeyRequest,
            UserAPIKeyAuth,
        )
        from litellm.types.secret_managers.main import (
            KeyManagementSettings,
            KeyManagementSystem,
        )

        mock_secret_manager = RecordingSecretManager()
        _configure_secret_manager_state(
            monkeypatch,
            secret_manager_client=mock_secret_manager,
            key_management_system=KeyManagementSystem.HASHICORP_VAULT,
            settings=KeyManagementSettings(
                store_virtual_keys=True,
                prefix_for_stored_virtual_keys="litellm/",
            ),
        )

        existing_key_row = LiteLLM_VerificationToken(
            token="sk-old-key",
            key_alias="test-key-alias",
            team_id="team-456",
        )
        response = GenerateKeyResponse(
            token_id="token-new-123",
            key="sk-new-key",
            key_alias="test-key-alias-new",
        )
        data = RegenerateKeyRequest(
            key="sk-old-key",
            key_alias="test-key-alias-new",
        )
        captured_rotations = []

        async def capture_rotation(**kwargs):
            captured_rotations.append(kwargs)

        async def ignore_email(*args, **kwargs):
            return None

        monkeypatch.setattr(
            KeyManagementEventHooks,
            "_rotate_virtual_key_in_secret_manager",
            capture_rotation,
        )
        monkeypatch.setattr(
            KeyManagementEventHooks,
            "_send_key_rotated_email",
            ignore_email,
        )
        monkeypatch.setattr("litellm.store_audit_logs", False)

        await KeyManagementEventHooks.async_key_rotated_hook(
            data=data,
            existing_key_row=existing_key_row,
            response=response,
            user_api_key_dict=UserAPIKeyAuth(api_key="sk-admin-key", user_id="admin"),
        )

        assert captured_rotations == [
            {
                "current_secret_name": "test-key-alias",
                "new_secret_name": "test-key-alias-new",
                "new_secret_value": "sk-new-key",
                "team_id": "team-456",
            }
        ]

    @pytest.mark.asyncio
    async def test_rotate_virtual_key_when_store_virtual_keys_disabled(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """Test that rotation is skipped when store_virtual_keys is False."""
        from litellm.types.secret_managers.main import (
            KeyManagementSettings,
            KeyManagementSystem,
        )

        mock_secret_manager = RecordingSecretManager()
        _configure_secret_manager_state(
            monkeypatch,
            secret_manager_client=mock_secret_manager,
            key_management_system=KeyManagementSystem.HASHICORP_VAULT,
            settings=KeyManagementSettings(
                store_virtual_keys=False,
                prefix_for_stored_virtual_keys="litellm/",
            ),
        )

        await KeyManagementEventHooks._rotate_virtual_key_in_secret_manager(
            current_secret_name="old-key",
            new_secret_name="new-key",
            new_secret_value="sk-new-value",
            team_id="team-123",
        )

        assert mock_secret_manager.rotate_calls == []

    @pytest.mark.asyncio
    async def test_rotate_virtual_key_when_secret_manager_not_set(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """Test that rotation is skipped when secret_manager_client is None."""
        from litellm.types.secret_managers.main import KeyManagementSettings

        requested_team_ids = []

        async def capture_optional_params(requested_team_id: str | None):
            requested_team_ids.append(requested_team_id)
            return {"team_id": requested_team_id}

        _configure_secret_manager_state(
            monkeypatch,
            secret_manager_client=None,
            key_management_system=None,
            settings=KeyManagementSettings(
                store_virtual_keys=True,
                prefix_for_stored_virtual_keys="litellm/",
            ),
        )
        monkeypatch.setattr(
            KeyManagementEventHooks,
            "_get_secret_manager_optional_params",
            capture_optional_params,
        )

        await KeyManagementEventHooks._rotate_virtual_key_in_secret_manager(
            current_secret_name="old-key",
            new_secret_name="new-key",
            new_secret_value="sk-new-value",
            team_id="team-123",
        )

        assert requested_team_ids == []


class TestKeyUpdatedAuditLogObjectId:
    """Tests that /key/update audit logs never store the raw virtual key (issue #31620)."""

    async def _run_updated_hook_and_capture_audit_log(self, request_key: str):

        from litellm.proxy._types import (
            LiteLLM_VerificationToken,
            UpdateKeyRequest,
            UserAPIKeyAuth,
        )
        from litellm.proxy.utils import hash_token

        captured = []

        async def capture_audit_log(request_data, **kwargs):
            captured.append(request_data)

        existing_key_row = LiteLLM_VerificationToken(
            token=hash_token("sk-raw-test-key-31620"),
            key_name="sk-...1620",
        )

        with (
            patch("litellm.store_audit_logs", True),
            patch(
                "litellm.proxy.management_helpers.audit_logs.create_audit_log_for_update",
                new=capture_audit_log,
            ),
        ):
            await KeyManagementEventHooks.async_key_updated_hook(
                data=UpdateKeyRequest(key=request_key, max_budget=2000.0),
                existing_key_row=existing_key_row,
                response=MagicMock(),
                user_api_key_dict=UserAPIKeyAuth(api_key="sk-admin-key", user_id="admin"),
            )
            for _ in range(100):
                if captured:
                    break
                await asyncio.sleep(0.01)

        assert len(captured) == 1
        return captured[0]

    @pytest.mark.asyncio
    async def test_update_audit_log_hashes_raw_key_in_object_id(self):
        """A raw sk- key sent to /key/update must be stored hashed in object_id."""
        from litellm.proxy.utils import hash_token

        raw_key = "sk-raw-test-key-31620"

        audit_row = await self._run_updated_hook_and_capture_audit_log(request_key=raw_key)

        assert audit_row.object_id == hash_token(raw_key)
        assert raw_key not in audit_row.object_id
        assert raw_key not in str(audit_row.updated_values)
        assert raw_key not in str(audit_row.before_value)

    @pytest.mark.asyncio
    async def test_update_audit_log_passes_through_hashed_key(self):
        """An already-hashed token sent to /key/update is stored unchanged."""
        from litellm.proxy.utils import hash_token

        hashed_key = hash_token("sk-raw-test-key-31620")

        audit_row = await self._run_updated_hook_and_capture_audit_log(request_key=hashed_key)

        assert audit_row.object_id == hashed_key


class TestOSSAuditMutationCoverage:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("user_id,key_type", [("user-1", None), (None, "service_account")])
    async def test_user_and_service_key_creation_emit_one_safe_audit(self, user_id, key_type):

        captured = []

        async def capture(request_data, **kwargs):
            captured.append(request_data)

        data = MagicMock(send_invite_email=False, key_alias="alias", team_id="team-1")
        response = MagicMock(token_id="hashed-token", key="sk-plaintext")
        response.model_dump_json.return_value = (
            '{"token_id":"hashed-token","user_id":%s,"key_type":%s}'
            % (
                f'"{user_id}"' if user_id is not None else "null",
                f'"{key_type}"' if key_type is not None else "null",
            )
        )
        with (
            patch("litellm.store_audit_logs", True),
            patch("litellm.proxy.management_helpers.audit_logs.create_audit_log_for_update", new=capture),
            patch.object(KeyManagementEventHooks, "_store_virtual_key_in_secret_manager", new=AsyncMock()),
        ):
            await KeyManagementEventHooks.async_key_generated_hook(
                data=data,
                response=response,
                user_api_key_dict=MagicMock(user_id="admin", token="hashed-actor"),
            )
            await asyncio.sleep(0)

        assert len(captured) == 1
        assert captured[0].action == "created"
        assert captured[0].object_id == "hashed-token"
        assert "sk-plaintext" not in str(captured[0].updated_values)

    @pytest.mark.asyncio
    @pytest.mark.parametrize("user_id", ["user-1", None])
    async def test_user_and_service_key_delete_emit_one_audit_per_resource(self, user_id):

        captured = []

        async def capture(request_data, **kwargs):
            captured.append(request_data)

        key_row = MagicMock(token="hashed-token", user_id=user_id)
        key_row.model_dump_json.return_value = '{"token":"hashed-token","key_alias":"alias"}'
        with (
            patch("litellm.store_audit_logs", True),
            patch("litellm.proxy.management_helpers.audit_logs.create_audit_log_for_update", new=capture),
            patch.object(KeyManagementEventHooks, "_delete_virtual_keys_from_secret_manager", new=AsyncMock()),
        ):
            await KeyManagementEventHooks.async_key_deleted_hook(
                data=MagicMock(keys=["hashed-token"]),
                keys_being_deleted=[key_row],
                response={},
                user_api_key_dict=MagicMock(user_id="admin", token="hashed-actor"),
            )
            await asyncio.sleep(0)

        assert len(captured) == 1
        assert captured[0].action == "deleted"
        assert captured[0].object_id == "hashed-token"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("user_id", ["user-1", None])
    async def test_user_and_service_key_update_emit_one_audit(self, user_id):

        captured = []

        async def capture(request_data, **kwargs):
            captured.append(request_data)

        existing = MagicMock(token="hashed-token", user_id=user_id)
        existing.json.return_value = {"token": "hashed-token", "user_id": user_id, "blocked": False}
        with (
            patch("litellm.store_audit_logs", True),
            patch("litellm.proxy.management_helpers.audit_logs.create_audit_log_for_update", new=capture),
        ):
            await KeyManagementEventHooks.async_key_updated_hook(
                data=MagicMock(key="hashed-token", json=MagicMock(return_value={"blocked": True})),
                existing_key_row=existing,
                response=MagicMock(),
                user_api_key_dict=MagicMock(user_id="admin", token="hashed-actor"),
            )
            await asyncio.sleep(0)

        assert len(captured) == 1
        assert captured[0].action == "updated"

    @pytest.mark.asyncio
    async def test_rotation_never_places_plaintext_key_in_audit_values(self):

        captured = []

        async def capture(request_data, **kwargs):
            captured.append(request_data)

        existing = MagicMock(token="old-hash", key_alias="alias", team_id="team-1")
        existing.model_dump_json.return_value = '{"token":"old-hash","key_alias":"alias"}'
        response = MagicMock(key="sk-new-plaintext", token_id="new-hash", key_alias="alias")
        response.model_dump_json.return_value = '{"token_id":"new-hash","key_alias":"alias"}'
        with (
            patch("litellm.store_audit_logs", True),
            patch("litellm.proxy.management_helpers.audit_logs.create_audit_log_for_update", new=capture),
            patch.object(KeyManagementEventHooks, "_rotate_virtual_key_in_secret_manager", new=AsyncMock()),
            patch.object(KeyManagementEventHooks, "_send_key_rotated_email", new=AsyncMock()),
        ):
            await KeyManagementEventHooks.async_key_rotated_hook(
                data=MagicMock(key_alias="alias"),
                existing_key_row=existing,
                response=response,
                user_api_key_dict=MagicMock(user_id="admin", token="hashed-actor"),
            )
            await asyncio.sleep(0)

        assert len(captured) == 1
        assert captured[0].action == "rotated"
        assert "sk-new-plaintext" not in str(captured[0].updated_values)
        assert "sk-new-plaintext" not in str(captured[0].before_value)
