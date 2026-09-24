"use client";

/**
 * Status primitives. Colour is never the only signal: each carries an icon and
 * a word, which is what keeps the UI readable in sunlight and for colour-blind
 * operators.
 */
import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  OctagonAlert,
  PauseCircle,
  PowerOff,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { AlertSeverity, MachineStatus } from "@/lib/api/contracts";
import { ALERT_SEVERITY, MACHINE_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { IconComponent } from "@/components/ui/icon";

const STATUS_ICON: Record<MachineStatus, LucideIcon> = {
  operating: CheckCircle2,
  idle: PauseCircle,
  warning: AlertTriangle,
  critical: OctagonAlert,
  maintenance: Wrench,
  offline: PowerOff,
};

const SEVERITY_ICON: Record<AlertSeverity, LucideIcon> = {
  critical: OctagonAlert,
  warning: AlertTriangle,
  info: Info,
};

type Size = "sm" | "md" | "lg";

const SIZES: Record<Size, { chip: string; icon: string }> = {
  sm: { chip: "text-[10px] px-1.5 py-0.5 gap-1", icon: "size-3" },
  md: { chip: "text-[11px] px-2 py-0.5 gap-1.5", icon: "size-3.5" },
  lg: { chip: "text-sm px-3 py-1.5 gap-2", icon: "size-4.5" },
};

export function MachineStatusChip({
  status,
  size = "md",
  label,
  className,
}: {
  status: MachineStatus;
  size?: Size;
  label?: string;
  className?: string;
}) {
  const token = MACHINE_STATUS[status];
  const Icon = STATUS_ICON[status];
  const s = SIZES[size];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border font-semibold uppercase tracking-[0.1em]",
        token.bg,
        token.border,
        token.text,
        s.chip,
        className,
      )}
    >
      <Icon className={cn(s.icon, "shrink-0")} aria-hidden />
      {label ?? token.label}
    </span>
  );
}

export function SeverityChip({
  severity,
  size = "md",
  label,
  className,
}: {
  severity: AlertSeverity;
  size?: Size;
  label?: string;
  className?: string;
}) {
  const token = ALERT_SEVERITY[severity];
  const Icon = SEVERITY_ICON[severity];
  const s = SIZES[size];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border font-semibold uppercase tracking-[0.1em]",
        token.bg,
        token.border,
        token.text,
        s.chip,
        className,
      )}
    >
      <Icon className={cn(s.icon, "shrink-0")} aria-hidden />
      {label ?? token.label}
    </span>
  );
}

/**
 * A dot plus its word. The word is what makes this accessible; the dot is what
 * makes a dense fleet list scannable.
 */
export function StatusLabel({
  status,
  className,
  pulse,
}: {
  status: MachineStatus;
  className?: string;
  pulse?: boolean;
}) {
  const token = MACHINE_STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-semibold",
        token.text,
        className,
      )}
    >
      <span
        className={cn(
          "relative inline-flex size-2 shrink-0 rounded-full",
          token.dot,
          pulse && "pulse-ring",
        )}
        aria-hidden
      />
      {token.label}
    </span>
  );
}
