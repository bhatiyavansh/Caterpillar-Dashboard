"use client";

/**
 * Hazard banner for the most severe active alert, plus a compact stack of any
 * others. Critical alerts pulse; warnings sit still so the difference is
 * unmistakable at a glance.
 */

import { AnimatePresence, motion } from "motion/react";
import type { Alert } from "@/types/twin";
import { useTwinStore } from "@/store/twinStore";
import { useAlertSound } from "@/lib/hooks/use-alert-sound";

function PrimaryAlert({ alert, compact }: { alert: Alert; compact?: boolean }) {
  const critical = alert.severity === "critical";

  return (
    <motion.div
      key={alert.id}
      initial={{ opacity: 0, y: -14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      role="alert"
      className={`pointer-events-auto w-full overflow-hidden rounded border bg-ink-950/92 backdrop-blur-md ${
        critical
          ? "border-status-crit/70 shadow-[0_0_44px_-8px_rgba(255,59,48,0.75)]"
          : "border-status-warn/60 shadow-[0_0_36px_-10px_rgba(255,176,32,0.6)]"
      }`}
    >
      {/* pulsing header */}
      <motion.header
        animate={critical ? { opacity: [1, 0.55, 1] } : { opacity: 1 }}
        transition={
          critical ? { duration: 0.85, repeat: Infinity, ease: "easeInOut" } : undefined
        }
        className={`flex items-center gap-2 px-3 py-2 ${
          critical ? "bg-status-crit/20" : "bg-status-warn/15"
        }`}
      >
        <span className={`text-base ${critical ? "text-status-crit" : "text-status-warn"}`}>
          ⚠
        </span>
        <span
          className={`text-sm font-bold tracking-[0.16em] ${
            critical ? "text-status-crit" : "text-status-warn"
          }`}
        >
          {alert.title}
        </span>
        <span className="ml-auto font-mono text-[10px] text-zinc-500">{alert.machineId}</span>
      </motion.header>

      <div className="px-3 py-2.5">
        <p className="text-xs font-bold tracking-[0.12em] text-zinc-100">{alert.message}</p>

        <dl className="mt-2.5 space-y-1">
          {Object.entries(alert.detail).slice(0, compact ? 2 : 4).map(([key, value]) => (
            <div key={key} className="flex items-baseline justify-between gap-3">
              <dt className="text-[11px] text-zinc-500">{key}</dt>
              <dd className="font-mono text-sm font-bold tabular-nums text-zinc-100">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-2.5 border-t border-white/10 pt-2">
          <div className="label-xs leading-none">Recommended action</div>
          <div
            className={`mt-1 text-sm font-bold tracking-wider ${
              critical ? "text-status-crit" : "text-status-warn"
            }`}
          >
            {alert.recommendation}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function AlertOverlay({ compact }: { compact?: boolean }) {
  const alerts = useTwinStore((s) => s.snapshot.alerts);
  useAlertSound(alerts, "twin");
  const primary = alerts[0];
  const rest = alerts.slice(1, 4);

  return (
    <div className={`flex flex-col items-end gap-2 ${compact ? "w-60" : "w-[330px]"}`}>
      <AnimatePresence mode="popLayout">
        {primary ? <PrimaryAlert key={primary.id} alert={primary} compact={compact} /> : null}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {(compact ? rest.slice(0, 2) : rest).map((alert) => (
          <motion.div
            key={alert.id}
            layout
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ duration: 0.2 }}
            className={`pointer-events-auto flex w-full items-center gap-2 rounded border bg-ink-950/85 px-2.5 py-1.5 backdrop-blur-sm ${
              alert.severity === "critical"
                ? "border-status-crit/45"
                : "border-status-warn/40"
            }`}
          >
            <span
              className={`inline-block size-1.5 shrink-0 rounded-full ${
                alert.severity === "critical" ? "bg-status-crit" : "bg-status-warn"
              }`}
            />
            <span className="truncate text-[11px] font-bold tracking-wider text-zinc-200">
              {alert.title}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-500">
              {alert.machineId}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
