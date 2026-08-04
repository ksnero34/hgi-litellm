import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlparse, urlunparse

import httpx
from pydantic import BaseModel, ConfigDict, TypeAdapter

from litellm.litellm_core_utils.sensitive_data_masker import mask_sensitive_keys

_DISCOVERY_TIMEOUT_SECONDS = 10.0
_DISCOVERY_MAX_BYTES = 64 * 1024
_SSO_ENV_FIELDS = {
    "google_client_id": "GOOGLE_CLIENT_ID",
    "google_client_secret": "GOOGLE_CLIENT_SECRET",
    "microsoft_client_id": "MICROSOFT_CLIENT_ID",
    "microsoft_client_secret": "MICROSOFT_CLIENT_SECRET",
    "microsoft_tenant": "MICROSOFT_TENANT",
    "generic_client_id": "GENERIC_CLIENT_ID",
    "generic_client_secret": "GENERIC_CLIENT_SECRET",
    "generic_discovery_url": "GENERIC_DISCOVERY_URL",
    "generic_authorization_endpoint": "GENERIC_AUTHORIZATION_ENDPOINT",
    "generic_token_endpoint": "GENERIC_TOKEN_ENDPOINT",
    "generic_userinfo_endpoint": "GENERIC_USERINFO_ENDPOINT",
    "proxy_base_url": "PROXY_BASE_URL",
}
_SSO_SECRET_ENV_FIELDS = {
    "google_client_secret": "GOOGLE_CLIENT_SECRET",
    "microsoft_client_secret": "MICROSOFT_CLIENT_SECRET",
    "generic_client_secret": "GENERIC_CLIENT_SECRET",
}


class OIDCDiscoveryResponse(Protocol):
    @property
    def content(self) -> bytes: ...

    def json(self) -> object: ...

    def raise_for_status(self) -> object: ...


class OIDCDiscoveryClient(Protocol):
    async def get(
        self,
        url: str,
        *,
        follow_redirects: bool,
        timeout: float,
    ) -> OIDCDiscoveryResponse: ...


class OIDCDiscoveryMetadata(BaseModel):
    model_config = ConfigDict(extra="ignore")

    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    userinfo_endpoint: str
    jwks_uri: str


@dataclass(frozen=True, slots=True)
class GenericOIDCEndpoints:
    authorization_endpoint: str
    token_endpoint: str
    userinfo_endpoint: str


def get_sso_environment_fallbacks(
    database_settings: Mapping[str, object],
) -> dict[str, object]:
    return {
        field_name: database_settings.get(field_name) or os.getenv(env_name)
        for field_name, env_name in _SSO_ENV_FIELDS.items()
    }


def preserve_masked_sso_secrets(
    incoming_settings: Mapping[str, object],
    database_settings: Mapping[str, object],
) -> dict[str, object]:
    def resolve_value(field_name: str, incoming_value: object) -> object:
        env_name = _SSO_SECRET_ENV_FIELDS.get(field_name)
        if env_name is None or not isinstance(incoming_value, str):
            return incoming_value
        current_value = database_settings.get(field_name) or os.getenv(env_name)
        if not isinstance(current_value, str):
            return incoming_value
        masked_values: dict[str, object] = mask_sensitive_keys(
            {field_name: current_value},
            {field_name},
        )
        masked_value = masked_values[field_name]
        return current_value if incoming_value == masked_value else incoming_value

    return {field_name: resolve_value(field_name, value) for field_name, value in incoming_settings.items()}


def _validate_http_url(value: str, field_name: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{field_name} must be an absolute HTTP(S) URL")
    if parsed.username is not None or parsed.password is not None or parsed.query or parsed.fragment:
        raise ValueError(f"{field_name} must not contain credentials, a query, or a fragment")
    return value


def _expected_issuer_from_discovery_url(discovery_url: str) -> str | None:
    suffix = "/.well-known/openid-configuration"
    parsed = urlparse(discovery_url)
    if not parsed.path.endswith(suffix):
        return None
    issuer_path = parsed.path[: -len(suffix)]
    return urlunparse((parsed.scheme, parsed.netloc, issuer_path, "", "", ""))


async def fetch_oidc_discovery_metadata(
    discovery_url: str,
    client: OIDCDiscoveryClient | None = None,
) -> OIDCDiscoveryMetadata:
    validated_url = _validate_http_url(discovery_url, "GENERIC_DISCOVERY_URL")
    if client is None:
        async with httpx.AsyncClient(
            follow_redirects=False,
            timeout=_DISCOVERY_TIMEOUT_SECONDS,
        ) as http_client:
            response = await http_client.get(validated_url)
            return _parse_oidc_discovery_response(validated_url, response)
    response = await client.get(validated_url, follow_redirects=False, timeout=_DISCOVERY_TIMEOUT_SECONDS)
    return _parse_oidc_discovery_response(validated_url, response)


def _parse_oidc_discovery_response(
    validated_url: str,
    response: OIDCDiscoveryResponse,
) -> OIDCDiscoveryMetadata:
    response.raise_for_status()
    if len(response.content) > _DISCOVERY_MAX_BYTES:
        raise ValueError("GENERIC_DISCOVERY_URL response exceeds 64 KiB")
    metadata = TypeAdapter(OIDCDiscoveryMetadata).validate_python(response.json())
    expected_issuer = _expected_issuer_from_discovery_url(validated_url)
    if expected_issuer is not None and metadata.issuer != expected_issuer:
        raise ValueError("OIDC discovery issuer does not match GENERIC_DISCOVERY_URL")
    return OIDCDiscoveryMetadata(
        issuer=_validate_http_url(metadata.issuer, "issuer"),
        authorization_endpoint=_validate_http_url(
            metadata.authorization_endpoint,
            "authorization_endpoint",
        ),
        token_endpoint=_validate_http_url(metadata.token_endpoint, "token_endpoint"),
        userinfo_endpoint=_validate_http_url(
            metadata.userinfo_endpoint,
            "userinfo_endpoint",
        ),
        jwks_uri=_validate_http_url(metadata.jwks_uri, "jwks_uri"),
    )


async def resolve_generic_oidc_endpoints(
    *,
    discovery_url: str | None,
    authorization_endpoint: str | None,
    token_endpoint: str | None,
    userinfo_endpoint: str | None,
    client: OIDCDiscoveryClient | None = None,
) -> GenericOIDCEndpoints:
    requires_discovery = bool(
        discovery_url and (not authorization_endpoint or not token_endpoint or not userinfo_endpoint)
    )
    metadata = (
        await fetch_oidc_discovery_metadata(discovery_url=discovery_url, client=client)
        if discovery_url and requires_discovery
        else None
    )
    resolved_authorization_endpoint = authorization_endpoint or (metadata.authorization_endpoint if metadata else None)
    resolved_token_endpoint = token_endpoint or (metadata.token_endpoint if metadata else None)
    resolved_userinfo_endpoint = userinfo_endpoint or (metadata.userinfo_endpoint if metadata else None)
    missing_fields = tuple(
        field_name
        for field_name, value in (
            ("GENERIC_AUTHORIZATION_ENDPOINT", resolved_authorization_endpoint),
            ("GENERIC_TOKEN_ENDPOINT", resolved_token_endpoint),
            ("GENERIC_USERINFO_ENDPOINT", resolved_userinfo_endpoint),
        )
        if not value
    )
    if missing_fields:
        raise ValueError(
            "Set GENERIC_DISCOVERY_URL or provide the missing endpoint variables: " + ", ".join(missing_fields)
        )
    if not isinstance(resolved_authorization_endpoint, str):
        raise TypeError("GENERIC_AUTHORIZATION_ENDPOINT must be a string")
    if not isinstance(resolved_token_endpoint, str):
        raise TypeError("GENERIC_TOKEN_ENDPOINT must be a string")
    if not isinstance(resolved_userinfo_endpoint, str):
        raise TypeError("GENERIC_USERINFO_ENDPOINT must be a string")
    return GenericOIDCEndpoints(
        authorization_endpoint=_validate_http_url(
            resolved_authorization_endpoint,
            "GENERIC_AUTHORIZATION_ENDPOINT",
        ),
        token_endpoint=_validate_http_url(
            resolved_token_endpoint,
            "GENERIC_TOKEN_ENDPOINT",
        ),
        userinfo_endpoint=_validate_http_url(
            resolved_userinfo_endpoint,
            "GENERIC_USERINFO_ENDPOINT",
        ),
    )
