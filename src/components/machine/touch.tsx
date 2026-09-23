"use client";

import * as React from "react";
import { motion } from "motion/react";
import type { HealthStatus, Severity } from "@/lib/types";
import { cn, severityStyles, statusStyles } from "@/lib/utils";

/**
 * Minimum 56px high — sized for a gloved hand on a vibrating machine.
 */
export const TouchButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: "primary" | "neutral" | "ok" | "warn" | "crit";
    icon?: React.ReactNode;
    full?: boolean;
  }
>(function TouchButton({ className, tone = "neutral", icon, full, children, ...props }, ref) {
  const tones = {
    primary: "bg-cat-500 text-ink-950 hover:bg-cat-400 active:bg-cat-600",
    neutral: "bg-white/8 text-zinc-100 hover:bg-white/14 border border-white/12",
    ok: "bg-status-ok text-ink-950 hover:brightness-110",
    warn: "bg-status-warn text-ink-950 hover:brightness-110",
    crit: "bg-status-crit text-white hover:brightness-110",
  }[tone];

  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex min-h-14 items-center justify-center gap-3 rounded px-6 text-base font-bold uppercase tracking-[0.06em] transition-colors",
        tones,
        full && "w-full",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
});

/** Big read-at-a-glance metric tile for the in-cab home screen. */
export function MachineStatusCard({
  label,
  value,
  unit,
  sub,
  status = "healthy",
  icon,
  onClick,
  className,
}: {
  label: string;
  value: string | number;
  unit?: string;
  sub?: string;
  status?: HealthStatus;
  icon?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const s = statusStyles[status];
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className={cn(
        "relative flex min-h-[132px] flex-col justify-between rounded border-2 bg-ink-900 p-4 text-left transition-colors",
        s.border,
        onClick && "hover:bg-ink-850",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] font-bold uppercase tracking-[0.16em] text-muted">{label}</span>
        <span className={s.text}>{icon}</span>
      </div>
      <div>
        <div className="flex items-baseline gap-1.5">
          <motion.span
            key={String(value)}
            initial={{ opacity: 0.5 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            className="font-mono text-[40px] font-bold leading-none tracking-tight text-zinc-50"
          >
            {value}
          </motion.span>
          {unit ? <span className="text-lg font-semibold text-muted">{unit}</span> : null}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className={cn("text-xs font-bold uppercase tracking-[0.14em]", s.text)}>{s.label}</span>
          {sub ? <span className="text-xs text-muted">{sub}</span> : null}
        </div>
      </div>
      <span className={cn("absolute inset-x-0 bottom-0 h-1 rounded-b", s.dot)} />
    </Wrapper>
  );
}

export const SEVERITY_HEX: Record<Severity, string> = {
  critical: "#ff4d4f",
  warning: "#ffb020",
  info: "#4aa8ff",
};

/** Contextual advice card from the operational assistant. */
export function AssistantCard({
  severity,
  title,
  body,
  action,
}: {
  severity: Severity;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  const s = severityStyles[severity];
  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      className="rounded border-l-4 bg-ink-900 p-4"
      style={{ borderLeftColor: SEVERITY_HEX[severity] }}
    >
      <div className={cn("flex items-center gap-2", s.text)}>
        <span className={cn("size-2.5 rounded-full", s.dot)} />
        <span className="text-xs font-bold uppercase tracking-[0.14em]">{s.label}</span>
      </div>
      <p className="mt-2 text-base font-semibold text-zinc-100">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-zinc-400">{body}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </motion.div>
  );
}

export function ScreenPad({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("p-4 lg:p-6", className)}>{children}</div>;
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-muted">{children}</h2>
      {right}
    </div>
  );
}
