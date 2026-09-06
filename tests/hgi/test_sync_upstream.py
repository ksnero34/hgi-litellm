import importlib.util
import subprocess
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).parents[2] / "scripts" / "hgi" / "sync_upstream.py"
SPEC = importlib.util.spec_from_file_location("sync_upstream", MODULE_PATH)
assert SPEC is not None
assert SPEC.loader is not None
sync_upstream = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync_upstream)


def git(repo, *args):
    return subprocess.run(
        ("git", *args),
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    )


def valid_manifest():
    return {
        "schema_version": 1,
        "groups": [
            {
                "name": "one",
                "commit": "feat: one",
                "paths": ["src/file.py"],
                "remove_paths": ["enterprise"],
            }
        ],
    }


def test_path_is_owned_supports_files_and_directories():
    owned = ["src/file.py", "enterprise"]

    assert sync_upstream.path_is_owned("src/file.py", owned)
    assert sync_upstream.path_is_owned("enterprise/package.py", owned)
    assert not sync_upstream.path_is_owned("src/other.py", owned)


def test_load_manifest_rejects_duplicate_path_ownership(tmp_path):
    manifest = valid_manifest()
    manifest["groups"].append(
        {
            "name": "two",
            "commit": "feat: two",
            "paths": ["enterprise"],
            "remove_paths": [],
        }
    )
    path = tmp_path / "manifest.json"
    path.write_text(__import__("json").dumps(manifest))

    with pytest.raises(ValueError, match="overlaps"):
        sync_upstream.load_manifest(path)


def test_load_project_manifest():
    manifest = sync_upstream.load_manifest(Path(__file__).parents[2] / "customizations" / "manifest.json")

    assert manifest["base_ref"] == "e4f25265704e2b2c6cf6e81be2e4c5cffff896f4"
    assert {group["name"] for group in manifest["groups"]} == {
        "license-boundary",
        "oidc",
        "virtual-key-controls",
        "purview",
        "closed-network-ui",
        "presidio-governance",
        "dashboard-i18n",
        "usage-performance-metrics",
        "upstream-runtime-fixes",
        "prisma-v2-migrations",
        "spend-log-detail-access",
        "observability-scope",
        "oss-audit-logs",
        "maintenance-tooling",
    }


def test_verify_coverage_includes_extra_working_tree_paths(monkeypatch, tmp_path):
    monkeypatch.setattr(sync_upstream, "changed_paths", lambda *_: ["src/file.py"])

    uncovered = sync_upstream.verify_coverage(
        tmp_path,
        valid_manifest(),
        "base",
        "custom",
        extra_paths=["src/new.py", "enterprise/new.py"],
    )

    assert uncovered == ["src/new.py"]


def test_verify_coverage_ignores_removed_build_artifact(monkeypatch, tmp_path):
    artifact = "ui/litellm-dashboard/tsconfig.tsbuildinfo"
    monkeypatch.setattr(sync_upstream, "changed_paths", lambda *_: [artifact])

    assert sync_upstream.verify_coverage(tmp_path, valid_manifest(), "base", "custom") == []


def test_verify_coverage_rejects_present_build_artifact(monkeypatch, tmp_path):
    artifact = "ui/litellm-dashboard/tsconfig.tsbuildinfo"
    artifact_path = tmp_path / artifact
    artifact_path.parent.mkdir(parents=True)
    artifact_path.write_text("generated")
    monkeypatch.setattr(sync_upstream, "changed_paths", lambda *_: [artifact])

    assert sync_upstream.verify_coverage(tmp_path, valid_manifest(), "base", "custom") == [artifact]


def test_manifest_path_errors_accepts_existing_file_and_absent_remove_path(tmp_path):
    source = tmp_path / "src" / "file.py"
    source.parent.mkdir()
    source.write_text("value = 1\n")

    assert (
        sync_upstream.manifest_path_errors(
            tmp_path,
            valid_manifest(),
            "HEAD",
            use_working_tree=True,
        )
        == []
    )


def test_manifest_path_errors_reports_missing_file(tmp_path):
    errors = sync_upstream.manifest_path_errors(
        tmp_path,
        valid_manifest(),
        "HEAD",
        use_working_tree=True,
    )

    assert errors == ["Group one path does not exist: src/file.py"]


def test_manifest_path_errors_accepts_existing_directory(tmp_path):
    manifest = valid_manifest()
    manifest["groups"][0]["paths"] = ["src"]
    (tmp_path / "src").mkdir()

    assert (
        sync_upstream.manifest_path_errors(
            tmp_path,
            manifest,
            "HEAD",
            use_working_tree=True,
        )
        == []
    )


def test_manifest_path_errors_reports_present_remove_path(tmp_path):
    source = tmp_path / "src" / "file.py"
    source.parent.mkdir()
    source.write_text("value = 1\n")
    (tmp_path / "enterprise").mkdir()

    errors = sync_upstream.manifest_path_errors(
        tmp_path,
        valid_manifest(),
        "HEAD",
        use_working_tree=True,
    )

    assert errors == ["Group one remove_path still exists: enterprise"]


def test_manifest_path_errors_reads_custom_ref_for_apply(tmp_path):
    git(tmp_path, "init")
    git(tmp_path, "config", "user.email", "test@example.com")
    git(tmp_path, "config", "user.name", "Test")
    source = tmp_path / "src" / "file.py"
    source.parent.mkdir()
    source.write_text("value = 1\n")
    git(tmp_path, "add", ".")
    git(tmp_path, "commit", "-m", "custom")
    source.unlink()

    assert (
        sync_upstream.manifest_path_errors(
            tmp_path,
            valid_manifest(),
            "HEAD",
            use_working_tree=False,
        )
        == []
    )


def test_apply_group_replays_patch_and_sanitizes_paths(tmp_path):
    source = tmp_path / "source"
    target = tmp_path / "target"
    source.mkdir()
    git(source, "init")
    git(source, "config", "user.email", "test@example.com")
    git(source, "config", "user.name", "Test")
    (source / "feature.txt").write_text("upstream\n")
    (source / "enterprise").mkdir()
    (source / "enterprise" / "module.py").write_text("licensed = True\n")
    git(source, "add", ".")
    git(source, "commit", "-m", "base")
    git(source, "tag", "base")
    (source / "feature.txt").write_text("custom\n")
    git(source, "add", "feature.txt")
    git(source, "commit", "-m", "custom")
    git(source, "tag", "custom")
    git(tmp_path, "clone", str(source), str(target))
    git(target, "config", "user.email", "test@example.com")
    git(target, "config", "user.name", "Test")
    git(target, "checkout", "base")

    applied = sync_upstream.apply_group(
        source,
        target,
        "base",
        "custom",
        {
            "paths": ["feature.txt"],
            "remove_paths": ["enterprise"],
            "commit": "feat: replay",
        },
    )

    assert applied
    assert (target / "feature.txt").read_text() == "custom\n"
    assert not (target / "enterprise").exists()
    assert git(target, "status", "--short").stdout == ""


def test_update_manifest_base_pins_upstream_commit(tmp_path):
    git(tmp_path, "init")
    git(tmp_path, "config", "user.email", "test@example.com")
    git(tmp_path, "config", "user.name", "Test")
    manifest_path = tmp_path / "customizations" / "manifest.json"
    manifest_path.parent.mkdir()
    manifest_path.write_text('{"schema_version": 1, "base_ref": "old", "groups": []}\n')
    git(tmp_path, "add", ".")
    git(tmp_path, "commit", "-m", "initial")

    updated = sync_upstream.update_manifest_base(
        tmp_path,
        Path("customizations/manifest.json"),
        "0123456789abcdef",
    )

    assert updated
    manifest = __import__("json").loads(manifest_path.read_text())
    assert manifest["base_ref"] == "0123456789abcdef"
    assert git(tmp_path, "status", "--short").stdout == ""
    assert not sync_upstream.update_manifest_base(
        tmp_path,
        Path("customizations/manifest.json"),
        "0123456789abcdef",
    )
