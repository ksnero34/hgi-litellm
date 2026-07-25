"""Regression tests for ProxyExtrasDBManager v2 migration resolver.

The v2 resolver is the default. These tests exercise its fail-fast behavior;
the v1 resolver's legacy best-effort behavior remains available through an
explicit `use_v2_resolver=False` kwarg.
"""

import subprocess
from unittest.mock import patch

import pytest

from litellm_proxy_extras.utils import (
    ProxyExtrasDBManager,
    _max_migration_timestamp,
    _migration_timestamp,
)


def _fake_migrate_deploy_failure(returncode: int, stderr: str):
    def _run(*args, **kwargs):
        raise subprocess.CalledProcessError(
            returncode=returncode,
            cmd=args[0],
            stderr=stderr,
            output="",
        )

    return _run


def test_v2_p3018_permission_error_raises_runtime_error(monkeypatch, tmp_path):
    """v2: a permission failure during migrate deploy raises RuntimeError."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost:9/x")
    monkeypatch.setattr(
        ProxyExtrasDBManager, "_warn_if_db_ahead_of_head", lambda _: None
    )
    monkeypatch.setattr(ProxyExtrasDBManager, "_get_prisma_dir", lambda: str(tmp_path))
    (tmp_path / "schema.prisma").write_text("// stub")

    stderr = (
        "Error: P3018\nMigration name: 20250326162113_baseline\n"
        "Database error code: 42501\npermission denied for schema public"
    )
    with patch("subprocess.run", side_effect=_fake_migrate_deploy_failure(1, stderr)):
        with pytest.raises(RuntimeError, match="permission"):
            ProxyExtrasDBManager.setup_database(use_migrate=True, use_v2_resolver=True)


def test_v2_non_idempotent_p3009_raises_runtime_error(monkeypatch, tmp_path):
    """v2: a non-idempotent migration failure raises (no silent recovery)."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost:9/x")
    monkeypatch.setattr(
        ProxyExtrasDBManager, "_warn_if_db_ahead_of_head", lambda _: None
    )
    monkeypatch.setattr(ProxyExtrasDBManager, "_get_prisma_dir", lambda: str(tmp_path))
    (tmp_path / "schema.prisma").write_text("// stub")

    stderr = (
        "Error: P3009\nMigration `20260101000000_genuinely_broken` failed\n"
        'Reason: syntax error at or near "BRKN" LINE 42'
    )
    with patch("subprocess.run", side_effect=_fake_migrate_deploy_failure(1, stderr)):
        with pytest.raises(RuntimeError, match="cannot be auto-recovered"):
            ProxyExtrasDBManager.setup_database(use_migrate=True, use_v2_resolver=True)


def test_strip_prisma_query_params_removes_connection_limit():
    """DATABASE_URLs with Prisma-specific params should be parseable by psycopg."""
    url = "postgresql://u:p@h:5432/db?connection_limit=100&pool_timeout=60&sslmode=require"
    stripped = ProxyExtrasDBManager._strip_prisma_query_params(url)
    assert "connection_limit" not in stripped
    assert "pool_timeout" not in stripped
    assert "sslmode=require" in stripped


def test_strip_prisma_query_params_passthrough_no_query():
    """URLs without query strings are returned unchanged."""
    url = "postgresql://u:p@h:5432/db"
    assert ProxyExtrasDBManager._strip_prisma_query_params(url) == url


def test_migration_timestamp_extracts_leading_digits():
    assert _migration_timestamp("20260101000000_add_foo") == 20260101000000
    assert _migration_timestamp("20250326162113_baseline") == 20250326162113


def test_migration_timestamp_returns_zero_on_malformed():
    assert _migration_timestamp("0_init") == 0
    assert _migration_timestamp("not_a_migration") == 0


def test_max_migration_timestamp():
    names = {"20250326000000_a", "20260415000000_b", "20251115000000_c"}
    assert _max_migration_timestamp(names) == 20260415000000


def test_max_migration_timestamp_empty_set():
    assert _max_migration_timestamp(set()) == 0


@pytest.mark.parametrize("stdout", ["Applied migration.\n", "No pending migrations to apply\n"])
def test_v1_opt_out_always_calls_resolve_all_migrations(monkeypatch, tmp_path, stdout):
    monkeypatch.setattr(ProxyExtrasDBManager, "_get_prisma_dir", lambda: str(tmp_path))
    (tmp_path / "schema.prisma").write_text("// stub")

    # Stub `prisma migrate deploy` to claim success with pending migrations
    # applied, which is the code path that triggers the legacy post-migration
    # sanity check (a call to _resolve_all_migrations).
    class FakeResult:
        pass

    FakeResult.stdout = stdout
    FakeResult.stderr = ""

    def fake_run(cmd, *args, **kwargs):
        return FakeResult()

    resolve_called = {"n": 0}

    def fake_resolve(*args, **kwargs):
        resolve_called["n"] += 1

    monkeypatch.setattr("subprocess.run", fake_run)
    monkeypatch.setattr(ProxyExtrasDBManager, "_resolve_all_migrations", fake_resolve)

    ok = ProxyExtrasDBManager.setup_database(
        use_migrate=True, use_v2_resolver=False
    )
    assert ok is True
    assert resolve_called["n"] == 1


def test_v2_db_push_wraps_subprocess_error_as_runtime_error(monkeypatch, tmp_path):
    """v2: a failing `prisma db push` must raise RuntimeError, not leak
    CalledProcessError past proxy_cli.py's `except RuntimeError`."""
    monkeypatch.setattr(ProxyExtrasDBManager, "_get_prisma_dir", lambda: str(tmp_path))
    (tmp_path / "schema.prisma").write_text("// stub")

    stderr = "db push error"
    with patch("subprocess.run", side_effect=_fake_migrate_deploy_failure(1, stderr)):
        with pytest.raises(RuntimeError, match="prisma db push failed"):
            ProxyExtrasDBManager.setup_database(use_migrate=False, use_v2_resolver=True)


def test_v2_warn_ahead_of_head_swallows_db_errors(monkeypatch, tmp_path):
    """_warn_if_db_ahead_of_head must never raise — it's informational.

    Non-connection DB errors (e.g. InsufficientPrivilege from a user
    without SELECT on _prisma_migrations) must be caught, not propagated.
    """
    import psycopg

    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost:9/x")
    monkeypatch.setattr(ProxyExtrasDBManager, "_get_prisma_dir", lambda: str(tmp_path))
    (tmp_path / "schema.prisma").write_text("// stub")

    class _FakeConn:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def execute(self, *a, **kw):
            # Simulate an InsufficientPrivilege (subclass of DatabaseError).
            raise psycopg.errors.InsufficientPrivilege("permission denied")

    def _fake_connect(*a, **kw):
        return _FakeConn()

    monkeypatch.setattr("psycopg.connect", _fake_connect)

    # Must not raise.
    ProxyExtrasDBManager._warn_if_db_ahead_of_head(str(tmp_path))


def test_v2_resolve_specific_migration_failure_raises_runtime_error(
    monkeypatch, tmp_path
):
    """If marking a migration as applied fails inside P3009 idempotent
    recovery, the subprocess error must be re-raised as RuntimeError so
    proxy_cli.py catches it cleanly (instead of leaking CalledProcessError)."""
    monkeypatch.setattr(
        ProxyExtrasDBManager, "_warn_if_db_ahead_of_head", lambda _: None
    )
    monkeypatch.setattr(ProxyExtrasDBManager, "_get_prisma_dir", lambda: str(tmp_path))
    (tmp_path / "schema.prisma").write_text("// stub")
    monkeypatch.setattr(
        ProxyExtrasDBManager, "_roll_back_migration", lambda *a, **kw: None
    )

    # First call: migrate deploy -> P3009 idempotent error.
    # Recovery path tries _resolve_specific_migration; that also raises.
    def _failing_resolve(*a, **kw):
        raise subprocess.CalledProcessError(
            returncode=1,
            cmd="prisma migrate resolve --applied",
            stderr="resolve failed",
            output="",
        )

    monkeypatch.setattr(
        ProxyExtrasDBManager, "_resolve_specific_migration", _failing_resolve
    )

    stderr = (
        "Error: P3009\nMigration `20260101000000_some_migration` failed\n"
        "relation already exists"
    )
    with patch("subprocess.run", side_effect=_fake_migrate_deploy_failure(1, stderr)):
        with pytest.raises(
            RuntimeError, match="Failed to mark migration .* as applied"
        ):
            ProxyExtrasDBManager.setup_database(use_migrate=True, use_v2_resolver=True)


def test_v2_default_does_not_call_resolve_all_migrations(monkeypatch, tmp_path):
    """The v2 default must never call the legacy diff-and-force recovery."""
    monkeypatch.setattr(
        ProxyExtrasDBManager, "_warn_if_db_ahead_of_head", lambda _: None
    )
    monkeypatch.setattr(ProxyExtrasDBManager, "_get_prisma_dir", lambda: str(tmp_path))
    (tmp_path / "schema.prisma").write_text("// stub")

    class FakeResult:
        stdout = "Applied migration.\n"
        stderr = ""

    monkeypatch.setattr("subprocess.run", lambda *a, **kw: FakeResult())

    resolve_called = {"n": 0}
    monkeypatch.setattr(
        ProxyExtrasDBManager,
        "_resolve_all_migrations",
        lambda *a, **kw: resolve_called.__setitem__("n", resolve_called["n"] + 1),
    )

    ok = ProxyExtrasDBManager.setup_database(use_migrate=True)
    assert ok is True
    assert resolve_called["n"] == 0, "v2 must not invoke the diff-and-force recovery"
