import { useTranslation } from "react-i18next";
import { GuardrailField, type GuardrailFormControl } from "./GuardrailFormField";

export const STREAMING_OUTPUT = "presidio_streaming_output_mode";
export const streamingMode = (value: unknown): string =>
  value === "off" || value === "full_buffer" ? value : "windowed";
export const streamingPayload = (values: Record<string, unknown>, provider: string) =>
  provider === "presidio" ? { [STREAMING_OUTPUT]: streamingMode(values[STREAMING_OUTPUT]) } : {};

export default function PresidioStreamingOutput({
  control,
  values = {},
}: {
  control?: GuardrailFormControl;
  values?: Record<string, unknown>;
}) {
  const { t } = useTranslation();
  return (
    <section className="my-6 space-y-2">
      {control ? (
        <GuardrailField
          control={control}
          name={STREAMING_OUTPUT}
          defaultValue="windowed"
          label={t("guardrails.streamingOutput.title")}
        >
          {({ value, onChange, ...field }) => (
            <select
              {...field}
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={streamingMode(value)}
              onChange={(event) => onChange(event.target.value)}
            >
              {["off", "windowed", "full_buffer"].map((mode) => (
                <option key={mode} value={mode}>
                  {t(`guardrails.streamingOutput.${mode}`)}
                </option>
              ))}
            </select>
          )}
        </GuardrailField>
      ) : (
        <dl className="text-sm">
          <dt>{t("guardrails.streamingOutput.title")}</dt>
          <dd>{t(`guardrails.streamingOutput.${streamingMode(values[STREAMING_OUTPUT])}`)}</dd>
        </dl>
      )}
      <p className="text-sm text-muted-foreground">{t("guardrails.streamingOutput.help")}</p>
      <p className="text-sm text-muted-foreground">{t("guardrails.streamingOutput.tradeoff")}</p>
    </section>
  );
}
