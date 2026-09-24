/**
 * Hydraulic hose leak on EXC001, end to end.
 *
 * Everything here is a pure function of the fault record and the clock, so any
 * tab (the presenter's demo control, the maintenance screen, a second monitor)
 * derives the same telemetry, the same detection moment and the same diagnosis
 * from nothing more than the time the leak started. Nothing is scripted as a
 * result: detection and the ranked causes are computed from the samples.
 *
 * The story, in seconds after the leak starts:
 *
 *   0      a fitting starts to weep: tank level creeps down, pressure sags a little
 *   ~8     the predictive health check notices the level trend
 *   20     the boom hose splits: pressure collapses, level falls fast, boom drifts
 *   ~22    detection rule fires, operator told to lower the boom and stop
 *   +6     operator has the machine safe: engine off, boom on the ground
 *   ...    technician dispatched, repairs, restarts, test cycle proves the fix
 */

/* ------------------------------------------------------------------ Types */

export type StepId = "safe" | "relieve" | "locate" | "remove" | "install" | "refill" | "verify";

export interface FaultRecord {
  /** Breakdown report id, e.g. BR-0142. */
  id: string;
  workOrder: string;
  machineId: string;
  /** Epoch ms the leak started weeping. */
  startedAt: number;
  dispatchedAt?: number;
  technician?: string;
  /** Epoch ms each procedure step was ticked off. */
  steps: Partial<Record<StepId, number>>;
  /** Epoch ms the technician restarted the machine for the test cycle. */
  verifyStartedAt?: number;
  closedAt?: number;
}

export interface Sample {
  /** Seconds relative to the start of the leak. Negative is healthy history. */
  t: number;
  pressure: number;
  level: number;
  temp: number;
  drift: number;
  engineOn: boolean;
}

export type Phase =
  | "monitoring"
  | "degrading"
  | "detected"
  | "safed"
  | "dispatched"
  | "repairing"
  | "verifying"
  | "verified"
  | "closed";

const PHASE_ORDER: Phase[] = [
  "monitoring",
  "degrading",
  "detected",
  "safed",
  "dispatched",
  "repairing",
  "verifying",
  "verified",
  "closed",
];

export const phaseAtLeast = (phase: Phase, min: Phase) => PHASE_ORDER.indexOf(phase) >= PHASE_ORDER.indexOf(min);

/* -------------------------------------------------------------- Constants */

export const MACHINE = {
  id: "EXC001",
  model: "CAT 320",
  label: "CAT 320 · EXC001",
  zone: "Zone B",
  operator: "R. Subramanian (OP-1042)",
  hours: 4218,
};

export const TECHNICIAN = "R. Okafor";

const BASE_PRESSURE = 3200; // psi, main pump under digging load
const BASE_LEVEL = 92; // % of sight glass
const BASE_TEMP = 76; // °C hydraulic oil
const BASE_DRIFT = 1.5; // mm/min boom creep, engine running, bucket loaded
/** Usable hydraulic tank volume, for converting level into litres lost. */
export const TANK_LITRES = 120;

const WEEP_RATE = 0.03; // % level per second before the split
export const RUPTURE_S = 20;
const RUPTURE_RATE = 0.9; // % level per second once the hose has split
const RUPTURE_PRESSURE = 2150;

/** Operator reaction: lower the boom, idle down, key off. */
const SAFE_STOP_DELAY_S = 6;
/** Technician travel to the machine, compressed for the demo. */
export const ARRIVE_S = 8;
/** Length of the post-repair test cycle. */
export const TEST_S = 12;
export const HISTORY_S = 60;

/* ------------------------------------------------------------------ Noise */

/** Deterministic noise in [-0.5, 0.5], so every tab draws the same trace. */
function noise(t: number, k: number): number {
  const x = Math.sin(t * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

/** Digging cycle: pressure swings with each bucket fill. */
const cycle = (t: number) => 220 * Math.sin((2 * Math.PI * t) / 16);

/* -------------------------------------------------------------- Telemetry */

interface Timing {
  /** Seconds at which the machine was shut down. Infinity while running. */
  safeS: number;
  refillS: number;
  verifyS: number;
}

function sampleWith(t: number, tm: Timing): Sample {
  const { safeS, refillS, verifyS } = tm;
  const restarted = t >= verifyS;
  const engineOn = t < safeS || restarted;

  // Level: integrate the leak rate piecewise; it stops falling once the pump
  // stops pushing oil out of the split, and resets when the tank is topped up.
  let level: number;
  if (t >= refillS) level = BASE_LEVEL;
  else if (t < 0) level = BASE_LEVEL;
  else if (t < RUPTURE_S) level = BASE_LEVEL - WEEP_RATE * t;
  else {
    const end = Math.min(t, safeS);
    level = BASE_LEVEL - WEEP_RATE * RUPTURE_S - RUPTURE_RATE * Math.max(0, end - RUPTURE_S);
  }
  level += noise(t, 1) * 0.06;

  // Pressure: sags with the weep, collapses at the split, bleeds off at
  // shutdown, and builds back up during the test cycle.
  const running = (s: number) => {
    if (s < 0) return BASE_PRESSURE + cycle(s);
    if (s < RUPTURE_S) return BASE_PRESSURE - 8 * s + cycle(s);
    const atSplit = BASE_PRESSURE - 8 * RUPTURE_S;
    return atSplit - (atSplit - RUPTURE_PRESSURE) * (1 - Math.exp(-(s - RUPTURE_S) / 1.2)) + cycle(s) * 0.5;
  };
  let pressure: number;
  if (restarted) pressure = BASE_PRESSURE * (1 - Math.exp(-(t - verifyS) / 1.5)) + cycle(t);
  else if (t >= safeS) pressure = running(safeS) * Math.exp(-(t - safeS) / 0.6);
  else pressure = running(t);
  pressure = Math.max(0, pressure + noise(t, 2) * 50);

  // Oil temperature: climbs as the pump works harder against a leak, cools
  // with the engine off, settles once the circuit is whole again.
  const hot = (s: number) => {
    if (s < 0) return BASE_TEMP;
    if (s < RUPTURE_S) return BASE_TEMP + 0.04 * s;
    return BASE_TEMP + 0.04 * RUPTURE_S + 0.15 * (s - RUPTURE_S);
  };
  let temp: number;
  if (restarted) {
    const from = t >= safeS ? coolFrom(hot(safeS), verifyS - safeS) : hot(verifyS);
    temp = 72 + (from - 72) * Math.exp(-(t - verifyS) / 20);
  } else if (t >= safeS) temp = coolFrom(hot(safeS), t - safeS);
  else temp = hot(t);
  temp += noise(t, 3) * 0.4;

  // Boom drift: the loaded boom sinks when its head-end hose cannot hold
  // pressure. With the bucket on the ground there is nothing to drift.
  let drift: number;
  if (restarted) drift = 2;
  else if (t >= safeS) drift = 0;
  else if (t >= RUPTURE_S) drift = 38;
  else drift = BASE_DRIFT + (t > 0 ? 0.05 * t : 0);
  drift = Math.max(0, drift + (drift ? noise(t, 4) * 1.2 : 0));

  return { t, pressure, level, temp, drift, engineOn };
}

function coolFrom(start: number, seconds: number) {
  return 60 + (start - 60) * Math.exp(-seconds / 120);
}

/* ------------------------------------------------------------- Statistics */

/** Least-squares slope, units per second. */
function slope(samples: Sample[], key: "level" | "temp" | "pressure"): number {
  const n = samples.length;
  if (n < 2) return 0;
  const mx = samples.reduce((a, s) => a + s.t, 0) / n;
  const my = samples.reduce((a, s) => a + s[key], 0) / n;
  let num = 0;
  let den = 0;
  for (const s of samples) {
    num += (s.t - mx) * (s[key] - my);
    den += (s.t - mx) ** 2;
  }
  return den ? num / den : 0;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function range(from: number, to: number, tm: Timing): Sample[] {
  const out: Sample[] = [];
  for (let t = Math.ceil(from); t <= to; t++) out.push(sampleWith(t, tm));
  return out;
}

/* -------------------------------------------------------------- Detection */

const RUNNING: Timing = { safeS: Infinity, refillS: Infinity, verifyS: Infinity };

/**
 * First second at which the level is trending down on a 12 s regression.
 * This is the "we saw it coming" moment: before anything alarms.
 */
function findPredictive(): number {
  for (let t = 4; t < RUPTURE_S + 10; t++) {
    if (slope(range(t - 11, t, RUNNING), "level") < -0.015) return t;
  }
  return RUPTURE_S;
}

/**
 * The alarm rule: tank level falling fast *and* pressure well below normal
 * over the last five seconds. Either alone is too noisy to stop a machine for.
 */
function findDetection(): number {
  for (let t = 1; t < RUPTURE_S + 30; t++) {
    const w = range(t - 4, t, RUNNING);
    if (slope(w, "level") < -0.25 && mean(w.map((s) => s.pressure)) < BASE_PRESSURE * 0.85) return t;
  }
  return RUPTURE_S + 3;
}

// Detection happens with the machine still running, so it does not depend on
// anything a person does afterwards and can be computed once.
export const PREDICTIVE_S = findPredictive();
export const DETECT_S = findDetection();
export const SAFE_S = DETECT_S + SAFE_STOP_DELAY_S;

/* -------------------------------------------------------------- Diagnosis */

export interface Features {
  baselinePressure: number;
  pressureAtFault: number;
  pressureDropPct: number;
  /** % of sight glass per minute. */
  levelRate: number;
  /** °C per minute. */
  tempRate: number;
  /** mm per minute. */
  drift: number;
  levelAtFault: number;
  tempAtFault: number;
}

function features(): Features {
  const base = range(-30, -1, RUNNING);
  const w = range(DETECT_S - 4, DETECT_S, RUNNING);
  const baselinePressure = mean(base.map((s) => s.pressure));
  const pressureAtFault = mean(w.map((s) => s.pressure));
  return {
    baselinePressure,
    pressureAtFault,
    pressureDropPct: ((baselinePressure - pressureAtFault) / baselinePressure) * 100,
    levelRate: slope(w, "level") * 60,
    tempRate: slope(range(DETECT_S - 8, DETECT_S, RUNNING), "temp") * 60,
    drift: mean(w.map((s) => s.drift)),
    levelAtFault: w[w.length - 1].level,
    tempAtFault: w[w.length - 1].temp,
  };
}

interface Check {
  label: string;
  weight: number;
  test: (f: Features) => boolean;
}

export interface CauseDef {
  id: string;
  title: string;
  kind: "external" | "internal";
  /** One line on how to confirm or rule it out at the machine. */
  confirm: string;
  checks: Check[];
}

const levelFast: Check = { label: "Tank level falling fast (> 3 %/min)", weight: 3, test: (f) => f.levelRate < -3 };
const levelFlat: Check = { label: "Tank level holding steady", weight: 3, test: (f) => f.levelRate > -0.3 };
const pressureLarge: Check = { label: "Pressure drop over 15 %", weight: 2, test: (f) => f.pressureDropPct > 15 };
const tempRising: Check = { label: "Oil temperature rising (> 3 °C/min)", weight: 1, test: (f) => f.tempRate > 3 };
const drifting: Check = { label: "Boom drifting under load (> 10 mm/min)", weight: 1, test: (f) => f.drift > 10 };
const notDrifting: Check = { label: "Boom holding position", weight: 1, test: (f) => f.drift <= 10 };

export const CAUSES: CauseDef[] = [
  {
    id: "hose_rupture",
    title: "Boom cylinder hose rupture",
    kind: "external",
    confirm: "Oil sprayed on the boom foot and ground; split visible on hose H-3.",
    checks: [levelFast, pressureLarge, tempRising, drifting],
  },
  {
    id: "fitting",
    title: "Loose or failed hose fitting",
    kind: "external",
    confirm: "Wet fitting with a slow drip; hose itself intact. Re-torque and recheck.",
    checks: [
      { label: "Tank level falling", weight: 2, test: (f) => f.levelRate < -0.3 },
      { label: "Level falling slowly (< 3 %/min)", weight: 2, test: (f) => f.levelRate >= -3 && f.levelRate < -0.3 },
      { label: "Pressure drop under 15 %", weight: 1, test: (f) => f.pressureDropPct <= 15 },
    ],
  },
  {
    id: "seal_bypass",
    title: "Boom cylinder seal bypass",
    kind: "internal",
    confirm: "No external oil. Boom sinks with engine off; cylinder drift test fails.",
    checks: [levelFlat, { ...drifting, weight: 2 }, { label: "Moderate pressure drop (5–15 %)", weight: 1, test: (f) => f.pressureDropPct > 5 && f.pressureDropPct <= 15 }],
  },
  {
    id: "pump_wear",
    title: "Main pump wear",
    kind: "internal",
    confirm: "Slow cycle times on every function, not only the boom. Pump flow test.",
    checks: [levelFlat, { label: "Pressure drop over 5 %", weight: 1, test: (f) => f.pressureDropPct > 5 }, tempRising, notDrifting],
  },
  {
    id: "relief_valve",
    title: "Main relief valve stuck open",
    kind: "internal",
    confirm: "Pressure capped on every function; relief valve body runs hot.",
    checks: [levelFlat, pressureLarge, { label: "Oil temperature climbing fast (> 8 °C/min)", weight: 1, test: (f) => f.tempRate > 8 }, notDrifting],
  },
];

export interface RankedCause {
  cause: CauseDef;
  probability: number;
  evidence: { label: string; matched: boolean; weight: number }[];
}

/**
 * Score each cause by how well the signature fits: matched evidence adds its
 * weight, contradicted evidence costs half of it. Softmax turns scores into a
 * confidence that sums to 100 %.
 */
function rank(f: Features): RankedCause[] {
  const scored = CAUSES.map((cause) => {
    const evidence = cause.checks.map((c) => ({ label: c.label, weight: c.weight, matched: c.test(f) }));
    const score = evidence.reduce((a, e) => a + (e.matched ? e.weight : -e.weight * 0.5), 0);
    return { cause, evidence, score };
  });
  const z = scored.map((s) => Math.exp(s.score / 3));
  const total = z.reduce((a, b) => a + b, 0);
  return scored
    .map((s, i) => ({ cause: s.cause, evidence: s.evidence, probability: z[i] / total }))
    .sort((a, b) => b.probability - a.probability);
}

export const FEATURES = features();
export const DIAGNOSIS = rank(FEATURES);

/** Litres lost between the weep starting and the machine being shut down. */
export const OIL_LOST_L = Number(
  (((BASE_LEVEL - sampleWith(SAFE_S + 1, { ...RUNNING, safeS: SAFE_S }).level) / 100) * TANK_LITRES).toFixed(1),
);

/* -------------------------------------------------------------- Procedure */

export interface ProcedureStep {
  id: StepId;
  title: string;
  detail: string;
  caution?: string;
  /** Components the step touches, for highlighting on the machine view. */
  parts: PartId[];
  /** Proven by telemetry rather than ticked by hand. */
  verified?: boolean;
}

export const PROCEDURE: ProcedureStep[] = [
  {
    id: "safe",
    title: "Confirm the machine is safe",
    detail: "Boom and bucket on the ground, engine off, key removed. Hang a lockout tag on the key switch.",
    caution: "Do not start any work until the lockout tag is on.",
    parts: [],
  },
  {
    id: "relieve",
    title: "Relieve hydraulic pressure",
    detail: "Key ON, engine OFF: move every joystick through its full travel a few times. Then slowly loosen the tank breather cap.",
    caution: "Oil may be hot. Stand to the side of the breather cap while it vents.",
    parts: ["tank"],
  },
  {
    id: "locate",
    title: "Locate and confirm the leak",
    detail: "Degrease the boom foot. Pass a piece of cardboard along hose H-3 and its fittings to find where oil is coming out.",
    caution:
      "Never feel for a leak with your hand. A pinhole jet can inject oil under the skin. Get medical help at once if that happens.",
    parts: ["hose_h3", "boom_cyl"],
  },
  {
    id: "remove",
    title: "Remove the damaged hose",
    detail: "Put a drip pan under it. Use a backup wrench on the fitting and undo both ends. Cap and plug the open ports right away. Tag the old hose for failure analysis.",
    parts: ["hose_h3"],
  },
  {
    id: "install",
    title: "Install the new hose assembly",
    detail: "Fit new O-rings, lightly oiled. Follow the hose's lay line so it is not twisted, and keep it clear of pinch points. Refit the clamps and torque the fittings to the manual's value for this fitting size.",
    parts: ["hose_h3", "boom_cyl"],
  },
  {
    id: "refill",
    title: "Top up the hydraulic oil",
    detail: `Put the boom in the service position shown on the tank decal. Fill to the FULL mark (about ${Math.ceil(OIL_LOST_L + 2)} L). Clean up any spill with absorbent pads.`,
    parts: ["tank"],
  },
  {
    id: "verify",
    title: "Restart and run a test cycle",
    detail: "Start the engine and idle. Cycle the boom slowly through full stroke three times to bleed out air. The system checks pressure, level and drift live.",
    parts: ["pump", "valve", "boom_cyl", "hose_h3"],
    verified: true,
  },
];

export const LABOUR_MIN = 55;

export const PARTS_LIST = [
  { name: "Hose assembly, boom cylinder head end (H-3)", ref: "HA-320-BCH3", qty: "1" },
  { name: "O-ring seal kit, -12 face seal", ref: "SK-ORFS-12", qty: "1" },
  { name: "Hydraulic oil, ISO VG 46", ref: "OIL-HV46", qty: `${Math.ceil(OIL_LOST_L + 2)} L` },
  { name: "Hose clamp, boom routing", ref: "CL-320-B2", qty: "2" },
  { name: "Absorbent spill pads", ref: "SPILL-10", qty: "10" },
];

export const TOOLS = [
  "Lockout tag and padlock",
  "Open-end wrench set with a backup wrench",
  "Torque wrench",
  "40 L drip pan and port caps",
  "Cardboard for leak tracing",
  "Safety glasses, face shield, nitrile gloves",
];

/* -------------------------------------------------------- Machine diagram */

export type PartId = "tank" | "pump" | "valve" | "hose_h3" | "hose_h4" | "boom_cyl" | "stick_cyl" | "bucket_cyl";

export interface PartInfo {
  id: PartId;
  name: string;
  ref: string;
  role: string;
}

export const PARTS: Record<PartId, PartInfo> = {
  tank: { id: "tank", name: "Hydraulic tank", ref: `${TANK_LITRES} L`, role: "Holds the oil; sight glass shows the level." },
  pump: { id: "pump", name: "Main pump", ref: "Twin variable piston", role: "Builds system pressure from engine power." },
  valve: { id: "valve", name: "Main control valve", ref: "MCV", role: "Routes flow to each cylinder as the joysticks ask for it." },
  hose_h3: { id: "hose_h3", name: "Hose H-3, boom head end", ref: "HA-320-BCH3", role: "Feeds the boom cylinders to raise the boom. Flexes at the boom foot." },
  hose_h4: { id: "hose_h4", name: "Hose H-4, boom rod end", ref: "HA-320-BCR4", role: "Return side of the boom cylinders." },
  boom_cyl: { id: "boom_cyl", name: "Boom cylinders", ref: "Pair", role: "Raise and lower the boom." },
  stick_cyl: { id: "stick_cyl", name: "Stick cylinder", ref: "Single", role: "Moves the stick in and out." },
  bucket_cyl: { id: "bucket_cyl", name: "Bucket cylinder", ref: "Single", role: "Curls the bucket." },
};

/* ------------------------------------------------------------ Derivation */

export type EventTone = "info" | "warn" | "crit" | "ok";

export interface FaultEvent {
  at: number;
  label: string;
  detail?: string;
  tone: EventTone;
}

export interface VerifyCheck {
  label: string;
  value: string;
  pass: boolean;
}

export interface FaultView {
  record: FaultRecord;
  /** The clock this view was derived at, epoch ms. */
  now: number;
  /** Seconds since the leak started. */
  tNow: number;
  phase: Phase;
  predictiveAt: number;
  detectedAt: number;
  safedAt: number;
  arrivedAt?: number;
  verifiedAt?: number;
  current: Sample;
  series: Sample[];
  events: FaultEvent[];
  verify: { checks: VerifyCheck[]; progress: number; passed: boolean } | null;
  /** Procedure steps that can be ticked right now. */
  nextStep: StepId | null;
}

const toS = (rec: FaultRecord, epoch?: number) => (epoch === undefined ? Infinity : (epoch - rec.startedAt) / 1000);
const toMs = (rec: FaultRecord, s: number) => rec.startedAt + s * 1000;

function timingFor(rec: FaultRecord): Timing {
  return {
    safeS: SAFE_S,
    refillS: toS(rec, rec.steps.refill),
    verifyS: toS(rec, rec.verifyStartedAt),
  };
}

export function sampleAt(rec: FaultRecord, t: number): Sample {
  return sampleWith(t, timingFor(rec));
}

function verification(rec: FaultRecord, tNow: number, tm: Timing): FaultView["verify"] {
  if (tm.verifyS === Infinity) return null;
  const elapsed = tNow - tm.verifyS;
  // Give pressure a few seconds to build before judging it.
  const w = range(tm.verifyS + 4, Math.max(tm.verifyS + 4, Math.min(tNow, tm.verifyS + TEST_S)), tm);
  const p = mean(w.map((s) => s.pressure));
  const ls = w.length > 2 ? slope(w, "level") * 60 : 0;
  const d = mean(w.map((s) => s.drift));
  const temp = w.length ? w[w.length - 1].temp : 0;
  const ready = elapsed >= 5;
  const checks: VerifyCheck[] = [
    { label: "Pressure at least 3,000 psi under test", value: ready ? `${Math.round(p).toLocaleString()} psi` : "building…", pass: ready && p >= 3000 },
    { label: "Tank level holding", value: ready ? `${ls.toFixed(2)} %/min` : "…", pass: ready && Math.abs(ls) < 1 },
    { label: "Boom drift under 5 mm/min", value: ready ? `${d.toFixed(1)} mm/min` : "…", pass: ready && d < 5 },
    { label: "Oil temperature under 90 °C", value: `${temp.toFixed(1)} °C`, pass: ready && temp < 90 },
  ];
  const progress = Math.min(1, Math.max(0, elapsed / TEST_S));
  return { checks, progress, passed: progress >= 1 && checks.every((c) => c.pass) };
}

export function deriveFault(rec: FaultRecord, now: number): FaultView {
  const tNow = (now - rec.startedAt) / 1000;
  const tm = timingFor(rec);
  const arrivedS = rec.dispatchedAt !== undefined ? toS(rec, rec.dispatchedAt) + ARRIVE_S : undefined;

  const verify = verification(rec, tNow, tm);
  const verifiedS = verify?.passed ? tm.verifyS + TEST_S : undefined;

  const handSteps = PROCEDURE.filter((s) => !s.verified);
  const allHandDone = handSteps.every((s) => rec.steps[s.id] !== undefined);

  let phase: Phase;
  if (rec.closedAt !== undefined) phase = "closed";
  else if (verifiedS !== undefined) phase = "verified";
  else if (tm.verifyS !== Infinity) phase = "verifying";
  else if (arrivedS !== undefined && tNow >= arrivedS) phase = "repairing";
  else if (rec.dispatchedAt !== undefined) phase = "dispatched";
  else if (tNow >= SAFE_S) phase = "safed";
  else if (tNow >= DETECT_S) phase = "detected";
  else if (tNow >= PREDICTIVE_S) phase = "degrading";
  else phase = "monitoring";

  let nextStep: StepId | null = null;
  if (phase === "repairing") {
    nextStep = handSteps.find((s) => rec.steps[s.id] === undefined)?.id ?? (allHandDone ? "verify" : null);
  }

  // Chart window: all history, thinned so a long session stays ~240 points.
  const end = Math.floor(tNow);
  const span = end + HISTORY_S;
  const step = Math.max(1, Math.ceil(span / 240));
  const series: Sample[] = [];
  for (let t = -HISTORY_S; t <= end; t += step) series.push(sampleWith(t, tm));

  const events: FaultEvent[] = [];
  const push = (s: number | undefined, label: string, tone: EventTone, detail?: string) => {
    if (s !== undefined && Number.isFinite(s) && s <= tNow) events.push({ at: toMs(rec, s), label, tone, detail });
  };
  push(PREDICTIVE_S, "Hydraulic health trending down", "warn", "Predictive check: tank level falling on a 12 s trend with no alarm yet.");
  push(DETECT_S, "Hydraulic leak detected", "crit", "Tank level falling fast and pressure below 85 % of normal.");
  push(DETECT_S + 1, "Operator alerted", "warn", "Cab display: lower the boom, idle down, shut down.");
  push(SAFE_S, "Machine safed", "ok", "Boom on the ground, engine off. Oil loss stopped.");
  if (rec.dispatchedAt !== undefined) {
    push(toS(rec, rec.dispatchedAt), `Work order ${rec.workOrder} issued`, "info", `${rec.technician ?? TECHNICIAN} dispatched with parts.`);
    push(arrivedS, "Technician on site", "info");
  }
  for (const s of PROCEDURE) {
    if (s.verified) continue;
    push(toS(rec, rec.steps[s.id]), s.title, "ok");
  }
  push(tm.verifyS, "Test cycle started", "info", "Engine restarted; boom cycled to bleed out air.");
  push(verifiedS, "Fix verified by telemetry", "ok", "Pressure restored, level holding, no drift.");
  push(toS(rec, rec.closedAt), `Work order ${rec.workOrder} closed`, "ok");
  events.sort((a, b) => b.at - a.at);

  return {
    record: rec,
    now,
    tNow,
    phase,
    predictiveAt: toMs(rec, PREDICTIVE_S),
    detectedAt: toMs(rec, DETECT_S),
    safedAt: toMs(rec, SAFE_S),
    arrivedAt: arrivedS !== undefined ? toMs(rec, arrivedS) : undefined,
    verifiedAt: verifiedS !== undefined ? toMs(rec, verifiedS) : undefined,
    current: sampleWith(tNow, tm),
    series,
    events,
    verify,
    nextStep,
  };
}

/** Readings either side of the repair, for the service report. */
export function beforeAfter(rec: FaultRecord) {
  const tm = timingFor(rec);
  const before = range(DETECT_S - 4, DETECT_S, { ...tm, verifyS: Infinity, refillS: Infinity });
  const after = tm.verifyS === Infinity ? [] : range(tm.verifyS + 6, tm.verifyS + TEST_S, tm);
  const pick = (w: Sample[]) => ({
    pressure: Math.round(mean(w.map((s) => s.pressure))),
    level: Number((w.at(-1)?.level ?? 0).toFixed(1)),
    temp: Number((w.at(-1)?.temp ?? 0).toFixed(1)),
    drift: Number(mean(w.map((s) => s.drift)).toFixed(1)),
  });
  return { before: pick(before), after: pick(after), baseline: { pressure: BASE_PRESSURE, level: BASE_LEVEL, temp: BASE_TEMP, drift: BASE_DRIFT } };
}

export function newFaultRecord(now = Date.now()): FaultRecord {
  const n = String(Math.floor(now / 1000) % 10_000).padStart(4, "0");
  return { id: `BR-${n}`, workOrder: `WO-${n}`, machineId: MACHINE.id, startedAt: now, steps: {} };
}

/** Rewind the clock so the leak is already a few seconds from splitting. */
export function skipToFailure(rec: FaultRecord, now = Date.now()): FaultRecord {
  const t = (now - rec.startedAt) / 1000;
  if (t >= RUPTURE_S - 2) return rec;
  return { ...rec, startedAt: now - (RUPTURE_S - 2) * 1000 };
}
