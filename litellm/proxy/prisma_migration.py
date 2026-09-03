"""Standalone entrypoint for applying database migrations and generating the Prisma client.

Migration failures fail the entrypoint by default; set ENFORCE_PRISMA_MIGRATION_CHECK=false
for log-only behavior. A failed 'prisma generate' is always log-only: every shipped image
bakes the client at build time, and refreshing it writes into site-packages, which an
arbitrary non-root uid or a read-only root filesystem cannot do.
"""

import os
import subprocess
import sys

sys.path.insert(0, os.path.abspath("./"))

from litellm._logging import verbose_proxy_logger
from litellm.proxy.proxy_cli import run_server
from litellm.secret_managers.main import str_to_bool


def run_prisma_generate() -> None:
    if os.getenv("PRISMA_SKIP_GENERATE") == "true":
        verbose_proxy_logger.info("Skipping 'prisma generate'.")
        return

    prisma_cli_path = os.getenv("PRISMA_CLI_PATH") or "prisma"
    verbose_proxy_logger.info("Running 'prisma generate'...")
    result = subprocess.run([prisma_cli_path, "generate"], capture_output=True, text=True)
    verbose_proxy_logger.info("'prisma generate' stdout: %s", result.stdout)

    if result.returncode != 0:
        verbose_proxy_logger.warning(
            "'prisma generate' failed with exit code %s: %s",
            result.returncode,
            result.stderr,
        )


def main() -> int:
    enforce_migration_check = str_to_bool(os.getenv("ENFORCE_PRISMA_MIGRATION_CHECK")) is not False
    args = (
        ("--skip_server_startup", "--enforce_prisma_migration_check")
        if enforce_migration_check
        else ("--skip_server_startup",)
    )
    run_server(args, standalone_mode=False)
    run_prisma_generate()
    return 0


if __name__ == "__main__":
    sys.exit(main())
