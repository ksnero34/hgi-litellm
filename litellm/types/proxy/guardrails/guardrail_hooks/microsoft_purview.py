from pydantic import Field

from .base import GuardrailConfigModel


class MicrosoftPurviewGuardrailConfigModel(GuardrailConfigModel):
    tenant_id: str = Field(
        description="Microsoft Entra tenant ID used to request a Microsoft Graph access token.",
    )
    client_id: str = Field(
        description="Application client ID with permission to call the Microsoft Purview processContent API.",
    )
    client_secret: str = Field(
        description="Application client secret used to authenticate to Microsoft Entra.",
    )
    purview_app_name: str = Field(
        default="LLM Gateway",
        description="Application name recorded in Microsoft Purview audit events.",
    )
    user_id_field: str = Field(
        default="user_id",
        description="Authenticated proxy user field used as the Microsoft Purview user identity.",
    )

    @staticmethod
    def ui_friendly_name() -> str:
        return "Microsoft Purview"
