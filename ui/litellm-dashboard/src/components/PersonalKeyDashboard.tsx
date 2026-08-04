"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import MessageManager from "@/components/molecules/message_manager";
import { getGlobalLitellmHeaderName, getProxyBaseUrl } from "@/components/networking";
import { ApiError, createApiClient } from "@/lib/http/client";
import type { HttpMethod } from "@/lib/http/client";
import { copyToClipboard } from "@/utils/dataUtils";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type PersonalKey = {
  logical_key_id: string;
  key_alias: string | null;
  user_id: string;
  team_id: string;
  organization_id: string;
  generation: number;
  status: "active" | "blocked" | "expired";
  expires: string;
};

type PersonalKeySecret = PersonalKey & {
  key: string;
  previous_key_revoke_at?: string;
};

type PersonalKeyDashboardProps = {
  accessToken: string;
  readOnly?: boolean;
};

const personalKeyClient = createApiClient({
  getBaseUrl: getProxyBaseUrl,
  getAuthHeaderName: getGlobalLitellmHeaderName,
});

async function personalKeyRequest<T>(accessToken: string, path: string, method: HttpMethod, body?: object): Promise<T> {
  return personalKeyClient.request<T>(method, path, { accessToken, body });
}

function personalKeyErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

export default function PersonalKeyDashboard({ accessToken, readOnly = false }: PersonalKeyDashboardProps) {
  const { t, i18n } = useTranslation();
  const [keyInfo, setKeyInfo] = useState<PersonalKey | null>(null);
  const [keyAlias, setKeyAlias] = useState("");
  const [newSecret, setNewSecret] = useState<PersonalKeySecret | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await personalKeyRequest<PersonalKey>(accessToken, "/internal/personal-key", "GET");
        if (active) {
          setKeyInfo(result);
        }
      } catch (error) {
        if (active && error instanceof ApiError && error.status === 404) {
          setKeyInfo(null);
        } else if (active) {
          MessageManager.error(personalKeyErrorMessage(error, i18n.t("access.personalKeys.messages.requestFailed")));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [accessToken, i18n]);

  const create = async () => {
    setLoading(true);
    try {
      const created = await personalKeyRequest<PersonalKeySecret>(accessToken, "/internal/personal-key", "POST", {
        key_alias: keyAlias.trim() || null,
      });
      setKeyInfo(created);
      setNewSecret(created);
      MessageManager.success(t("access.personalKeys.messages.created"));
    } catch (error) {
      MessageManager.error(personalKeyErrorMessage(error, t("access.personalKeys.messages.requestFailed")));
    } finally {
      setLoading(false);
    }
  };

  const rotate = async () => {
    setLoading(true);
    try {
      const rotated = await personalKeyRequest<PersonalKeySecret>(accessToken, "/internal/personal-key/rotate", "POST");
      setKeyInfo(rotated);
      setNewSecret(rotated);
      MessageManager.success(t("access.personalKeys.messages.rotated"));
    } catch (error) {
      MessageManager.error(personalKeyErrorMessage(error, t("access.personalKeys.messages.requestFailed")));
    } finally {
      setLoading(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(t("access.personalKeys.delete.confirm"))) {
      return;
    }
    setLoading(true);
    try {
      await personalKeyRequest(accessToken, "/internal/personal-key", "DELETE");
      setKeyInfo(null);
      setNewSecret(null);
      MessageManager.success(t("access.personalKeys.messages.deleted"));
    } catch (error) {
      MessageManager.error(personalKeyErrorMessage(error, t("access.personalKeys.messages.requestFailed")));
    } finally {
      setLoading(false);
    }
  };

  const copySecret = async () => {
    if (newSecret === null) {
      return;
    }
    await copyToClipboard(newSecret.key, t("access.personalKeys.messages.copied"));
  };

  return (
    <div className="mx-auto w-full max-w-3xl p-8">
      <Card>
        <CardHeader>
          <CardTitle>{t("access.personalKeys.title")}</CardTitle>
          <CardDescription>{t("access.personalKeys.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {newSecret !== null && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <p className="mb-2 font-medium">{t("access.personalKeys.secret.copyNow")}</p>
              <div className="flex gap-2">
                <Input readOnly value={newSecret.key} className="font-mono" />
                <Button onClick={copySecret}>{t("access.personalKeys.actions.copy")}</Button>
              </div>
              {newSecret.previous_key_revoke_at && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("access.personalKeys.secret.previousKeyUntil", {
                    timestamp: new Date(newSecret.previous_key_revoke_at).toLocaleString(),
                  })}
                </p>
              )}
            </div>
          )}
          {keyInfo === null && !readOnly && (
            <div className="space-y-3">
              <Input
                value={keyAlias}
                onChange={(event) => setKeyAlias(event.target.value)}
                placeholder={t("access.personalKeys.form.aliasPlaceholder")}
                maxLength={255}
              />
              <p className="text-sm text-muted-foreground">{t("access.personalKeys.form.singleKeyHint")}</p>
            </div>
          )}
          {keyInfo !== null && (
            <dl className="grid grid-cols-[10rem_1fr] gap-3 text-sm">
              <dt className="text-muted-foreground">{t("access.personalKeys.details.alias")}</dt>
              <dd>{keyInfo.key_alias || t("access.personalKeys.details.defaultAlias")}</dd>
              <dt className="text-muted-foreground">{t("access.personalKeys.details.departmentTeam")}</dt>
              <dd>{keyInfo.team_id}</dd>
              <dt className="text-muted-foreground">{t("access.personalKeys.details.status")}</dt>
              <dd>{t(`access.personalKeys.status.${keyInfo.status}`)}</dd>
              <dt className="text-muted-foreground">{t("access.personalKeys.details.generation")}</dt>
              <dd>{keyInfo.generation}</dd>
              <dt className="text-muted-foreground">{t("access.personalKeys.details.expires")}</dt>
              <dd>{new Date(keyInfo.expires).toLocaleString()}</dd>
            </dl>
          )}
          {keyInfo === null && readOnly && (
            <p className="text-sm text-muted-foreground">{t("access.personalKeys.empty")}</p>
          )}
        </CardContent>
        {!readOnly && (
          <CardFooter className="gap-2">
            {keyInfo === null ? (
              <Button disabled={loading} onClick={create}>
                {t("access.personalKeys.actions.create")}
              </Button>
            ) : (
              <>
                <Button disabled={loading} onClick={rotate}>
                  {t("access.personalKeys.actions.rotate")}
                </Button>
                <Button disabled={loading} variant="destructive" onClick={remove}>
                  {t("access.personalKeys.actions.delete")}
                </Button>
              </>
            )}
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
