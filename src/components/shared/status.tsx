"use client";

import { AlertTriangle, CheckCircle2, Info, OctagonAlert, PowerOff } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { HealthStatus, Severity } from "@/lib/types";
import { cn, severityStyles, statusStyles } from "@/lib/utils";
import { useStatusSoundFor } from "@/lib/hooks/use-status-sound";

const statusIcon: Record<HealthStatus, LucideIcon> = {
  healthy: CheckCircle2,
  warning: AlertTriangle,
  critical: OctagonAlert,
  offline: PowerOff,
};

/**
 * Status is always conveyed by icon + text as well as colour, so the UI stays
 * readable for colour-blind operators and in direct sunlight.
 */
export function StatusIndicator({
  status,
  label,
  size = "md",
  className,
  soundKey,
}: {
  status: HealthStatus;
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  /**
   * What this indicator is reporting on. Given one, it announces itself when it
   * turns amber or red; the label is used when nothing more specific is passed,
   * since "Hydraulic temperature" identifies the reading well enough.
   */
  soundKey?: string;
}) {
  const s = statusStyles[status];
  useStatusSoundFor(soundKey ?? label, status);
  const Icon = statusIcon[status];
  const sizes = {
    sm: "text-[11px] px-2 py-0.5 gap-1.5",
    md: "text-xs px-2.5 py-1 gap-2",
    lg: "text-sm px-3.5 py-2 gap-2.5",
  }[size];
  const iconSize = { sm: "size-3.5", md: "size-4", lg: "size-5" }[size];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded border font-semibold uppercase tracking-[0.1em]",
        s.bg,
        s.border,
        s.text,
        sizes,
        className,
      )}
    >
      <Icon className={iconSize} aria-hidden />
      {label ?? s.label}
    </span>
  );
}

export function StatusDot({
  status,
  pulse,
  soundKey,
}: {
  status: HealthStatus;
  pulse?: boolean;
  /** What this dot is reporting on. See `StatusIndicator`. */
  soundKey?: string;
}) {
  const s = statusStyles[status];
  useStatusSoundFor(soundKey, status);
  return (
    <span className={cn("relative inline-flex size-2.5 shrink-0 rounded-full", s.dot, pulse && "pulse-ring", s.text)} />
  );
}

export function SeverityIndicator({
  severity,
  size = "md",
  soundKey,
}: {
  severity: Severity;
  size?: "sm" | "md" | "lg";
  /** What this severity belongs to. See `StatusIndicator`. */
  soundKey?: string;
}) {
  // Announced here rather than in the nested StatusIndicator, so the caller's
  // key is what identifies it and "info" never makes a noise.
  useStatusSoundFor(soundKey, severity);
  if (severity === "info") {
    const s = severityStyles.info;
    const sizes = { sm: "text-[11px] px-2 py-0.5 gap-1.5", md: "text-xs px-2.5 py-1 gap-2", lg: "text-sm px-3.5 py-2 gap-2.5" }[size];
    return (
      <span className={cn("inline-flex items-center rounded border font-semibold uppercase tracking-[0.1em]", s.bg, s.border, s.text, sizes)}>
        <Info className={{ sm: "size-3.5", md: "size-4", lg: "size-5" }[size]} aria-hidden />
        INFO
      </span>
    );
  }
  return <StatusIndicator status={severity} size={size} soundKey="" />;
}
