"""
Tests for audit log callback dispatch.

Tests the flow: create_audit_log_for_update -> _dispatch_audit_log_to_callbacks -> CustomLogger.async_log_audit_log_event
"""

import asyncio
import json
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

import litellm
from litellm.integrations.custom_logger import CustomLogger
from litellm.proxy._types import LiteLLM_AuditLogs, LitellmTableNames
from litellm.proxy.management_helpers.audit_logs import (
    _audit_log_task_done_callback,
    _build_audit_log_payload,
    _dispatch_audit_log_to_callbacks,
    create_audit_log_for_update,
    is_audit_logging_enabled,
)
from litellm.types.utils import StandardAuditLogPayload


@pytest.fixture(autouse=True)
def reset_audit_log_callbacks(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every test starts with no audit log callbacks registered."""
    monkeypatch.setattr(litellm, "audit_log_callbacks", [])


def _make_audit_log(
    action: str = "created",
    table_name: LitellmTableNames = LitellmTableNames.TEAM_TABLE_NAME,
) -> LiteLLM_AuditLogs:
    return LiteLLM_AuditLogs(
        id="test-audit-id",
        updated_at=datetime(2026, 3, 9, 12, 0, 0, tzinfo=timezone.utc),
        changed_by="user-123",
        changed_by_api_key="sk-abc",
        action=action,
        table_name=table_name,
        object_id="team-456",
        updated_values=json.dumps({"name": "new-team"}),
        before_value=json.dumps({"name": "old-team"}),
    )


class RecordingAuditLogger(CustomLogger):
    def __init__(self) -> None:
        super().__init__()
        self.payloads: list[StandardAuditLogPayload] = []

    async def async_log_audit_log_event(self, audit_log: StandardAuditLogPayload):
        self.payloads.append(audit_log)


class FailingAuditLogger(RecordingAuditLogger):
    async def async_log_audit_log_event(self, audit_log: StandardAuditLogPayload):
        await super().async_log_audit_log_event(audit_log)
        raise RuntimeError("boom")


class RecordingProxyLogger:
    def __init__(self) -> None:
        self.debugs: list[str] = []
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def debug(self, message: str, *args, **kwargs) -> None:
        self.debugs.append(message % args if args else message)

    def error(self, message: str, *args, **kwargs) -> None:
        self.errors.append(message % args if args else message)

    def warning(self, message: str, *args, **kwargs) -> None:
        self.warnings.append(message % args if args else message)


class FakeTask:
    def __init__(self, exception_value: BaseException | None = None, *, cancelled: bool = False) -> None:
        self._exception_value = exception_value
        self._cancelled = cancelled

    def exception(self) -> BaseException | None:
        if self._cancelled:
            raise asyncio.CancelledError()
        return self._exception_value


def _install_recording_repository(
    monkeypatch: pytest.MonkeyPatch,
    *,
    failure: BaseException | None = None,
) -> list[dict[str, object]]:
    persisted_rows: list[dict[str, object]] = []

    class RecordingTable:
        async def create(self, data: dict[str, object]) -> dict[str, object]:
            if failure is not None:
                raise failure
            persisted_rows.append(data)
            return data

    class RecordingAuditLogRepository:
        def __init__(self, prisma_client: object) -> None:
            self.table = RecordingTable()

    monkeypatch.setattr(
        "litellm.proxy.management_helpers.audit_logs.AuditLogRepository",
        RecordingAuditLogRepository,
    )
    return persisted_rows


@pytest.mark.parametrize(
    ("premium_user", "configured_value", "environment_value", "expected"),
    (
        (True, None, None, False),
        (True, False, None, False),
        (True, None, "false", False),
        (False, None, None, False),
        (False, True, None, True),
        (True, True, "false", True),
    ),
)
def test_is_audit_logging_enabled_is_not_licensed_by_premium_status(
    monkeypatch: pytest.MonkeyPatch,
    premium_user: bool,
    configured_value: bool | None,
    environment_value: str | None,
    expected: bool,
):
    monkeypatch.setattr(litellm, "store_audit_logs", configured_value)
    monkeypatch.setattr("litellm.proxy.proxy_server.premium_user", premium_user)
    if environment_value is None:
        monkeypatch.delenv("LITELLM_STORE_AUDIT_LOGS", raising=False)
    else:
        monkeypatch.setenv("LITELLM_STORE_AUDIT_LOGS", environment_value)

    assert is_audit_logging_enabled() is expected


class TestBuildAuditLogPayload:
    def test_builds_correct_payload(self):
        audit_log = _make_audit_log()
        payload = _build_audit_log_payload(audit_log)

        assert payload["id"] == "test-audit-id"
        assert payload["updated_at"] == "2026-03-09T12:00:00+00:00"
        assert payload["changed_by"] == "user-123"
        assert payload["changed_by_api_key"] == "sk-abc"
        assert payload["action"] == "created"
        assert payload["table_name"] == "LiteLLM_TeamTable"
        assert payload["object_id"] == "team-456"
        assert payload["updated_values"] == json.dumps({"name": "new-team"})
        assert payload["before_value"] == json.dumps({"name": "old-team"})

    def test_handles_none_values(self):
        audit_log = LiteLLM_AuditLogs(
            id="test-id",
            updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            changed_by=None,
            changed_by_api_key=None,
            action="deleted",
            table_name=LitellmTableNames.KEY_TABLE_NAME,
            object_id="key-789",
            updated_values=None,
            before_value=None,
        )
        payload = _build_audit_log_payload(audit_log)

        assert payload["changed_by"] == ""
        assert payload["changed_by_api_key"] == ""
        assert payload["before_value"] is None
        assert payload["updated_values"] is None


class TestDispatchAuditLogToCallbacks:
    @pytest.mark.asyncio
    async def test_dispatches_to_custom_logger_instance(self, monkeypatch: pytest.MonkeyPatch):
        logger = RecordingAuditLogger()
        monkeypatch.setattr(litellm, "audit_log_callbacks", [logger])

        audit_log = _make_audit_log()
        await _dispatch_audit_log_to_callbacks(audit_log)
        await asyncio.sleep(0.01)

        assert len(logger.payloads) == 1
        payload = logger.payloads[0]
        assert payload["id"] == "test-audit-id"
        assert payload["action"] == "created"

    @pytest.mark.asyncio
    async def test_no_dispatch_when_callbacks_empty(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(litellm, "audit_log_callbacks", [])
        audit_log = _make_audit_log()
        logger = RecordingProxyLogger()
        monkeypatch.setattr("litellm.proxy.management_helpers.audit_logs.verbose_proxy_logger", logger)

        result = await _dispatch_audit_log_to_callbacks(audit_log)

        assert result is None
        assert logger.errors == []
        assert logger.warnings == []

    @pytest.mark.asyncio
    async def test_resolves_string_callback(self, monkeypatch: pytest.MonkeyPatch):
        logger = RecordingAuditLogger()
        monkeypatch.setattr(litellm, "audit_log_callbacks", ["s3_v2"])
        monkeypatch.setattr(
            "litellm.proxy.management_helpers.audit_logs._resolve_audit_log_callback",
            lambda name: logger,
        )

        audit_log = _make_audit_log()
        await _dispatch_audit_log_to_callbacks(audit_log)
        await asyncio.sleep(0.01)

        assert len(logger.payloads) == 1
        assert logger.payloads[0]["table_name"] == "LiteLLM_TeamTable"

    @pytest.mark.asyncio
    async def test_nonblocking_on_callback_failure(self, monkeypatch: pytest.MonkeyPatch):
        """Callback errors should not propagate."""
        callback = FailingAuditLogger()
        logger = RecordingProxyLogger()
        monkeypatch.setattr(litellm, "audit_log_callbacks", [callback])
        monkeypatch.setattr("litellm.proxy.management_helpers.audit_logs.verbose_proxy_logger", logger)

        audit_log = _make_audit_log()
        await _dispatch_audit_log_to_callbacks(audit_log)
        await asyncio.sleep(0.01)

        assert len(callback.payloads) == 1
        assert any("Audit log callback task failed: boom" in message for message in logger.errors)

    @pytest.mark.asyncio
    async def test_skips_unresolvable_string_callback(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(litellm, "audit_log_callbacks", ["nonexistent_callback"])
        logger = RecordingProxyLogger()
        monkeypatch.setattr("litellm.proxy.management_helpers.audit_logs.verbose_proxy_logger", logger)
        monkeypatch.setattr(
            "litellm.proxy.management_helpers.audit_logs._resolve_audit_log_callback",
            lambda name: None,
        )

        audit_log = _make_audit_log()
        await _dispatch_audit_log_to_callbacks(audit_log)

        assert logger.warnings == ["Could not resolve audit log callback: nonexistent_callback"]


class TestCreateAuditLogForUpdateWithCallbacks:
    @pytest.mark.asyncio
    async def test_dispatches_to_callbacks_after_db_write(self, monkeypatch: pytest.MonkeyPatch):
        callback = RecordingAuditLogger()
        persisted_rows = _install_recording_repository(monkeypatch)
        monkeypatch.setattr(litellm, "audit_log_callbacks", [callback])
        monkeypatch.setattr("litellm.proxy.proxy_server.prisma_client", object())

        audit_log = _make_audit_log()
        result = await create_audit_log_for_update(audit_log)
        await asyncio.sleep(0.01)

        assert result is True
        assert len(persisted_rows) == 1
        assert len(callback.payloads) == 1
        assert persisted_rows[0]["object_id"] == "team-456"
        assert callback.payloads[0]["action"] == "created"

    @pytest.mark.asyncio
    async def test_dispatch_does_not_require_premium(self, monkeypatch: pytest.MonkeyPatch):
        callback = RecordingAuditLogger()
        persisted_rows = _install_recording_repository(monkeypatch)
        monkeypatch.setattr(litellm, "audit_log_callbacks", [callback])
        monkeypatch.setattr("litellm.proxy.proxy_server.premium_user", False)
        monkeypatch.setattr("litellm.proxy.proxy_server.prisma_client", object())

        audit_log = _make_audit_log()
        result = await create_audit_log_for_update(audit_log)
        await asyncio.sleep(0.01)

        assert result is True
        assert len(callback.payloads) == 1
        assert len(persisted_rows) == 1

    @pytest.mark.asyncio
    async def test_hgi_audit_dispatch_cannot_be_disabled_at_runtime(self, monkeypatch: pytest.MonkeyPatch):
        callback = RecordingAuditLogger()
        monkeypatch.setattr(litellm, "audit_log_callbacks", [callback])
        monkeypatch.setattr("litellm.store_audit_logs", False)
        monkeypatch.setattr("litellm.proxy.proxy_server.prisma_client", None)

        audit_log = _make_audit_log()
        result = await create_audit_log_for_update(audit_log)
        await asyncio.sleep(0.01)

        assert result is False
        assert len(callback.payloads) == 1
        assert callback.payloads[0]["id"] == "test-audit-id"

    @pytest.mark.asyncio
    async def test_dispatches_even_when_prisma_client_is_none(self, monkeypatch: pytest.MonkeyPatch):
        """Callbacks should fire even if DB is unavailable."""
        callback = RecordingAuditLogger()
        logger = RecordingProxyLogger()
        monkeypatch.setattr(litellm, "audit_log_callbacks", [callback])
        monkeypatch.setattr("litellm.proxy.proxy_server.prisma_client", None)
        monkeypatch.setattr("litellm.proxy.management_helpers.audit_logs.verbose_proxy_logger", logger)

        audit_log = _make_audit_log()
        result = await create_audit_log_for_update(audit_log)
        await asyncio.sleep(0.01)

        assert result is False
        assert len(callback.payloads) == 1
        assert any("database_not_connected" in message for message in logger.errors)

    @pytest.mark.asyncio
    async def test_dispatches_even_when_db_write_fails(self, monkeypatch: pytest.MonkeyPatch):
        """Callbacks should fire even if the DB write raises."""
        callback = RecordingAuditLogger()
        logger = RecordingProxyLogger()
        _install_recording_repository(monkeypatch, failure=RuntimeError("DB connection lost"))
        monkeypatch.setattr(litellm, "audit_log_callbacks", [callback])
        monkeypatch.setattr("litellm.proxy.proxy_server.prisma_client", object())
        monkeypatch.setattr("litellm.proxy.management_helpers.audit_logs.verbose_proxy_logger", logger)

        audit_log = _make_audit_log()
        result = await create_audit_log_for_update(audit_log)
        await asyncio.sleep(0.01)

        assert result is False
        assert len(callback.payloads) == 1
        assert any("DB connection lost" in message for message in logger.errors)


class TestAuditLogTaskDoneCallback:
    def test_logs_exception_from_failed_task(self):
        """Done callback should log task exceptions."""
        with patch(
            "litellm.proxy.management_helpers.audit_logs.verbose_proxy_logger",
            new=RecordingProxyLogger(),
        ) as logger:
            _audit_log_task_done_callback(FakeTask(RuntimeError("callback failed")))
            assert logger.errors == ["Audit log callback task failed: callback failed"]

    def test_no_log_on_success(self):
        """Done callback should not log when task succeeds."""
        with patch(
            "litellm.proxy.management_helpers.audit_logs.verbose_proxy_logger",
            new=RecordingProxyLogger(),
        ) as logger:
            _audit_log_task_done_callback(FakeTask())
            assert logger.errors == []

    def test_handles_cancelled_task(self):
        """Done callback should handle cancelled tasks gracefully."""
        with patch(
            "litellm.proxy.management_helpers.audit_logs.verbose_proxy_logger",
            new=RecordingProxyLogger(),
        ) as logger:
            _audit_log_task_done_callback(FakeTask(cancelled=True))
            assert logger.errors == []


class TestS3LoggerAuditLogEvent:
    @pytest.mark.asyncio
    async def test_queues_audit_log_with_correct_s3_key(self):
        with patch("litellm.integrations.s3_v2.S3Logger.__init__", return_value=None):
            from litellm.integrations.s3_v2 import S3Logger

            logger = S3Logger()
            logger.s3_path = "my-prefix"
            logger.log_queue = []
            logger.batch_size = 100

            audit_log = StandardAuditLogPayload(
                id="audit-123",
                updated_at="2026-03-09T12:00:00+00:00",
                changed_by="user-1",
                changed_by_api_key="sk-abc",
                action="created",
                table_name="LiteLLM_TeamTable",
                object_id="team-1",
                before_value=None,
                updated_values='{"name": "new"}',
            )

            await logger.async_log_audit_log_event(audit_log)

            assert len(logger.log_queue) == 1
            element = logger.log_queue[0]
            assert element.s3_object_key.startswith("my-prefix/audit_logs/")
            assert "audit-123" in element.s3_object_key
            assert element.s3_object_key.endswith(".json")
            assert element.s3_object_download_filename == "audit-audit-123.json"
            assert element.payload["id"] == "audit-123"
            assert element.payload["action"] == "created"

    @pytest.mark.asyncio
    async def test_s3_key_format_no_path(self):
        with patch("litellm.integrations.s3_v2.S3Logger.__init__", return_value=None):
            from litellm.integrations.s3_v2 import S3Logger

            logger = S3Logger()
            logger.s3_path = None
            logger.log_queue = []
            logger.batch_size = 100

            audit_log = StandardAuditLogPayload(
                id="audit-456",
                updated_at="2026-03-09T12:00:00+00:00",
                changed_by="user-1",
                changed_by_api_key="sk-abc",
                action="deleted",
                table_name="LiteLLM_VerificationToken",
                object_id="key-1",
                before_value=None,
                updated_values=None,
            )

            await logger.async_log_audit_log_event(audit_log)

            assert len(logger.log_queue) == 1
            element = logger.log_queue[0]
            assert element.s3_object_key.startswith("audit_logs/")
            assert "audit-456" in element.s3_object_key


class TestS3AuditCallbackParamsDecoupling:
    """`s3_audit_callback_params` should give the audit-log path its own
    S3Logger instance, distinct from the singleton serving normal logs."""

    @pytest.fixture(autouse=True)
    def _isolate_caches_and_globals(self, monkeypatch: pytest.MonkeyPatch):
        from litellm.litellm_core_utils import litellm_logging as ll_logging
        from litellm.proxy.management_helpers import audit_logs as ll_audit_logs

        monkeypatch.setattr(litellm, "s3_callback_params", litellm.s3_callback_params)
        monkeypatch.setattr(
            litellm, "s3_audit_callback_params", getattr(litellm, "s3_audit_callback_params", None)
        )
        ll_audit_logs._audit_log_callback_cache.clear()
        ll_logging._in_memory_loggers.clear()
        yield
        ll_audit_logs._audit_log_callback_cache.clear()
        ll_logging._in_memory_loggers.clear()

    def test_opt_in_constructs_separate_instance_with_audit_config(self, monkeypatch: pytest.MonkeyPatch):
        """Audit config set → audit resolver returns a fresh S3Logger pointing
        at the audit bucket, distinct from the normal-log singleton."""
        from litellm.integrations.s3_v2 import S3Logger
        from litellm.litellm_core_utils.litellm_logging import (
            _init_custom_logger_compatible_class,
        )
        from litellm.proxy.management_helpers.audit_logs import (
            _resolve_audit_log_callback,
        )

        monkeypatch.setattr(litellm, "s3_callback_params", {"s3_bucket_name": "normal-bucket"})
        monkeypatch.setattr(litellm, "s3_audit_callback_params", {"s3_bucket_name": "audit-bucket"})

        with patch("asyncio.create_task"):
            audit_instance = _resolve_audit_log_callback("s3_v2")
            normal_instance = _init_custom_logger_compatible_class(
                logging_integration="s3_v2",
                internal_usage_cache=None,
                llm_router=None,
            )

        assert isinstance(audit_instance, S3Logger)
        assert isinstance(normal_instance, S3Logger)
        assert id(audit_instance) != id(normal_instance)
        assert audit_instance.s3_bucket_name == "audit-bucket"
        assert normal_instance.s3_bucket_name == "normal-bucket"

    def test_opt_out_preserves_singleton_behavior(self, monkeypatch: pytest.MonkeyPatch):
        """No `s3_audit_callback_params` → audit and normal share the singleton
        (existing behavior, regression guard)."""
        from litellm.integrations.s3_v2 import S3Logger
        from litellm.litellm_core_utils.litellm_logging import (
            _init_custom_logger_compatible_class,
        )
        from litellm.proxy.management_helpers.audit_logs import (
            _resolve_audit_log_callback,
        )

        monkeypatch.setattr(litellm, "s3_callback_params", {"s3_bucket_name": "shared-bucket"})
        monkeypatch.setattr(litellm, "s3_audit_callback_params", None)

        with patch("asyncio.create_task"):
            normal_instance = _init_custom_logger_compatible_class(
                logging_integration="s3_v2",
                internal_usage_cache=None,
                llm_router=None,
            )
            audit_instance = _resolve_audit_log_callback("s3_v2")

        assert isinstance(audit_instance, S3Logger)
        assert id(audit_instance) == id(normal_instance)
        assert audit_instance.s3_bucket_name == "shared-bucket"

    def test_empty_dict_opts_in(self, monkeypatch: pytest.MonkeyPatch):
        """`s3_audit_callback_params = {}` is opt-in (truthy-by-presence) and
        produces a separate instance with no bucket configured (env/IAM-only)."""
        from litellm.litellm_core_utils.litellm_logging import (
            _init_custom_logger_compatible_class,
        )
        from litellm.proxy.management_helpers.audit_logs import (
            _resolve_audit_log_callback,
        )

        monkeypatch.setattr(litellm, "s3_callback_params", {"s3_bucket_name": "normal-bucket"})
        monkeypatch.setattr(litellm, "s3_audit_callback_params", {})

        with patch("asyncio.create_task"):
            audit_instance = _resolve_audit_log_callback("s3_v2")
            normal_instance = _init_custom_logger_compatible_class(
                logging_integration="s3_v2",
                internal_usage_cache=None,
                llm_router=None,
            )

        assert id(audit_instance) != id(normal_instance)
        assert audit_instance.s3_bucket_name is None
        assert normal_instance.s3_bucket_name == "normal-bucket"

    def test_reset_audit_log_callback_cache_clears_audit_instance(self, monkeypatch: pytest.MonkeyPatch):
        """`reset_audit_log_callback_cache()` must drop the cached audit
        instance so a config reload picks up the new params."""
        from litellm.proxy.management_helpers.audit_logs import (
            _audit_log_callback_cache,
            _resolve_audit_log_callback,
            reset_audit_log_callback_cache,
        )

        monkeypatch.setattr(litellm, "s3_audit_callback_params", {"s3_bucket_name": "first"})
        with patch("asyncio.create_task"):
            first = _resolve_audit_log_callback("s3_v2")
            assert first is not None and "s3_v2" in _audit_log_callback_cache

            reset_audit_log_callback_cache()
            assert "s3_v2" not in _audit_log_callback_cache

            monkeypatch.setattr(litellm, "s3_audit_callback_params", {"s3_bucket_name": "second"})
            second = _resolve_audit_log_callback("s3_v2")
            assert second is not None
            assert id(second) != id(first)
            assert second.s3_bucket_name == "second"
