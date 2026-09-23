"use client";

import { AlertTriangle, CheckCircle2, Info, OctagonAlert, PowerOff } from "lucide-react";
import type { HealthStatus, Severity } from "@/lib/types";
import { cn, severityStyles, statusStyles } from "@/lib/utils";

const statusIcon: Record<HealthStatus, React.ElementType> = {
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
}: {
  status: HealthStatus;
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const s = statusStyles[status];
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

export function StatusDot({ status, pulse }: { status: HealthStatus; pulse?: boolean }) {
  const s = statusStyles[status];
  return (
    <span className={cn("relative inline-flex size-2.5 shrink-0 rounded-full", s.dot, pulse && "pulse-ring", s.text)} />
  );
}

export function SeverityIndicator({ severity, size = "md" }: { severity: Severity; size?: "sm" | "md" | "lg" }) {
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
  return <StatusIndicator status={severity} size={size} />;
}
