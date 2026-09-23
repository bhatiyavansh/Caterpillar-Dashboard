/**
 * Translation between the simulator's wire format and the twin's telemetry.
 *
 * Kept pure and separate from the socket so it can be unit-tested and reused by
 * any future transport. Nothing here touches the network or React.
 *
 * Coordinate frames
 * -----------------
 * The simulator works in real metres on a 400 x 300 site with the origin at the
 * south-west corner, x east and y north. The twin works in real metres too, but
 * centred on the origin with north along -Z.
 *
 * The conversion is a **translation only — never a scale**. Scaling would
 * silently distort every distance in the scene, and this is a safety demo: a
 * 10 m proximity ring has to be 10 m. Keeping 1 m = 1 unit means the bubble the
 * operator sees and the `nearest_person_m` the HUD prints are the same number.
 */

import type { MachineActivity, MachineTelemetry, SiteWorker } from "@/types/twin";
import { ARM_LIMITS, DEG } from "./telemetry";
import { clamp } from "./site";
import { terrainHeight } from "./terrain";

/**
 * Centre of the simulator's working area (machines span x 46-339, y 118-266).
 * Putting this at the twin's origin keeps the live fleet inside the terrain.
 */
export const LIVE_ORIGIN = { x: 192, y: 192 } as const;

export function liveToWorldX(x: number): number {
  return x - LIVE_ORIGIN.x;
}

/** Their +y is north; the twin's north is -Z. */
export function liveToWorldZ(y: number): number {
  return -(y - LIVE_ORIGIN.y);
}

/* ------------------------------ wire types ----------------------------- */

export interface LiveMachineState {
  type: "machine_state";
  machine_id: string;
  model: string;
  machine_type: string;
  operator_id: string;
  status: string;
  pos: { x: number; y: number; lat?: number; lon?: number };
  heading_deg: number;
  speed_mps: number;
  intent: string;
  engine_on: boolean;
  engine_hours: number;
  fuel_level_pct: number;
  load_cycles: number;
  idle_min: number;
  seatbelt: string;
  boom_angle_deg: number;
  stick_angle_deg: number;
  swing_angle_deg: number;
  payload_kg: number;
  hydraulic_temp_c: number;
  coolant_temp_c: number;
  pitch_deg: number;
  roll_deg: number;
  tip_over_margin: number;
  bubble: "green" | "amber" | "red";
  nearest_person_m: number | null;
  fatigue_score: number;
  zone: string | null;
  task_id: string | null;
  task_progress: number | null;
  task_eta_min: number | null;
}

export interface LiveWorkerState {
  type: "worker_state";
  worker_id: string;
  pos: { x: number; y: number };
  zone: string | null;
}

export interface LiveEvent {
  type: "event";
  id: string;
  ts: string;
  event: string;
  severity: "info" | "medium" | "high" | "critical";
  machine_id: string | null;
  source: string;
  message: string;
  data: Record<string, unknown>;
}

/* --------------------------- field mapping ----------------------------- */

/**
 * The simulator reports what the machine is *trying* to do; the twin labels
 * what it *is* doing. Speed wins, because a travelling machine is travelling
 * whatever its implement is up to.
 */
export function mapActivity(intent: string, status: string, speed: number): MachineActivity {
  if (status === "estop" || status === "emergency_stop") return "emergency_stop";
  if (Math.abs(speed) > 0.5) return "traveling";
  if (intent.includes("swing")) return "swinging";
  if (intent === "dump" || intent === "load" || intent === "tip") return "loading";
  if (intent === "dig" || intent === "push" || intent === "grade" || intent === "cut") {
    return "digging";
  }
  if (status === "idle" || intent === "idle") return "idle";
  return "idle";
}

/**
 * The simulator has no bucket channel, so the twin infers a pose from intent.
 * Purely cosmetic — nothing downstream reads it as a measurement.
 */
export function inferBucketAngle(intent: string): number {
  if (intent === "dig" || intent === "cut") return ARM_LIMITS.bucket.max * 0.8;
  if (intent === "dump" || intent === "tip") return ARM_LIMITS.bucket.min * 0.75;
  if (intent === "load") return ARM_LIMITS.bucket.max * 0.4;
  return 0;
}

/**
 * Engine speed, reconstructed. The simulator does not publish RPM, so the twin
 * derives it the same way its own vehicle model does — load and travel raise
 * it above an 800 rpm idle — purely so the dial moves in sympathy with the work.
 */
export function inferEngineRpm(msg: LiveMachineState): number {
  if (!msg.engine_on) return 0;
  const speedRatio = Math.min(Math.abs(msg.speed_mps) / 3, 1);
  const working = msg.intent !== "idle" && msg.status !== "idle" ? 1 : 0;
  const load = Math.min(msg.payload_kg / 2400, 1);
  return clamp(800 + speedRatio * 900 + working * 420 + load * 150, 700, 2200);
}

/** One `machine_state` message as twin telemetry. */
export function toTelemetry(msg: LiveMachineState): MachineTelemetry {
  const x = liveToWorldX(msg.pos.x);
  const z = liveToWorldZ(msg.pos.y);

  return {
    machineId: msg.machine_id,
    x,
    // The twin owns the ground, so height comes from its own terrain.
    y: terrainHeight(x, z),
    z,
    speed: msg.speed_mps,
    // Both sides use 0 = north, clockwise positive.
    heading: msg.heading_deg * DEG,
    engineRpm: inferEngineRpm(msg),
    fuel: msg.fuel_level_pct,
    boomAngle: clamp(msg.boom_angle_deg * DEG, ARM_LIMITS.boom.min, ARM_LIMITS.boom.max),
    stickAngle: clamp(msg.stick_angle_deg * DEG, ARM_LIMITS.stick.min, ARM_LIMITS.stick.max),
    bucketAngle: inferBucketAngle(msg.intent),
    swingAngle: msg.swing_angle_deg * DEG,
    pitch: msg.pitch_deg * DEG,
    roll: msg.roll_deg * DEG,
    payload: msg.payload_kg,
    hydraulicTemperature: msg.hydraulic_temp_c,
    // `null` means nobody is being tracked, which is Infinity to the twin.
    nearestPerson: msg.nearest_person_m ?? Infinity,
    tipOverMargin: msg.tip_over_margin,
    activity: mapActivity(msg.intent, msg.status, msg.speed_mps),
  };
}

/** One `worker_state` message as a twin worker. */
export function toWorker(msg: LiveWorkerState, previous?: SiteWorker): SiteWorker {
  const x = liveToWorldX(msg.pos.x);
  const z = liveToWorldZ(msg.pos.y);
  // Face the direction of travel, so the figures do not moonwalk.
  const heading = previous ? Math.atan2(x - previous.x, -(z - previous.z)) : 0;
  const moved = previous ? Math.hypot(x - previous.x, z - previous.z) > 0.05 : true;

  return {
    id: msg.worker_id,
    x,
    z,
    state: moved ? "walking" : "idle",
    heading: moved ? heading : (previous?.heading ?? 0),
    phase: previous?.phase ?? Math.random() * Math.PI * 2,
  };
}

