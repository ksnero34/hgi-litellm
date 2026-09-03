from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

BUILD_ARTIFACT_PATHS = (
    "ui/litellm-dashboard/.next",
    "ui/litellm-dashboard/coverage",
    "ui/litellm-dashboard/tsconfig.tsbuildinfo",
)


def emit(message: str, *, error: bool = False) -> None:
    stream = sys.stderr if error else sys.stdout
    stream.write(f"{message}\n")


def run(
    args: Sequence[str],
    cwd: Path,
    *,
    input_bytes: bytes | None = None,
    capture: bool = False,
) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        list(args),
        cwd=cwd,
        input=input_bytes,
        check=True,
        stdout=subprocess.PIPE if capture else None,
    )


def git_output(repo: Path, *args: str) -> str:
    result = run(("git", *args), repo, capture=True)
    return result.stdout.decode().strip()


def load_manifest(path: Path) -> dict[str, Any]:
    manifest = json.loads(path.read_text())
    if manifest.get("schema_version") != 1:
        raise ValueError("Unsupported manifest schema_version")
    groups = manifest.get("groups")
    if not isinstance(groups, list) or not groups:
        raise ValueError("Manifest groups must be a non-empty list")
    names: set[str] = set()
    owned_paths: dict[str, str] = {}
    for group in groups:
        name = group.get("name")
        if not isinstance(name, str) or not name or name in names:
            raise ValueError("Every group must have a unique non-empty name")
        names.add(name)
        if not isinstance(group.get("commit"), str) or not group["commit"]:
            raise ValueError(f"Group {name} must define a commit message")
        for field in ("paths", "remove_paths"):
            paths = group.get(field)
            if not isinstance(paths, list):
                raise ValueError(f"Group {name} field {field} must be a list")
            for owned_path in paths:
                if not isinstance(owned_path, str) or not owned_path:
                    raise ValueError(f"Group {name} has an invalid path")
                normalized = owned_path.rstrip("/")
                for existing_path, existing_group in owned_paths.items():
                    if path_is_owned(normalized, [existing_path]) or path_is_owned(existing_path, [normalized]):
                        raise ValueError(
                            f"Path ownership overlaps between {existing_group} and {name}: "
                            f"{existing_path}, {normalized}"
                        )
                owned_paths[normalized] = name
    return manifest


def path_is_owned(path: str, owned_paths: Sequence[str]) -> bool:
    return any(path == owned or path.startswith(f"{owned}/") for owned in owned_paths)


def changed_paths(repo: Path, base_ref: str, custom_ref: str) -> list[str]:
    output = git_output(repo, "diff", "--name-only", f"{base_ref}..{custom_ref}")
    return [line for line in output.splitlines() if line]


def working_tree_paths(repo: Path) -> list[str]:
    tracked = git_output(repo, "diff", "--name-only", "HEAD")
    untracked = git_output(repo, "ls-files", "--others", "--exclude-standard")
    return sorted({line for output in (tracked, untracked) for line in output.splitlines() if line})


def is_removed_build_artifact(repo: Path, path: str) -> bool:
    return path_is_owned(path, BUILD_ARTIFACT_PATHS) and not (repo / path).exists()


def ref_path_exists(repo: Path, ref: str, path: str) -> bool:
    result = subprocess.run(
        ("git", "cat-file", "-e", f"{ref}:{path}"),
        cwd=repo,
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return result.returncode == 0


def manifest_path_errors(
    repo: Path,
    manifest: dict[str, Any],
    custom_ref: str,
    *,
    use_working_tree: bool,
) -> list[str]:
    def path_exists(path: str) -> bool:
        if use_working_tree:
            target = repo / path
            return target.exists() or target.is_symlink()
        return ref_path_exists(repo, custom_ref, path)

    missing_paths = (
        f"Group {group['name']} path does not exist: {path}"
        for group in manifest["groups"]
        for path in group["paths"]
        if not path_exists(path.rstrip("/"))
    )
    present_remove_paths = (
        f"Group {group['name']} remove_path still exists: {path}"
        for group in manifest["groups"]
        for path in group["remove_paths"]
        if path_exists(path.rstrip("/"))
    )
    return [*missing_paths, *present_remove_paths]


def verify_coverage(
    repo: Path,
    manifest: dict[str, Any],
    base_ref: str,
    custom_ref: str,
    extra_paths: Sequence[str] = (),
) -> list[str]:
    owned_paths = [
        path.rstrip("/") for group in manifest["groups"] for field in ("paths", "remove_paths") for path in group[field]
    ]
    generated_paths = [path.rstrip("/") for path in manifest.get("generated_paths", [])]
    candidates = set(changed_paths(repo, base_ref, custom_ref))
    candidates.update(extra_paths)
    return [
        path
        for path in sorted(candidates)
        if not path_is_owned(path, owned_paths)
        and not path_is_owned(path, generated_paths)
        and not is_removed_build_artifact(repo, path)
    ]


def apply_group(
    repo: Path,
    worktree: Path,
    base_ref: str,
    custom_ref: str,
    group: dict[str, Any],
) -> bool:
    paths = group["paths"]
    if paths:
        patch = run(
            (
                "git",
                "diff",
                "--binary",
                "--full-index",
                f"{base_ref}..{custom_ref}",
                "--",
                *paths,
            ),
            repo,
            capture=True,
        ).stdout
        if patch:
            run(("git", "apply", "--3way", "--index", "-"), worktree, input_bytes=patch)
    remove_paths = group["remove_paths"]
    if remove_paths:
        run(("git", "rm", "-r", "--ignore-unmatch", "--", *remove_paths), worktree)
    staged = git_output(worktree, "diff", "--cached", "--name-only")
    if not staged:
        return False
    run(("git", "commit", "-m", group["commit"]), worktree)
    return True


def check_ref(repo: Path, ref: str) -> None:
    run(("git", "rev-parse", "--verify", f"{ref}^{{commit}}"), repo, capture=True)


def check_branch_absent(repo: Path, branch: str) -> None:
    result = subprocess.run(
        ("git", "show-ref", "--verify", "--quiet", f"refs/heads/{branch}"),
        cwd=repo,
        check=False,
    )
    if result.returncode == 0:
        raise ValueError(f"Branch already exists: {branch}")


def update_manifest_base(
    worktree: Path,
    manifest_relative_path: Path,
    upstream_commit: str,
) -> bool:
    target = worktree / manifest_relative_path
    manifest = json.loads(target.read_text())
    manifest["base_ref"] = upstream_commit
    target.write_text(f"{json.dumps(manifest, indent=2, ensure_ascii=False)}\n")
    run(("git", "add", str(manifest_relative_path)), worktree)
    if not git_output(worktree, "diff", "--cached", "--name-only"):
        return False
    run(("git", "commit", "-m", "chore(hgi): record upstream base"), worktree)
    return True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("customizations/manifest.json"),
    )
    parser.add_argument("--base-ref")
    parser.add_argument("--custom-ref", default="HEAD")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("check")
    apply_parser = subparsers.add_parser("apply")
    apply_parser.add_argument("--upstream-ref", required=True)
    apply_parser.add_argument("--branch", required=True)
    apply_parser.add_argument("--worktree", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo = Path(git_output(Path.cwd(), "rev-parse", "--show-toplevel"))
    manifest_path = args.manifest
    if not manifest_path.is_absolute():
        manifest_path = repo / manifest_path
    try:
        manifest_relative_path = manifest_path.relative_to(repo)
    except ValueError as error:
        raise ValueError("Manifest must be inside the repository") from error
    manifest = load_manifest(manifest_path)
    base_ref = args.base_ref or manifest["base_ref"]
    check_ref(repo, base_ref)
    check_ref(repo, args.custom_ref)
    custom_is_head = git_output(repo, "rev-parse", f"{args.custom_ref}^{{commit}}") == git_output(
        repo, "rev-parse", "HEAD^{commit}"
    )
    path_errors = manifest_path_errors(
        repo,
        manifest,
        args.custom_ref,
        use_working_tree=args.command == "check" and custom_is_head,
    )
    if path_errors:
        emit("Invalid manifest path declarations:", error=True)
        for error in path_errors:
            emit(f"  {error}", error=True)
        return 2
    extra_paths = working_tree_paths(repo) if args.command == "check" else ()
    uncovered = verify_coverage(
        repo,
        manifest,
        base_ref,
        args.custom_ref,
        extra_paths=extra_paths,
    )
    if uncovered:
        emit("Uncovered customization paths:", error=True)
        for path in uncovered:
            emit(f"  {path}", error=True)
        return 2
    emit(f"Manifest covers all changes in {base_ref}..{args.custom_ref} across {len(manifest['groups'])} groups.")
    if args.command == "check":
        return 0
    if working_tree_paths(repo):
        raise ValueError("Apply requires a clean working tree")
    worktree = args.worktree.resolve()
    if worktree.exists():
        raise ValueError(f"Worktree path already exists: {worktree}")
    check_ref(repo, args.upstream_ref)
    upstream_commit = git_output(repo, "rev-parse", f"{args.upstream_ref}^{{commit}}")
    check_branch_absent(repo, args.branch)
    run(
        (
            "git",
            "worktree",
            "add",
            "-b",
            args.branch,
            str(worktree),
            args.upstream_ref,
        ),
        repo,
    )
    applied: list[str] = []
    for group in manifest["groups"]:
        if apply_group(repo, worktree, base_ref, args.custom_ref, group):
            applied.append(group["name"])
    update_manifest_base(worktree, manifest_relative_path, upstream_commit)
    emit(f"Created {args.branch} at {worktree}")
    emit(f"Recorded upstream base: {upstream_commit}")
    emit(f"Applied groups: {', '.join(applied)}")
    generated = manifest.get("generated_paths", [])
    if generated:
        emit("Regenerate before validation:")
        for path in generated:
            emit(f"  {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
