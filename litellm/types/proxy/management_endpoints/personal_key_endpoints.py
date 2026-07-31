from datetime import datetime
from typing import Literal, Optional

from pydantic import ConfigDict, Field

from litellm.types.llms.base import LiteLLMPydanticObjectBase


class PersonalKeyCreateRequest(LiteLLMPydanticObjectBase):
    key_alias: Optional[str] = Field(default=None, max_length=255)
    user_id: Optional[str] = None

    model_config = ConfigDict(extra="forbid")


class PersonalKeyView(LiteLLMPydanticObjectBase):
    logical_key_id: str
    key_alias: Optional[str] = None
    user_id: str
    team_id: str
    organization_id: str
    generation: int
    status: Literal["active", "blocked", "expired"]
    expires: datetime
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


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
