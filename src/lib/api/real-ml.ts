/**
 * Fetches and maps the backend's real ML output into the product's own
 * contracts.
 *
 * Every function here is fail-soft by construction: a network error, a 503
 * (the backend hasn't warmed yet, or the LLM provider is overloaded), or a
 * malformed response resolves to `null` rather than throwing, so a caller
 * always has a trivial "keep the existing value" fallback. Nothing here
 * invents a number the response did not actually carry — a field with no
 * real-data equivalent is simply left off the returned partial, so the
 * caller's existing baseline value survives untouched.
 */
import type { Anomaly, AnomalyPattern, AlertSeverity, MaintenanceItem, OwnerKpis, OwnerSeries, SeriesPoint } from "./contracts";

const TIMEOUT_MS = 12_000;
/** The weekly report's own LLM narrative step can be slow on a cold cache or an overloaded provider. */
const REPORT_TIMEOUT_MS = 40_000;

async function getJson<T>(url: string, timeoutMs = TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------- anomalies */

interface RawAnomaly {
  anomaly_id: string;
  machine_id: string;
  type: string;
  related: string[];
  score: number;
  detected_by: "rules" | "isolation_forest";
  window: { start: string; end: string };
  evidence: Record<string, number>;
  fuel_wasted_l: number;
  fuel_cost_inr: number;
}

function humanize(snake: string): string {
  return snake.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function anomalySeverity(a: RawAnomaly): AlertSeverity {
  if (a.detected_by === "rules" && a.score >= 0.8) return "critical";
  if (a.score >= 0.85) return "critical";
  if (a.score >= 0.6) return "warning";
  return "info";
}

function anomalyDeviation(a: RawAnomaly): string {
  const { idle_min, baseline_idle_min } = a.evidence;
  if (idle_min !== undefined && baseline_idle_min) {
    return `${Math.round(((idle_min - baseline_idle_min) / baseline_idle_min) * 100)}% vs baseline`;
  }
  return a.detected_by === "isolation_forest" ? `Isolation Forest score ${a.score.toFixed(2)}` : "Rule triggered";
}

/** A one-sentence, deterministic explanation from the evidence — no LLM call per row. */
function anomalyExplanation(a: RawAnomaly): string {
  const ev = a.evidence;
  const parts: string[] = [`${a.machine_id}: ${humanize(a.type).toLowerCase()}`];
  if (ev.idle_min !== undefined) parts.push(`idle ${ev.idle_min} min against a ${ev.baseline_idle_min ?? "?"} min baseline`);
  if (ev.seatbelt_off_min) parts.push(`seatbelt open ${ev.seatbelt_off_min} min`);
  if (ev.peak_hydraulic_temp_c !== undefined) parts.push(`hydraulic peaked at ${ev.peak_hydraulic_temp_c}°C`);
  if (ev.peak_payload_kg !== undefined && a.type === "overload") parts.push(`peak payload ${Math.round(ev.peak_payload_kg)} kg`);
  if (a.related.length) parts.push(`also flagged: ${a.related.map(humanize).join(", ").toLowerCase()}`);
  return parts.join(", ") + ".";
}

function mapAnomaly(a: RawAnomaly): Anomaly {
  return {
    id: a.anomaly_id,
    machineId: a.machine_id,
    title: humanize(a.type),
    explanation: anomalyExplanation(a),
    deviation: anomalyDeviation(a),
    costInr: a.fuel_cost_inr,
    detectedAt: Date.parse(a.window.end) || Date.now(),
    severity: anomalySeverity(a),
    pattern: toPattern(a.type),
    related: a.related.map(toPattern),
    score: a.score,
    detectedBy: a.detected_by === "rules" ? "rules" : "baseline_deviation",
    evidence: Object.fromEntries(Object.entries(a.evidence).map(([k, v]) => [k, String(v)])),
    fuelWastedL: a.fuel_wasted_l,
  };
}

const PATTERNS: readonly AnomalyPattern[] = [
  "excessive_idling",
  "seatbelt_violation",
  "overload",
  "harsh_operation",
  "temperature_anomaly",
  "low_productivity",
];

/** The backend's anomaly types, narrowed to the patterns the screens know. */
function toPattern(type: string): AnomalyPattern {
  return (PATTERNS as readonly string[]).includes(type) ? (type as AnomalyPattern) : "unusual_pattern";
}

export async function fetchRealAnomalies(apiBase: string, sinceHours = 24 * 7): Promise<Anomaly[] | null> {
  const res = await getJson<{ data: { anomalies: RawAnomaly[] } }>(
    `${apiBase}/api/anomalies?since_hours=${sinceHours}`,
  );
  return res?.data?.anomalies.map(mapAnomaly) ?? null;
}

/* ----------------------------------------------------------- maintenance */

interface RawMaintenance {
  machine_id: string;
  component: string;
  health_pct: number;
  hours_to_service: number;
  due_date: string | null;
  recommended_parts: string[];
}

function maintenanceDueLabel(hours: number): string {
  if (hours <= 0) return "Overdue";
  if (hours < 48) return `In ${Math.round(hours)} engine hours`;
  return `In ${Math.round(hours / 24)} days`;
}

function maintenanceSeverity(hours: number): AlertSeverity {
  if (hours <= 0) return "critical";
  if (hours < 48) return "warning";
  return "info";
}

function mapMaintenance(m: RawMaintenance): MaintenanceItem {
  return {
    id: `${m.machine_id}-${m.component}`,
    machineId: m.machine_id,
    title: `${humanize(m.component)} service`,
    component: humanize(m.component),
    dueInHours: m.hours_to_service,
    dueLabel: maintenanceDueLabel(m.hours_to_service),
    severity: maintenanceSeverity(m.hours_to_service),
    healthPct: m.health_pct,
    workOrder: null,
  };
}

export async function fetchRealMaintenance(apiBase: string): Promise<MaintenanceItem[] | null> {
  const res = await getJson<{ data: { forecast: RawMaintenance[] } }>(`${apiBase}/api/maintenance`);
  return res?.data?.forecast.map(mapMaintenance) ?? null;
}

/* ---------------------------------------------------------- owner report */

interface RawDailyRow {
  date: string;
  utilization_pct: number;
  fuel_l: number;
  idle_pct: number;
  idle_cost_inr: number;
  cycles: number;
}

interface RawWeeklyReport {
  data: {
    fuel_l?: number;
    fuel_spend_inr?: number;
    idle_cost_inr?: number;
    co2_kg?: number;
    utilization_pct?: number;
    daily?: RawDailyRow[];
    error?: string;
  };
}

const CO2_PER_LITRE = 2.68; // kg CO2 per litre of diesel — matches the backend's own constant

function dayLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { weekday: "short" });
}

function seriesFrom(daily: RawDailyRow[], pick: (d: RawDailyRow) => number): SeriesPoint[] {
  return daily.map((d) => ({ label: dayLabel(d.date), value: pick(d) }));
}

export interface RealOwnerReport {
  kpis: Partial<OwnerKpis>;
  series: Partial<OwnerSeries>;
}

/**
 * `/api/reports/weekly` also drafts an LLM narrative, which can be genuinely
 * slow (or briefly unavailable if the provider is overloaded) — hence the
 * longer timeout here than every other real-data fetch in this file.
 */
export async function fetchRealOwnerReport(apiBase: string): Promise<RealOwnerReport | null> {
  const res = await getJson<RawWeeklyReport>(`${apiBase}/api/reports/weekly`, REPORT_TIMEOUT_MS);
  const d = res?.data;
  if (!d || d.error) return null;

  const kpis: Partial<OwnerKpis> = {};
  if (d.fuel_spend_inr !== undefined && d.idle_cost_inr !== undefined) kpis.fleetCostInr = d.fuel_spend_inr + d.idle_cost_inr;
  if (d.idle_cost_inr !== undefined) kpis.idleCostInr = d.idle_cost_inr;
  if (d.fuel_l !== undefined) kpis.fuelL = d.fuel_l;
  if (d.co2_kg !== undefined) kpis.carbonTonnes = Number((d.co2_kg / 1000).toFixed(1));
  if (d.utilization_pct !== undefined) kpis.utilization = d.utilization_pct;
  // productiveHours has no real-data equivalent in owner_summary — left off, so
  // the caller's existing baseline value carries through untouched.

  const series: Partial<OwnerSeries> = {};
  if (d.daily?.length) {
    series.utilization = seriesFrom(d.daily, (r) => r.utilization_pct);
    series.fuel = seriesFrom(d.daily, (r) => r.fuel_l);
    series.idleCost = seriesFrom(d.daily, (r) => r.idle_cost_inr);
    series.productivity = seriesFrom(d.daily, (r) => r.cycles);
    series.carbon = seriesFrom(d.daily, (r) => Number(((r.fuel_l * CO2_PER_LITRE) / 1000).toFixed(2)));
  }

  return { kpis, series };
}

/* ------------------------------------------------------------ task time */

interface RawTaskEstimate {
  data: {
    task: { task_type: string; zone: string };
    remaining_min: { p10: number; p50: number; p90: number };
    progress: number;
    reasons: { label: string; impact_min: number }[];
  };
}

export interface RealTaskEstimate {
  title: string;
  zone: string;
  progress: number;
  etaMinutes: number;
  etaRange: [number, number];
  reasons: string[];
}

/** A task_id in the simulator's own "T-0001" shape — the only kind `/api/tasks/estimate` accepts. */
export const LIVE_TASK_ID = /^T-\d{4}$/;

export async function fetchRealTaskEstimate(apiBase: string, taskId: string): Promise<RealTaskEstimate | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${apiBase}/api/tasks/estimate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: taskId }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as RawTaskEstimate;
    const d = body.data;
    return {
      title: `${humanize(d.task.task_type)} — ${d.task.zone}`,
      zone: d.task.zone,
      progress: Math.round(d.progress * 100),
      etaMinutes: Math.round(d.remaining_min.p50),
      etaRange: [Math.round(d.remaining_min.p10), Math.round(d.remaining_min.p90)],
      reasons: d.reasons.map((r) => `${r.label} ${r.impact_min >= 0 ? "+" : ""}${r.impact_min} min`),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
