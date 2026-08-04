from typing import Any

from fastapi import Request
from fastapi.responses import RedirectResponse

from litellm.proxy.auth.trusted_proxy_utils import require_trusted_proxy_request


async def handle_custom_ui_sso_sign_in(
    *,
    request: Request,
    handler: Any,
    general_settings: dict[str, Any],
    return_to: str | None = None,
) -> RedirectResponse:
    require_trusted_proxy_request(
        request=request,
        general_settings=general_settings,
        feature_name="Custom UI SSO",
    )
    result = await handler.handle_custom_ui_sso_sign_in(request=request)
    from litellm.proxy.management_endpoints.ui_sso import SSOAuthenticationHandler

    return await SSOAuthenticationHandler.get_redirect_response_from_openid(
        result=result,
        request=request,
        received_response=None,
        generic_client_id=None,
        ui_access_mode=None,
        return_to=return_to,
    )
