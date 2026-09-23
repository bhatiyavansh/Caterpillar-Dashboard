import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { HealthStatus, Severity } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const statusStyles: Record<
  HealthStatus,
  { label: string; text: string; bg: string; border: string; dot: string }
> = {
  healthy: {
    label: "NORMAL",
    text: "text-status-ok",
    bg: "bg-status-ok/10",
    border: "border-status-ok/40",
    dot: "bg-status-ok",
  },
  warning: {
    label: "WARNING",
    text: "text-status-warn",
    bg: "bg-status-warn/10",
    border: "border-status-warn/40",
    dot: "bg-status-warn",
  },
  critical: {
    label: "CRITICAL",
    text: "text-status-crit",
    bg: "bg-status-crit/10",
    border: "border-status-crit/40",
    dot: "bg-status-crit",
  },
  offline: {
    label: "OFFLINE",
    text: "text-muted",
    bg: "bg-white/5",
    border: "border-white/15",
    dot: "bg-zinc-500",
  },
};

export const severityStyles: Record<
  Severity,
  { label: string; text: string; bg: string; border: string; dot: string }
> = {
  critical: statusStyles.critical,
  warning: statusStyles.warning,
  info: {
    label: "INFO",
    text: "text-status-info",
    bg: "bg-status-info/10",
    border: "border-status-info/40",
    dot: "bg-status-info",
  },
};

export function formatNumber(value: number, digits = 0) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
