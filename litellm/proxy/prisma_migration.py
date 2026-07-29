# What is this?
## Script to apply initial prisma migration on Docker setup

import os
import subprocess
import sys

sys.path.insert(0, os.path.abspath("./"))  # Adds the parent directory to the system path

from litellm._logging import verbose_proxy_logger
from litellm.proxy.proxy_cli import run_server


def run_prisma_generate() -> None:
    if os.getenv("PRISMA_SKIP_GENERATE") == "true":
        verbose_proxy_logger.info("Skipping 'prisma generate'.")
        return

    prisma_cli_path = os.getenv("PRISMA_CLI_PATH") or "prisma"
    verbose_proxy_logger.info("Running 'prisma generate'...")
    result = subprocess.run([prisma_cli_path, "generate"], capture_output=True, text=True)
    verbose_proxy_logger.info(f"'prisma generate' stdout: {result.stdout}")

    if result.returncode != 0:
        verbose_proxy_logger.info(f"'prisma generate' failed with exit code {result.returncode}.")
        verbose_proxy_logger.error(f"'prisma generate' stderr: {result.stderr}")
        raise SystemExit(result.returncode)


def main() -> None:
    run_server(["--skip_server_startup"], standalone_mode=False)
    run_prisma_generate()


if __name__ == "__main__":
    main()
