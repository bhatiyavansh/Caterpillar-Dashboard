/**
 * Deterministic starting state for the demo site.
 *
 * Values are drawn from real Cat model classes and a Chennai-scale earthworks
 * site so nothing on screen reads as filler. The live mock drifts from here.
 */
import type {
  Anomaly,
  Incident,
  Machine,
  MachineKind,
  MaintenanceItem,
  OperatorRef,
  SiteTask,
  TrainingModule,
} from "./contracts";
import { dataset, getOperator, replays } from "@/lib/data/dataset";
import { engineTargets } from "./engine-readings";
import { historicalAnomalies, type HistoricalAnomaly } from "@/lib/intel";
import {
  RESTING_CONDITIONS,
  estimateTask,
  type JobSpec,
  type SiteConditions,
} from "./estimate";

export const SITE_NAME = "Perungudi Extension — Sector 4";
export const SHIFT_LABEL = "Day shift · 06:00–14:00";
export const PRIMARY_MACHINE_ID = "EXC001";

export const KIND_LABEL: Record<MachineKind, string> = {
  excavator: "Excavator",
  dozer: "Dozer",
  loader: "Wheel loader",
  truck: "Articulated truck",
  grader: "Motor grader",
};

/** Rated payload per kind, kilograms — used to derive load percentage. */
export const RATED_PAYLOAD: Record<MachineKind, number> = {
  excavator: 2400,
  dozer: 4200,
  loader: 5800,
  truck: 41000,
  grader: 2600,
};

// Experience is a feature of the task-time model, not decoration: the fitted
// coefficient on it is worth several minutes on a long job.
const operators: OperatorRef[] = [
  { id: "OP-1042", name: "R. Subramanian", shift: "Day", skill: "expert", years: 14 },
  { id: "OP-1017", name: "K. Mehta", shift: "Day", skill: "intermediate", years: 6 },
  { id: "OP-1093", name: "A. Fernandes", shift: "Day", skill: "expert", years: 11 },
  { id: "OP-1128", name: "S. Bose", shift: "Day", skill: "novice", years: 2 },
  { id: "OP-1064", name: "D. Iyer", shift: "Day", skill: "intermediate", years: 7 },
  { id: "OP-1071", name: "M. Nair", shift: "Day", skill: "expert", years: 16 },
  { id: "OP-1150", name: "V. Chandra", shift: "Day", skill: "novice", years: 1 },
  { id: "OP-1009", name: "T. Rajan", shift: "Day", skill: "expert", years: 12 },
];

export function operatorById(id: string): OperatorRef | null {
  return operators.find((o) => o.id === id) ?? null;
}

interface MachineSeed {
  id: string;
  kind: MachineKind;
  model: string;
  zone: string;
  operatorId: string | null;
  task: string | null;
  fuel: number;
  hydraulicTemperature: number;
  utilization: number;
  engineHours: number;
  idleMinutes: number;
  loadCycles: number;
  load: number;
  speedKmh: number;
  x: number;
  z: number;
  heading: number;
  offline?: boolean;
  maintenance?: boolean;
}

export const MACHINE_SEED: MachineSeed[] = [
  {
    id: "EXC001", kind: "excavator", model: "CAT 320", zone: "Zone B",
    operatorId: "OP-1042", task: "Excavate Zone B trench", fuel: 82,
    hydraulicTemperature: 68, utilization: 88, engineHours: 2184, idleMinutes: 22,
    loadCycles: 96, load: 74, speedKmh: 1.8, x: -5, z: -22, heading: 142,
  },
  {
    id: "EXC002", kind: "excavator", model: "CAT 336", zone: "Zone C",
    operatorId: "OP-1017", task: "Load truck TRK004", fuel: 46,
    hydraulicTemperature: 91, utilization: 71, engineHours: 3910, idleMinutes: 74,
    loadCycles: 58, load: 62, speedKmh: 0.4, x: 38, z: -12, heading: 268,
  },
  {
    id: "DOZ001", kind: "dozer", model: "CAT D6", zone: "Haul road",
    operatorId: "OP-1093", task: "Grade haul road north", fuel: 63,
    hydraulicTemperature: 74, utilization: 82, engineHours: 5240, idleMinutes: 31,
    loadCycles: 0, load: 55, speedKmh: 4.6, x: 12, z: 18, heading: 12,
  },
  {
    id: "WHL001", kind: "loader", model: "CAT 966M", zone: "Stockpile",
    operatorId: "OP-1128", task: "Feed crusher hopper", fuel: 71,
    hydraulicTemperature: 70, utilization: 76, engineHours: 4488, idleMinutes: 44,
    loadCycles: 112, load: 81, speedKmh: 7.2, x: -48, z: 34, heading: 305,
  },
  {
    id: "TRK001", kind: "truck", model: "CAT 745", zone: "Haul road",
    operatorId: "OP-1064", task: "Haul to spoil tip", fuel: 58,
    hydraulicTemperature: 66, utilization: 91, engineHours: 6712, idleMinutes: 18,
    loadCycles: 22, load: 94, speedKmh: 21.4, x: 24, z: 52, heading: 78,
  },
  {
    id: "TRK002", kind: "truck", model: "CAT 745", zone: "Fuel bay",
    operatorId: "OP-1071", task: "Refuelling", fuel: 19,
    hydraulicTemperature: 61, utilization: 44, engineHours: 6104, idleMinutes: 61,
    loadCycles: 17, load: 0, speedKmh: 0, x: -6, z: 76, heading: 180,
  },
  {
    id: "TRK003", kind: "truck", model: "CAT 745", zone: "Loader queue",
    operatorId: "OP-1150", task: "Queued at stockpile", fuel: 67,
    hydraulicTemperature: 64, utilization: 52, engineHours: 5870, idleMinutes: 88,
    loadCycles: 14, load: 0, speedKmh: 0, x: -40, z: 44, heading: 300,
  },
  {
    id: "TRK004", kind: "truck", model: "CAT 745", zone: "Zone C",
    operatorId: "OP-1009", task: "Receiving load", fuel: 74,
    hydraulicTemperature: 68, utilization: 79, engineHours: 5312, idleMinutes: 26,
    loadCycles: 19, load: 71, speedKmh: 0, x: 44, z: -6, heading: 90,
  },
  {
    id: "GRD001", kind: "grader", model: "CAT 140", zone: "Haul road",
    operatorId: null, task: null, fuel: 88, hydraulicTemperature: 58,
    utilization: 0, engineHours: 2966, idleMinutes: 0, loadCycles: 0, load: 0,
    speedKmh: 0, x: 60, z: 30, heading: 220, maintenance: true,
  },
  {
    id: "EXC003", kind: "excavator", model: "CAT 320", zone: "Yard",
    operatorId: null, task: null, fuel: 34, hydraulicTemperature: 30,
    utilization: 0, engineHours: 1218, idleMinutes: 0, loadCycles: 0, load: 0,
    speedKmh: 0, x: -62, z: 74, heading: 0, offline: true,
  },
];

export function seedMachines(): Machine[] {
  return MACHINE_SEED.map((s) => {
    const engineOn = !s.offline && !s.maintenance;
    const coolant = s.offline ? 28 : s.hydraulicTemperature + 12;
    const readings = engineTargets({
      engineOn,
      effort: engineOn && s.utilization >= 55 ? s.utilization / 100 : 0,
      loadRatio: s.load / 100,
      coolantC: coolant,
    });
    return {
    id: s.id,
    kind: s.kind,
    model: s.model,
    kindLabel: KIND_LABEL[s.kind],
    status: s.offline
      ? ("offline" as const)
      : s.maintenance
        ? ("maintenance" as const)
        : s.utilization < 55
          ? ("idle" as const)
          : ("operating" as const),
    zone: s.zone,
    operator: s.operatorId ? operatorById(s.operatorId) : null,
    taskId: s.task ? `T-${s.id}` : null,
    taskLabel: s.task,
    taskProgress: s.task ? 40 + (((s.engineHours % 7) * 7) % 45) : 0,
    fuel: s.fuel,
    fuelUsedL: Number((s.engineHours % 97).toFixed(1)),
    hydraulicTemperature: s.hydraulicTemperature,
    coolantTemperature: s.offline ? 28 : s.hydraulicTemperature + 12,
    tipOverMargin: s.kind === "excavator" ? 1.62 : 2.4,
    utilization: s.utilization,
    load: s.load,
    payloadKg: Math.round((s.load / 100) * RATED_PAYLOAD[s.kind]),
    speedKmh: s.speedKmh,
    engineHours: s.engineHours,
    idleMinutes: s.idleMinutes,
    loadCycles: s.loadCycles,
    seatbelt: s.offline || s.maintenance ? ("not_fitted" as const) : ("fastened" as const),
    position: { x: s.x, z: s.z },
    heading: s.heading,
    proximity: { nearestPersonM: null, level: "safe" as const, zone: null },
    alertIds: [],
    engineRpm: Math.round(readings.engineRpm),
    oilPressurePsi: Number(readings.oilPressurePsi.toFixed(1)),
    hydraulicPressurePsi: Math.round(readings.hydraulicPressurePsi),
    // Deterministic per machine so a reload does not reshuffle the gauges.
    batteryPct: engineOn ? 90 + (s.engineHours % 9) : 62,
    defLevelPct: 48 + (Math.round(s.engineHours) % 45),
    };
  });
}

/* ------------------------------------------------------------------ tasks */

/**
 * The shift's work, stated as jobs rather than as durations.
 *
 * Nothing here says how long anything takes. The job — what kind of work, what
 * ground, how much of it — is what a site office actually knows; the minutes
 * come from the model, under whatever the conditions are when it is asked. That
 * is the difference between a number that updates when it rains and one that
 * does not.
 */
export const JOBS: JobSpec[] = [
  {
    id: "T-EXC001", machineId: "EXC001", title: "Excavate Zone B trench", zone: "Zone B",
    taskType: "trenching", soil: "clay", volume: 140, state: "active", progress: 68,
    startsAt: "10:40",
  },
  {
    id: "T-EXC001-2", machineId: "EXC001", title: "Load truck TRK004", zone: "Zone C",
    taskType: "loading", soil: "mixed", volume: 5, state: "queued", progress: 0,
    startsAt: "14:20",
  },
  {
    id: "T-EXC001-3", machineId: "EXC001", title: "Backfill service trench", zone: "Zone B",
    taskType: "trenching", soil: "mixed", volume: 96, state: "queued", progress: 0,
    startsAt: "15:10",
  },
  {
    id: "T-EXC001-0", machineId: "EXC001", title: "Pre-shift walkaround", zone: "Yard",
    taskType: "trenching", soil: "sand", volume: 4, state: "done", progress: 100,
    startsAt: "06:05",
  },
  {
    id: "T-DOZ001", machineId: "DOZ001", title: "Grade haul road north", zone: "Haul road",
    taskType: "dozing", soil: "mixed", volume: 210, state: "active", progress: 41,
    startsAt: "09:50",
  },
  {
    id: "T-WHL001", machineId: "WHL001", title: "Feed crusher hopper", zone: "Stockpile",
    taskType: "loading", soil: "rock", volume: 7, state: "active", progress: 77,
    startsAt: "11:05",
  },
  {
    id: "T-GRD001", machineId: "GRD001", title: "Finish grade Zone A pad", zone: "Zone A",
    taskType: "grading", soil: "sand", volume: 2200, state: "active", progress: 23,
    startsAt: "11:40",
  },
  {
    id: "T-TRK001", machineId: "TRK001", title: "Haul spoil to north tip", zone: "Haul road",
    taskType: "hauling", soil: "mixed", volume: 11, state: "active", progress: 55,
    startsAt: "10:15",
  },
];

/** The shift's tasks, estimated under whatever conditions are handed in. */
export function seedTasks(
  machines: Machine[] = seedMachines(),
  site: SiteConditions = RESTING_CONDITIONS,
): SiteTask[] {
  const byId = new Map(machines.map((m) => [m.id, m]));
  return JOBS.map((job) => {
    const machine = byId.get(job.machineId);
    return estimateTask(job, machine, machine?.operator ?? null, site);
  });
}

/* -------------------------------------------------------------- incidents */

const H = 3_600_000;

/** The dataset's incident types, in the product's own vocabulary. */
const INCIDENT_KIND: Record<string, Incident["kind"]> = {
  seatbelt: "seatbelt",
  proximity: "proximity",
  v2v: "collision",
  fatigue: "fatigue",
  tip_over: "tip_over",
};

const INCIDENT_TITLE: Record<string, string> = {
  seatbelt: "Seatbelt unfastened while operating",
  proximity: "Worker inside the machine's envelope",
  v2v: "Predicted machine-to-machine conflict",
  fatigue: "Operator fatigue indicated",
  tip_over: "Stability margin below limit",
};

/**
 * The incident log, read from the 150 incidents in the generated record.
 *
 * These are not illustrative: each one has a timestamp, a machine, an operator,
 * a position on site and the weather at the time, and four of them carry
 * frame-by-frame tracks the twin can replay.
 */
export function seedIncidents(now: number): Incident[] {
  const replayable = new Set(replays.tracks.map((t) => t.incidentId));
  // The history ends whenever the dataset was generated; anchoring it to the
  // demo clock keeps "3 hours ago" meaningful on screen.
  const latest = dataset.incidents.reduce(
    (max, i) => Math.max(max, Date.parse(i.timestamp)),
    0,
  );

  return dataset.incidents
    .map((i) => {
      const operator = getOperator(i.operatorId);
      const at = now - (latest - Date.parse(i.timestamp));
      return {
        id: i.incidentId,
        machineId: i.machineId,
        title: INCIDENT_TITLE[i.type] ?? "Safety incident",
        kind: INCIDENT_KIND[i.type] ?? "proximity",
        severity: i.severity === "critical" ? ("critical" as const) : i.severity === "high" ? ("warning" as const) : ("info" as const),
        at,
        zone: i.zone,
        summary: i.description,
        replayable: replayable.has(i.incidentId),
        // Anything older than the current shift has been through review.
        status: now - at > 12 * H ? ("reviewed" as const) : ("filed" as const),
        operatorId: i.operatorId,
        operatorName: operator?.name ?? null,
        weather: (["clear", "rain", "fog", "heat"].includes(i.weather)
          ? i.weather
          : "clear") as Incident["weather"],
        position: { x: i.worldX, z: i.worldZ },
        alertId: null,
        note: null,
        automatic: true,
      };
    })
    .sort((a, b) => b.at - a.at);
}

/* ------------------------------------------------------------ maintenance */

export function seedMaintenance(): MaintenanceItem[] {
  return [
    {
      id: "MNT-501", machineId: "EXC002", title: "Hydraulic oil and filter change",
      component: "Hydraulic system", dueInHours: 18, dueLabel: "In 18 engine hours",
      severity: "critical", healthPct: 31, workOrder: "WO-8841",
    },
    {
      id: "MNT-502", machineId: "DOZ001", title: "Engine service at 5,250 h",
      component: "Powertrain", dueInHours: 10, dueLabel: "Tomorrow, 07:00",
      severity: "warning", healthPct: 58, workOrder: "WO-8839",
    },
    {
      id: "MNT-503", machineId: "GRD001", title: "Blade circle bearing inspection",
      component: "Drawbar and circle", dueInHours: -6, dueLabel: "Overdue by 6 hours",
      severity: "critical", healthPct: 24, workOrder: "WO-8830",
    },
    {
      id: "MNT-504", machineId: "TRK001", title: "Brake wear measurement",
      component: "Braking", dueInHours: 96, dueLabel: "In 4 days", severity: "info",
      healthPct: 72, workOrder: null,
    },
    {
      id: "MNT-505", machineId: "EXC001", title: "Track tension adjustment",
      component: "Undercarriage", dueInHours: 120, dueLabel: "In 5 days", severity: "info",
      healthPct: 81, workOrder: null,
    },
  ];
}

/* -------------------------------------------------------------- anomalies */

const ANOMALY_TITLE: Record<string, string> = {
  excessive_idling: "Excessive idling",
  seatbelt_violation: "Operating with the belt unfastened",
  overload: "Payload above rated capacity",
  harsh_operation: "Harsh operation",
  temperature_anomaly: "Hydraulic temperature excursion",
  low_productivity: "Output below this machine's norm",
  unusual_pattern: "Unusual usage pattern",
};

/**
 * Unusual usage, as found by the detector rather than written by hand.
 *
 * `historicalAnomalies()` runs the same rules and the same per-machine
 * baselines the live detector uses across every machine-day in the record.
 * What this returns is therefore a result, not a fixture — change the data and
 * the list changes with it.
 */
export function seedAnomalies(now: number): Anomaly[] {
  const found = historicalAnomalies();
  const latest = dataset.telemetry.perDay.reduce(
    (max, d) => (d.date && d.date > max ? d.date : max),
    "",
  );
  const latestMs = Date.parse(`${latest}T12:00:00Z`) || now;

  return found.slice(0, 12).map((a, index) => ({
    id: `ANO-${String(index + 1).padStart(3, "0")}`,
    machineId: a.machineId,
    title: ANOMALY_TITLE[a.type] ?? "Unusual usage",
    explanation: explainAnomaly(a),
    deviation: a.deviation,
    costInr: a.fuelCostInr,
    detectedAt: now - (latestMs - Date.parse(`${a.date}T12:00:00Z`)),
    severity: a.score >= 0.9 ? ("critical" as const) : a.score >= 0.7 ? ("warning" as const) : ("info" as const),
    pattern: a.type,
    related: a.related,
    score: a.score,
    detectedBy: a.detectedBy,
    evidence: {
      "Idle time": `${a.evidence.idleMinutes.toFixed(0)} min`,
      "Baseline idle": `${a.evidence.baselineIdleMinutes.toFixed(0)} min`,
      "Load cycles": String(a.evidence.cycles),
      "Belt unfastened": `${a.evidence.seatbeltOffMinutes.toFixed(0)} min`,
      "Peak payload": `${a.evidence.peakPayloadKg.toLocaleString("en-IN")} kg`,
      "Hydraulic temp": `${a.evidence.peakHydraulicTempC.toFixed(0)} °C`,
    },
    fuelWastedL: a.fuelWastedL,
  }));
}

/**
 * The sentence under the heading.
 *
 * Deliberately built from the detector's own numbers rather than written out:
 * every clause here is a figure the model produced, so the explanation cannot
 * drift away from what was actually detected.
 */
function explainAnomaly(a: HistoricalAnomaly): string {
  const parts: string[] = [];
  if (a.type === "excessive_idling" || a.related.includes("excessive_idling")) {
    parts.push(
      `${a.machineId} idled ${a.evidence.idleMinutes.toFixed(0)} minutes against a ` +
        `${a.evidence.baselineIdleMinutes.toFixed(0)}-minute baseline while completing ` +
        `${a.evidence.cycles} load cycles`,
    );
  }
  if (a.type === "seatbelt_violation" || a.related.includes("seatbelt_violation")) {
    parts.push(
      `the belt read unfastened for ${a.evidence.seatbeltOffMinutes.toFixed(0)} of those minutes`,
    );
  }
  if (a.type === "overload" || a.related.includes("overload")) {
    parts.push(`payload peaked at ${a.evidence.peakPayloadKg.toLocaleString("en-IN")} kg`);
  }
  if (a.type === "temperature_anomaly") {
    parts.push(`hydraulic oil reached ${a.evidence.peakHydraulicTempC.toFixed(0)} °C`);
  }
  if (!parts.length) parts.push(`${a.machineId} ran ${a.deviation}`);

  const detector =
    a.detectedBy === "rules"
      ? "This matches a named pattern in the safety rules."
      : "No single rule fired; it is the distance from this machine's own 30-day normal that flagged it.";

  return `${parts.join(", and ")}. ${detector}`;
}

/* --------------------------------------------------------------- training */

export function seedTraining(): TrainingModule[] {
  return [
    {
      id: "TRN-01", title: "Safety fundamentals", progress: 100, lessons: 8, lessonsDone: 8,
      rationale: "Completed 12 March. Recertification due in 9 months.", locked: false,
    },
    {
      id: "TRN-02", title: "Equipment operation", progress: 70, lessons: 10, lessonsDone: 7,
      rationale: "Three lessons left before the 336 class sign-off.", locked: false,
    },
    {
      id: "TRN-03", title: "Incident response", progress: 60, lessons: 5, lessonsDone: 3,
      rationale: "Assigned after the 2.4 m proximity event on EXC001.", locked: false,
    },
    {
      id: "TRN-04", title: "Slope and stability control", progress: 25, lessons: 6, lessonsDone: 1,
      rationale: "Recommended: two tip-over margin warnings in the last 30 days.", locked: false,
    },
    {
      id: "TRN-05", title: "Fuel-efficient operation", progress: 0, lessons: 4, lessonsDone: 0,
      rationale: "Unlocks once Equipment operation reaches 80%.", locked: true,
    },
  ];
}
