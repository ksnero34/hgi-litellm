"use client";

import React from "react";
import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/cva.config";

export const INPUT_POLICY_OPTIONS = [
  { value: "untrusted", label: "untrusted", dot: "bg-warning" },
  { value: "trusted", label: "trusted", dot: "bg-success" },
  { value: "blocked", label: "blocked", dot: "bg-destructive" },
] as const;

export const OUTPUT_POLICY_OPTIONS = [
  { value: "untrusted", label: "untrusted", dot: "bg-warning" },
  { value: "trusted", label: "trusted", dot: "bg-success" },
] as const;

export const POLICY_OPTIONS = INPUT_POLICY_OPTIONS;

export const policyStyle = (p: string) => INPUT_POLICY_OPTIONS.find((o) => o.value === p) ?? INPUT_POLICY_OPTIONS[0];

const isKoreanLanguage = (language: string | undefined): boolean => language?.startsWith("ko") ?? false;

const toPolicyLabel = (
  value: string,
  language: string | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
) => {
  if (!isKoreanLanguage(language)) {
    return value;
  }

  return t(`observabilityExtra.toolPolicies.policy.${value}`, {
    defaultValue: value,
  });
};

export interface PolicySelectProps {
  value: string;
  toolName: string;
  saving: boolean;
  onChange: (toolName: string, policy: string) => void;
  policyType?: "input" | "output";
  size?: "small" | "middle";
  minWidth?: number;
  stopPropagation?: boolean;
}

export const PolicySelect: React.FC<PolicySelectProps> = ({
  value,
  toolName,
  saving,
  onChange,
  policyType = "input",
  size = "small",
  stopPropagation = true,
}) => {
  const { t, i18n } = useTranslation();
  const options = policyType === "output" ? OUTPUT_POLICY_OPTIONS : INPUT_POLICY_OPTIONS;
  const selected = policyStyle(value);
  return (
    <Select value={value} disabled={saving} onValueChange={(v: string | null) => v !== null && onChange(toolName, v)}>
      <SelectTrigger
        size={size === "small" ? "sm" : "default"}
        className="w-auto min-w-28"
        onClick={(e) => stopPropagation && e.stopPropagation()}
      >
        <span className={cn("size-2 shrink-0 rounded-full", selected.dot)} />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("size-2 shrink-0 rounded-full", o.dot)} />
              {toPolicyLabel(o.label, i18n.resolvedLanguage, t)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
