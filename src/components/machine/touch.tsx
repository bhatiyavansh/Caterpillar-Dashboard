"use client";

import * as React from "react";
import { motion } from "motion/react";
import type { HealthStatus, Severity } from "@/lib/types";
import { cn, severityStyles, statusStyles } from "@/lib/utils";
import { useStatusSoundFor } from "@/lib/hooks/use-status-sound";

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
    neutral: "bg-white/7 text-zinc-100 hover:bg-white/12 border border-white/10",
    ok: "bg-status-ok text-ink-950 hover:brightness-110",
    warn: "bg-status-warn text-ink-950 hover:brightness-110",
    crit: "bg-status-crit text-white hover:brightness-110",
  }[tone];

  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex min-h-14 items-center justify-center gap-3 rounded-2xl px-6 text-base font-semibold transition-all active:scale-[0.98]",
        tone === "primary" && "shadow-[0_10px_28px_-12px_rgba(255,205,17,0.75)]",
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
  useStatusSoundFor(label, status);
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className={cn(
        "panel-raised relative flex min-h-[132px] flex-col justify-between overflow-hidden p-4 text-left transition-colors",
        onClick && "hover:border-white/20",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-semibold text-zinc-400">{label}</span>
        <span className={cn("grid size-9 place-items-center rounded-xl bg-white/6", s.text)}>{icon}</span>
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
          <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-white/6 px-2 py-0.5 text-[11px] font-semibold", s.text)}>
            <span className={cn("size-1.5 rounded-full", s.dot)} />
            {s.label}
          </span>
          {sub ? <span className="text-xs text-muted">{sub}</span> : null}
        </div>
      </div>
      <span className={cn("absolute inset-x-4 bottom-0 h-[3px] rounded-t-full opacity-80", s.dot)} />
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
      className="panel-raised relative overflow-hidden p-4 pl-5"
    >
      <span className="absolute inset-y-3 left-0 w-1 rounded-r-full" style={{ background: SEVERITY_HEX[severity] }} />
      <div className={cn("flex items-center gap-2", s.text)}>
        <span className={cn("size-2 rounded-full", s.dot)} />
        <span className="text-[12px] font-semibold">{s.label}</span>
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
      <h2 className="text-[13px] font-semibold tracking-wide text-zinc-400">{children}</h2>
      {right}
    </div>
  );
}
