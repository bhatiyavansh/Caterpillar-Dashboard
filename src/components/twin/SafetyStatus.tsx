"use client";

/**
 * Top-centre site safety banner. Reads the worst of proximity, stability,
 * predicted conflicts, e-stop and weather.
 */

import { motion } from "motion/react";
import type { ProximityLevel } from "@/types/twin";
import { useTwinStore } from "@/store/twinStore";

const LOOK: Record<
  ProximityLevel,
  { label: string; dot: string; text: string; border: string; glow: string; mark: string }
> = {
  safe: {
    label: "NORMAL",
    dot: "bg-status-ok",
    text: "text-status-ok",
    border: "border-status-ok/35",
    glow: "shadow-[0_0_24px_-8px_rgba(61,220,132,0.55)]",
    mark: "●",
  },
  warning: {
    label: "WARNING",
    dot: "bg-status-warn",
    text: "text-status-warn",
    border: "border-status-warn/50",
    glow: "shadow-[0_0_28px_-6px_rgba(255,176,32,0.6)]",
    mark: "▲",
  },
  critical: {
    label: "CRITICAL",
    dot: "bg-status-crit",
    text: "text-status-crit",
    border: "border-status-crit/60",
    glow: "shadow-[0_0_34px_-4px_rgba(255,59,48,0.7)]",
    mark: "■",
  },
};

export function SafetyStatus({ compact }: { compact?: boolean }) {
  const level = useTwinStore((s) => s.snapshot.siteSafety);
  const nearest = useTwinStore((s) => s.snapshot.proximity.nearest);
  const look = LOOK[level];

  return (
    <motion.div
      animate={
        level === "critical"
          ? { scale: [1, 1.025, 1] }
          : { scale: 1 }
      }
      transition={
        level === "critical"
          ? { duration: 0.9, repeat: Infinity, ease: "easeInOut" }
          : { duration: 0.2 }
      }
      className={`pointer-events-auto flex items-center rounded border bg-ink-950/85 backdrop-blur-md ${
        compact ? "gap-2 px-2.5 py-1.5" : "gap-3 px-4 py-2"
      } ${look.border} ${look.glow}`}
    >
      <div className="flex flex-col">
        <span className="label-xs leading-none">Site safety</span>
        <span className={`mt-1 text-sm font-bold tracking-[0.18em] ${look.text}`}>
          <span className="mr-1.5 text-[10px]">{look.mark}</span>
          {look.label}
        </span>
      </div>

      <div className="h-8 w-px bg-white/10" />

      <div className="flex flex-col">
        <span className="label-xs leading-none">{compact ? "Nearest" : "Nearest worker"}</span>
        <span className="mt-1 font-mono text-sm font-bold tabular-nums text-zinc-100">
          {Number.isFinite(nearest) ? `${nearest.toFixed(1)} m` : "--"}
        </span>
      </div>

      <span
        className={`relative inline-block size-2.5 rounded-full ${look.dot} ${
          level !== "safe" ? "pulse-ring" : ""
        }`}
        style={{ color: "currentColor" }}
        aria-hidden
      />
    </motion.div>
  );
}
