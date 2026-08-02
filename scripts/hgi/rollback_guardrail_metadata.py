from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from contextlib import AbstractContextManager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Literal, Mapping, Protocol, Sequence, cast

JsonScalar = None | bool | int | float | str
JsonValue = JsonScalar | list["JsonValue"] | dict[str, "JsonValue"]
JsonObject = dict[str, JsonValue]
EntityKind = Literal["key", "team"]
KEY_FIELDS = ("disable_global_guardrails", "guardrails", "policies")
TEAM_FIELDS = KEY_FIELDS + ("opted_out_global_guardrails",)
REQUIRED_COLUMNS = (
    ("LiteLLM_GuardrailsTable", "guardrail_id"),
    ("LiteLLM_GuardrailsTable", "guardrail_name"),
    ("LiteLLM_GuardrailsTable", "litellm_params"),
    ("LiteLLM_GuardrailsTable", "status"),
    ("LiteLLM_GuardrailsTable", "team_id"),
    ("LiteLLM_PolicyTable", "guardrails_add"),
    ("LiteLLM_PolicyTable", "guardrails_remove"),
    ("LiteLLM_PolicyTable", "pipeline"),
    ("LiteLLM_PolicyTable", "policy_id"),
    ("LiteLLM_PolicyTable", "policy_name"),
    ("LiteLLM_PolicyTable", "version_status"),
    ("LiteLLM_TeamTable", "allow_team_guardrail_config"),
    ("LiteLLM_TeamTable", "metadata"),
    ("LiteLLM_TeamTable", "team_id"),
    ("LiteLLM_VerificationToken", "metadata"),
    ("LiteLLM_VerificationToken", "token"),
)
REQUIRED_MIGRATIONS = (
    "20250514142245_add_guardrails_table",
    "20260123131407_add_policy_tables_and_policies_field",
    "20260205091235_allow_team_guardrail_config",
    "20260214094754_schema_sync",
    "20260214163027_add_pipeline_to_policy_table",
    "20260221183800_add_policy_versioning",
    "20260228170127_support_team_based_guardrails",
)


@dataclass(frozen=True, slots=True)
class SchemaState:
    columns: frozenset[tuple[str, str]]
    migrations: frozenset[str]


@dataclass(frozen=True, slots=True)
class Entry:
    kind: EntityKind
    entity_id: str
    metadata: JsonObject
    team_guardrail_config: bool | None = None


@dataclass(frozen=True, slots=True)
class Blocker:
    kind: Literal["guardrail", "policy"]
    entity_id: str
    name: str
    references: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class Snapshot:
    entries: tuple[Entry, ...]
    blockers: tuple[Blocker, ...]


@dataclass(frozen=True, slots=True)
class Backup:
    schema_version: int
    created_at: str
    entries: tuple[Entry, ...]


class ResultLike(Protocol):
    def fetchall(self) -> list[Mapping[str, object]]: ...
    def fetchone(self) -> Mapping[str, object] | None: ...


class ConnectionLike(Protocol):
    def execute(self, query: str, params: object = ()) -> ResultLike: ...
    def transaction(self) -> AbstractContextManager[object]: ...
    def __enter__(self) -> ConnectionLike: ...
    def __exit__(self, exc_type: object, exc_value: object, traceback: object) -> None: ...


class Store(Protocol):
    def schema_state(self) -> SchemaState: ...
    def snapshot(self) -> Snapshot: ...
    def current_entries(self, entries: Sequence[Entry]) -> tuple[Entry, ...]: ...
    def cleanup(self, entries: Sequence[Entry]) -> int: ...
    def restore(self, entries: Sequence[Entry]) -> int: ...


def selected_metadata(value: object, allowed: Sequence[str]) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    return {field: cast(JsonValue, value[field]) for field in allowed if field in value}


def string_list(value: object) -> tuple[str, ...]:
    return tuple(item for item in value if isinstance(item, str)) if isinstance(value, list) else ()


def pipeline_guardrails(value: object) -> tuple[str, ...]:
    if not isinstance(value, dict) or not isinstance(value.get("steps"), list):
        return ()
    return tuple(
        guardrail
        for step in value["steps"]
        if isinstance(step, dict)
        for guardrail in (step.get("guardrail"),)
        if isinstance(guardrail, str)
    )


def find_policy_blockers(rows: Sequence[Mapping[str, object]], guardrail_names: Sequence[str]) -> tuple[Blocker, ...]:
    names = frozenset(guardrail_names)
    return tuple(
        Blocker("policy", str(row["policy_id"]), str(row["policy_name"]), references)
        for row in rows
        for references in (
            tuple(
                sorted(
                    names.intersection(
                        string_list(row.get("guardrails_add"))
                        + string_list(row.get("guardrails_remove"))
                        + pipeline_guardrails(row.get("pipeline"))
                    )
                )
            ),
        )
        if references
    )


class PostgresStore:
    def __init__(self, database_url: str):
        self.database_url = database_url

    def connect(self) -> ConnectionLike:
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as error:
            raise RuntimeError("psycopg is required to use this command") from error
        return cast(ConnectionLike, psycopg.connect(self.database_url, row_factory=dict_row))

    def schema_state(self) -> SchemaState:
        tables = sorted({table for table, _ in REQUIRED_COLUMNS})
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT table_name, column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = ANY(%s::text[])",
                (tables,),
            ).fetchall()
            migration_table = connection.execute(
                "SELECT to_regclass('public.\"_prisma_migrations\"') AS name"
            ).fetchone()
            migration_rows = (
                connection.execute(
                    'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL'
                ).fetchall()
                if migration_table and migration_table.get("name")
                else []
            )
        return SchemaState(
            frozenset((str(row["table_name"]), str(row["column_name"])) for row in rows),
            frozenset(str(row["migration_name"]) for row in migration_rows),
        )

    def snapshot(self) -> Snapshot:
        with self.connect() as connection:
            key_rows = connection.execute(
                'SELECT token, metadata FROM "LiteLLM_VerificationToken" '
                "WHERE coalesce(metadata, '{}'::jsonb) ?| %s::text[] ORDER BY token",
                (list(KEY_FIELDS),),
            ).fetchall()
            team_rows = connection.execute(
                'SELECT team_id, metadata, allow_team_guardrail_config FROM "LiteLLM_TeamTable" '
                "WHERE allow_team_guardrail_config OR coalesce(metadata, '{}'::jsonb) ?| %s::text[] ORDER BY team_id",
                (list(TEAM_FIELDS),),
            ).fetchall()
            guardrail_rows = connection.execute(
                'SELECT guardrail_id, guardrail_name FROM "LiteLLM_GuardrailsTable" '
                "WHERE status = 'active' AND litellm_params->>'guardrail' = 'microsoft_purview' "
                "ORDER BY guardrail_name, guardrail_id"
            ).fetchall()
            names = tuple(str(row["guardrail_name"]) for row in guardrail_rows)
            policy_rows = connection.execute(
                'SELECT policy_id, policy_name, guardrails_add, guardrails_remove, pipeline FROM "LiteLLM_PolicyTable" '
                "WHERE version_status = 'production' ORDER BY policy_name, policy_id"
            ).fetchall()
        keys = tuple(
            Entry("key", str(row["token"]), selected_metadata(row.get("metadata"), KEY_FIELDS)) for row in key_rows
        )
        teams = tuple(
            Entry(
                "team",
                str(row["team_id"]),
                selected_metadata(row.get("metadata"), TEAM_FIELDS),
                bool(row["allow_team_guardrail_config"]),
            )
            for row in team_rows
        )
        guardrails = tuple(
            Blocker("guardrail", str(row["guardrail_id"]), str(row["guardrail_name"])) for row in guardrail_rows
        )
        policies = find_policy_blockers(policy_rows, names)
        return Snapshot(keys + teams, guardrails + policies)

    def current_entries(self, entries: Sequence[Entry]) -> tuple[Entry, ...]:
        key_ids = [entry.entity_id for entry in entries if entry.kind == "key"]
        team_ids = [entry.entity_id for entry in entries if entry.kind == "team"]
        with self.connect() as connection:
            key_rows = connection.execute(
                'SELECT token, metadata FROM "LiteLLM_VerificationToken" WHERE token = ANY(%s::text[])', (key_ids,)
            ).fetchall()
            team_rows = connection.execute(
                'SELECT team_id, metadata, allow_team_guardrail_config FROM "LiteLLM_TeamTable" WHERE team_id = ANY(%s::text[])',
                (team_ids,),
            ).fetchall()
        keys = tuple(
            Entry("key", str(row["token"]), selected_metadata(row.get("metadata"), KEY_FIELDS)) for row in key_rows
        )
        teams = tuple(
            Entry(
                "team",
                str(row["team_id"]),
                selected_metadata(row.get("metadata"), TEAM_FIELDS),
                bool(row["allow_team_guardrail_config"]),
            )
            for row in team_rows
        )
        return keys + teams

    def cleanup(self, entries: Sequence[Entry]) -> int:
        return self._apply(entries, restore=False)

    def restore(self, entries: Sequence[Entry]) -> int:
        return self._apply(entries, restore=True)

    def _apply(self, entries: Sequence[Entry], restore: bool) -> int:
        changed = 0
        with self.connect() as connection, connection.transaction():
            for entry in entries:
                fields = TEAM_FIELDS if entry.kind == "team" else KEY_FIELDS
                table = '"LiteLLM_TeamTable"' if entry.kind == "team" else '"LiteLLM_VerificationToken"'
                identifier_column = "team_id" if entry.kind == "team" else "token"
                removal = "".join(f" - '{field}'" for field in fields)
                restored = " || %s::jsonb" if restore else ""
                team_set = ", allow_team_guardrail_config = %s" if entry.kind == "team" else ""
                params: tuple[object, ...] = (json.dumps(entry.metadata),) if restore else ()
                params += (team_flag(entry, restore),) if entry.kind == "team" else ()
                params += (entry.entity_id,)
                row = connection.execute(
                    f"UPDATE {table} SET metadata = (coalesce(metadata, '{{}}'::jsonb){removal}){restored}"
                    f"{team_set}, updated_at = NOW() WHERE {identifier_column} = %s RETURNING {identifier_column}",
                    params,
                ).fetchone()
                changed += int(row is not None)
        return changed


def team_flag(entry: Entry, restore: bool) -> bool:
    return bool(entry.team_guardrail_config) if restore else False


def preflight(state: SchemaState) -> tuple[str, ...]:
    columns = tuple(
        f"missing column {table}.{column}" for table, column in REQUIRED_COLUMNS if (table, column) not in state.columns
    )
    migrations = tuple(
        f"missing migration {migration}" for migration in REQUIRED_MIGRATIONS if migration not in state.migrations
    )
    return columns + migrations


def identifier(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:12]


def report(
    action: str, apply: bool, entries: Sequence[Entry], blockers: Sequence[Blocker], issues: Sequence[str]
) -> JsonObject:
    return {
        "action": action,
        "mode": "apply" if apply else "dry-run",
        "preflight_issues": list(issues),
        "key_count": sum(entry.kind == "key" for entry in entries),
        "team_count": sum(entry.kind == "team" for entry in entries),
        "targets": [
            {
                "kind": entry.kind,
                "id_sha256": identifier(entry.entity_id),
                "metadata_fields": sorted(entry.metadata),
                **({"allow_team_guardrail_config": entry.team_guardrail_config} if entry.kind == "team" else {}),
            }
            for entry in entries
        ],
        "blockers": [
            {"kind": blocker.kind, "name": blocker.name, "references": list(blocker.references)} for blocker in blockers
        ],
    }


def write_backup(
    entries: Sequence[Entry],
    directory: Path,
    opener: Callable[[Path, int, int], int] = os.open,
    synchronizer: Callable[[int], None] = os.fsync,
) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    path = directory / f"guardrail-metadata-{stamp}.json"
    backup = Backup(1, datetime.now(timezone.utc).isoformat(), tuple(entries))
    descriptor = opener(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump(asdict(backup), stream, indent=2, sort_keys=True)
        stream.write("\n")
        stream.flush()
        synchronizer(stream.fileno())
    directory_descriptor = opener(directory, os.O_RDONLY, 0)
    try:
        synchronizer(directory_descriptor)
    finally:
        os.close(directory_descriptor)
    return path


def load_backup(path: Path) -> Backup:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or raw.get("schema_version") != 1 or not isinstance(raw.get("entries"), list):
        raise ValueError("unsupported backup format")
    entries = tuple(parse_entry(item) for item in raw["entries"])
    created_at = raw.get("created_at")
    if not isinstance(created_at, str):
        raise ValueError("backup is missing created_at")
    return Backup(1, created_at, entries)


def parse_entry(value: object) -> Entry:
    if not isinstance(value, dict) or value.get("kind") not in ("key", "team"):
        raise ValueError("backup contains an invalid entry")
    kind = cast(EntityKind, value["kind"])
    entity_id = value.get("entity_id")
    raw_metadata = value.get("metadata")
    team_flag = value.get("team_guardrail_config")
    allowed = TEAM_FIELDS if kind == "team" else KEY_FIELDS
    if not isinstance(entity_id, str) or not isinstance(raw_metadata, dict) or set(raw_metadata).difference(allowed):
        raise ValueError("backup contains unsupported metadata")
    if kind == "team" and not isinstance(team_flag, bool):
        raise ValueError("backup contains an invalid team flag")
    if kind == "key" and team_flag is not None:
        raise ValueError("backup contains an invalid key flag")
    return Entry(kind, entity_id, selected_metadata(raw_metadata, allowed), cast(bool | None, team_flag))


def changed_restore_entries(backup: Backup, current: Sequence[Entry]) -> tuple[Entry, ...]:
    current_by_id = {(entry.kind, entry.entity_id): entry for entry in current}
    missing = tuple(entry for entry in backup.entries if (entry.kind, entry.entity_id) not in current_by_id)
    if missing:
        targets = ", ".join(f"{entry.kind}:{identifier(entry.entity_id)}" for entry in missing)
        raise ValueError(f"restore targets are missing from the database: {targets}")
    return tuple(entry for entry in backup.entries if current_by_id[(entry.kind, entry.entity_id)] != entry)


def run(store: Store, command: str, apply: bool, output_dir: Path, backup_path: Path | None = None) -> JsonObject:
    issues = preflight(store.schema_state())
    if command == "inspect":
        snapshot = Snapshot((), ()) if issues else store.snapshot()
        return report(command, False, snapshot.entries, snapshot.blockers, issues)
    if issues:
        raise ValueError("preflight failed: " + "; ".join(issues))
    if command == "cleanup":
        snapshot = store.snapshot()
        if snapshot.blockers:
            raise ValueError("cleanup blocked by active microsoft_purview guardrails or production policies")
        result = report(command, apply, snapshot.entries, snapshot.blockers, ())
        if not apply:
            return result
        if not snapshot.entries:
            return {**result, "changed_count": 0}
        saved = write_backup(snapshot.entries, output_dir)
        changed = store.cleanup(snapshot.entries)
        return {**result, "backup_file": str(saved), "changed_count": changed}
    if backup_path is None:
        raise ValueError("restore requires --backup-file")
    backup = load_backup(backup_path)
    entries = changed_restore_entries(backup, store.current_entries(backup.entries))
    result = report(command, apply, entries, (), ())
    if not apply:
        return result
    return {**result, "changed_count": store.restore(entries)}


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="Inspect or roll back HGI guardrail metadata")
    root.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    root.add_argument("--output-dir", type=Path, default=Path(".tmp/hgi-guardrail-rollback"))
    commands = root.add_subparsers(dest="command", required=True)
    commands.add_parser("inspect")
    cleanup = commands.add_parser("cleanup")
    cleanup.add_argument("--apply", action="store_true")
    restore = commands.add_parser("restore")
    restore.add_argument("--backup-file", required=True, type=Path)
    restore.add_argument("--apply", action="store_true")
    return root


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if not args.database_url:
        sys.stderr.write("DATABASE_URL or --database-url is required\n")
        return 2
    try:
        payload = run(
            PostgresStore(args.database_url),
            args.command,
            bool(getattr(args, "apply", False)),
            args.output_dir,
            getattr(args, "backup_file", None),
        )
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as error:
        sys.stderr.write(f"{error}\n")
        return 2
    sys.stdout.write(f"{json.dumps(payload, indent=2, sort_keys=True)}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
