from datetime import datetime, timezone

import pytest

from litellm.proxy.customizations.personal_key_policy import (
    PersonalKeyLifecycle,
    build_personal_key_metadata,
    personal_key_expiry,
    personal_key_revoke_at,
    read_personal_key_metadata,
    requires_distributed_quota,
    resolve_department_team_id,
)


def test_resolve_department_team_requires_exactly_one_managed_team():
    assert resolve_department_team_id({"litellm_sso_managed_team_ids": ["department-1"]}) == "department-1"

    with pytest.raises(ValueError, match="exactly one OIDC-managed department team"):
        resolve_department_team_id({"litellm_sso_managed_team_ids": []})

    with pytest.raises(ValueError, match="exactly one OIDC-managed department team"):
        resolve_department_team_id({"litellm_sso_managed_team_ids": ["department-1", "project-1"]})


def test_personal_key_metadata_round_trip_preserves_unrelated_metadata():
    metadata = build_personal_key_metadata(
        existing_metadata={"guardrails": ["company-policy"]},
        logical_key_id="logical-1",
        generation=2,
        lifecycle=PersonalKeyLifecycle.ACTIVE,
    )

    parsed = read_personal_key_metadata(metadata)

    assert parsed is not None
    assert parsed.logical_key_id == "logical-1"
    assert parsed.generation == 2
    assert metadata["guardrails"] == ["company-policy"]


def test_unrelated_personal_key_metadata_is_not_a_managed_personal_key():
    assert (
        read_personal_key_metadata(
            {
                "personal_key": {
                    "owner_type": "service",
                    "key_purpose": "service_account",
                }
            }
        )
        is None
    )


def test_json_encoded_metadata_is_recognized_for_distributed_quota():
    metadata = (
        '{"personal_key":{"owner_type":"user","key_purpose":"personal_llm",'
        '"logical_key_id":"logical-1","generation":1,"lifecycle":"active"}}'
    )

    assert read_personal_key_metadata(metadata) is not None
    assert requires_distributed_quota(metadata) is True


def test_personal_key_expiry_and_grace_use_fixed_environment_policy(monkeypatch: pytest.MonkeyPatch):
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    monkeypatch.setenv("PERSONAL_KEY_DURATION", "90d")
    monkeypatch.setenv("PERSONAL_KEY_ROTATION_GRACE_PERIOD", "24h")

    assert (personal_key_expiry(now) - now).days == 90
    assert (personal_key_revoke_at(now) - now).total_seconds() == 86400
