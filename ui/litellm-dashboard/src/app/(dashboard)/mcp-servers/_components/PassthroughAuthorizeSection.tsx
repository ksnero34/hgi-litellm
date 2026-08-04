import React from "react";
import { useTranslation } from "react-i18next";
import { Button, Checkbox, Form, Input } from "antd";
import DcrBridgeToggle from "./DcrBridgeToggle";
import { credentialAuthClass, isClientForwardedTokenMode } from "@/components/mcp_tools/types";

interface PassthroughOAuthFlow {
  startOAuthFlow: () => void | Promise<void>;
  status: string;
  error: string | null;
  tokenResponse: { access_token?: string; expires_in?: number } | null;
}

/**
 * Browser-only Authorize & Fetch for the client-forwarded token modes
 * (true_passthrough / oauth_delegate). Tokens are never stored: the token
 * obtained here lives in this browser session only, forwarded per-server for
 * the tools preview and allowlist configuration, and is never written to the
 * server row or the per-user credential store. The optional OAuth client
 * credentials cover IdPs without dynamic client registration (e.g. a
 * pre-registered Slack app); unlike the token they ARE saved onto the server
 * as declared config, so internal users' Authorize relays through the org's
 * app instead of dead-ending on upstreams that cannot mint clients.
 *
 * Blank fields follow the same convention as the M2M credential fields. On
 * create they mean "no app configured" (dynamic client registration). On edit
 * they mean "keep existing" ONLY when the credential class is unchanged: the
 * backend merges a partial update within the client-forwarded class, so a
 * true_passthrough <-> oauth_delegate switch keeps the stored app, but a switch
 * from a different class (e.g. oauth2) replaces it, so blanks then mean "no
 * app". Removing a stored app is an explicit checkbox (edit only) that writes
 * an explicit-null credential.
 */
export default function PassthroughAuthorizeSection({
  authType,
  oauthFlow,
  dcrBridgeInitialChecked,
  isEditing = false,
  savedAuthType,
  removeStoredApp = false,
  onRemoveStoredAppChange,
  appMayNotMatchUpstream = false,
}: {
  authType?: string | null;
  oauthFlow: PassthroughOAuthFlow;
  dcrBridgeInitialChecked?: boolean;
  isEditing?: boolean;
  savedAuthType?: string | null;
  removeStoredApp?: boolean;
  onRemoveStoredAppChange?: (remove: boolean) => void;
  appMayNotMatchUpstream?: boolean;
}) {
  const { t } = useTranslation();
  if (!isClientForwardedTokenMode(authType)) return null;
  const authorizeButtonLabels: Record<string, string> = {
    authorizing: t("toolsModels.mcp.oauthWaiting"),
    exchanging: t("toolsModels.mcp.oauthExchanging"),
  };
  const authorizeButtonLabel = authorizeButtonLabels[oauthFlow.status] ?? t("toolsModels.mcp.browserOnlyAuthorize");
  // On edit, "keep existing" only holds when the stored credential class is unchanged; a cross-class
  // switch (e.g. oauth2 -> true_passthrough) replaces credentials, so blanks then mean "no app".
  const classUnchanged = isEditing && credentialAuthClass(savedAuthType) === credentialAuthClass(authType);
  const clientIdPlaceholder = classUnchanged
    ? t("toolsModels.mcp.keepSavedAppPlaceholder")
    : t("toolsModels.mcp.dynamicRegistrationPlaceholder");
  const clientSecretPlaceholder = classUnchanged
    ? t("toolsModels.mcp.keepSavedSecretPlaceholder")
    : t("toolsModels.mcp.publicClientPlaceholder");
  const clientIdExtra = classUnchanged
    ? t("toolsModels.mcp.savedAppDescription")
    : t("toolsModels.mcp.switchedAuthAppDescription");
  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-4 space-y-2 mb-4">
      <p className="text-sm text-gray-600">{t("toolsModels.mcp.passthroughAuthorizeDescription")}</p>
      {appMayNotMatchUpstream && (
        <p className="text-sm text-amber-600">{t("toolsModels.mcp.upstreamChangedWarning")}</p>
      )}
      <Form.Item
        label={<span className="text-sm font-medium text-gray-700">{t("toolsModels.mcp.oauthClientIdOptional")}</span>}
        name={["credentials", "client_id"]}
        extra={clientIdExtra}
      >
        <Input.Password
          placeholder={clientIdPlaceholder}
          disabled={removeStoredApp}
          className="rounded-lg border-gray-300 focus:border-blue-500 focus:ring-blue-500"
        />
      </Form.Item>
      <Form.Item
        label={
          <span className="text-sm font-medium text-gray-700">{t("toolsModels.mcp.oauthClientSecretOptional")}</span>
        }
        name={["credentials", "client_secret"]}
      >
        <Input.Password
          placeholder={clientSecretPlaceholder}
          disabled={removeStoredApp}
          className="rounded-lg border-gray-300 focus:border-blue-500 focus:ring-blue-500"
        />
      </Form.Item>
      <DcrBridgeToggle authType={authType} initialChecked={dcrBridgeInitialChecked} />
      {isEditing && onRemoveStoredAppChange && (
        <Checkbox checked={removeStoredApp} onChange={(e) => onRemoveStoredAppChange(e.target.checked)}>
          <span className="text-sm text-gray-700">{t("toolsModels.mcp.removeSavedApp")}</span>
        </Checkbox>
      )}
      <Button
        onClick={oauthFlow.startOAuthFlow}
        disabled={oauthFlow.status === "authorizing" || oauthFlow.status === "exchanging"}
      >
        {authorizeButtonLabel}
      </Button>
      {oauthFlow.error && <p className="text-sm text-red-500">{oauthFlow.error}</p>}
      {oauthFlow.status === "success" && oauthFlow.tokenResponse?.access_token && (
        <p className="text-sm text-green-600">{t("toolsModels.mcp.browserOnlyTokenHeld")}</p>
      )}
    </div>
  );
}
