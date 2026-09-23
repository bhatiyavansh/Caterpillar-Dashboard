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

const operators: OperatorRef[] = [
  { id: "OP-1042", name: "R. Subramanian", shift: "Day", skill: "expert" },
  { id: "OP-1017", name: "K. Mehta", shift: "Day", skill: "intermediate" },
  { id: "OP-1093", name: "A. Fernandes", shift: "Day", skill: "expert" },
  { id: "OP-1128", name: "S. Bose", shift: "Day", skill: "novice" },
  { id: "OP-1064", name: "D. Iyer", shift: "Day", skill: "intermediate" },
  { id: "OP-1071", name: "M. Nair", shift: "Day", skill: "expert" },
  { id: "OP-1150", name: "V. Chandra", shift: "Day", skill: "novice" },
  { id: "OP-1009", name: "T. Rajan", shift: "Day", skill: "expert" },
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
  return MACHINE_SEED.map((s) => ({
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
  }));
}

/* ------------------------------------------------------------------ tasks */

export function seedTasks(): SiteTask[] {
  return [
    {
      id: "T-EXC001", machineId: "EXC001", title: "Excavate Zone B trench", zone: "Zone B",
      state: "active", progress: 68, etaMinutes: 32, etaRange: [26, 47], startsAt: "10:40",
      reasons: ["Clay soil +8 min", "Operator experience −6 min", "Bucket 1.2 m³ baseline"],
    },
    {
      id: "T-EXC001-2", machineId: "EXC001", title: "Load truck TRK004", zone: "Zone C",
      state: "queued", progress: 0, etaMinutes: 48, etaRange: [40, 62], startsAt: "14:20",
      reasons: ["4-truck rotation", "Haul distance 620 m"],
    },
    {
      id: "T-EXC001-3", machineId: "EXC001", title: "Backfill service trench", zone: "Zone B",
      state: "queued", progress: 0, etaMinutes: 75, etaRange: [62, 98], startsAt: "15:10",
      reasons: ["Rain window after 15:00 +14 min", "Compaction pass required"],
    },
    {
      id: "T-EXC001-0", machineId: "EXC001", title: "Pre-shift walkaround", zone: "Yard",
      state: "done", progress: 100, etaMinutes: 0, etaRange: [0, 0], startsAt: "06:05",
      reasons: [],
    },
    {
      id: "T-DOZ001", machineId: "DOZ001", title: "Grade haul road north", zone: "Haul road",
      state: "active", progress: 41, etaMinutes: 56, etaRange: [45, 73], startsAt: "09:50",
      reasons: ["620 m run", "Second pass required"],
    },
    {
      id: "T-WHL001", machineId: "WHL001", title: "Feed crusher hopper", zone: "Stockpile",
      state: "active", progress: 77, etaMinutes: 19, etaRange: [15, 28], startsAt: "11:05",
      reasons: ["Hopper draw steady", "Operator ramping up"],
    },
  ];
}

/* -------------------------------------------------------------- incidents */

const H = 3_600_000;

export function seedIncidents(now: number): Incident[] {
  return [
    {
      id: "INC-2418", machineId: "EXC001", title: "Worker in rear blind spot",
      kind: "proximity", severity: "critical", at: now - 2.4 * H, zone: "Zone B",
      summary:
        "Spotter crossed 2.4 m behind EXC001 during a 180° swing. The swing was arrested 1.1 s after the alert fired.",
      replayable: true, status: "filed",
    },
    {
      id: "INC-2417", machineId: "DOZ001", title: "Reverse conflict with EXC001",
      kind: "collision", severity: "warning", at: now - 5.1 * H, zone: "Haul road",
      summary:
        "V2V predicted a 3.2 s time-to-conflict while DOZ001 reversed toward the Zone B spur. Both operators were warned.",
      replayable: true, status: "filed",
    },
    {
      id: "INC-2415", machineId: "EXC002", title: "Seatbelt unfastened while tracking",
      kind: "seatbelt", severity: "warning", at: now - 27 * H, zone: "Zone C",
      summary:
        "The machine travelled 14 m with the belt unfastened. Travel lock engaged; the belt was fastened 22 s later.",
      replayable: true, status: "reviewed",
    },
    {
      id: "INC-2411", machineId: "EXC001", title: "Tip-over margin below 1.2",
      kind: "tip_over", severity: "critical", at: now - 51 * H, zone: "Zone B",
      summary:
        "A full-reach lift at 11° cross-slope drove the stability margin to 1.14. The operator retracted the stick on the alert.",
      replayable: true, status: "reviewed",
    },
  ];
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

export function seedAnomalies(now: number): Anomaly[] {
  return [
    {
      id: "ANO-91", machineId: "EXC002", title: "Unusual idle behaviour",
      explanation:
        "EXC002 idled 74 minutes across three sittings this shift against a 54-minute baseline, and every stretch coincided with the seatbelt reading unfastened. The operator is leaving the seat with the engine running.",
      deviation: "+37% vs 30-day baseline", costInr: 2840, detectedAt: now - 1.5 * H,
      severity: "warning",
    },
    {
      id: "ANO-88", machineId: "TRK003", title: "Queue time above plan",
      explanation:
        "TRK003 spent 88 minutes queued at the stockpile. The loader cycle is on target, so the rotation is over-trucked for the current dig rate.",
      deviation: "+52 min vs plan", costInr: 4120, detectedAt: now - 3.2 * H,
      severity: "warning",
    },
    {
      id: "ANO-85", machineId: "EXC001", title: "Harsh swing events",
      explanation:
        "Nine swing reversals exceeded the smoothness threshold in the last hour, concentrated in the narrow trench section. A coaching module is recommended rather than a fault investigation.",
      deviation: "9 events vs 2 typical", costInr: 760, detectedAt: now - 0.8 * H,
      severity: "info",
    },
  ];
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
