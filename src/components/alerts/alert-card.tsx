"use client";

/**
 * One alert, rendered consistently everywhere it appears.
 *
 * Every alert answers the same four questions in the same order: what happened,
 * why the system believes it, who it affects, and what to do next. That
 * structure is the product promise, so it lives in the component rather than in
 * each screen's markup.
 */
import * as React from "react";
import { motion } from "motion/react";
import { Check, ChevronRight } from "lucide-react";
import type { SiteAlert } from "@/lib/api/contracts";
import { ALERT_SEVERITY } from "@/lib/status";
import { Button } from "@/components/ui/primitives";
import { SeverityChip } from "@/components/ui/status";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<SiteAlert["source"], string> = {
  simulator: "Machine telemetry",
  webcam: "On-board camera",
  v2v: "Machine-to-machine",
  rules: "Safety rules engine",
  ml: "Predictive model",
  director: "Demo control",
};

export function relativeTime(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function AlertCard({
  alert,
  onAcknowledge,
  onSelect,
  compact,
  className,
}: {
  alert: SiteAlert;
  onAcknowledge?: (id: string) => void;
  onSelect?: (alert: SiteAlert) => void;
  compact?: boolean;
  className?: string;
}) {
  const token = ALERT_SEVERITY[alert.severity];
  const critical = alert.severity === "critical" && !alert.acknowledged;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.22 }}
      className={cn(
        "relative overflow-hidden rounded border bg-ink-850",
        token.border,
        alert.acknowledged && "opacity-60",
        className,
      )}
      aria-live={critical ? "assertive" : "off"}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", token.dot)} aria-hidden />

      <div className="space-y-2 py-3 pl-4 pr-3">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityChip severity={alert.severity} size="sm" />
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-50">{alert.title}</h3>
          <span className="shrink-0 font-mono text-[11px] text-muted">{relativeTime(alert.createdAt)}</span>
        </div>

        <p className="text-xs leading-relaxed text-zinc-300">{alert.message}</p>

        {!compact ? (
          <>
            <p className="text-[11px] leading-relaxed text-muted">
              <span className="font-semibold uppercase tracking-wider text-zinc-500">Why </span>
              {alert.cause}
            </p>

            {Object.keys(alert.detail).length ? (
              <dl className="flex flex-wrap gap-x-4 gap-y-1 border-t border-white/8 pt-2">
                {Object.entries(alert.detail).map(([k, v]) => (
                  <div key={k} className="flex items-baseline gap-1.5">
                    <dt className="text-[10px] uppercase tracking-wider text-zinc-500">{k}</dt>
                    <dd className="font-mono text-[11px] font-semibold text-zinc-200">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </>
        ) : null}

        <div className={cn("flex items-start gap-2 rounded border border-white/8 bg-ink-900 px-2.5 py-2")}>
          <ChevronRight className={cn("mt-0.5 size-3.5 shrink-0", token.text)} aria-hidden />
          <p className="text-[11px] font-medium leading-relaxed text-zinc-200">{alert.action}</p>
        </div>

        <div className="flex items-center justify-between gap-2 pt-0.5">
          <span className="truncate text-[10px] uppercase tracking-wider text-zinc-500">
            {alert.machineId} · {SOURCE_LABEL[alert.source]}
          </span>
          <div className="flex shrink-0 gap-1.5">
            {onSelect ? (
              <Button variant="ghost" size="sm" onClick={() => onSelect(alert)}>
                Inspect
              </Button>
            ) : null}
            {onAcknowledge && !alert.acknowledged ? (
              <Button variant="outline" size="sm" onClick={() => onAcknowledge(alert.id)}>
                <Check className="size-3.5" aria-hidden />
                Acknowledge
              </Button>
            ) : null}
            {alert.acknowledged ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted">
                <Check className="size-3.5" aria-hidden />
                Acknowledged
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </motion.article>
  );
}
