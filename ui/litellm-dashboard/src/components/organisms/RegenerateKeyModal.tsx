import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { Alert, AlertDescription, AlertTitle } from "@/components/shared/Alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, CircleHelp, Copy, RefreshCw, TriangleAlert } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { useWatch } from "react-hook-form";
import { CopyToClipboard } from "react-copy-to-clipboard";
import { useTranslation } from "react-i18next";
import { z } from "zod/v4";
import { KeyResponse } from "../key_team_helpers/key_list";
import { toast } from "@/lib/toast";
import { FieldGroup } from "@/components/shared/form/field";
import { personalKeyRotateCall, regenerateKeyCall } from "../networking";
import { FormField } from "@/components/shared/form/FormField";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useZodForm } from "@/lib/forms/useZodForm";
import { calculateExpiryPreviewFromDuration, formatExpiresUtc, isKeyExpired } from "@/utils/keyExpiryUtils";
import { buildRegenerateKeyPayload, type RegenerateKeyFormValues } from "./regenerateKeyPayload";

const DURATION_PATTERN = /^(\d+(s|m|h|d|w|mo))?$/;
const DURATION_MESSAGE_KEY = "gateway.regenerate.durationPattern";
const EXPIRED_DURATION_MESSAGE_KEY = "gateway.regenerate.expiredDurationRequired";

const EMPTY_VALUES: RegenerateKeyFormValues = {
  key_alias: undefined,
  max_budget: undefined,
  tpm_limit: undefined,
  rpm_limit: undefined,
  duration: "",
  grace_period: "",
};

const buildSchema = (
  keyIsExpired: boolean,
  messages: { durationPattern: string; expiredDurationRequired: string },
): z.ZodType<RegenerateKeyFormValues, RegenerateKeyFormValues> => {
  const shape = {
    key_alias: z.string().nullish(),
    max_budget: z.number().nullish(),
    tpm_limit: z.number().nullish(),
    rpm_limit: z.number().nullish(),
    duration: keyIsExpired
      ? z.string().min(1, messages.expiredDurationRequired).regex(DURATION_PATTERN, messages.durationPattern)
      : z.string().regex(DURATION_PATTERN, messages.durationPattern),
    grace_period: z.string().regex(DURATION_PATTERN, messages.durationPattern),
  };

  return z.object(shape);
};

const labelWithHint = (label: string, hint: string): React.ReactNode => (
  <>
    {label}
    <Tooltip>
      <TooltipTrigger render={<CircleHelp className="size-3.5 shrink-0 cursor-help text-muted-foreground" />} />
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  </>
);

interface RegenerateKeyModalProps {
  selectedToken: KeyResponse | null;
  visible: boolean;
  onClose: () => void;
  onKeyUpdate?: (updatedKeyData: Partial<KeyResponse>) => void;
  onManagedRotationAcknowledged?: () => void;
}

const isManagedPersonalKey = (selectedToken: KeyResponse | null): boolean => {
  const personalKeyMetadata = selectedToken?.metadata?.personal_key;
  return (
    personalKeyMetadata != null &&
    typeof personalKeyMetadata === "object" &&
    "key_purpose" in personalKeyMetadata &&
    personalKeyMetadata.key_purpose === "personal_llm"
  );
};

export function RegenerateKeyModal({
  selectedToken,
  visible,
  onClose,
  onKeyUpdate,
  onManagedRotationAcknowledged,
}: RegenerateKeyModalProps) {
  const { t } = useTranslation();
  const { accessToken } = useAuthorized();
  const [regeneratedKey, setRegeneratedKey] = useState<string | null>(null);
  const [previousKeyRevokeAt, setPreviousKeyRevokeAt] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [managedRotationCompleted, setManagedRotationCompleted] = useState(false);

  const managedPersonalKey = isManagedPersonalKey(selectedToken);
  const keyIsExpired = isKeyExpired(selectedToken?.expires);
  const validationMessages = useMemo(
    () => ({
      durationPattern: t(DURATION_MESSAGE_KEY),
      expiredDurationRequired: t(EXPIRED_DURATION_MESSAGE_KEY),
    }),
    [t],
  );
  const schema = useMemo(() => buildSchema(keyIsExpired, validationMessages), [keyIsExpired, validationMessages]);
  const form = useZodForm(schema, { defaultValues: EMPTY_VALUES });
  const durationValue = useWatch({ control: form.control, name: "duration" });

  useEffect(() => {
    if (visible && selectedToken && accessToken) {
      const seededValues: RegenerateKeyFormValues = {
        key_alias: selectedToken.key_alias,
        max_budget: selectedToken.max_budget,
        tpm_limit: selectedToken.tpm_limit,
        rpm_limit: selectedToken.rpm_limit,
        duration: selectedToken.duration || "",
        grace_period: "",
      };
      form.reset(seededValues);
    }
  }, [visible, selectedToken, form, accessToken]);

  const newExpiryTime = durationValue ? calculateExpiryPreviewFromDuration(durationValue) : null;

  const submitRegenerateKey = async (values: RegenerateKeyFormValues) => {
    if (!selectedToken || !accessToken) return;
    if (managedPersonalKey && !selectedToken.user_id) {
      toast.fromError(new Error("The managed personal key owner is unavailable."));
      setIsRegenerating(false);
      return;
    }

    const formValues = buildRegenerateKeyPayload(values);
    try {
      setManagedRotationCompleted(false);
      const response = managedPersonalKey
        ? await personalKeyRotateCall(accessToken, selectedToken.user_id as string)
        : await regenerateKeyCall(accessToken, selectedToken.token || selectedToken.token_id, formValues);
      setRegeneratedKey(response.key);
      setPreviousKeyRevokeAt(response.previous_key_revoke_at || null);
      setManagedRotationCompleted(managedPersonalKey);
      toast.success(t("gateway.regenerate.success"));

      // Build the update payload. Spread the API response first so any new
      // fields it returns (new token, timestamps, etc.) are captured, then
      // override with the explicit form values — the user's just-submitted
      // edits must win over whatever the API echoes back.
      // expires must come from the API (an ISO string), never the locale-
      // formatted preview, otherwise downstream expiry parsing breaks.
      const updatedKeyData: Partial<KeyResponse> = {
        ...response,
        token: response.token || response.key_id || selectedToken.token,
        key_name: response.key,
        max_budget: formValues.max_budget,
        tpm_limit: formValues.tpm_limit,
        rpm_limit: formValues.rpm_limit,
        expires: response.expires ?? selectedToken.expires,
      };

      // Update the parent component with new key data
      if (!managedPersonalKey && onKeyUpdate) {
        onKeyUpdate(updatedKeyData);
      }

      setIsRegenerating(false);
    } catch (error) {
      setIsRegenerating(false); // Reset regenerating state on error
      console.error("Error regenerating key:", error);
      toast.fromError(error);
    }
  };

  const handleRegenerateKey = () => {
    if (!selectedToken || !accessToken) return;

    setIsRegenerating(true);
    void form.handleSubmit(submitRegenerateKey, () => setIsRegenerating(false))();
  };

  const handleClose = () => {
    const shouldCloseManagedKeyDetail = managedRotationCompleted;
    setRegeneratedKey(null);
    setPreviousKeyRevokeAt(null);
    setIsRegenerating(false);
    setCopied(false);
    setManagedRotationCompleted(false);
    form.reset(EMPTY_VALUES);
    onClose();
    if (shouldCloseManagedKeyDetail) {
      onManagedRotationAcknowledged?.();
    }
  };

  const handleCopyKey = () => {
    setCopied(true);
  };

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && handleClose()} disablePointerDismissal>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("gateway.regenerate.title")}</DialogTitle>
        </DialogHeader>
        {regeneratedKey ? (
          <div className="flex flex-col gap-4">
            <Alert variant="warning">
              <TriangleAlert />
              <AlertTitle>{t("gateway.regenerate.saveWarning")}</AlertTitle>
            </Alert>

            {previousKeyRevokeAt ? (
              <Alert variant="info">
                <CircleHelp />
                <AlertTitle>{t("gateway.regenerate.previousKeyWindow")}</AlertTitle>
                <AlertDescription>
                  {t("gateway.regenerate.previousKeyRevokeAt", {
                    value: formatExpiresUtc(previousKeyRevokeAt),
                  })}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="warning">
                <TriangleAlert />
                <AlertTitle>{t("gateway.regenerate.previousKeyUnavailable")}</AlertTitle>
              </Alert>
            )}

            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">{t("gateway.regenerate.keyAlias")}</span>
              <span className="text-sm text-foreground">
                {selectedToken?.key_alias || t("gateway.regenerate.noAlias")}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t("gateway.regenerate.virtualKey")}</span>
              <div className="rounded-md border border-border bg-muted px-4 py-3.5 font-mono text-base break-all text-foreground">
                {regeneratedKey}
              </div>
            </div>
          </div>
        ) : (
          <TooltipProvider>
            <form onSubmit={(event) => event.preventDefault()} noValidate className="mt-1">
              <FieldGroup>
                {managedPersonalKey && (
                  <Alert variant="info">
                    <CircleHelp />
                    <AlertTitle>{t("gateway.regenerate.managedPolicyTitle")}</AlertTitle>
                    <AlertDescription>{t("gateway.regenerate.managedPolicyDescription")}</AlertDescription>
                  </Alert>
                )}

                {!managedPersonalKey && (
                  <>
                    <FormField control={form.control} name="key_alias" label={t("gateway.regenerate.keyAlias")}>
                      {({ ref, value, ...field }) => <Input {...field} ref={ref} value={value ?? ""} disabled />}
                    </FormField>

                    <div className="grid grid-cols-3 gap-3">
                      <FormField control={form.control} name="max_budget" label={t("gateway.regenerate.maxBudget")}>
                        {({ ref, value, onChange, ...field }) => (
                          <Input
                            {...field}
                            ref={ref}
                            type="number"
                            step={0.01}
                            value={value ?? ""}
                            onChange={(event) =>
                              onChange(event.target.value === "" ? null : event.target.valueAsNumber)
                            }
                          />
                        )}
                      </FormField>

                      <FormField control={form.control} name="tpm_limit" label={t("gateway.regenerate.tpmLimit")}>
                        {({ ref, value, onChange, ...field }) => (
                          <Input
                            {...field}
                            ref={ref}
                            type="number"
                            value={value ?? ""}
                            onChange={(event) =>
                              onChange(event.target.value === "" ? null : event.target.valueAsNumber)
                            }
                          />
                        )}
                      </FormField>

                      <FormField control={form.control} name="rpm_limit" label={t("gateway.regenerate.rpmLimit")}>
                        {({ ref, value, onChange, ...field }) => (
                          <Input
                            {...field}
                            ref={ref}
                            type="number"
                            value={value ?? ""}
                            onChange={(event) =>
                              onChange(event.target.value === "" ? null : event.target.valueAsNumber)
                            }
                          />
                        )}
                      </FormField>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={form.control}
                        name="duration"
                        label={t("gateway.regenerate.expireKey")}
                        description={
                          <span className="flex flex-col gap-0.5 text-xs">
                            <span className={keyIsExpired ? "text-destructive" : "text-muted-foreground"}>
                              {t("gateway.regenerate.currentExpiry", {
                                value: selectedToken?.expires
                                  ? formatExpiresUtc(selectedToken.expires)
                                  : t("gateway.regenerate.never"),
                              })}{" "}
                              {keyIsExpired ? t("gateway.regenerate.expired") : null}
                            </span>
                            {newExpiryTime && (
                              <span className="text-success">
                                {t("gateway.regenerate.newExpiry", { value: newExpiryTime })}
                              </span>
                            )}
                          </span>
                        }
                      >
                        {({ ref, ...field }) => (
                          <Input {...field} ref={ref} placeholder={t("gateway.regenerate.durationPlaceholder")} />
                        )}
                      </FormField>

                      <FormField
                        control={form.control}
                        name="grace_period"
                        label={labelWithHint(
                          t("gateway.regenerate.gracePeriod"),
                          "Keep the old key valid for this duration after rotation. Both keys work during this period for seamless cutover. Empty = immediate revoke.",
                        )}
                        description={<span className="text-xs">{t("gateway.regenerate.graceRecommendation")}</span>}
                      >
                        {({ ref, ...field }) => (
                          <Input {...field} ref={ref} placeholder={t("gateway.regenerate.gracePlaceholder")} />
                        )}
                      </FormField>
                    </div>
                  </>
                )}
              </FieldGroup>
            </form>
          </TooltipProvider>
        )}
        <DialogFooter>
          {regeneratedKey ? (
            <>
              <Button variant="outline" onClick={handleClose}>
                {t("gateway.regenerate.close")}
              </Button>
              <CopyToClipboard text={regeneratedKey} onCopy={handleCopyKey}>
                <Button>
                  {copied ? <Check /> : <Copy />}
                  {copied ? t("gateway.regenerate.copied") : t("gateway.regenerate.copy")}
                </Button>
              </CopyToClipboard>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose}>
                {t("gateway.regenerate.cancel")}
              </Button>
              <Button onClick={handleRegenerateKey} disabled={isRegenerating} aria-busy={isRegenerating}>
                <RefreshCw />
                <span className="sr-only">Regenerate </span>
                {t("gateway.regenerate.issue")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
