"use client";

/**
 * The alert ribbon: one wide, unmissable band that states the worst thing
 * currently true, and what to do about it.
 *
 * It has a deliberate resting state. "All systems normal" is information the
 * operator needs, so the ribbon never collapses to nothing — it changes
 * character instead. Only the critical state animates.
 */
import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  OctagonAlert,
  type LucideIcon,
} from "lucide-react";
import type { SiteAlert } from "@/lib/api/contracts";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { useAlertSound } from "@/lib/hooks/use-alert-sound";
import { XrayLink } from "@/components/shared/xray-link";

export type RibbonLevel = "normal" | "info" | "warning" | "critical";

const LEVEL: Record<
  RibbonLevel,
  { wrap: string; icon: LucideIcon; iconWrap: string; eyebrow: string }
> = {
  normal: {
    wrap: "border-status-ok/30 bg-status-ok/8",
    icon: CheckCircle2,
    iconWrap: "bg-status-ok/15 text-status-ok",
    eyebrow: "text-status-ok",
  },
  info: {
    wrap: "border-status-info/35 bg-status-info/8",
    icon: AlertTriangle,
    iconWrap: "bg-status-info/15 text-status-info",
    eyebrow: "text-status-info",
  },
  warning: {
    wrap: "border-status-warn/45 bg-status-warn/10",
    icon: AlertTriangle,
    iconWrap: "bg-status-warn/15 text-status-warn",
    eyebrow: "text-status-warn",
  },
  critical: {
    wrap: "border-status-crit/60 bg-status-crit/12",
    icon: OctagonAlert,
    iconWrap: "bg-status-crit/20 text-status-crit",
    eyebrow: "text-status-crit",
  },
};

const EYEBROW: Record<RibbonLevel, string> = {
  normal: "All systems normal",
  info: "Advisory",
  warning: "Warning",
  critical: "Safety alert",
};

export function levelFor(alerts: SiteAlert[]): RibbonLevel {
  const open = alerts.filter((a) => !a.acknowledged);
  if (open.some((a) => a.severity === "critical")) return "critical";
  if (open.some((a) => a.severity === "warning")) return "warning";
  if (open.some((a) => a.severity === "info")) return "info";
  return "normal";
}

export function AlertRibbon({
  alerts,
  onAcknowledge,
  restingMessage,
  size = "md",
  className,
}: {
  alerts: SiteAlert[];
  onAcknowledge?: (id: string) => void;
  /** Shown when nothing is wrong. */
  restingMessage: string;
  size?: "md" | "cab";
  className?: string;
}) {
  const open = alerts.filter((a) => !a.acknowledged);
  useAlertSound(open, "ribbon");
  const level = levelFor(alerts);
  const lead = open[0] ?? null;
  const style = LEVEL[level];
  const Icon = style.icon;
  const cab = size === "cab";

  // On the cab HMI, "nothing is wrong" doesn't need a quarter of the screen —
  // it collapses to a single compact line, and only expands into the full
  // treatment below once there is something the operator actually needs to
  // read. The banner grows with the severity of the situation, not by default.
  if (cab && level === "normal") {
    return (
      <div
        className={cn("flex items-center gap-2.5 rounded border px-4 py-2.5", style.wrap, className)}
        role="status"
      >
        <Icon className="size-4 shrink-0 text-status-ok" aria-hidden />
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-status-ok">
          System status
        </span>
        <span className="truncate text-sm font-semibold text-zinc-100">{restingMessage}</span>
        <span className="ml-auto hidden truncate text-[11px] text-muted sm:block">Continue with the current task.</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded border transition-colors duration-300",
        style.wrap,
        className,
      )}
      role={level === "critical" ? "alert" : "status"}
      aria-live={level === "critical" ? "assertive" : "polite"}
    >
      {level === "critical" ? (
        <motion.span
          aria-hidden
          className="absolute inset-0 bg-status-crit/10"
          animate={{ opacity: [0, 0.55, 0] }}
          transition={{ duration: 1.9, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : null}

      <div
        className={cn(
          "relative flex items-center gap-3",
          cab ? "px-5 py-4" : "px-4 py-3",
        )}
      >
        <span
          className={cn(
            "grid shrink-0 place-items-center rounded",
            style.iconWrap,
            cab ? "size-12" : "size-9",
          )}
        >
          <Icon className={cab ? "size-6" : "size-5"} aria-hidden />
        </span>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={lead?.id ?? "resting"}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.2 }}
            className="min-w-0 flex-1"
          >
            <p
              className={cn(
                "font-semibold uppercase tracking-[0.14em]",
                style.eyebrow,
                cab ? "text-xs" : "text-[10px]",
              )}
            >
              {EYEBROW[level]}
            </p>
            <p
              className={cn(
                "truncate font-bold text-zinc-50",
                cab ? "text-2xl" : "text-sm",
              )}
            >
              {lead ? lead.title : restingMessage}
            </p>
            <p
              className={cn(
                "truncate text-muted",
                cab ? "mt-0.5 text-sm" : "text-[11px]",
              )}
            >
              {lead ? lead.action : "Continue with the current task."}
            </p>
          </motion.div>
        </AnimatePresence>

        {open.length > 1 ? (
          <span
            className={cn(
              "shrink-0 rounded border border-white/15 bg-black/30 px-2 py-1 font-mono font-bold text-zinc-200",
              cab ? "text-sm" : "text-[11px]",
            )}
          >
            +{open.length - 1}
          </span>
        ) : null}

        {lead && lead.kind !== "proximity" && lead.kind !== "seatbelt" && lead.kind !== "fatigue" ? (
          <XrayLink
            machineId={lead.machineId}
            issue={{ alertKind: lead.kind, text: lead.title }}
            label="Where?"
            className={cab ? "h-14 px-5 text-base" : undefined}
          />
        ) : null}

        {lead && onAcknowledge ? (
          <Button
            variant={level === "critical" ? "danger" : "outline"}
            size={cab ? "touch" : "sm"}
            className="shrink-0"
            onClick={() => onAcknowledge(lead.id)}
          >
            <Check className={cab ? "size-5" : "size-3.5"} aria-hidden />
            Acknowledge
          </Button>
        ) : null}
      </div>
    </div>
  );
}
