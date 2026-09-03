"use client";

import * as React from "react";
import { AlertCircle, Copy, KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Alert, AlertDescription, AlertTitle } from "@/components/shared/Alert";
import { getGlobalLitellmHeaderName, getProxyBaseUrl } from "@/components/networking";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/lib/toast";
import { ApiError, createApiClient } from "@/lib/http/client";
import type { components } from "@/lib/http/schema";
import { copyToClipboard } from "@/utils/dataUtils";

type PersonalKeyView = components["schemas"]["PersonalKeyView"];
type PersonalKeyCreateRequest = components["schemas"]["PersonalKeyCreateRequest"];
type PersonalKeyCreateResponse = components["schemas"]["PersonalKeyCreateResponse"];
type PersonalKeyRotateResponse = components["schemas"]["PersonalKeyRotateResponse"];

type RevealedPersonalKey = {
  readonly key: string;
  readonly previousKeyRevokeAt: string | null;
};

type PersonalKeyDashboardProps = {
  readonly accessToken: string;
  readonly readOnly?: boolean;
};

const personalKeyClient = createApiClient({
  getBaseUrl: getProxyBaseUrl,
  getAuthHeaderName: getGlobalLitellmHeaderName,
});

const FALLBACK_ERROR = "Personal key request failed";

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  return fallback;
};

const toPersonalKeyView = (response: PersonalKeyCreateResponse | PersonalKeyRotateResponse): PersonalKeyView => ({
  created_at: response.created_at,
  expires: response.expires,
  generation: response.generation,
  key_alias: response.key_alias,
  logical_key_id: response.logical_key_id,
  organization_id: response.organization_id,
  status: response.status,
  team_id: response.team_id,
  updated_at: response.updated_at,
  user_id: response.user_id,
});

const formatTimestamp = (value: string): string => new Date(value).toLocaleString();

const DetailRow = ({ label, value }: { readonly label: string; readonly value: React.ReactNode }) => (
  <>
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="text-foreground break-all">{value}</dd>
  </>
);

const LoadingState = () => (
  <div className="space-y-4">
    <Skeleton className="h-4 w-40" />
    <Skeleton className="h-10 w-full" />
    <Skeleton className="h-24 w-full" />
  </div>
);

export default function PersonalKeyDashboard({ accessToken, readOnly = false }: PersonalKeyDashboardProps) {
  const { t, i18n } = useTranslation();

  const [keyInfo, setKeyInfo] = React.useState<PersonalKeyView | null | undefined>(undefined);
  const [keyAlias, setKeyAlias] = React.useState("");
  const [revealedKey, setRevealedKey] = React.useState<RevealedPersonalKey | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [isMutating, setIsMutating] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);

  React.useEffect(() => {
    let active = true;

    const loadPersonalKey = async () => {
      setKeyInfo(undefined);
      setRevealedKey(null);
      setLoadError(null);

      try {
        const result = await personalKeyClient.get<PersonalKeyView>("/internal/personal-key", { accessToken });

        if (!active) {
          return;
        }

        setKeyInfo(result);
      } catch (error) {
        if (!active) {
          return;
        }

        if (error instanceof ApiError && error.status === 404) {
          setKeyInfo(null);
          return;
        }

        const message = toErrorMessage(error, i18n.t("access.personalKeys.messages.requestFailed"));
        setLoadError(message);
        toast.fromError(error ?? message);
      }
    };

    void loadPersonalKey();

    return () => {
      active = false;
    };
  }, [accessToken, i18n]);

  const handleCreate = async () => {
    setIsMutating(true);

    try {
      const body: PersonalKeyCreateRequest = {
        key_alias: keyAlias.trim() === "" ? null : keyAlias.trim(),
      };
      const created = await personalKeyClient.post<PersonalKeyCreateResponse>("/internal/personal-key", {
        accessToken,
        body,
      });

      setKeyInfo(toPersonalKeyView(created));
      setRevealedKey({
        key: created.key,
        previousKeyRevokeAt: null,
      });
      setKeyAlias("");
      toast.success(t("access.personalKeys.messages.created"));
    } catch (error) {
      toast.fromError(error ?? FALLBACK_ERROR);
    } finally {
      setIsMutating(false);
    }
  };

  const handleRotate = async () => {
    setIsMutating(true);

    try {
      const rotated = await personalKeyClient.post<PersonalKeyRotateResponse>("/internal/personal-key/rotate", {
        accessToken,
      });

      setKeyInfo(toPersonalKeyView(rotated));
      setRevealedKey({
        key: rotated.key,
        previousKeyRevokeAt: rotated.previous_key_revoke_at ?? null,
      });
      toast.success(t("access.personalKeys.messages.rotated"));
    } catch (error) {
      toast.fromError(error ?? FALLBACK_ERROR);
    } finally {
      setIsMutating(false);
    }
  };

  const handleDelete = async () => {
    setIsMutating(true);

    try {
      await personalKeyClient.delete("/internal/personal-key", { accessToken });
      setKeyInfo(null);
      setRevealedKey(null);
      setDeleteDialogOpen(false);
      toast.success(t("access.personalKeys.messages.deleted"));
    } catch (error) {
      toast.fromError(error ?? FALLBACK_ERROR);
    } finally {
      setIsMutating(false);
    }
  };

  const handleCopy = async () => {
    if (revealedKey === null) {
      return;
    }

    await copyToClipboard(revealedKey.key, t("access.personalKeys.messages.copied"));
  };

  const content = (() => {
    if (loadError !== null) {
      return (
        <Alert variant="error">
          <AlertCircle />
          <AlertTitle>{t("access.personalKeys.messages.requestFailed")}</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      );
    }

    if (keyInfo === undefined) {
      return <LoadingState />;
    }

    if (keyInfo === null && readOnly) {
      return <p className="text-sm text-muted-foreground">{t("access.personalKeys.empty")}</p>;
    }

    if (keyInfo === null) {
      return (
        <div className="space-y-3">
          <Input
            value={keyAlias}
            onChange={(event) => setKeyAlias(event.target.value)}
            placeholder={t("access.personalKeys.form.aliasPlaceholder")}
            maxLength={255}
          />
          <p className="text-sm text-muted-foreground">{t("access.personalKeys.form.singleKeyHint")}</p>
        </div>
      );
    }

    const existingKeyInfo = keyInfo;
    return (
      <dl className="grid grid-cols-[10rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
        <DetailRow
          label={t("access.personalKeys.details.alias")}
          value={existingKeyInfo.key_alias || t("access.personalKeys.details.defaultAlias")}
        />
        <DetailRow label={t("access.personalKeys.details.departmentTeam")} value={existingKeyInfo.team_id} />
        <DetailRow
          label={t("access.personalKeys.details.status")}
          value={t(`access.personalKeys.status.${existingKeyInfo.status}`)}
        />
        <DetailRow label={t("access.personalKeys.details.generation")} value={existingKeyInfo.generation} />
        <DetailRow label={t("access.personalKeys.details.expires")} value={formatTimestamp(existingKeyInfo.expires)} />
      </dl>
    );
  })();

  const footerActions = (() => {
    if (keyInfo === null) {
      return (
        <Button type="button" disabled={isMutating} onClick={() => void handleCreate()}>
          {t("access.personalKeys.actions.create")}
        </Button>
      );
    }

    if (keyInfo === undefined) {
      return null;
    }

    return (
      <>
        <Button type="button" disabled={isMutating} onClick={() => void handleRotate()}>
          <RefreshCw />
          {t("access.personalKeys.actions.rotate")}
        </Button>
        <Button type="button" variant="destructive" disabled={isMutating} onClick={() => setDeleteDialogOpen(true)}>
          <Trash2 />
          {t("access.personalKeys.actions.delete")}
        </Button>
      </>
    );
  })();

  return (
    <>
      <div className="mx-auto w-full max-w-3xl p-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4" />
              {t("access.personalKeys.title")}
            </CardTitle>
            <CardDescription>{t("access.personalKeys.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {revealedKey !== null && (
              <Alert variant="warning">
                <KeyRound />
                <AlertTitle>{t("access.personalKeys.secret.copyNow")}</AlertTitle>
                <AlertDescription>
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                    <Input readOnly value={revealedKey.key} className="font-mono" />
                    <Button type="button" variant="outline" onClick={() => void handleCopy()}>
                      <Copy />
                      {t("access.personalKeys.actions.copy")}
                    </Button>
                  </div>
                  {revealedKey.previousKeyRevokeAt !== null && (
                    <p className="mt-3 text-sm">
                      {t("access.personalKeys.secret.previousKeyUntil", {
                        timestamp: formatTimestamp(revealedKey.previousKeyRevokeAt),
                      })}
                    </p>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {content}
          </CardContent>
          {!readOnly && loadError === null && <CardFooter className="gap-2">{footerActions}</CardFooter>}
        </Card>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("access.personalKeys.actions.delete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("access.personalKeys.delete.confirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>{t("access.common.cancel")}</AlertDialogCancel>
            <Button type="button" variant="destructive" disabled={isMutating} onClick={() => void handleDelete()}>
              {t("access.personalKeys.actions.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
