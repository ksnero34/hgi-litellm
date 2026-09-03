from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Sequence

import pytest

MODULE_PATH = Path(__file__).parents[2] / "scripts" / "hgi" / "rollback_guardrail_metadata.py"
SPEC = importlib.util.spec_from_file_location("rollback_guardrail_metadata", MODULE_PATH)
assert SPEC is not None
assert SPEC.loader is not None
rollback = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = rollback
SPEC.loader.exec_module(rollback)


class FakeStore:
    def __init__(
        self,
        *,
        state: rollback.SchemaState | None = None,
        snapshot: rollback.Snapshot | None = None,
        current: tuple[rollback.Entry, ...] = (),
        backup_directory: Path | None = None,
    ):
        self.state = state or rollback.SchemaState(
            frozenset(rollback.REQUIRED_COLUMNS), frozenset(rollback.REQUIRED_MIGRATIONS)
        )
        self.value = snapshot or rollback.Snapshot((), ())
        self.current = current
        self.backup_directory = backup_directory
        self.snapshot_calls = 0
        self.cleanup_calls: list[tuple[rollback.Entry, ...]] = []
        self.restore_calls: list[tuple[rollback.Entry, ...]] = []

    def schema_state(self) -> rollback.SchemaState:
        return self.state

    def snapshot(self) -> rollback.Snapshot:
        self.snapshot_calls += 1
        return self.value

    def current_entries(self, entries: Sequence[rollback.Entry]) -> tuple[rollback.Entry, ...]:
        return self.current

    def cleanup(self, entries: Sequence[rollback.Entry]) -> int:
        assert self.backup_directory is None or tuple(self.backup_directory.glob("*.json"))
        copied = tuple(entries)
        self.cleanup_calls.append(copied)
        return len(copied)

    def restore(self, entries: Sequence[rollback.Entry]) -> int:
        copied = tuple(entries)
        self.restore_calls.append(copied)
        return len(copied)


def sample_entries() -> tuple[rollback.Entry, ...]:
    return (
        rollback.Entry("key", "secret-token", {"guardrails": ["pii"], "policies": ["baseline"]}),
        rollback.Entry(
            "team",
            "team-1",
            {"disable_global_guardrails": True, "opted_out_global_guardrails": ["audit"]},
            True,
        ),
    )


def test_inspect_reports_redacted_targets_without_metadata_values() -> None:
    store = FakeStore(snapshot=rollback.Snapshot(sample_entries(), ()))

    result = rollback.run(store, "inspect", False, Path("unused"))
    rendered = json.dumps(result)

    assert result["mode"] == "dry-run"
    assert result["key_count"] == 1
    assert result["team_count"] == 1
    assert "secret-token" not in rendered
    assert "baseline" not in rendered
    assert "metadata_fields" in rendered


def test_inspect_schema_failure_does_not_query_optional_tables() -> None:
    store = FakeStore(state=rollback.SchemaState(frozenset(), frozenset()))

    result = rollback.run(store, "inspect", False, Path("unused"))

    assert store.snapshot_calls == 0
    assert result["preflight_issues"]


def test_cleanup_is_dry_run_by_default(tmp_path: Path) -> None:
    store = FakeStore(snapshot=rollback.Snapshot(sample_entries(), ()))

    result = rollback.run(store, "cleanup", False, tmp_path)

    assert result["mode"] == "dry-run"
    assert store.cleanup_calls == []
    assert list(tmp_path.iterdir()) == []


def test_cleanup_apply_noop_does_not_create_backup(tmp_path: Path) -> None:
    store = FakeStore(snapshot=rollback.Snapshot((), ()), backup_directory=tmp_path)

    result = rollback.run(store, "cleanup", True, tmp_path)

    assert result["changed_count"] == 0
    assert store.cleanup_calls == []
    assert list(tmp_path.iterdir()) == []


def test_cleanup_apply_writes_restricted_backup_before_mutation(tmp_path: Path) -> None:
    store = FakeStore(snapshot=rollback.Snapshot(sample_entries(), ()), backup_directory=tmp_path)

    result = rollback.run(store, "cleanup", True, tmp_path)
    backup_path = Path(result["backup_file"])
    raw = json.loads(backup_path.read_text())

    assert store.cleanup_calls == [sample_entries()]
    assert raw["entries"][0]["metadata"] == {"guardrails": ["pii"], "policies": ["baseline"]}
    assert set(raw["entries"][1]["metadata"]) == {"disable_global_guardrails", "opted_out_global_guardrails"}


def test_backup_requests_private_file_mode(tmp_path: Path) -> None:
    opened: list[tuple[Path, int, int]] = []
    synced: list[int] = []

    def open_with_mode(path: Path, flags: int, mode: int) -> int:
        opened.append((path, flags, mode))
        return os.open(path, flags, mode)

    rollback.write_backup(sample_entries(), tmp_path, opener=open_with_mode, synchronizer=synced.append)

    assert opened[0][1:] == (os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    assert opened[1] == (tmp_path, os.O_RDONLY, 0)
    assert len(synced) == 2


def test_cleanup_blocks_active_purview_and_policy_references(tmp_path: Path) -> None:
    blockers = (
        rollback.Blocker("guardrail", "g-1", "purview"),
        rollback.Blocker("policy", "p-1", "production", ("purview",)),
    )
    store = FakeStore(snapshot=rollback.Snapshot(sample_entries(), blockers))

    with pytest.raises(ValueError, match="blocked"):
        rollback.run(store, "cleanup", True, tmp_path)

    assert store.cleanup_calls == []
    assert list(tmp_path.iterdir()) == []


def test_postgres_store_apply_uses_cleanup_and_restore_team_flags(monkeypatch) -> None:
    class Result:
        def fetchone(self):
            return {"team_id": "team-1"}

    class Transaction:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            return None

    class Connection:
        def __init__(self):
            self.calls = []

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            return None

        def transaction(self):
            return Transaction()

        def execute(self, query, params=()):
            self.calls.append((query, params))
            return Result()

    connection = Connection()
    store = rollback.PostgresStore("unused")
    monkeypatch.setattr(store, "connect", lambda: connection)
    team = sample_entries()[1]

    assert store.cleanup((team,)) == 1
    assert connection.calls[-1][1] == (False, "team-1")

    assert store.restore((team,)) == 1
    assert connection.calls[-1][1][1:] == (True, "team-1")


def test_cleanup_preflight_requires_live_columns_and_migrations(tmp_path: Path) -> None:
    state = rollback.SchemaState(
        frozenset(rollback.REQUIRED_COLUMNS) - {("LiteLLM_GuardrailsTable", "status")},
        frozenset(rollback.REQUIRED_MIGRATIONS) - {"20260228170127_support_team_based_guardrails"},
    )
    store = FakeStore(state=state)

    with pytest.raises(ValueError, match=r"missing column.*missing migration"):
        rollback.run(store, "cleanup", False, tmp_path)


def write_backup(path: Path, entries: tuple[rollback.Entry, ...]) -> None:
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "created_at": "2026-08-02T00:00:00+00:00",
                "entries": [
                    {
                        "kind": entry.kind,
                        "entity_id": entry.entity_id,
                        "metadata": entry.metadata,
                        "team_guardrail_config": entry.team_guardrail_config,
                    }
                    for entry in entries
                ],
            }
        )
    )


def test_restore_is_diff_based_and_idempotent(tmp_path: Path) -> None:
    entries = sample_entries()
    backup = tmp_path / "backup.json"
    write_backup(backup, entries)
    store = FakeStore(current=entries)

    dry_run = rollback.run(store, "restore", False, tmp_path, backup)
    applied = rollback.run(store, "restore", True, tmp_path, backup)

    assert dry_run["key_count"] == 0
    assert dry_run["team_count"] == 0
    assert applied["changed_count"] == 0
    assert store.restore_calls == [()]


def test_restore_applies_only_existing_changed_entries(tmp_path: Path) -> None:
    entries = sample_entries()
    backup = tmp_path / "backup.json"
    write_backup(backup, entries)
    current = (rollback.Entry("key", "secret-token", {}), entries[1])
    store = FakeStore(current=current)

    result = rollback.run(store, "restore", True, tmp_path, backup)

    assert result["changed_count"] == 1
    assert store.restore_calls == [(entries[0],)]


def test_restore_rejects_missing_targets_without_exposing_raw_ids(tmp_path: Path) -> None:
    entries = sample_entries()
    backup = tmp_path / "backup.json"
    write_backup(backup, entries)
    store = FakeStore(current=(entries[0],))

    with pytest.raises(ValueError, match="restore targets are missing") as error:
        rollback.run(store, "restore", True, tmp_path, backup)

    assert "team-1" not in str(error.value)
    assert store.restore_calls == []


def test_backup_rejects_non_allowlisted_metadata(tmp_path: Path) -> None:
    backup = tmp_path / "backup.json"
    backup.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "created_at": "2026-08-02T00:00:00+00:00",
                "entries": [
                    {
                        "kind": "key",
                        "entity_id": "token",
                        "metadata": {"api_key": "plaintext"},
                        "team_guardrail_config": None,
                    }
                ],
            }
        )
    )

    with pytest.raises(ValueError, match="unsupported metadata"):
        rollback.load_backup(backup)


def test_policy_blockers_cover_add_remove_and_pipeline_references() -> None:
    rows = [
        {
            "policy_id": "p-1",
            "policy_name": "production-policy",
            "guardrails_add": ["purview-add"],
            "guardrails_remove": ["purview-remove"],
            "pipeline": {"steps": [{"guardrail": "purview-pipeline"}, {"guardrail": 1}, "bad"]},
        }
    ]

    blockers = rollback.find_policy_blockers(rows, ("purview-add", "purview-remove", "purview-pipeline"))

    assert blockers == (
        rollback.Blocker(
            "policy",
            "p-1",
            "production-policy",
            ("purview-add", "purview-pipeline", "purview-remove"),
        ),
    )


def test_restore_uses_live_preflight_before_reading_backup(tmp_path: Path) -> None:
    state = rollback.SchemaState(
        frozenset(rollback.REQUIRED_COLUMNS),
        frozenset(rollback.REQUIRED_MIGRATIONS) - {"20260214094754_schema_sync"},
    )
    store = FakeStore(state=state)

    with pytest.raises(ValueError, match="20260214094754_schema_sync"):
        rollback.run(store, "restore", False, tmp_path, tmp_path / "not-read.json")
