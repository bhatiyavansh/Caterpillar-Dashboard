/**
 * Task-time prediction, running in the browser.
 *
 * The site planner's own arithmetic — volume divided by a base production rate
 * — is wrong by about 28% on the historical record, because it takes no account
 * of ground, weather, who is in the seat or what condition the machine is in.
 * This corrects it:
 *
 *     actual = planner_estimate x exp(b0 + sum(coefficients . features))
 *
 * The coefficients were fitted by `scripts/export_intel.py` on the same 30-day
 * history and the same held-out split that LightGBM trains on, and land at
 * 9.7% MAPE — the same place the boosted model does, with arithmetic simple
 * enough to run on every tick with no backend.
 *
 * Every term is also reported back in minutes, so the interface can say *why*
 * it expects the job to run long rather than just quoting a number.
 */

import {
  intel,
  type MachineModel,
  type OperatorSkill,
  type Soil,
  type TaskType,
  type Weather,
} from "./model";

const M = intel.taskTime;

export interface TaskConditions {
  taskType: TaskType;
  machineModel: MachineModel | string;
  operatorSkill: OperatorSkill;
  soil: Soil;
  weather: Weather;
  /** Job size in the task type's own unit: m³, truckloads or m². */
  volumeM3: number;
  operatorYears: number;
  temperatureC: number;
  visibilityM: number;
  /** 0-1: how much of the fleet is working the same corner of the site. */
  siteCongestion: number;
  /** Hour of day the job starts, 0-23. */
  timeOfDay: number;
  /** 0-1 condition score for the machine doing the work. */
  machineHealth: number;
}

/** One term of the prediction, in minutes, for the "why" list. */
export interface EstimateReason {
  feature: string;
  label: string;
  impactMin: number;
}

export interface TaskEstimate {
  p10: number;
  p50: number;
  p90: number;
  /** What the site office would have written down, for comparison. */
  plannerMin: number;
  reasons: EstimateReason[];
  model: "ridge_correction";
}

/* ------------------------------- planner ------------------------------- */

function baseRate(taskType: string, model: string): number {
  return M.baseRate[`${taskType}|${model}`] ?? M.defaultBaseRate;
}

/** The naive estimate the correction is applied to. */
export function plannerEstimateMin(taskType: string, model: string, volume: number): number {
  return (volume / baseRate(taskType, model)) * 60;
}

/* ------------------------------- labels -------------------------------- */

const VALUE_LABEL: Record<string, Record<string, string>> = {
  weather: { clear: "Clear weather", rain: "Rain", fog: "Fog", heat: "Extreme heat", wind: "High wind" },
  soil: { sand: "Sandy ground", mixed: "Mixed ground", clay: "Clay", rock: "Rock" },
  operator_skill: {
    novice: "Novice operator",
    intermediate: "Intermediate operator",
    expert: "Expert operator",
  },
  task_type: {
    trenching: "Trenching",
    loading: "Loading",
    grading: "Grading",
    dozing: "Dozing",
    hauling: "Hauling",
  },
  machine_model: { "320": "CAT 320", "950": "CAT 950", D6: "CAT D6", "745": "CAT 745", "140": "CAT 140" },
};

function numericLabel(feature: string, value: number): string {
  switch (feature) {
    case "site_congestion":
      return value > 0.5 ? "Busy site" : value < 0.2 ? "Quiet site" : "Normal site traffic";
    case "machine_health":
      return value < 0.6 ? "Machine needs service" : "Machine in good condition";
    case "volume_m3":
      return `Job size ${Math.round(value).toLocaleString()}`;
    case "visibility_m":
      return `Visibility ${Math.round(value).toLocaleString()} m`;
    case "temperature_c":
      return `${Math.round(value)} °C`;
    case "operator_years":
      return `${Math.round(value)} years experience`;
    case "time_of_day":
      return `${String(Math.round(value)).padStart(2, "0")}:00 start`;
    default:
      return `${feature} ${value}`;
  }
}

/* ----------------------------- prediction ------------------------------ */

const NUMERIC_VALUE: Record<string, (c: TaskConditions) => number> = {
  volume_m3: (c) => c.volumeM3,
  operator_years: (c) => c.operatorYears,
  temperature_c: (c) => c.temperatureC,
  visibility_m: (c) => c.visibilityM,
  site_congestion: (c) => c.siteCongestion,
  time_of_day: (c) => c.timeOfDay,
  machine_health: (c) => c.machineHealth,
};

const CATEGORY_VALUE: Record<string, (c: TaskConditions) => string> = {
  task_type: (c) => c.taskType,
  machine_model: (c) => String(c.machineModel),
  operator_skill: (c) => c.operatorSkill,
  soil: (c) => c.soil,
  weather: (c) => c.weather,
};

/**
 * Predict how long a whole task will take, with the band the model's own
 * held-out residuals justify and the terms that moved the number.
 */
export function predictTaskTime(conditions: TaskConditions): TaskEstimate {
  const planner = plannerEstimateMin(
    conditions.taskType,
    String(conditions.machineModel),
    conditions.volumeM3,
  );

  // Each term contributes in log space; converting to minutes afterwards is
  // what makes "Rain +14 min" a true statement about this job rather than a
  // generic weather penalty.
  const terms: { feature: string; label: string; logImpact: number }[] = [];

  for (const [feature, levels] of Object.entries(M.categorical)) {
    const value = CATEGORY_VALUE[feature]?.(conditions);
    if (value === undefined) continue;
    // The first level is the reference category and carries no coefficient.
    if (!levels.slice(1).includes(value)) continue;
    const coef = M.coefficients[`${feature}=${value}`];
    if (coef === undefined) continue;
    terms.push({
      feature,
      label: VALUE_LABEL[feature]?.[value] ?? value,
      logImpact: coef,
    });
  }

  for (const feature of M.numeric) {
    const read = NUMERIC_VALUE[feature];
    const coef = M.coefficients[feature];
    if (!read || coef === undefined) continue;
    const value = read(conditions);
    const centred = (value - (M.centres[feature] ?? 0)) / (M.scales[feature] || 1);
    terms.push({ feature, label: numericLabel(feature, value), logImpact: coef * centred });
  }

  const totalLog = M.intercept + terms.reduce((sum, t) => sum + t.logImpact, 0);
  const p50 = planner * Math.exp(totalLog);

  const reasons: EstimateReason[] = terms
    .map((t) => ({
      feature: t.feature,
      label: t.label,
      // The share of the final duration this term is responsible for.
      impactMin: Math.round(p50 * (1 - Math.exp(-t.logImpact))),
    }))
    .filter((r) => Math.abs(r.impactMin) >= 1)
    .sort((a, b) => Math.abs(b.impactMin) - Math.abs(a.impactMin))
    .slice(0, 4);

  return {
    p10: round1(p50 * Math.exp(M.residualQuantiles.p10)),
    p50: round1(p50),
    p90: round1(p50 * Math.exp(M.residualQuantiles.p90)),
    plannerMin: round1(planner),
    reasons,
    model: "ridge_correction",
  };
}

/** The same prediction scaled by how much of the job is left to do. */
export function predictRemaining(conditions: TaskConditions, progress: number): TaskEstimate {
  const full = predictTaskTime(conditions);
  const left = Math.max(0, Math.min(1, 1 - progress));
  return {
    ...full,
    p10: round1(full.p10 * left),
    p50: round1(full.p50 * left),
    p90: round1(full.p90 * left),
  };
}

/** Held-out accuracy, for the screens that state how good the estimate is. */
export const taskTimeMetrics = M.metrics;

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
