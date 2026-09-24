/**
 * Turning a job and the state of the site into a task estimate.
 *
 * This is the seam between the model and the product contract: the model takes
 * features and returns minutes, and everything about *which* features — the
 * machine's condition from its service history, how busy the site is right now,
 * what the weather is doing — is decided here, in one place, so the cab and the
 * command centre can never quote different numbers for the same job.
 */

import { healthScore } from "@/lib/data/dataset";
import { predictRemaining, type TaskConditions } from "@/lib/intel";
import type { EstimateDriver, Machine, OperatorRef, SiteTask, Soil, TaskType, WeatherMode } from "./contracts";

/** The job itself, before anything is known about conditions. */
export interface JobSpec {
  id: string;
  machineId: string;
  title: string;
  zone: string;
  taskType: TaskType;
  soil: Soil;
  /** Job size in the task type's own unit: m³, truckloads or m². */
  volume: number;
  state: SiteTask["state"];
  progress: number;
  startsAt: string;
}

/** Everything about the site that moves an estimate. */
export interface SiteConditions {
  weather: WeatherMode;
  temperatureC: number;
  /** Metres. Rain and fog cut this, and the model is fitted on it. */
  visibilityM: number;
  /** 0-1, how much of the fleet is working at once. */
  congestion: number;
  /** Hour of day, 0-23. */
  hour: number;
}

/** The site at rest, used for the server pass so SSR and hydration agree. */
export const RESTING_CONDITIONS: SiteConditions = {
  weather: "clear",
  temperatureC: 34,
  visibilityM: 10_000,
  congestion: 0.3,
  // Fixed rather than "now", or the server and the client would disagree.
  hour: 10,
};

const VISIBILITY: Record<WeatherMode, number> = {
  clear: 10_000,
  heat: 8_000,
  rain: 1_800,
  fog: 300,
};

export const visibilityFor = (weather: WeatherMode): number => VISIBILITY[weather];

/** The simulator's model class for a machine, e.g. "CAT 320" -> "320". */
export function modelCode(machine: { model: string }): string {
  return machine.model.replace(/^CAT\s*/i, "").trim() || "320";
}

/**
 * A machine's condition as a 0-1 feature.
 *
 * Its actual service record is the honest source: the maintenance history has a
 * measured health per subsystem for every machine on this site.
 */
export function machineHealthFraction(machineId: string): number {
  const score = healthScore(machineId);
  return score === null ? 0.8 : score / 100;
}

function conditionsFor(
  job: JobSpec,
  machine: Machine | undefined,
  operator: OperatorRef | null,
  site: SiteConditions,
): TaskConditions {
  return {
    taskType: job.taskType,
    machineModel: machine ? modelCode(machine) : "320",
    operatorSkill: operator?.skill ?? "intermediate",
    soil: job.soil,
    weather: site.weather,
    volumeM3: job.volume,
    operatorYears: operator?.years ?? 5,
    temperatureC: site.temperatureC,
    visibilityM: site.visibilityM,
    siteCongestion: site.congestion,
    timeOfDay: site.hour,
    machineHealth: machine ? machineHealthFraction(machine.id) : 0.8,
  };
}

/** A driver rendered as the short string the compact surfaces show. */
function driverLabel(driver: EstimateDriver): string {
  const sign = driver.impactMin > 0 ? "+" : "−";
  return `${driver.label} ${sign}${Math.abs(driver.impactMin)} min`;
}

/**
 * Estimate one job under the current conditions.
 *
 * `etaMinutes` is what is *left*, which is what an operator wants; `totalMinutes`
 * is the whole job, which is what a planner wants. Both come from one call so
 * they cannot drift apart.
 */
export function estimateTask(
  job: JobSpec,
  machine: Machine | undefined,
  operator: OperatorRef | null,
  site: SiteConditions,
): SiteTask {
  const conditions = conditionsFor(job, machine, operator, site);
  const progress = Math.max(0, Math.min(1, job.progress / 100));
  const remaining = predictRemaining(conditions, progress);
  // The same prediction before the progress scaling, for the planner view.
  const whole = progress > 0 ? remaining.p50 / Math.max(1 - progress, 0.001) : remaining.p50;

  const drivers: EstimateDriver[] = remaining.reasons.map((r) => ({
    feature: r.feature,
    label: r.label,
    impactMin: r.impactMin,
  }));

  return {
    id: job.id,
    machineId: job.machineId,
    title: job.title,
    zone: job.zone,
    state: job.state,
    progress: job.progress,
    etaMinutes: Math.round(remaining.p50),
    etaRange: [Math.round(remaining.p10), Math.round(remaining.p90)],
    startsAt: job.startsAt,
    reasons: drivers.map(driverLabel),
    taskType: job.taskType,
    soil: job.soil,
    volume: job.volume,
    totalMinutes: Math.round(whole),
    plannerMinutes: Math.round(remaining.plannerMin),
    drivers,
  };
}

/** How busy the site is, as the model's congestion feature. */
export function congestionFrom(machines: Machine[]): number {
  const onSite = machines.filter((m) => m.status !== "offline");
  if (!onSite.length) return 0.3;
  const working = onSite.filter((m) => m.status !== "idle" && m.status !== "maintenance");
  return Math.round((working.length / onSite.length) * 100) / 100;
}
