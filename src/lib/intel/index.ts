/**
 * The intelligence layer: the two models from `intelligence/`, running where
 * the screens are.
 *
 * Nothing here fits anything. `scripts/export_intel.py` does the fitting and
 * writes the coefficients and baselines; this evaluates them.
 */

export { intel, specFor, dieselCostInr, type MachineSpec } from "./model";
export {
  predictTaskTime,
  predictRemaining,
  plannerEstimateMin,
  taskTimeMetrics,
  type TaskConditions,
  type TaskEstimate,
  type EstimateReason,
} from "./task-time";
export {
  scoreWindow,
  scoreFeatures,
  windowFeatures,
  featuresFromTotals,
  anomalyMetrics,
  ANOMALY_LABEL,
  type AnomalyFinding,
  type AnomalyType,
  type TelemetrySample,
  type WindowFeatures,
} from "./anomaly";
export {
  historicalAnomalies,
  historicalAnomaliesFor,
  anomalySummary,
  taskHistoryFor,
  type HistoricalAnomaly,
} from "./history";
