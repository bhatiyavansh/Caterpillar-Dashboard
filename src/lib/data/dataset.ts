/**
 * Typed access to the generated site dataset.
 *
 * The raw CSVs in `data/` are ~20 MB; `npm run data:build` rolls them up into
 * the two JSON files imported here (~255 KB combined). Everything is a plain
 * import, so it works in server and client components alike with no fetch.
 *
 * The JSON is cast to these interfaces rather than inferred — inferring types
 * from a 179 KB literal makes `tsc` crawl and produces unusable error messages.
 */

import rawDataset from "@/data/generated/site-dataset.json";
import rawReplays from "@/data/generated/replays.json";

/* ----------------------------- entities ------------------------------- */

export type MachineKindRaw =
  | "excavator"
  | "wheel_loader"
  | "dozer"
  | "truck"
  | "grader";

export interface MachineRecord {
  machineId: string;
  model: string;
  type: MachineKindRaw;
  engineHoursStart: number;
  commissionedDate: string;
}

export type OperatorSkill = "novice" | "intermediate" | "expert";

export interface OperatorRecord {
  operatorId: string;
  name: string;
  skill: OperatorSkill;
  yearsExperience: number;
  certifiedModels: string[];
}

export type AnomalyType =
  | "harsh_operation"
  | "overload"
  | "temperature_anomaly"
  | "excessive_idling"
  | "seatbelt_violation";

export interface AnomalyRecord {
  date: string;
  machineId: string;
  operatorId: string;
  type: AnomalyType;
}

export type IncidentType = "seatbelt" | "proximity" | "v2v" | "fatigue" | "tip_over";
export type IncidentSeverity = "medium" | "high" | "critical";

export interface IncidentRecord {
  incidentId: string;
  timestamp: string;
  machineId: string;
  operatorId: string;
  type: IncidentType;
  severity: IncidentSeverity;
  zone: string;
  weather: string;
  description: string;
  /** Raw dataset frame. */
  x: number;
  y: number;
  /** Twin world frame, ready to drop into the 3D scene. */
  worldX: number;
  worldZ: number;
}

export interface MaintenanceRecord {
  date: string;
  machineId: string;
  hydraulicHealth: number;
  engineHealth: number;
  undercarriageHealth: number;
  avgHydraulicTempC: number;
  oilAnalysisIndex: number;
}

export interface TelemetryRollup {
  machineId: string;
  date?: string;
  samples: number;
  fuelL: number;
  loadCycles: number;
  idleMin: number;
  avgHydraulicC: number;
  avgCoolantC: number;
  avgSpeedMps: number;
  avgPayloadKg: number;
  maxPayloadKg: number;
  seatbeltViolations: number;
  harshSwings: number;
  engineHours: number;
  idleRatio: number;
}

export interface TaskRollup {
  key: string;
  count: number;
  avgEstimatedMin: number;
  avgActualMin: number;
  overrunRatio: number;
}

export interface CountEntry {
  key: string;
  count: number;
}

export interface SiteDataset {
  meta: {
    generated_at: string;
    seed: number;
    days: number;
    diesel_price_inr: number;
    builtAt: string;
    siteFrame: { originX: number; originY: number; scaleX: number; scaleZ: number };
    telemetryRows: number;
    telemetryFrom: string;
    telemetryTo: string;
    rows: Record<string, number>;
  };
  machines: MachineRecord[];
  operators: OperatorRecord[];
  anomalies: AnomalyRecord[];
  incidents: IncidentRecord[];
  incidentSummary: {
    total: number;
    byType: CountEntry[];
    bySeverity: CountEntry[];
    byZone: CountEntry[];
  };
  maintenance: MaintenanceRecord[];
  maintenanceLatest: MaintenanceRecord[];
  telemetry: {
    perMachine: TelemetryRollup[];
    perDay: TelemetryRollup[];
    weather: { weather: string; samples: number }[];
  };
  tasks: {
    total: number;
    byMachine: TaskRollup[];
    byType: TaskRollup[];
    bySkill: TaskRollup[];
  };
}

/* ------------------------------ replays -------------------------------- */

export type BubbleState = "green" | "amber" | "red";

export interface TrackFrame {
  t: number;
  machines: {
    machineId: string;
    x: number;
    z: number;
    /** Radians, clockwise from north — the twin's convention. */
    heading: number;
    intent: string;
    bubble: BubbleState;
  }[];
  workers: { workerId: string; x: number; z: number }[];
}

export interface IncidentTrack {
  incidentId: string;
  machineId: string;
  operatorId: string;
  type: IncidentType;
  severity: IncidentSeverity;
  timestamp: string;
  durationS: number;
  frames: TrackFrame[];
}

export interface RunFrame {
  t: number;
  boomAngle: number;
  stickAngle: number;
  swingAngle: number;
  payload: number;
  cycleIndex: number;
}

export interface OperatorRun {
  runId: string;
  operatorId: string;
  skill: OperatorSkill;
  machineId: string;
  taskType: string;
  durationS: number;
  cycles: number;
  cycleTimeS: number;
  frames: RunFrame[];
}

export interface Replays {
  tracks: IncidentTrack[];
  runs: OperatorRun[];
}

/* ------------------------------ exports -------------------------------- */

export const dataset = rawDataset as unknown as SiteDataset;
export const replays = rawReplays as unknown as Replays;

/* ------------------------------ lookups -------------------------------- */

const machineIndex = new Map(dataset.machines.map((m) => [m.machineId, m]));
const operatorIndex = new Map(dataset.operators.map((o) => [o.operatorId, o]));
const rollupIndex = new Map(dataset.telemetry.perMachine.map((t) => [t.machineId, t]));
const healthIndex = new Map(dataset.maintenanceLatest.map((m) => [m.machineId, m]));

export const getMachine = (id: string) => machineIndex.get(id);
export const getOperator = (id: string) => operatorIndex.get(id);
export const getRollup = (id: string) => rollupIndex.get(id);
export const getHealth = (id: string) => healthIndex.get(id);

export const getTrack = (incidentId: string) =>
  replays.tracks.find((t) => t.incidentId === incidentId);
export const getRun = (runId: string) => replays.runs.find((r) => r.runId === runId);

/** Incidents for a machine, newest first. */
export function incidentsFor(machineId: string): IncidentRecord[] {
  return dataset.incidents
    .filter((i) => i.machineId === machineId)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/** Anomaly labels for a machine, newest first. */
export function anomaliesFor(machineId: string): AnomalyRecord[] {
  return dataset.anomalies
    .filter((a) => a.machineId === machineId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Per-day telemetry series for one machine, oldest first. */
export function dailySeries(machineId: string): TelemetryRollup[] {
  return dataset.telemetry.perDay.filter((d) => d.machineId === machineId);
}

/** Maintenance history for one machine, oldest first. */
export function maintenanceSeries(machineId: string): MaintenanceRecord[] {
  return dataset.maintenance
    .filter((m) => m.machineId === machineId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Single 0-100 condition score.
 *
 * The three subsystem healths are weighted by how often each actually strands a
 * machine: hydraulics first, then engine, then undercarriage.
 */
export function healthScore(machineId: string): number | null {
  const h = getHealth(machineId);
  if (!h) return null;
  return Math.round(
    h.hydraulicHealth * 0.45 + h.engineHealth * 0.35 + h.undercarriageHealth * 0.2,
  );
}

export type HealthBand = "good" | "watch" | "service";

export function healthBand(score: number): HealthBand {
  if (score >= 80) return "good";
  if (score >= 65) return "watch";
  return "service";
}

/** Litres of diesel burned, converted with the dataset's own price. */
export function fuelCostInr(litres: number): number {
  return litres * dataset.meta.diesel_price_inr;
}

/* --------------------------- site frame -------------------------------- */

/**
 * Converts raw dataset coordinates into the twin's world frame.
 * Mirrors `SITE_FRAME` in scripts/build-dataset.mjs — both read the values
 * baked into the generated file so they cannot drift apart.
 */
export function toWorld(x: number, y: number): { x: number; z: number } {
  const f = dataset.meta.siteFrame;
  return {
    x: (x - f.originX) * f.scaleX,
    z: (y - f.originY) * f.scaleZ,
  };
}
