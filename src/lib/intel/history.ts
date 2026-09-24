/**
 * The detectors, run over the 30-day record rather than the live shift.
 *
 * The anomaly screen used to show a handful of hand-written findings. These are
 * the same rules and the same per-machine baselines the live detector uses,
 * applied to every machine-day in the generated dataset — so what the screen
 * lists is something the model actually found, and it changes when the data
 * changes.
 *
 * Scoring 300 machine-days takes a few milliseconds, but nothing about the
 * history moves, so the result is computed once and cached.
 */

import { dataset, getMachine, type TelemetryRollup } from "@/lib/data/dataset";
import { scoreFeatures, featuresFromTotals, type AnomalyFinding } from "./anomaly";

export interface HistoricalAnomaly extends AnomalyFinding {
  /** ISO date of the machine-day this was found in. */
  date: string;
}

/** The simulator's model code for a machine, which the specs are keyed by. */
function modelCode(machineId: string): string {
  const model = getMachine(machineId)?.model ?? "";
  // Dataset models read "CAT 320"; the specs are keyed by the bare class.
  return model.replace(/^CAT\s*/i, "").trim() || "320";
}

/** A day of rolled-up telemetry, as the detector's features. */
function featuresForDay(day: TelemetryRollup) {
  return featuresFromTotals({
    // Rows are per-minute, so the sample count is the window length.
    minutes: day.samples,
    idleMinutes: day.idleMin,
    cycles: day.loadCycles,
    fuelL: day.fuelL,
    seatbeltOffMinutes: day.seatbeltViolations,
    meanPayload: day.avgPayloadKg,
    peakPayload: day.maxPayloadKg,
    meanHydraulicTemp: day.avgHydraulicC,
    // The rollup keeps no peak temperature, so the mean stands in. That makes
    // the temperature rule conservative here: a short excursion inside an
    // otherwise normal day will not fire, where the live detector would catch
    // it. Better to under-report on history than to invent a peak.
    peakHydraulicTemp: day.avgHydraulicC,
    harshSwingRate: day.samples ? day.harshSwings / day.samples : 0,
  });
}

let cache: HistoricalAnomaly[] | null = null;

/** Every anomaly the detectors find in the historical record, worst first. */
export function historicalAnomalies(): HistoricalAnomaly[] {
  if (cache) return cache;

  const found: HistoricalAnomaly[] = [];
  for (const day of dataset.telemetry.perDay) {
    if (!day.date || day.samples < 60) continue;
    const finding = scoreFeatures(day.machineId, modelCode(day.machineId), featuresForDay(day));
    if (finding) found.push({ ...finding, date: day.date });
  }

  found.sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
  cache = found;
  return cache;
}

export function historicalAnomaliesFor(machineId: string): HistoricalAnomaly[] {
  return historicalAnomalies().filter((a) => a.machineId === machineId);
}

/** How the detector's own output breaks down, for the summary tiles. */
export function anomalySummary() {
  const all = historicalAnomalies();
  const byPattern = new Map<string, number>();
  for (const a of all) byPattern.set(a.type, (byPattern.get(a.type) ?? 0) + 1);

  return {
    total: all.length,
    machineDays: dataset.telemetry.perDay.filter((d) => d.date && d.samples >= 60).length,
    byRules: all.filter((a) => a.detectedBy === "rules").length,
    byDeviation: all.filter((a) => a.detectedBy === "baseline_deviation").length,
    fuelWastedL: Math.round(all.reduce((sum, a) => sum + a.fuelWastedL, 0)),
    costInr: Math.round(all.reduce((sum, a) => sum + a.fuelCostInr, 0)),
    byPattern: [...byPattern.entries()]
      .map(([pattern, count]) => ({ pattern, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/* ------------------------------ task history ---------------------------- */

/**
 * How the planner's estimates actually landed for one kind of job.
 *
 * This is what makes "the planner runs 28% light" a statement about this site
 * rather than a claim in a slide.
 */
export function taskHistoryFor(taskType: string) {
  const row = dataset.tasks.byType.find((t) => t.key === taskType);
  if (!row) return null;
  return {
    taskType,
    jobs: row.count,
    avgPlannedMin: row.avgEstimatedMin,
    avgActualMin: row.avgActualMin,
    /** >1 means jobs of this type habitually run over. */
    overrunRatio: row.overrunRatio,
  };
}
