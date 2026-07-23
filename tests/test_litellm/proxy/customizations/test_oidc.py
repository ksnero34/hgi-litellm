from dataclasses import dataclass

import pytest

from litellm.proxy.customizations.oidc import (
    fetch_oidc_discovery_metadata,
    get_sso_environment_fallbacks,
    preserve_masked_sso_secrets,
    resolve_generic_oidc_endpoints,
)


@dataclass(frozen=True, slots=True)
class FakeDiscoveryResponse:
    payload: object
    content: bytes = b"{}"

    def json(self) -> object:
        return self.payload

    def raise_for_status(self) -> None:
        return None


@dataclass(frozen=True, slots=True)
class FakeDiscoveryClient:
    response: FakeDiscoveryResponse

    async def get(
        self,
        url: str,
        *,
        follow_redirects: bool,
        timeout: float,
    ) -> FakeDiscoveryResponse:
        assert url == "https://idp.example.com/.well-known/openid-configuration"
        assert follow_redirects is False
        assert timeout == 10.0
        return self.response


class FailingDiscoveryClient:
    async def get(
        self,
        url: str,
        *,
        follow_redirects: bool,
        timeout: float,
    ) -> FakeDiscoveryResponse:
        raise AssertionError("discovery must not be fetched")


def discovery_payload() -> dict[str, str]:
    return {
        "issuer": "https://idp.example.com",
        "authorization_endpoint": "https://idp.example.com/authorize",
        "token_endpoint": "https://idp.example.com/token",
        "userinfo_endpoint": "https://idp.example.com/userinfo",
        "jwks_uri": "https://idp.example.com/jwks",
    }


@pytest.mark.asyncio
async def test_fetch_oidc_discovery_metadata_validates_and_parses_document():
    metadata = await fetch_oidc_discovery_metadata(
        "https://idp.example.com/.well-known/openid-configuration",
        client=FakeDiscoveryClient(FakeDiscoveryResponse(discovery_payload())),
    )

    assert metadata.issuer == "https://idp.example.com"
    assert metadata.authorization_endpoint == "https://idp.example.com/authorize"
    assert metadata.token_endpoint == "https://idp.example.com/token"
    assert metadata.userinfo_endpoint == "https://idp.example.com/userinfo"


@pytest.mark.asyncio
async def test_fetch_oidc_discovery_metadata_rejects_issuer_mismatch():
    payload = {
        **discovery_payload(),
        "issuer": "https://attacker.example.com",
    }

    with pytest.raises(ValueError, match="issuer does not match"):
        await fetch_oidc_discovery_metadata(
            "https://idp.example.com/.well-known/openid-configuration",
            client=FakeDiscoveryClient(FakeDiscoveryResponse(payload)),
        )


@pytest.mark.asyncio
async def test_resolve_generic_oidc_endpoints_uses_discovery_with_explicit_override():
    endpoints = await resolve_generic_oidc_endpoints(
        discovery_url="https://idp.example.com/.well-known/openid-configuration",
        authorization_endpoint="https://override.example.com/authorize",
        token_endpoint=None,
        userinfo_endpoint=None,
        client=FakeDiscoveryClient(FakeDiscoveryResponse(discovery_payload())),
    )

    assert endpoints.authorization_endpoint == "https://override.example.com/authorize"
    assert endpoints.token_endpoint == "https://idp.example.com/token"
    assert endpoints.userinfo_endpoint == "https://idp.example.com/userinfo"


@pytest.mark.asyncio
async def test_resolve_generic_oidc_endpoints_requires_discovery_or_explicit_endpoints():
    with pytest.raises(ValueError, match="GENERIC_TOKEN_ENDPOINT"):
        await resolve_generic_oidc_endpoints(
            discovery_url=None,
            authorization_endpoint="https://idp.example.com/authorize",
            token_endpoint=None,
            userinfo_endpoint="https://idp.example.com/userinfo",
        )


@pytest.mark.asyncio
async def test_resolve_generic_oidc_endpoints_skips_discovery_when_all_overrides_exist():
    endpoints = await resolve_generic_oidc_endpoints(
        discovery_url="https://unavailable.example.com/.well-known/openid-configuration",
        authorization_endpoint="https://idp.example.com/authorize",
        token_endpoint="https://idp.example.com/token",
        userinfo_endpoint="https://idp.example.com/userinfo",
        client=FailingDiscoveryClient(),
    )

    assert endpoints.authorization_endpoint == "https://idp.example.com/authorize"
    assert endpoints.token_endpoint == "https://idp.example.com/token"
    assert endpoints.userinfo_endpoint == "https://idp.example.com/userinfo"


def test_get_sso_environment_fallbacks_prefers_database_values(monkeypatch):
    monkeypatch.setenv("GENERIC_CLIENT_ID", "env-client")
    monkeypatch.setenv("GENERIC_CLIENT_SECRET", "env-secret")
    monkeypatch.setenv(
        "GENERIC_DISCOVERY_URL",
        "https://idp.example.com/.well-known/openid-configuration",
    )

    values = get_sso_environment_fallbacks(
        {
            "generic_client_id": "db-client",
            "generic_client_secret": None,
        }
    )

    assert values["generic_client_id"] == "db-client"
    assert values["generic_client_secret"] == "env-secret"
    assert values["generic_discovery_url"] == ("https://idp.example.com/.well-known/openid-configuration")


def test_preserve_masked_sso_secrets_uses_current_environment_secret(monkeypatch):
    monkeypatch.setenv("GENERIC_CLIENT_SECRET", "environment-secret")

    values = preserve_masked_sso_secrets(
        incoming_settings={
            "generic_client_secret": "envi**********cret",
            "generic_client_id": "client-id",
        },
        database_settings={},
    )

    assert values["generic_client_secret"] == "environment-secret"
    assert values["generic_client_id"] == "client-id"
