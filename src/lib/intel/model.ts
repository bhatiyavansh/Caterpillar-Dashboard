/**
 * Typed access to the exported intelligence layer.
 *
 * `scripts/export_intel.py` fits the model and writes `intel.json`; nothing in
 * the browser re-fits anything. Keeping the shape in one place means the two
 * estimators below can't disagree about what they were handed.
 */

import raw from "@/data/generated/intel.json";

export type TaskType = "trenching" | "loading" | "grading" | "dozing" | "hauling";
export type MachineModel = "320" | "950" | "D6" | "745" | "140";
export type OperatorSkill = "novice" | "intermediate" | "expert";
export type Soil = "sand" | "mixed" | "clay" | "rock";
export type Weather = "clear" | "heat" | "wind" | "rain" | "fog";

/** One machine model's physical limits, straight from the simulator's specs. */
export interface MachineSpec {
  machineType: string;
  maxPayloadKg: number;
  workingFuelLph: number;
  idleFuelLph: number;
  tankL: number;
  bucketM3: number;
  cycleS: number;
}

export interface Stat {
  mean: number;
  std: number;
}

export interface IntelPayload {
  meta: { generatedAt: string; seed: number; rowsTrain: number; rowsTest: number };
  taskTime: {
    intercept: number;
    /** Keyed `feature=level` for categoricals, bare feature name for numerics. */
    coefficients: Record<string, number>;
    centres: Record<string, number>;
    scales: Record<string, number>;
    categorical: Record<string, string[]>;
    numeric: string[];
    residualQuantiles: { p10: number; p90: number };
    /** Keyed `taskType|model`. */
    baseRate: Record<string, number>;
    defaultBaseRate: number;
    plannerFactors: {
      weather: Record<string, number>;
      soil: Record<string, number>;
      skill: Record<string, number>;
    };
    metrics: {
      ridgeMapePct: number;
      plannerMapePct: number;
      coveragePct: number;
      lightgbmMapePct: number;
      lightgbmCoveragePct: number;
    };
  };
  anomaly: {
    windowMin: number;
    thresholds: {
      idleRatioHigh: number;
      productivityLowRatio: number;
      cyclesPerHourFallback: number;
      overloadRatio: number;
      harshMultiplier: number;
      tempHighC: number;
      seatbeltOffRatio: number;
    };
    /** Per machine, per feature: what normal looked like over the 30 days. */
    baselines: Record<string, Record<string, Stat>>;
    metrics: {
      windows: number;
      machines: number;
      injectedRecallPct?: number;
      injected_recall_pct?: number;
      brief_sample?: { rows: number; expected_alerts: number; detected: number; false_alarms: number };
    };
  };
  specs: Record<string, MachineSpec>;
  dieselPriceInr: number;
}

export const intel = raw as unknown as IntelPayload;

export const specFor = (model: string): MachineSpec | undefined => intel.specs[model];

/** Litres of diesel, priced with the same figure the history was costed at. */
export const dieselCostInr = (litres: number): number => litres * intel.dieselPriceInr;
