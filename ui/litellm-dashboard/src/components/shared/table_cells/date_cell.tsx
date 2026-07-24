"use client";

import { CellTooltip } from "./cell_tooltip";
import { useTranslation } from "react-i18next";
import type { SupportedLanguage } from "@/i18n/resources";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type DatePrecision = "datetime" | "date";

interface DateCellProps {
  value: string | null | undefined;
  precision?: DatePrecision;
  fallback?: string;
}

const pad = (n: number): string => String(n).padStart(2, "0");

export const formatCellDate = (date: Date, precision: DatePrecision, language: SupportedLanguage = "en"): string => {
  if (language === "ko") {
    const options: Intl.DateTimeFormatOptions = {
      year: precision === "date" ? "numeric" : undefined,
      month: "long",
      day: "numeric",
      hour: precision === "datetime" ? "2-digit" : undefined,
      minute: precision === "datetime" ? "2-digit" : undefined,
      second: precision === "datetime" ? "2-digit" : undefined,
      hour12: false,
    };
    return new Intl.DateTimeFormat("ko-KR", options).format(date);
  }

  return precision === "date"
    ? `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
    : `${MONTHS[date.getMonth()]} ${date.getDate()}, ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

export const formatFullTimestamp = (date: Date, language: SupportedLanguage = "en"): string => {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (language === "ko") {
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    };
    const timestamp = new Intl.DateTimeFormat("ko-KR", options).format(date);
    return `${timestamp} (${timeZone})`;
  }

  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${day}, ${time} (${timeZone})`;
};

export function DateCell({ value, precision = "datetime", fallback = "-" }: DateCellProps) {
  const { i18n } = useTranslation();
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return <span className="text-muted-foreground">{fallback}</span>;
  }

  return (
    <CellTooltip
      content={formatFullTimestamp(date, i18n.resolvedLanguage === "ko" ? "ko" : "en")}
      trigger={
        <span className="whitespace-nowrap">
          {formatCellDate(date, precision, i18n.resolvedLanguage === "ko" ? "ko" : "en")}
        </span>
      }
    />
  );
}
