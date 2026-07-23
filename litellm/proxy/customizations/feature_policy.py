OSS_VIRTUAL_KEY_METADATA_FIELDS = frozenset({"disable_global_guardrails", "guardrails", "policies"})


def is_oss_virtual_key_metadata_field(field_name: str) -> bool:
    return field_name in OSS_VIRTUAL_KEY_METADATA_FIELDS
