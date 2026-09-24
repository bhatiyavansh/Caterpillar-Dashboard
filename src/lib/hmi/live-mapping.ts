/**
 * Site data (from the hub, via `use-site`) in the shapes the in-cab HMI renders.
 *
 * The HMI screens were built against `src/lib/types.ts`. Rather than rewrite
 * nine screens, the bridge in `sensor-engine.tsx` maps the live site records into
 * those same shapes and hands them to `useMachineStore`. Everything here is pure,
 * so the mapping can be reasoned about without a hub running.
 */

import type { Alert, Operator, TaskItem } from "@/lib/types";
import type { AlertKind, Machine, SiteAlert, SiteTask } from "@/lib/api/contracts";
import { SEATBELT_ALERT_ID } from "@/store/machine-store";

/** Which HMI panel an alert belongs under. */
const SYSTEM: Partial<Record<AlertKind, string>> = {
  seatbelt: "Safety",
  proximity: "Safety",
  fatigue: "Operator",
  tip_over: "Stability",
  collision: "Safety",
  maintenance: "Hydraulics",
  weather: "Site",
  anomaly: "Diagnostics",
};

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/**
 * The HMI id for a live alert. The seatbelt alert keeps the fixed id the home
 * screen's banner looks up, so that banner works identically live and offline.
 */
export function hmiAlertId(alert: SiteAlert): string {
  return alert.kind === "seatbelt" ? SEATBELT_ALERT_ID : alert.id;
}

export function toHmiAlert(alert: SiteAlert, machineName: string): Alert {
  const detail = Object.entries(alert.detail)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
  return {
    id: hmiAlertId(alert),
    severity: alert.severity,
    machineId: alert.machineId,
    machineName,
    title: alert.title,
    description: detail ? `${alert.message} ${detail}` : alert.message,
    // The hub attaches the site protocol and puts its first step here, so this
    // is the correct next action rather than a generic prompt.
    recommendedAction: alert.action,
    timestamp: clock(alert.createdAt),
    system: SYSTEM[alert.kind] ?? "Machine",
    acknowledged: alert.acknowledged,
  };
}

const TASK_STATUS: Record<SiteTask["state"], TaskItem["status"]> = {
  done: "completed",
  active: "in-progress",
  queued: "pending",
};

const TASK_PRIORITY: Record<SiteTask["state"], TaskItem["priority"]> = {
  active: "high",
  queued: "medium",
  done: "low",
};

export function toHmiTask(task: SiteTask, assignee: string): TaskItem {
  return {
    id: task.id,
    title: task.title,
    description: task.reasons[0] ?? `${task.zone} · ${task.progress}% done`,
    status: TASK_STATUS[task.state],
    assignee,
    machineId: task.machineId,
    due: task.state === "done" ? "Done" : task.state === "active" ? `ETA ${Math.round(task.etaMinutes)} min` : task.startsAt,
    priority: TASK_PRIORITY[task.state],
  };
}

/** Hours:minutes since the shift started, from a "07:00 – 15:00" style label. */
function sinceShiftStart(shift: string, now: Date): string | null {
  const match = /(\d{1,2}):(\d{2})/.exec(shift);
  if (!match) return null;
  const start = new Date(now);
  start.setHours(Number(match[1]), Number(match[2]), 0, 0);
  const minutes = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 60000));
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * The operator card, from the live machine record.
 *
 * Name, id, shift, task counts and safety status are real. Certifications are
 * not carried by the hub, so they come from the operator's local profile — that
 * is personnel data, not telemetry, and stays in the HMI's own records.
 */
export function toHmiOperator(
  machine: Machine,
  tasks: SiteTask[],
  alerts: SiteAlert[],
  profile: Operator,
  now = new Date(),
): Operator | null {
  const op = machine.operator;
  if (!op) return null;
  const open = alerts.filter((a) => !a.acknowledged && a.resolvedAt === null);
  const safetyStatus: Operator["safetyStatus"] = open.some((a) => a.severity === "critical")
    ? "action"
    : open.length > 0
      ? "review"
      : "good";
  return {
    name: op.name,
    id: op.id,
    shift: op.shift,
    machineId: machine.id,
    operatingTimeToday: sinceShiftStart(op.shift, now) ?? profile.operatingTimeToday,
    tasksCompleted: tasks.filter((t) => t.state === "done").length,
    tasksTotal: tasks.length,
    safetyStatus,
    certifications: profile.certifications,
  };
}
