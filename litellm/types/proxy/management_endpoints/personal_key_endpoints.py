from datetime import datetime
from typing import Literal

from pydantic import ConfigDict, Field

from litellm.types.llms.base import LiteLLMPydanticObjectBase


class PersonalKeyCreateRequest(LiteLLMPydanticObjectBase):
    key_alias: str | None = Field(default=None, max_length=255)
    user_id: str | None = None

    model_config = ConfigDict(extra="forbid")


class PersonalKeyView(LiteLLMPydanticObjectBase):
    logical_key_id: str
    key_alias: str | None = None
    user_id: str
    team_id: str
    organization_id: str
    generation: int
    status: Literal["active", "blocked", "expired"]
    expires: datetime
    created_at: datetime | None = None
    updated_at: datetime | None = None


class PersonalKeyCreateResponse(PersonalKeyView):
    key: str


class PersonalKeyRotateResponse(PersonalKeyCreateResponse):
    previous_key_revoke_at: datetime


class PersonalKeyDeleteResponse(LiteLLMPydanticObjectBase):
    deleted: bool
    logical_key_id: str


class PersonalKeyMetrics(LiteLLMPydanticObjectBase):
    active_personal_keys: int
    expiring_within_seven_days: int
    grace_keys: int
