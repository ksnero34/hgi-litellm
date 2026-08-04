"""
Static checks on docker/Dockerfile.non_root.

The non_root image is intended for deployment into hardened Kubernetes
clusters where `securityContext.runAsNonRoot: true` is enforced. The
kubelet validates non-root status by parsing the image's USER field as
an integer — a string name like "nobody" is rejected with
CreateContainerConfigError because the kubelet cannot resolve
/etc/passwd inside the image at admission time.
"""

import os
import re

import pytest

DOCKERFILE_PATH = os.path.join(
    os.path.dirname(__file__),
    "..",
    "..",
    "docker",
    "Dockerfile.non_root",
)


def _final_user_directive(dockerfile_text: str) -> str:
    """Return the value of the last `USER` directive in the file."""
    matches = re.findall(r"^USER\s+(\S+)\s*$", dockerfile_text, re.MULTILINE)
    assert matches, "Dockerfile.non_root has no USER directive"
    return matches[-1]


def _dockerfile_contents() -> str:
    with open(DOCKERFILE_PATH, "r", encoding="utf-8") as dockerfile:
        return dockerfile.read()


@pytest.mark.skipif(
    not os.path.exists(DOCKERFILE_PATH),
    reason="Dockerfile.non_root not present in this checkout",
)
def test_final_user_directive_is_numeric():
    """The runtime USER must be a numeric UID so kubelet's runAsNonRoot
    admission check (strconv.Atoi) succeeds."""
    contents = _dockerfile_contents()

    final_user = _final_user_directive(contents)

    assert final_user.isdigit(), (
        f"Dockerfile.non_root final USER is {final_user!r}; must be a numeric UID "
        "so Kubernetes' runAsNonRoot admission check can verify non-root status. "
        "See https://kubernetes.io/docs/tasks/configure-pod-container/security-context/"
    )

    assert int(final_user) != 0, (
        f"Dockerfile.non_root final USER is {final_user} (root); the non_root image "
        "must run as a non-zero UID."
    )


def test_prisma_cli_and_binary_engine_are_baked_for_offline_runtime():
    contents = _dockerfile_contents()

    assert "COPY --from=builder /opt/prisma /opt/prisma" in contents
    assert "PRISMA_BINARY_CACHE_DIR=/opt/prisma/binaries" in contents
    assert "PRISMA_CLI_PATH=/opt/prisma/binaries/node_modules/.bin/prisma" in contents
    assert "PRISMA_CLI_QUERY_ENGINE_TYPE=binary" in contents
    assert "test -x /opt/prisma/binaries/node_modules/.bin/prisma" in contents
    assert "query-engine-*" in contents


def test_prisma_runtime_does_not_generate_or_write_to_baked_engine_directory():
    contents = _dockerfile_contents()
    runtime_stage = contents.split("FROM $LITELLM_RUNTIME_IMAGE AS runtime", 1)[1]
    runtime_after_user = runtime_stage.rsplit("USER 65534", 1)[1]

    assert "RUN prisma generate" not in runtime_after_user
    assert "XDG_CACHE_HOME=/opt/prisma" not in runtime_stage
