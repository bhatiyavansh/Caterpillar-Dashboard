/**
 * Three real-world hazard scenarios, generated as 120 Hz telemetry.
 *
 * Each scenario is simulated twice from the same starting conditions:
 *
 *   assisted        what happens with CAT Operator Assist fitted: sensors
 *                   detect the hazard and the system intervenes.
 *   counterfactual  the same operator inputs with no assist system, run to
 *                   the outcome the system exists to prevent.
 *
 * Both are stepped with small fixed-step physics at exactly 120 Hz, so every
 * frame is internally consistent (speed integrates to position, slew rate to
 * slew angle, and so on). A seeded noise source adds realistic sensor jitter;
 * the same seed always yields the same data.
 *
 * Pure and dependency-free: the display imports it, and
 * `scripts/export-scenarios.ts` runs it under plain Node to write the dataset.
 */

export const FPS = 120;
const DT = 1 / FPS;

export type ScenarioId = "blind_spot_reversal" | "wet_slope_rollover" | "fatigue_microsleep";
export type Phase = "normal" | "hazard" | "intervention" | "recovered";
export type Actor = "hazard" | "system" | "operator" | "outcome";

/** One sample. Machine pose is local to its start: +forward along the tracks, +right. */
export interface Frame {
  t: number;
  /** Metres travelled along the track heading (negative = reversed). */
  travel: number;
  /** m/s along the heading. */
  speed: number;
  swingDeg: number;
  boomDeg: number;
  stickDeg: number;
  bucketDeg: number;
  payloadKg: number;
  /** Cross-slope, degrees (positive rolls the machine to its left). */
  rollDeg: number;
  tipMargin: number;
  hydC: number;
  /** Person in the scenario, machine-start frame: metres right / forward. */
  personRight: number;
  personFwd: number;
  personWalking: boolean;
  /** Centre-to-person distance, metres. */
  personDist: number;
  seatbelt: boolean;
  /** Camera signals, 0-1 (face blendshape scale). */
  eyesClosed: number;
  jawOpen: number;
  /** Camera detections after the same hold times the live camera uses. */
  camDrowsy: boolean;
  camYawn: boolean;
  phase: Phase;
  /** Counterfactual (no assist) channels. */
  cfSpeed: number;
  cfSwingDeg: number;
  cfTipMargin: number;
  cfPersonDist: number;
  /** Clearance from the moving hazard (bucket or counterweight) to the person, metres. */
  cfClearance: number;
}

export interface ScenarioEvent {
  t: number;
  actor: Actor;
  level: 1 | 2 | 3;
  title: string;
  detail: string;
}

export interface Scenario {
  id: ScenarioId;
  title: string;
  subtitle: string;
  why: string;
  risk: string;
  howItHelps: string[];
  weather: "clear" | "rain" | "fog" | "heat";
  ambientC: number;
  clock: string;
  fps: number;
  duration: number;
  frames: Frame[];
  events: ScenarioEvent[];
  outcome: { assisted: string; unassisted: string; unassistedAt: number | null };
}

/* ------------------------------------------------------------ helpers */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (e0: number, e1: number, x: number) => {
  const k = clamp((x - e0) / (e1 - e0), 0, 1);
  return k * k * (3 - 2 * k);
};
/** Move `v` toward `target` at no more than `rate` per second. */
const approach = (v: number, target: number, rate: number) => (Math.abs(target - v) <= rate * DT ? target : v + Math.sign(target - v) * rate * DT);
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const DEG = Math.PI / 180;

/** Stability model shared by all scenarios. Calibrated so a full-reach, full-load lift straight downhill on 12° is below 1.0. */
function tipMargin(o: { rollDeg: number; swingDeg: number; stickDeg: number; boomDeg: number; payloadKg: number }) {
  const reach = clamp(0.35 + (o.stickDeg / 60) * 0.45 + (1 - Math.abs(o.boomDeg - 25) / 50) * 0.2, 0, 1.1);
  const load = o.payloadKg / 2800;
  // Downhill is to the machine's left (negative slew) when rollDeg > 0.
  const downhill = 0.3 + 0.7 * clamp(Math.sin(-o.swingDeg * DEG) * Math.sign(o.rollDeg || 1), 0, 1);
  const slope = Math.abs(o.rollDeg) / 12;
  return 2.45 - 0.35 * slope - 1.45 * reach * load * downhill * (0.6 + 0.4 * slope);
}

/** Tracks the camera's hold logic: a condition must persist before it counts. */
function holder(holdS: number) {
  let since: number | null = null;
  return (cond: boolean, t: number) => {
    if (!cond) {
      since = null;
      return false;
    }
    since ??= t;
    return t - since >= holdS;
  };
}

const PROX_WARN = 10;
const PROX_CRIT = 6;
/** Excavator rear swing radius (counterweight), metres from centre. */
const TAIL_RADIUS = 2.9;
/** Bucket tip radius at working reach, metres from centre. */
const REACH = 8.2;

/* ============================================= 1. Blind-spot reversal */

function blindSpot(): Scenario {
  const noise = rng(11);
  const duration = 18;
  const frames: Frame[] = [];
  const events: ScenarioEvent[] = [];
  const once = new Set<string>();
  const ev = (key: string, e: ScenarioEvent) => {
    if (once.has(key)) return;
    once.add(key);
    events.push(e);
  };

  // Assisted world.
  let s = 0;
  let v = 0;
  let phase: Phase = "normal";
  let hold = false;
  let clearSince: number | null = null;
  let wRight = -3.5;
  let wFwd = -19;
  let heardAt: number | null = null;
  // Counterfactual world.
  let cs = 0;
  let cv = 0;
  let cwRight = -3.5;
  let cwFwd = -19;
  let contactAt: number | null = null;

  for (let i = 0; i <= duration * FPS; i++) {
    const t = i * DT;
    // Operator intent: reverse at ~3.2 km/h from t=1 to reposition for the next truck.
    const intent = t > 1 ? -0.9 : 0;

    // Banksman: walks from behind-left toward the machine's path, head down, to pick up a dropped radio.
    const walkTarget = { r: 0.4, f: -3.5 };
    const walkSpeed = t > 1.5 ? 1.35 : 0;
    const step = (r: number, f: number, speed: number) => {
      const dr = walkTarget.r - r;
      const df = walkTarget.f - f;
      const d = Math.hypot(dr, df);
      if (d < 0.05) return { r, f };
      const k = Math.min(1, (speed * DT) / d);
      return { r: r + dr * k, f: f + df * k };
    };

    // ---- assisted ----
    const dist = Math.hypot(wRight, wFwd - s);
    if (dist < PROX_WARN && phase === "normal") {
      phase = "hazard";
      ev("warn", { t, actor: "hazard", level: 2, title: "Person entering the rear blind spot", detail: `Rear radar + camera: banksman ${dist.toFixed(1)} m behind while reversing.` });
      ev("slow", { t, actor: "system", level: 2, title: "Travel speed limited to 1.2 km/h", detail: "Reverse alarm escalated. Travel governor applied." });
    }
    if (dist < PROX_CRIT && !hold) {
      hold = true;
      phase = "intervention";
      ev("stop", { t, actor: "system", level: 3, title: "Automatic travel stop", detail: `Person ${dist.toFixed(1)} m behind. Travel brakes applied, horn sounded, incident logged.` });
      heardAt = t + 0.9;
    }
    const target = hold ? 0 : phase === "hazard" ? Math.max(intent, -0.33) : intent;
    v = approach(v, target, hold ? 1.8 : 0.9);
    s += v * DT;
    if (heardAt !== null && t > heardAt) {
      // Horn heard: banksman stops, looks up, steps sideways out of the path.
      wRight = approach(wRight, 7.5, 1.6);
      wFwd = approach(wFwd, wFwd, 0);
      if (t < heardAt + 0.1) ev("clear-start", { t, actor: "operator", level: 1, title: "Banksman hears the horn and steps clear", detail: "Moves out of the travel path toward the haul road." });
    } else {
      const n = step(wRight, wFwd, walkSpeed);
      wRight = n.r;
      wFwd = n.f;
    }
    const distAfter = Math.hypot(wRight, wFwd - s);
    if (hold && distAfter > PROX_WARN) {
      clearSince ??= t;
      if (t - clearSince > 1.5) {
        hold = false;
        phase = "recovered";
        ev("release", { t, actor: "system", level: 1, title: "Zone clear, travel released", detail: "Operator acknowledged. Reversing resumes at limited speed." });
      }
    }

    // ---- counterfactual ----
    cv = approach(cv, intent, 0.9);
    if (contactAt === null) cs += cv * DT;
    const cn = contactAt === null ? step(cwRight, cwFwd, walkSpeed) : { r: cwRight, f: cwFwd };
    cwRight = cn.r;
    cwFwd = cn.f;
    const cfDist = Math.hypot(cwRight, cwFwd - cs);
    const clearance = cfDist - TAIL_RADIUS;
    if (clearance <= 0 && contactAt === null) contactAt = t;

    frames.push({
      t: r3(t),
      travel: r3(s),
      speed: r3(v + (noise() - 0.5) * 0.01 * Math.abs(v)),
      swingDeg: 0,
      boomDeg: 22,
      stickDeg: -10,
      bucketDeg: 30,
      payloadKg: 0,
      rollDeg: 0,
      tipMargin: r3(2.3 + (noise() - 0.5) * 0.01),
      hydC: r3(64 + t * 0.05 + (noise() - 0.5) * 0.3),
      personRight: r3(wRight),
      personFwd: r3(wFwd),
      personWalking: heardAt === null ? t > 1.5 : Math.abs(wRight - 7.5) > 0.05,
      personDist: r3(distAfter + (noise() - 0.5) * 0.05),
      seatbelt: true,
      eyesClosed: r3(0.05 + noise() * 0.05),
      jawOpen: r3(0.05 + noise() * 0.04),
      camDrowsy: false,
      camYawn: false,
      phase,
      cfSpeed: r3(contactAt === null ? cv : 0),
      cfSwingDeg: 0,
      cfTipMargin: 2.3,
      cfPersonDist: r3(cfDist),
      cfClearance: r3(Math.max(0, clearance)),
    });
  }

  return {
    id: "blind_spot_reversal",
    title: "Blind-spot reversal",
    subtitle: "Banksman walks behind a reversing excavator",
    why: "Struck-by incidents are one of OSHA's Fatal Four. Reversing and slewing machines kill ground workers in the zone the operator cannot see.",
    risk: "Operator reversing at 3 km/h to reposition for the next truck. A banksman, head down, walks into the travel path behind the counterweight to pick up a dropped radio.",
    howItHelps: [
      "Rear radar and camera see the person at 10 m",
      "Travel governor limits reverse to 1.2 km/h and escalates the alarm",
      "At 6 m the machine stops itself and sounds the horn",
      "Travel stays locked until the zone is clear; the near miss is logged",
    ],
    weather: "clear",
    ambientC: 31,
    clock: "07:42:10",
    fps: FPS,
    duration,
    frames,
    events: ([
      { t: 1.0, actor: "operator", level: 1, title: "Operator starts reversing", detail: "Repositioning for the next truck at ~3 km/h." },
      { t: 1.5, actor: "hazard", level: 1, title: "Banksman walks toward the path", detail: "Head down, looking for a dropped radio. Not in the operator's mirrors." },
      ...events,
      ...(contactAt !== null
        ? [{ t: contactAt, actor: "outcome" as const, level: 3 as const, title: "Without assist: counterweight strikes the banksman", detail: "Machine still reversing at 3.2 km/h. Operator never saw him." }]
        : []),
    ] as ScenarioEvent[]).sort((a, b) => a.t - b.t),
    outcome: {
      assisted: `Machine stopped itself. Closest approach ${Math.min(...frames.map((f) => f.personDist)).toFixed(1)} m from the machine centre, ${(Math.min(...frames.map((f) => f.personDist)) - TAIL_RADIUS).toFixed(1)} m from the counterweight. Near miss logged.`,
      unassisted: "Counterweight strikes the banksman while reversing. Fatal struck-by.",
      unassistedAt: contactAt,
    },
  };
}

/* ========================================== 2. Wet-slope rollover */

function wetSlope(): Scenario {
  const noise = rng(23);
  const duration = 20;
  const frames: Frame[] = [];
  const events: ScenarioEvent[] = [];
  const once = new Set<string>();
  const ev = (key: string, e: ScenarioEvent) => {
    if (!once.has(key)) {
      once.add(key);
      events.push(e);
    }
  };
  const ROLL = 12;
  const LOAD = 2800;

  let boom = 12;
  let stick = 0;
  let swing = 0;
  let belt = true;
  let phase: Phase = "normal";
  let lockUntilBelt = false;
  let retracting = false;
  // Counterfactual.
  let cBoom = 12;
  let cStick = 0;
  let cSwing = 0;
  let rolledAt: number | null = null;

  for (let i = 0; i <= duration * FPS; i++) {
    const t = i * DT;

    // Operator intent (both worlds): lift the pipe, reach out over the trench, slew downhill to lay it.
    const boomIntent = t < 2.5 ? 34 : 34;
    const stickIntent = t > 1 ? 48 : 0;
    const slewIntent = t > 3.5 ? -95 : 0;
    const beltOffAt = 2.6;

    // ---- assisted ----
    if (t >= beltOffAt && t < 5.4 && belt) {
      belt = false;
      lockUntilBelt = true;
      phase = "intervention";
      ev("belt", { t, actor: "hazard", level: 3, title: "Seatbelt released on a 12° slope", detail: "Operator unbuckles to lean out and see the trench edge." });
      ev("lock", { t, actor: "system", level: 3, title: "Hydraulic lockout", detail: "Seatbelt interlock freezes boom, stick and slew with the load held." });
    }
    if (t >= 5.4 && !belt) {
      belt = true;
      lockUntilBelt = false;
      phase = "hazard";
      ev("rebuckle", { t, actor: "operator", level: 1, title: "Operator re-fastens the belt", detail: "Hydraulics released." });
    }
    const pre = tipMargin({ rollDeg: ROLL, swingDeg: swing, stickDeg: stick, boomDeg: boom, payloadKg: LOAD });
    let slewRate = 22;
    if (pre < 1.55 && !retracting) {
      slewRate = 7;
      ev("slow", { t, actor: "system", level: 2, title: "Slew slowed: stability falling", detail: `Margin ${pre.toFixed(2)}×. Slew speed cut to 30%.` });
    }
    if (pre < 1.3 && !retracting) {
      retracting = true;
      phase = "intervention";
      ev("limit", { t, actor: "system", level: 3, title: "Downhill slew blocked", detail: `Margin ${pre.toFixed(2)}×. Retract the stick and lower the load to continue.` });
    }
    if (!lockUntilBelt) {
      boom = approach(boom, retracting ? 16 : boomIntent, 9);
      stick = approach(stick, retracting ? 8 : stickIntent, retracting ? 16 : 14);
      if (!retracting) swing = approach(swing, slewIntent, slewRate);
      else if (stick < 12) {
        // Load close in: slewing downhill is safe again.
        swing = approach(swing, slewIntent, 10);
        if (phase !== "recovered") {
          phase = "recovered";
          ev("ok", { t, actor: "system", level: 1, title: "Load in close, slew released", detail: "Margin back above 1.6×. Pipe laid with the load tucked in." });
        }
      }
    }
    const margin = tipMargin({ rollDeg: ROLL, swingDeg: swing, stickDeg: stick, boomDeg: boom, payloadKg: LOAD });

    // ---- counterfactual: belt off from 2.6 s, nothing intervenes ----
    if (rolledAt === null) {
      cBoom = approach(cBoom, boomIntent, 9);
      cStick = approach(cStick, stickIntent, 14);
      cSwing = approach(cSwing, slewIntent, 22);
    }
    const cMargin = tipMargin({ rollDeg: ROLL, swingDeg: cSwing, stickDeg: cStick, boomDeg: cBoom, payloadKg: LOAD });
    if (cMargin < 1.0 && rolledAt === null) rolledAt = t;

    frames.push({
      t: r3(t),
      travel: 0,
      speed: 0,
      swingDeg: r3(swing),
      boomDeg: r3(boom),
      stickDeg: r3(stick),
      bucketDeg: 20,
      payloadKg: LOAD,
      rollDeg: ROLL,
      tipMargin: r3(margin + (noise() - 0.5) * 0.008),
      hydC: r3(71 + t * 0.12 + (noise() - 0.5) * 0.3),
      // Pipe layer standing well uphill, outside the swing radius.
      personRight: 9,
      personFwd: 11,
      personWalking: false,
      personDist: r3(Math.hypot(9, 11)),
      seatbelt: belt,
      eyesClosed: r3(0.06 + noise() * 0.05),
      jawOpen: r3(0.05 + noise() * 0.04),
      camDrowsy: false,
      camYawn: false,
      phase,
      cfSpeed: 0,
      cfSwingDeg: r3(cSwing),
      cfTipMargin: r3(Math.max(0, cMargin)),
      cfPersonDist: r3(Math.hypot(9, 11)),
      cfClearance: r3(Math.max(0, cMargin - 1)),
    });
  }

  return {
    id: "wet_slope_rollover",
    title: "Rollover on a wet slope",
    subtitle: "Full-reach lift slewing downhill, operator unbelted",
    why: "Rollovers are among the deadliest excavator accidents, and the operators killed are overwhelmingly those not wearing a seatbelt, ejected and crushed by the cab.",
    risk: "Rain, soft ground, 12° cross-slope. Operator lifts a 2.8 t pipe section, reaches out over the trench, unbuckles to lean out and see the edge, then slews downhill.",
    howItHelps: [
      "Seatbelt interlock freezes the hydraulics the moment the belt opens",
      "Live stability margin from slope, reach, load and slew angle",
      "Slew slowed below 1.55× and blocked downhill below 1.3×",
      "Guides the operator to tuck the load in, then releases",
    ],
    weather: "rain",
    ambientC: 24,
    clock: "10:15:40",
    fps: FPS,
    duration,
    frames,
    events: ([
      { t: 0.5, actor: "operator", level: 1, title: "Lifting a 2.8 t pipe section", detail: "Wet clay, 12° cross-slope toward the trench." },
      ...events,
      ...(rolledAt !== null
        ? [{ t: rolledAt, actor: "outcome" as const, level: 3 as const, title: "Without assist: machine rolls downhill", detail: "Stability margin below 1.0× at full reach. Unbelted operator ejected." }]
        : []),
    ] as ScenarioEvent[]).sort((a, b) => a.t - b.t),
    outcome: {
      assisted: `Load laid safely. Stability never fell below ${Math.min(...frames.map((f) => f.tipMargin)).toFixed(2)}×, and no load moved while the belt was open.`,
      unassisted: "Machine rolls into the trench with an unbelted operator. Ejection and crush injury.",
      unassistedAt: rolledAt,
    },
  };
}

/* ========================================= 3. Fatigue microsleep */

function microsleep(): Scenario {
  const noise = rng(37);
  const duration = 22;
  const frames: Frame[] = [];
  const events: ScenarioEvent[] = [];
  const once = new Set<string>();
  const ev = (key: string, e: ScenarioEvent) => {
    if (!once.has(key)) {
      once.add(key);
      events.push(e);
    }
  };
  const yawnHold = holder(1.0);
  const drowsyHold = holder(1.2);
  // Truck driver standing by his cab, 7 m out at 125° right: inside the loaded swing path past the dump point.
  const personAngle = 125;
  const personR = 7.4;
  const pRight = Math.sin(personAngle * DEG) * personR;
  const pFwd = Math.cos(personAngle * DEG) * personR;
  const DUMP = 85;

  let swing = 0;
  let swingV = 0;
  let phase: Phase = "normal";
  let held = false;
  let ackAt: number | null = null;
  let cSwing = 0;
  let cSwingV = 0;
  let strikeAt: number | null = null;

  for (let i = 0; i <= duration * FPS; i++) {
    const t = i * DT;

    // Operator's face: yawns at 2 s and 5.5 s, then a microsleep from 8.0 s to 12.6 s.
    const yawn = smooth(1.8, 2.4, t) * (1 - smooth(3.6, 4.1, t)) + smooth(5.4, 5.9, t) * (1 - smooth(7.0, 7.4, t));
    const asleep = t > 8.0 && t < 12.6;
    const blink = (Math.sin(t * 2.1) > 0.985 ? 0.9 : 0.08) + noise() * 0.04;
    const eyes = asleep ? 0.93 + noise() * 0.04 : blink;
    const jaw = 0.05 + yawn * 0.82 + noise() * 0.03;
    const camYawn = yawnHold(jaw > 0.55, t);
    const camDrowsy = drowsyHold(eyes > 0.5, t);

    // Operator intent: truck-loading cycle, loaded swing right to the dump point and back.
    // During the microsleep the hand stays on the joystick and the house keeps swinging past the dump point.
    const cycle = (t % 9) / 9;
    // 2.4 s loaded swing out (~85°), 1.2 s dump, 2.4 s swing back, 3 s dig.
    let intentV = cycle < 0.2667 ? 38 : cycle < 0.4 ? 0 : cycle < 0.6667 ? -38 : 0;
    if (asleep) intentV = 34;

    // ---- assisted ----
    if (camYawn) {
      ev("yawn", { t, actor: "system", level: 1, title: "Fatigue signs detected", detail: "Cab camera: repeated yawning in the 10th hour of shift. Break suggested." });
      if (phase === "normal") phase = "hazard";
    }
    if (camDrowsy && !held) {
      held = true;
      phase = "intervention";
      ev("sleep", { t, actor: "hazard", level: 3, title: "Microsleep: eyes closed 1.2 s", detail: `Loaded bucket swinging at ${Math.abs(swingV).toFixed(0)}°/s toward the truck driver.` });
      ev("hold", { t, actor: "system", level: 3, title: "Swing held, seat vibration and alarm", detail: "Hydraulics soft-stopped. Operator must acknowledge to continue." });
    }
    if (held && !asleep && ackAt === null) {
      ackAt = t + 0.8;
    }
    if (ackAt !== null && t > ackAt && phase === "intervention") {
      phase = "recovered";
      ev("ack", { t, actor: "operator", level: 1, title: "Operator wakes and acknowledges", detail: "Bucket returned to the dump point. Break logged, supervisor notified." });
    }
    const target = held && phase === "intervention" ? 0 : phase === "recovered" ? (swing > DUMP ? -12 : 0) : intentV;
    swingV = approach(swingV, target, held ? 220 : 90);
    swing = clamp(swing + swingV * DT, -10, 160);

    // ---- counterfactual ----
    if (strikeAt === null) {
      cSwingV = approach(cSwingV, intentV, 90);
      cSwing = clamp(cSwing + cSwingV * DT, -10, 160);
    }
    const bucketR = Math.sin(cSwing * DEG) * REACH;
    const bucketF = Math.cos(cSwing * DEG) * REACH;
    const clearance = Math.hypot(bucketR - pRight, bucketF - pFwd) - 1.4;
    if (clearance <= 0 && strikeAt === null) strikeAt = t;

    frames.push({
      t: r3(t),
      travel: 0,
      speed: 0,
      swingDeg: r3(swing),
      boomDeg: r3(28 + Math.sin(t * 0.7) * 3),
      stickDeg: 20,
      bucketDeg: 35,
      payloadKg: 1900,
      rollDeg: 0,
      tipMargin: r3(1.95 + (noise() - 0.5) * 0.01),
      hydC: r3(86 + t * 0.08 + (noise() - 0.5) * 0.3),
      personRight: r3(pRight),
      personFwd: r3(pFwd),
      personWalking: false,
      personDist: personR,
      seatbelt: true,
      eyesClosed: r3(eyes),
      jawOpen: r3(jaw),
      camDrowsy,
      camYawn,
      phase,
      cfSpeed: 0,
      cfSwingDeg: r3(cSwing),
      cfTipMargin: 1.95,
      cfPersonDist: personR,
      cfClearance: r3(Math.max(0, clearance)),
    });
  }

  return {
    id: "fatigue_microsleep",
    title: "Microsleep in the 10th hour",
    subtitle: "Loaded swing continues past the truck while the operator dozes",
    why: "Fatigue is a leading contributor to plant accidents on long, hot shifts. A 1-2 second microsleep with a hand on the joystick keeps a loaded bucket moving.",
    risk: "41°C afternoon, 10th hour of a 12-hour shift, repetitive truck loading. The truck driver stands beside his cab, just past the dump point. The operator yawns, then nods off mid-swing.",
    howItHelps: [
      "Cab camera spots yawning and suggests a break early",
      "Eyes closed for 1.2 s triggers an alarm, seat vibration and swing hold",
      "Swing stays held until the operator acknowledges",
      "Fatigue event logged, so the supervisor can rotate the operator",
    ],
    weather: "heat",
    ambientC: 41,
    clock: "15:48:20",
    fps: FPS,
    duration,
    frames,
    events: ([
      { t: 0.5, actor: "operator", level: 1, title: "Loading a dump truck", detail: "Loaded swing right to ~85°, 9 s cycle. Truck driver standing by his cab." },
      ...events,
      ...(strikeAt !== null
        ? [{ t: strikeAt, actor: "outcome" as const, level: 3 as const, title: "Without assist: bucket strikes the truck driver", detail: "Swing continues past the dump point during the microsleep." }]
        : []),
    ] as ScenarioEvent[]).sort((a, b) => a.t - b.t),
    outcome: {
      assisted: `Swing held at ${Math.max(...frames.filter((f) => f.phase !== "normal").map((f) => f.swingDeg)).toFixed(0)}°, short of the driver at ${personAngle}°. Operator woke, acknowledged and was rotated to a break.`,
      unassisted: "Loaded bucket swings through the truck driver standing by his cab.",
      unassistedAt: strikeAt,
    },
  };
}

/* ----------------------------------------------------------- catalog */

const BUILDERS: Record<ScenarioId, () => Scenario> = {
  blind_spot_reversal: blindSpot,
  wet_slope_rollover: wetSlope,
  fatigue_microsleep: microsleep,
};

export const SCENARIO_IDS = Object.keys(BUILDERS) as ScenarioId[];

const cache = new Map<ScenarioId, Scenario>();
export function getScenario(id: ScenarioId): Scenario {
  let s = cache.get(id);
  if (!s) {
    s = BUILDERS[id]();
    cache.set(id, s);
  }
  return s;
}

/** Linear interpolation between the two frames around `t`. */
export function frameAt(s: Scenario, t: number): Frame {
  const x = clamp(t, 0, s.duration) * s.fps;
  const i = Math.min(Math.floor(x), s.frames.length - 1);
  const a = s.frames[i];
  const b = s.frames[Math.min(i + 1, s.frames.length - 1)];
  const k = x - i;
  const lerp = (p: number, q: number) => p + (q - p) * k;
  return {
    ...a,
    t,
    travel: lerp(a.travel, b.travel),
    speed: lerp(a.speed, b.speed),
    swingDeg: lerp(a.swingDeg, b.swingDeg),
    boomDeg: lerp(a.boomDeg, b.boomDeg),
    stickDeg: lerp(a.stickDeg, b.stickDeg),
    tipMargin: lerp(a.tipMargin, b.tipMargin),
    personRight: lerp(a.personRight, b.personRight),
    personFwd: lerp(a.personFwd, b.personFwd),
    personDist: lerp(a.personDist, b.personDist),
    cfClearance: lerp(a.cfClearance, b.cfClearance),
    cfTipMargin: lerp(a.cfTipMargin, b.cfTipMargin),
  };
}

export const CSV_COLUMNS: (keyof Frame)[] = [
  "t", "phase", "travel", "speed", "swingDeg", "boomDeg", "stickDeg", "bucketDeg", "payloadKg", "rollDeg", "tipMargin", "hydC",
  "personRight", "personFwd", "personWalking", "personDist", "seatbelt", "eyesClosed", "jawOpen", "camYawn", "camDrowsy",
  "cfSpeed", "cfSwingDeg", "cfTipMargin", "cfPersonDist", "cfClearance",
];

export function toCsv(s: Scenario): string {
  const rows = s.frames.map((f) => CSV_COLUMNS.map((c) => (typeof f[c] === "boolean" ? (f[c] ? 1 : 0) : f[c])).join(","));
  return [CSV_COLUMNS.join(","), ...rows].join("\n");
}
