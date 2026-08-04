from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from litellm.proxy.auth.oauth2_check import Oauth2Handler


@pytest.mark.asyncio
async def test_check_oauth2_token_does_not_log_token_or_introspection_response(monkeypatch):
    token = "secret-bearer-token"
    response_secret = "secret-introspection-value"
    response = MagicMock()
    response.raise_for_status.return_value = None
    response.json.return_value = {
        "active": True,
        "sub": "user-1",
        "sensitive_claim": response_secret,
    }
    client = MagicMock()
    client.post = AsyncMock(return_value=response)
    monkeypatch.setenv("OAUTH_TOKEN_INFO_ENDPOINT", "https://example.com/introspect")
    monkeypatch.setenv("OAUTH_CLIENT_ID", "client-id")
    monkeypatch.setenv("OAUTH_CLIENT_SECRET", "client-secret")

    with (
        patch("litellm.proxy.auth.oauth2_check.get_async_httpx_client", return_value=client),
        patch("litellm.proxy.auth.oauth2_check.verbose_proxy_logger") as logger,
    ):
        await Oauth2Handler.check_oauth2_token(token)

    log_output = repr(logger.method_calls)
    assert token not in log_output
    assert response_secret not in log_output
