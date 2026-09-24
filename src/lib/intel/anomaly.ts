/**
 * Unusual machine usage, running in the browser.
 *
 * Two layers, mirroring `intelligence/anomaly.py`:
 *
 *  1. Deterministic rules for the patterns the brief names outright — excessive
 *     idling, seatbelt violations, overload, harsh operation, overheating. The
 *     thresholds are the ones in the brief, exported rather than retyped.
 *  2. What the rules miss, caught by distance from what this specific machine
 *     normally does. The Isolation Forest itself cannot run here, but the
 *     per-machine baselines it was fitted alongside are means and standard
 *     deviations, so this layer scores z-distance against them. Same inputs,
 *     same features, a blunter decision boundary.
 *
 * "Cycles near zero" is deliberately relative: a 745 truck does ~21 loads an
 * hour where a 320 excavator does ~150 cycles, so any absolute floor either
 * flags every truck or misses every excavator.
 */

import { intel, specFor, dieselCostInr } from "./model";

const T = intel.anomaly.thresholds;
const BASELINES = intel.anomaly.baselines;

export type AnomalyType =
  | "excessive_idling"
  | "seatbelt_violation"
  | "overload"
  | "harsh_operation"
  | "temperature_anomaly"
  | "low_productivity"
  | "unusual_pattern";

/** One sample of live machine state, with counters as the machine reports them. */
export interface TelemetrySample {
  t: number;
  /** Cumulative minutes idled this shift. */
  idleMin: number;
  /** Cumulative load cycles this shift. */
  loadCycles: number;
  /** Cumulative litres burnt this shift. */
  fuelUsedL: number;
  payloadKg: number;
  hydraulicTemperatureC: number;
  seatbeltOff: boolean;
  harshSwing?: boolean;
}

export interface WindowFeatures {
  idleRatio: number;
  fuelPerCycle: number;
  cyclesPerHour: number;
  meanPayload: number;
  peakPayload: number;
  harshSwingRate: number;
  meanHydraulicTemp: number;
  peakHydraulicTemp: number;
  seatbeltOffRatio: number;
  /* carried for evidence, not scored */
  idleMinutes: number;
  cycles: number;
  seatbeltOffMinutes: number;
  fuelL: number;
  minutes: number;
}

export interface AnomalyFinding {
  machineId: string;
  type: AnomalyType;
  related: AnomalyType[];
  /** 0-1, 1 being most unusual. */
  score: number;
  detectedBy: "rules" | "baseline_deviation";
  /** e.g. "idle 63 min against a 24 min norm". */
  deviation: string;
  evidence: {
    idleMinutes: number;
    cycles: number;
    seatbeltOffMinutes: number;
    meanPayloadKg: number;
    peakPayloadKg: number;
    peakHydraulicTempC: number;
    baselineIdleMinutes: number;
  };
  fuelWastedL: number;
  fuelCostInr: number;
  features: WindowFeatures;
}

/** The features the baselines are keyed by, in the fitted order. */
const SCORED: (keyof WindowFeatures)[] = [
  "idleRatio",
  "fuelPerCycle",
  "cyclesPerHour",
  "meanPayload",
  "peakPayload",
  "harshSwingRate",
  "meanHydraulicTemp",
  "peakHydraulicTemp",
  "seatbeltOffRatio",
];

/** The baselines came out of Python under their snake_case names. */
const BASELINE_KEY: Record<string, string> = {
  idleRatio: "idle_ratio",
  fuelPerCycle: "fuel_per_cycle",
  cyclesPerHour: "cycles_per_hour",
  meanPayload: "mean_payload",
  peakPayload: "peak_payload",
  harshSwingRate: "harsh_swing_rate",
  meanHydraulicTemp: "mean_hydraulic_temp",
  peakHydraulicTemp: "peak_hydraulic_temp",
  seatbeltOffRatio: "seatbelt_off_ratio",
};

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

const mean = (values: number[]): number =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

/**
 * Collapse a run of live samples into the model's features.
 *
 * Counters are cumulative, so they are differenced across the window first —
 * the same thing `score_live_window` does on the Python side.
 */
export function windowFeatures(samples: TelemetrySample[]): WindowFeatures {
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const minutes = Math.max(Math.max(last.t - first.t, 1000) / 60000, 1 / 60);

  const idleMinutes = Math.max(0, last.idleMin - first.idleMin);
  const cycles = Math.max(0, last.loadCycles - first.loadCycles);
  const fuelL = Math.max(0, last.fuelUsedL - first.fuelUsedL);
  const beltOffSamples = samples.filter((s) => s.seatbeltOff).length;
  const harsh = samples.filter((s) => s.harshSwing).length;

  const payloads = samples.map((s) => s.payloadKg);
  const temps = samples.map((s) => s.hydraulicTemperatureC);

  return {
    idleRatio: Math.min(idleMinutes / minutes, 1),
    // With no cycles at all, fuel burnt is pure waste; the x10 keeps that
    // visible to the scorer instead of dividing by zero.
    fuelPerCycle: cycles > 0 ? fuelL / cycles : fuelL * 10,
    cyclesPerHour: (cycles / minutes) * 60,
    meanPayload: mean(payloads),
    // 90th percentile rather than the outright max, so one bad sample is not an
    // overload but a sustained excursion is.
    peakPayload: quantile(payloads, 0.9),
    harshSwingRate: harsh / samples.length,
    meanHydraulicTemp: mean(temps),
    peakHydraulicTemp: quantile(temps, 0.9),
    seatbeltOffRatio: beltOffSamples / samples.length,
    idleMinutes,
    cycles,
    seatbeltOffMinutes: (beltOffSamples / samples.length) * minutes,
    fuelL,
    minutes,
  };
}

/** Which named patterns fired in this window. */
function firedRules(
  f: WindowFeatures,
  maxPayloadKg: number,
  baseline: Record<string, { mean: number; std: number }>,
): AnomalyType[] {
  const harshBaseline = baseline.harsh_swing_rate?.mean ?? 0.06;
  const normalCph = baseline.cycles_per_hour?.mean;
  const productivityFloor = normalCph
    ? normalCph * T.productivityLowRatio
    : T.cyclesPerHourFallback;

  const fired: AnomalyType[] = [];
  // Idling most of the window *and* producing well below this machine's norm.
  // Either alone is a lunch break or a slow patch; together it is waste.
  if (f.idleRatio > T.idleRatioHigh && f.cyclesPerHour < productivityFloor) {
    fired.push("excessive_idling");
  }
  if (f.seatbeltOffRatio > T.seatbeltOffRatio) fired.push("seatbelt_violation");
  if (maxPayloadKg && f.peakPayload > maxPayloadKg * T.overloadRatio) fired.push("overload");
  if (harshBaseline > 0 && f.harshSwingRate > harshBaseline * T.harshMultiplier) {
    fired.push("harsh_operation");
  }
  if (f.peakHydraulicTemp > T.tempHighC) fired.push("temperature_anomaly");
  return fired;
}

/**
 * How each rule states its own case.
 *
 * The deviation layer describes a finding by naming the feature furthest from
 * normal. A rule needs no baseline to say what it saw, and saying it from the
 * rule's own numbers keeps the sentence true when the baselines are not in play.
 */
const RULE_DEVIATION: Record<AnomalyType, (f: WindowFeatures) => string> = {
  excessive_idling: (f) =>
    `idle ${f.idleMinutes.toFixed(0)} of ${f.minutes.toFixed(0)} minutes with ${f.cycles} load cycles`,
  seatbelt_violation: (f) =>
    `belt unfastened for ${(f.seatbeltOffRatio * 100).toFixed(0)}% of the window`,
  overload: (f) => `payload peaked at ${Math.round(f.peakPayload).toLocaleString()} kg`,
  harsh_operation: (f) => `harsh swings on ${(f.harshSwingRate * 100).toFixed(0)}% of samples`,
  temperature_anomaly: (f) => `hydraulics peaked at ${f.peakHydraulicTemp.toFixed(0)} °C`,
  low_productivity: (f) => `${f.cyclesPerHour.toFixed(0)} cycles/h`,
  unusual_pattern: () => "outside this machine's normal range",
};

const DEVIATION_TYPE: Record<string, AnomalyType> = {
  idleRatio: "excessive_idling",
  seatbeltOffRatio: "seatbelt_violation",
  meanPayload: "overload",
  peakPayload: "overload",
  harshSwingRate: "harsh_operation",
  meanHydraulicTemp: "temperature_anomaly",
  peakHydraulicTemp: "temperature_anomaly",
  fuelPerCycle: "low_productivity",
  cyclesPerHour: "low_productivity",
};

/**
 * How far out of its normal range one feature is.
 *
 * The standard deviation is floored against the mean before dividing. Some
 * baselines are degenerate — a machine whose payload never varies has a std of
 * 1e-6 — and dividing by that turns a rounding difference into a z-score of
 * thousands. The floor is what keeps the second layer from crying wolf every
 * time one feature happens to be constant in the history.
 */
function zScore(value: number, stat: { mean: number; std: number }): number {
  const spread = Math.max(stat.std, Math.abs(stat.mean) * 0.05, 1e-3);
  return Math.abs((value - stat.mean) / spread);
}

/** Per-feature distances from this machine's normal, worst first. */
function deviations(
  f: WindowFeatures,
  baseline: Record<string, { mean: number; std: number }>,
): { feature: keyof WindowFeatures; z: number }[] {
  const out: { feature: keyof WindowFeatures; z: number }[] = [];
  for (const key of SCORED) {
    const stat = baseline[BASELINE_KEY[key]!];
    if (!stat) continue;
    out.push({ feature: key, z: zScore(f[key], stat) });
  }
  return out.sort((a, b) => b.z - a.z);
}

/** Diesel burnt while producing nothing — the number the owner screen cares about. */
function fuelWastedL(f: WindowFeatures, model: string): number {
  const idleRate = specFor(model)?.idleFuelLph ?? 4;
  return Math.round((f.idleMinutes / 60) * idleRate * 10) / 10;
}

function readable(
  feature: keyof WindowFeatures,
  f: WindowFeatures,
  stat: { mean: number },
): string {
  switch (feature) {
    case "idleRatio":
      return `idle ${f.idleMinutes.toFixed(0)} min against a ${(stat.mean * f.minutes).toFixed(0)} min norm`;
    case "seatbeltOffRatio":
      return `belt unfastened ${(f.seatbeltOffRatio * 100).toFixed(0)}% of the window`;
    case "cyclesPerHour":
      return `${f.cyclesPerHour.toFixed(0)} cycles/h against ${stat.mean.toFixed(0)} normally`;
    case "peakPayload":
    case "meanPayload":
      return `payload peaked at ${Math.round(f.peakPayload).toLocaleString()} kg`;
    case "peakHydraulicTemp":
    case "meanHydraulicTemp":
      return `hydraulics peaked at ${f.peakHydraulicTemp.toFixed(0)} °C`;
    case "harshSwingRate":
      return `harsh swings on ${(f.harshSwingRate * 100).toFixed(0)}% of samples`;
    case "fuelPerCycle":
      return `${f.fuelPerCycle.toFixed(1)} L per cycle against ${stat.mean.toFixed(1)} normally`;
    default:
      return "outside this machine's normal range";
  }
}

/**
 * Totals for a window that was aggregated elsewhere — a day of history, or the
 * two-hour rows the brief supplies — turned into the same features live samples
 * produce, so both go through one scorer.
 */
export function featuresFromTotals(totals: {
  minutes: number;
  idleMinutes: number;
  cycles: number;
  fuelL: number;
  seatbeltOffMinutes: number;
  meanPayload?: number;
  peakPayload?: number;
  meanHydraulicTemp?: number;
  peakHydraulicTemp?: number;
  harshSwingRate?: number;
}): WindowFeatures {
  const minutes = Math.max(totals.minutes, 1);
  return {
    idleRatio: Math.min(totals.idleMinutes / minutes, 1),
    fuelPerCycle: totals.cycles > 0 ? totals.fuelL / totals.cycles : totals.fuelL * 10,
    cyclesPerHour: (totals.cycles / minutes) * 60,
    meanPayload: totals.meanPayload ?? 0,
    peakPayload: totals.peakPayload ?? totals.meanPayload ?? 0,
    harshSwingRate: totals.harshSwingRate ?? 0,
    meanHydraulicTemp: totals.meanHydraulicTemp ?? 0,
    peakHydraulicTemp: totals.peakHydraulicTemp ?? totals.meanHydraulicTemp ?? 0,
    seatbeltOffRatio: Math.min(totals.seatbeltOffMinutes / minutes, 1),
    idleMinutes: totals.idleMinutes,
    cycles: totals.cycles,
    seatbeltOffMinutes: totals.seatbeltOffMinutes,
    fuelL: totals.fuelL,
    minutes,
  };
}

/**
 * Score one machine's recent window. Returns null when nothing is unusual —
 * which is most of the time, and is the point.
 */
export interface ScoreOptions {
  /**
   * Whether to run the second layer at all.
   *
   * The baselines describe the *historical* telemetry — what a machine's own
   * per-minute record looked like over thirty days. Scoring a live window
   * against them only works if the live feed is on the same scale, and the
   * simulated site is not: its payloads and cycle rates come from machine specs
   * rather than from the generated history, so a z-distance between the two
   * measures the gap between two data sources rather than anything about the
   * machine. So history gets both layers, and the live shift gets the rules —
   * which are absolute thresholds and need no baseline to be meaningful.
   */
  useBaselines?: boolean;
  /**
   * How much of the window has to be there before anything can fire.
   *
   * Without this a machine flagged as idling has been watched for four seconds,
   * and the evidence line reads "idle 0 of 0 minutes". The Python side refuses
   * to score a window less than half full for the same reason.
   */
  minSamples?: number;
}

export function scoreWindow(
  machineId: string,
  machineModel: string,
  samples: TelemetrySample[],
  options: ScoreOptions = {},
): AnomalyFinding | null {
  if (samples.length < (options.minSamples ?? 10)) return null;
  return scoreFeatures(machineId, machineModel, windowFeatures(samples), options);
}

/** The scorer itself, once the window is features either way. */
export function scoreFeatures(
  machineId: string,
  machineModel: string,
  f: WindowFeatures,
  options: ScoreOptions = {},
): AnomalyFinding | null {
  const useBaselines = options.useBaselines ?? true;
  const baseline = BASELINES[machineId] ?? {};
  const spec = specFor(machineModel);
  const fired = firedRules(f, spec?.maxPayloadKg ?? 0, useBaselines ? baseline : {});

  const ranked = useBaselines ? deviations(f, baseline) : [];
  const feature = ranked[0]?.feature ?? null;

  // The mean of the three worst features, not the single worst. An unusual
  // shift shows up across several of them at once; one feature alone drifting
  // is how the forest's false positives looked, and averaging suppresses them.
  const top = ranked.slice(0, 3);
  const z = top.length ? top.reduce((sum, d) => sum + d.z, 0) / top.length : 0;
  // Six deviations is full scale, putting the 0.55 cut-off a little over three.
  const deviationScore = Math.min(1, z / 6);
  if (!fired.length && (!useBaselines || deviationScore < 0.55)) return null;

  // Co-occurrence is the strong signal — the brief's own flagged rows are the
  // ones where idling and an unfastened belt happen together.
  const ruleScore = fired.length ? Math.min(0.95, 0.75 + (fired.length - 1) * 0.1) : 0;
  const score = Math.max(ruleScore, deviationScore);

  const primary: AnomalyType =
    fired[0] ?? (feature ? (DEVIATION_TYPE[feature] ?? "unusual_pattern") : "unusual_pattern");

  const related = [...new Set(fired.slice(1))].filter((r) => r !== primary);
  const normalCph = useBaselines ? baseline.cycles_per_hour?.mean : undefined;
  if (
    normalCph &&
    f.cyclesPerHour < normalCph * T.productivityLowRatio &&
    primary !== "low_productivity"
  ) {
    related.push("low_productivity");
  }

  const wasted = fuelWastedL(f, machineModel);
  const stat = feature ? baseline[BASELINE_KEY[feature]!] : undefined;
  // A rule states its own case; only a deviation finding needs the baseline to
  // explain itself.
  const deviation = fired.length
    ? RULE_DEVIATION[primary](f)
    : feature && stat
      ? readable(feature, f, stat)
      : "outside this machine's normal range";

  return {
    machineId,
    type: primary,
    related,
    score: Math.round(score * 100) / 100,
    detectedBy: fired.length ? "rules" : "baseline_deviation",
    deviation,
    evidence: {
      idleMinutes: Math.round(f.idleMinutes * 10) / 10,
      cycles: f.cycles,
      seatbeltOffMinutes: Math.round(f.seatbeltOffMinutes * 10) / 10,
      meanPayloadKg: Math.round(f.meanPayload),
      peakPayloadKg: Math.round(f.peakPayload),
      peakHydraulicTempC: Math.round(f.peakHydraulicTemp * 10) / 10,
      baselineIdleMinutes: Math.round((baseline.idle_ratio?.mean ?? 0.2) * f.minutes * 10) / 10,
    },
    fuelWastedL: wasted,
    fuelCostInr: Math.round(dieselCostInr(wasted)),
    features: f,
  };
}

export const ANOMALY_LABEL: Record<AnomalyType, string> = {
  excessive_idling: "Excessive idling",
  seatbelt_violation: "Seatbelt violation",
  overload: "Overload",
  harsh_operation: "Harsh operation",
  temperature_anomaly: "Temperature anomaly",
  low_productivity: "Low productivity",
  unusual_pattern: "Unusual pattern",
};

export const anomalyMetrics = intel.anomaly.metrics;
