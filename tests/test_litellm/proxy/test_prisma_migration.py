import importlib.util
import subprocess
import sys
from pathlib import Path
from types import ModuleType
from typing import Protocol, cast
from unittest.mock import Mock, patch

import pytest

MODULE_PATH = Path(__file__).parents[3] / "litellm/proxy/prisma_migration.py"


class PrismaMigrationModule(Protocol):
    def run_prisma_generate(self) -> None: ...

    def main(self) -> int: ...


def load_module() -> PrismaMigrationModule:
    spec = importlib.util.spec_from_file_location("prisma_migration", MODULE_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    logger = Mock()
    logging_module = ModuleType("litellm._logging")
    setattr(logging_module, "verbose_proxy_logger", logger)
    proxy_cli_module = ModuleType("litellm.proxy.proxy_cli")
    setattr(proxy_cli_module, "run_server", Mock())

    with (
        patch.dict(
            sys.modules,
            {
                "litellm._logging": logging_module,
                "litellm.proxy.proxy_cli": proxy_cli_module,
            },
        ),
        patch("subprocess.run", return_value=subprocess.CompletedProcess([], 0)),
    ):
        spec.loader.exec_module(module)

    return cast(PrismaMigrationModule, module)


def test_prisma_generate_is_skipped_when_requested(monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_module()
    monkeypatch.setenv("PRISMA_SKIP_GENERATE", "true")

    with patch("subprocess.run") as run:
        result = module.run_prisma_generate()

    assert result is None
    run.assert_not_called()
    module.verbose_proxy_logger.info.assert_called_once_with("Skipping 'prisma generate'.")


def test_prisma_generate_uses_default_cli_path(monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_module()
    monkeypatch.delenv("PRISMA_CLI_PATH", raising=False)
    monkeypatch.delenv("PRISMA_SKIP_GENERATE", raising=False)

    with patch(
        "subprocess.run",
        return_value=subprocess.CompletedProcess(["prisma", "generate"], 0, stdout="generated", stderr=""),
    ) as run:
        result = module.run_prisma_generate()

    assert result is None
    run.assert_called_once_with(["prisma", "generate"], capture_output=True, text=True)
    module.verbose_proxy_logger.info.assert_any_call("'prisma generate' stdout: %s", "generated")


def test_prisma_generate_uses_configured_cli_path(monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_module()
    monkeypatch.setenv("PRISMA_CLI_PATH", "/usr/local/bin/prisma")
    monkeypatch.delenv("PRISMA_SKIP_GENERATE", raising=False)

    with patch(
        "subprocess.run",
        return_value=subprocess.CompletedProcess(
            ["/usr/local/bin/prisma", "generate"],
            0,
            stdout="generated",
            stderr="",
        ),
    ) as run:
        result = module.run_prisma_generate()

    assert result is None
    run.assert_called_once_with(["/usr/local/bin/prisma", "generate"], capture_output=True, text=True)
    module.verbose_proxy_logger.info.assert_any_call("'prisma generate' stdout: %s", "generated")


def test_prisma_generate_failure_is_log_only(monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_module()
    monkeypatch.delenv("PRISMA_SKIP_GENERATE", raising=False)

    with patch(
        "subprocess.run",
        return_value=subprocess.CompletedProcess([], 7, stderr="failed"),
    ):
        module.run_prisma_generate()


def test_migration_check_is_enforced_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_module()
    monkeypatch.delenv("ENFORCE_PRISMA_MIGRATION_CHECK", raising=False)

    with (
        patch.object(module, "run_server") as run_server,
        patch.object(module, "run_prisma_generate"),
    ):
        assert module.main() == 0

    run_server.assert_called_once_with(
        ("--skip_server_startup", "--enforce_prisma_migration_check"),
        standalone_mode=False,
    )


def test_migration_check_can_be_explicitly_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_module()
    monkeypatch.setenv("ENFORCE_PRISMA_MIGRATION_CHECK", "false")

    with (
        patch.object(module, "run_server") as run_server,
        patch.object(module, "run_prisma_generate"),
    ):
        assert module.main() == 0

    run_server.assert_called_once_with(("--skip_server_startup",), standalone_mode=False)
