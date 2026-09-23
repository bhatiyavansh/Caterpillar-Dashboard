/**
 * One definition of what each machine and alert state looks like.
 *
 * Every screen resolves colour, icon and wording through here so "WARNING"
 * never means two different things in two places. Status is always carried by
 * an icon and a word as well as a colour.
 */
import type { AlertSeverity, MachineStatus, ProximityLevel } from "@/lib/api/contracts";

export interface StatusToken {
  label: string;
  /** One-line meaning, used in tooltips and inspector rows. */
  description: string;
  text: string;
  bg: string;
  border: string;
  dot: string;
  /** Solid fill for bars and badges that need to read at a distance. */
  solid: string;
  /** Raw hex, for canvas, charts and the 3D layer. */
  hex: string;
}

export const MACHINE_STATUS: Record<MachineStatus, StatusToken> = {
  operating: {
    label: "Operating",
    description: "Working on an assigned task within normal limits.",
    text: "text-status-ok",
    bg: "bg-status-ok/10",
    border: "border-status-ok/40",
    dot: "bg-status-ok",
    solid: "bg-status-ok text-ink-950",
    hex: "#3ddc84",
  },
  idle: {
    label: "Idle",
    description: "Engine running but not producing work.",
    text: "text-status-info",
    bg: "bg-status-info/10",
    border: "border-status-info/40",
    dot: "bg-status-info",
    solid: "bg-status-info text-ink-950",
    hex: "#4aa8ff",
  },
  warning: {
    label: "Warning",
    description: "Operating with an unresolved caution against it.",
    text: "text-status-warn",
    bg: "bg-status-warn/10",
    border: "border-status-warn/40",
    dot: "bg-status-warn",
    solid: "bg-status-warn text-ink-950",
    hex: "#ffb020",
  },
  critical: {
    label: "Critical",
    description: "A safety limit has been breached. Needs action now.",
    text: "text-status-crit",
    bg: "bg-status-crit/12",
    border: "border-status-crit/50",
    dot: "bg-status-crit",
    solid: "bg-status-crit text-white",
    hex: "#ff4d4f",
  },
  maintenance: {
    label: "Maintenance",
    description: "Out of service for planned work.",
    text: "text-cat-500",
    bg: "bg-cat-500/10",
    border: "border-cat-500/40",
    dot: "bg-cat-500",
    solid: "bg-cat-500 text-ink-950",
    hex: "#ffcd11",
  },
  offline: {
    label: "Offline",
    description: "No telemetry received in the last 15 minutes.",
    text: "text-muted",
    bg: "bg-white/5",
    border: "border-white/15",
    dot: "bg-zinc-500",
    solid: "bg-zinc-600 text-white",
    hex: "#6b7280",
  },
};

export const ALERT_SEVERITY: Record<AlertSeverity, StatusToken> = {
  critical: { ...MACHINE_STATUS.critical, label: "Critical", description: "Stop and act." },
  warning: { ...MACHINE_STATUS.warning, label: "Warning", description: "Act before it escalates." },
  info: { ...MACHINE_STATUS.idle, label: "Info", description: "For awareness." },
};

export const PROXIMITY: Record<ProximityLevel, StatusToken> = {
  safe: { ...MACHINE_STATUS.operating, label: "Clear", description: "No person inside the work envelope." },
  warning: { ...MACHINE_STATUS.warning, label: "Approaching", description: "A person is inside the caution ring." },
  critical: { ...MACHINE_STATUS.critical, label: "Danger zone", description: "A person is inside the stop ring." },
};

/** Derives the status a reading should be shown in, for gauges and rows. */
export function thresholdStatus(
  value: number,
  { warn, crit, invert = false }: { warn: number; crit: number; invert?: boolean },
): MachineStatus {
  if (invert) {
    if (value <= crit) return "critical";
    if (value <= warn) return "warning";
    return "operating";
  }
  if (value >= crit) return "critical";
  if (value >= warn) return "warning";
  return "operating";
}

/** Shared limits, so the cab and the command centre never disagree. */
export const LIMITS = {
  fuel: { warn: 25, crit: 12, invert: true },
  hydraulicTemperature: { warn: 95, crit: 102 },
  coolantTemperature: { warn: 98, crit: 106 },
  tipOverMargin: { warn: 1.5, crit: 1.2, invert: true },
  load: { warn: 92, crit: 100 },
} as const;

export function worstOf(statuses: MachineStatus[]): MachineStatus {
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("warning")) return "warning";
  if (statuses.includes("offline")) return "offline";
  return "operating";
}
