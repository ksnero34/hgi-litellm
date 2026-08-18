import json
import os
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from litellm.litellm_core_utils.duration_parser import duration_in_seconds

PERSONAL_KEY_METADATA_KEY = "personal_key"
HUMAN_ORGANIZATION_ID_ENV = "HUMAN_ORGANIZATION_ID"
PERSONAL_KEY_DURATION_ENV = "PERSONAL_KEY_DURATION"
PERSONAL_KEY_GRACE_PERIOD_ENV = "PERSONAL_KEY_ROTATION_GRACE_PERIOD"
SSO_MANAGED_TEAM_IDS_METADATA_KEY = "litellm_sso_managed_team_ids"


class PersonalKeyRegistryStatus(StrEnum):
    ACTIVE = "active"
    BLOCKED = "blocked"


class PersonalKeyLifecycle(StrEnum):
    ACTIVE = "active"
    GRACE = "grace"
    REVOKED = "revoked"


class PersonalKeyPurpose(StrEnum):
    PERSONAL_LLM = "personal_llm"


class PersonalKeyMetadata(BaseModel):
    owner_type: str = "user"
    key_purpose: PersonalKeyPurpose = PersonalKeyPurpose.PERSONAL_LLM
    logical_key_id: str
    generation: int
    lifecycle: PersonalKeyLifecycle

    model_config = ConfigDict(extra="forbid")


class SSOManagedUserMetadata(BaseModel):
    team_ids: tuple[str, ...] = Field(alias=SSO_MANAGED_TEAM_IDS_METADATA_KEY)

    model_config = ConfigDict(extra="ignore")


_METADATA_ADAPTER = TypeAdapter(dict[str, object])


def _metadata_dict(metadata: object) -> dict[str, object]:
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except json.JSONDecodeError:
            return {}
    try:
        return _METADATA_ADAPTER.validate_python(metadata or {})
    except ValidationError:
        return {}


def human_organization_id() -> str:
    value = os.getenv(HUMAN_ORGANIZATION_ID_ENV, "human-default").strip()
    if not value:
        raise ValueError(f"{HUMAN_ORGANIZATION_ID_ENV} must not be empty")
    return value


def personal_key_duration() -> str:
    value = os.getenv(PERSONAL_KEY_DURATION_ENV, "90d").strip()
    seconds = duration_in_seconds(value)
    if seconds <= 0:
        raise ValueError(f"{PERSONAL_KEY_DURATION_ENV} must be greater than zero")
    return value


def personal_key_expiry(now: datetime | None = None) -> datetime:
    current = now or datetime.now(timezone.utc)
    return current + timedelta(seconds=duration_in_seconds(personal_key_duration()))


def personal_key_grace_period() -> str:
    value = os.getenv(PERSONAL_KEY_GRACE_PERIOD_ENV, "72h").strip()
    seconds = duration_in_seconds(value)
    if seconds <= 0:
        raise ValueError(f"{PERSONAL_KEY_GRACE_PERIOD_ENV} must be greater than zero")
    return value


def personal_key_revoke_at(now: datetime | None = None) -> datetime:
    current = now or datetime.now(timezone.utc)
    return current + timedelta(seconds=duration_in_seconds(personal_key_grace_period()))


def resolve_department_team_id(metadata: object) -> str:
    parsed = SSOManagedUserMetadata.model_validate(metadata)
    unique_team_ids = tuple(dict.fromkeys(parsed.team_ids))
    if len(unique_team_ids) != 1:
        raise ValueError("The user must have exactly one OIDC-managed department team")
    return unique_team_ids[0]


def build_personal_key_metadata(
    existing_metadata: object,
    logical_key_id: str,
    generation: int,
    lifecycle: PersonalKeyLifecycle,
) -> dict[str, object]:
    base = _metadata_dict(existing_metadata)
    personal_key = PersonalKeyMetadata(
        logical_key_id=logical_key_id,
        generation=generation,
        lifecycle=lifecycle,
    )
    return {
        **base,
        PERSONAL_KEY_METADATA_KEY: personal_key.model_dump(mode="json"),
    }


def read_personal_key_metadata(metadata: object) -> PersonalKeyMetadata | None:
    parsed = _metadata_dict(metadata)
    personal_key = parsed.get(PERSONAL_KEY_METADATA_KEY)
    if not isinstance(personal_key, Mapping):
        return None
    try:
        return PersonalKeyMetadata.model_validate(personal_key)
    except ValidationError:
        return None


def requires_distributed_quota(metadata: object) -> bool:
    parsed = _metadata_dict(metadata)
    personal_key = parsed.get(PERSONAL_KEY_METADATA_KEY)
    if not isinstance(personal_key, Mapping):
        return False
    return personal_key.get("key_purpose") in {
        PersonalKeyPurpose.PERSONAL_LLM.value,
        "service_account",
    }
