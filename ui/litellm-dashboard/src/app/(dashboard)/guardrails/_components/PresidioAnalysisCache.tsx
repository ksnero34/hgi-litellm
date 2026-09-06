import type { PresidioCacheSettings } from "@/components/guardrails/types";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { GuardrailField, type GuardrailFormControl } from "./GuardrailFormField";
import { CACHE_ENABLED, CACHE_TTL, validCacheTtl } from "./presidio_cache_form";

interface Props {
  control?: GuardrailFormControl;
  settings?: PresidioCacheSettings;
  values?: Record<string, unknown>;
}

function cacheChoice(value: unknown): string {
  if (value === true) return "enabled";
  if (value === false) return "disabled";
  return "inherit";
}

export default function PresidioAnalysisCache({ control, settings, values = {} }: Props) {
  const { t } = useTranslation();
  const choiceLabel = (value: unknown) => t(`guardrails.cache.${cacheChoice(value)}`);
  return (
    <section className="my-6 space-y-4">
      <h3 className="text-sm font-semibold">{t("guardrails.cache.title")}</h3>
      <p className="text-sm text-muted-foreground">{t("guardrails.cache.storage")}</p>
      {control ? (
        <>
          <GuardrailField control={control} name={CACHE_ENABLED} label={t("guardrails.cache.mode")} defaultValue={null}>
            {({ value, onChange, ...field }) => (
              <select
                {...field}
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={cacheChoice(value)}
                onChange={(event) =>
                  onChange(event.target.value === "inherit" ? null : event.target.value === "enabled")
                }
              >
                {["inherit", "enabled", "disabled"].map((choice) => (
                  <option key={choice} value={choice}>
                    {t(`guardrails.cache.${choice}`)}
                  </option>
                ))}
              </select>
            )}
          </GuardrailField>
          <GuardrailField
            control={control}
            name={CACHE_TTL}
            label={t("guardrails.cache.ttl")}
            defaultValue={null}
            description={t("guardrails.cache.ttlHelp")}
            rules={{ validate: (value) => validCacheTtl(value) || t("guardrails.cache.ttlInvalid") }}
          >
            {({ value, onChange, ...field }) => (
              <Input
                {...field}
                type="number"
                min={1}
                max={86400}
                step={1}
                value={typeof value === "number" ? value : ""}
                placeholder={settings ? String(settings.ttl_seconds) : ""}
                onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
              />
            )}
          </GuardrailField>
        </>
      ) : (
        <dl className="text-sm space-y-2">
          <div>
            <dt>{t("guardrails.cache.mode")}</dt>
            <dd>{choiceLabel(values[CACHE_ENABLED])}</dd>
          </div>
          <div>
            <dt>{t("guardrails.cache.ttl")}</dt>
            <dd>{typeof values[CACHE_TTL] === "number" ? String(values[CACHE_TTL]) : t("guardrails.cache.inherit")}</dd>
          </div>
        </dl>
      )}
      <div role="status" className="text-sm text-muted-foreground">
        {settings ? (
          <>
            <p>
              {t("guardrails.cache.defaults", {
                mode: choiceLabel(settings.enabled_by_default),
                ttl: settings.ttl_seconds,
              })}
            </p>
            <p>{t(settings.prerequisites_ready ? "guardrails.cache.ready" : "guardrails.cache.unavailable")}</p>
            {!settings.prerequisites_ready && (
              <ul>
                {settings.unavailable_reasons.map((reason) => (
                  <li key={reason}>
                    {t(`guardrails.cache.reason.${reason}`, {
                      defaultValue: t("guardrails.cache.reason.invalid_configuration"),
                    })}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          t("guardrails.cache.unknown")
        )}
      </div>
    </section>
  );
}
