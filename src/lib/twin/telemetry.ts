/**
 * Telemetry helpers and the provider seam.
 *
 * Nothing here knows about React or Three.js. The same functions serve the
 * keyboard path and the mock IoT path, which is what guarantees both sources
 * produce an identical `MachineTelemetry` shape.
 */

import type {
  MachineActivity,
  MachineTelemetry,
  TelemetryProvider,
  VehicleInput,
} from "@/types/twin";
import { clamp, headingVector } from "./site";
import { sampleAttitude, terrainHeight } from "./terrain";

export const DEG = Math.PI / 180;

/** Clamped joint ranges, straight from the spec. */
export const ARM_LIMITS = {
  boom: { min: -20 * DEG, max: 70 * DEG },
  stick: { min: -60 * DEG, max: 60 * DEG },
  bucket: { min: -70 * DEG, max: 70 * DEG },
} as const;

/** Radians per second at full deflection. Tuned to feel hydraulic, not twitchy. */
export const ARM_RATES = {
  boom: 0.45,
  stick: 0.55,
  bucket: 0.75,
  swing: 0.5,
} as const;

export const MAX_PAYLOAD = 2400;
export const AMBIENT_HYDRAULIC = 58;

export function createTelemetry(
  machineId: string,
  overrides: Partial<MachineTelemetry> = {},
): MachineTelemetry {
  const x = overrides.x ?? 0;
  const z = overrides.z ?? 0;
  return {
    machineId,
    x,
    y: terrainHeight(x, z),
    z,
    speed: 0,
    heading: 0,
    engineRpm: 800,
    fuel: 78,
    boomAngle: 22 * DEG,
    stickAngle: -10 * DEG,
    bucketAngle: 10 * DEG,
    swingAngle: 0,
    pitch: 0,
    roll: 0,
    payload: 0,
    hydraulicTemperature: 62,
    nearestPerson: Infinity,
    tipOverMargin: 2.1,
    activity: "idle",
    ...overrides,
  };
}

export function emptyInput(): VehicleInput {
  return {
    throttle: 0,
    steer: 0,
    swing: 0,
    boom: 0,
    stick: 0,
    bucket: 0,
    emergencyStop: false,
  };
}

/** Normalises a joint angle to 0..1 across its limits. */
export function jointFraction(value: number, limit: { min: number; max: number }): number {
  return clamp((value - limit.min) / (limit.max - limit.min), 0, 1);
}

/**
 * How far the load is slung from the centre of rotation, 0..1.
 * A low boom with an extended stick is the worst case.
 */
export function reachFactor(boomAngle: number, stickAngle: number): number {
  const boomReach = 1 - jointFraction(boomAngle, ARM_LIMITS.boom);
  const stickReach = jointFraction(stickAngle, ARM_LIMITS.stick);
  return clamp(boomReach * 0.45 + stickReach * 0.55, 0, 1);
}

/**
 * Demo stability figure — NOT engineering-grade physics.
 *
 * Blends the things that genuinely matter for an excavator tip-over: ground
 * slope, how far the load is slung out, how heavy it is, and whether the upper
 * body is swung over the side of the tracks rather than over the undercarriage.
 */
export function computeTipOverMargin(t: MachineTelemetry): number {
  const slopeDeg = Math.hypot(t.pitch, t.roll) / DEG;
  const reach = reachFactor(t.boomAngle, t.stickAngle);
  const load = clamp(t.payload / MAX_PAYLOAD, 0, 1);
  // Swung 90 degrees off the tracks is where an excavator is least stable.
  const lateral = Math.abs(Math.sin(t.swingAngle));

  const margin =
    2.35 -
    slopeDeg / 13 -
    reach * 0.5 -
    load * 0.4 -
    reach * lateral * 0.38 -
    Math.min(Math.abs(t.speed) / 3, 1) * 0.08;

  return clamp(margin, 0.55, 2.4);
}

export type TipOverLevel = "safe" | "warning" | "critical";

export function tipOverLevel(margin: number): TipOverLevel {
  if (margin >= 1.5) return "safe";
  if (margin >= 1.2) return "warning";
  return "critical";
}

/**
 * Derives the activity label from telemetry plus current operator intent,
 * exactly as an on-board classifier would.
 */
export function detectActivity(
  t: MachineTelemetry,
  input: VehicleInput,
  emergencyStopped: boolean,
): MachineActivity {
  if (emergencyStopped) return "emergency_stop";

  const speed = Math.abs(t.speed);
  if (speed > 0.5) return "traveling";

  if (Math.abs(input.swing) > 0.05) return "swinging";

  const armAction =
    Math.abs(input.boom) + Math.abs(input.stick) + Math.abs(input.bucket);
  if (armAction > 0.05) {
    // Opening the bucket with material in it is a dump, not a dig.
    if (t.payload > 150 && input.bucket < -0.05) return "loading";
    return "digging";
  }

  if (speed > 0.12) return "traveling";
  return "idle";
}

/** Metres per second to the km/h shown on the HUD. */
export function toKmh(speed: number): number {
  return speed * 3.6;
}

/** Heading in radians to a 0-359 compass bearing. */
export function toBearing(heading: number): number {
  const deg = (heading / DEG) % 360;
  return Math.round(deg < 0 ? deg + 360 : deg);
}

export function bearingLabel(heading: number): string {
  const b = toBearing(heading);
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return points[Math.round(b / 45) % 8];
}

/* ------------------------------------------------------------------------- */
/*  Telemetry providers                                                       */
/* ------------------------------------------------------------------------- */

/**
 * Drives EXC001 from a scripted dig cycle instead of the keyboard.
 *
 * It deliberately emits the *same* `MachineTelemetry` objects the keyboard path
 * produces, at a fixed tick rate, over a subscribe/unsubscribe API. Swapping in
 * a `WebSocketTelemetryProvider` later means implementing this same interface —
 * no 3D component changes.
 */
export class MockTelemetryProvider implements TelemetryProvider {
  readonly id = "mock_iot" as const;

  private listeners = new Set<(data: MachineTelemetry[]) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: MachineTelemetry | null = null;
  private phase = 0;
  private phaseTime = 0;
  private lastTick = 0;

  /** `seed` supplies the live telemetry so handover from keyboard is seamless. */
  constructor(
    private seed: () => MachineTelemetry,
    private integrate: (
      t: MachineTelemetry,
      input: VehicleInput,
      dt: number,
    ) => void,
    private hz = 30,
  ) {}

  subscribe(callback: (data: MachineTelemetry[]) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  start(): void {
    if (this.timer) return;
    this.state = { ...this.seed() };
    this.phase = 0;
    this.phaseTime = 0;
    this.lastTick = performance.now();
    this.timer = setInterval(() => this.tick(), 1000 / this.hz);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    if (!this.state) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastTick) / 1000, 0.1);
    this.lastTick = now;
    this.phaseTime += dt;

    this.integrate(this.state, this.script(), dt);

    const frame = { ...this.state };
    this.listeners.forEach((cb) => cb([frame]));
  }

  /** A five-stage dig / swing / dump loop. */
  private script(): VehicleInput {
    const input = emptyInput();
    const advance = (after: number) => {
      if (this.phaseTime > after) {
        this.phase = (this.phase + 1) % 5;
        this.phaseTime = 0;
      }
    };

    switch (this.phase) {
      case 0: // reposition
        input.throttle = 0.55;
        input.steer = Math.sin(this.phaseTime * 0.8) * 0.35;
        advance(3.2);
        break;
      case 1: // reach out and drop the bucket in
        input.boom = -0.85;
        input.stick = 0.7;
        input.bucket = -0.4;
        advance(2.4);
        break;
      case 2: // curl through the cut
        input.stick = -0.85;
        input.bucket = 0.95;
        input.boom = 0.35;
        advance(2.8);
        break;
      case 3: // swing to the truck
        input.swing = 0.8;
        input.boom = 0.5;
        advance(2.6);
        break;
      default: // dump and swing back
        input.bucket = -0.95;
        input.swing = -0.7;
        advance(2.6);
        break;
    }
    return input;
  }
}

/**
 * Reference implementation sketch for the next milestone. Kept as a comment so
 * the seam is obvious:
 *
 * ```ts
 * export class WebSocketTelemetryProvider implements TelemetryProvider {
 *   readonly id = "websocket";
 *   private ws?: WebSocket;
 *   private listeners = new Set<(d: MachineTelemetry[]) => void>();
 *   constructor(private url: string) {}
 *   subscribe(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
 *   start() {
 *     this.ws = new WebSocket(this.url);
 *     this.ws.onmessage = (e) =>
 *       this.listeners.forEach((cb) => cb(JSON.parse(e.data) as MachineTelemetry[]));
 *   }
 *   stop() { this.ws?.close(); }
 * }
 * ```
 */

/** Convenience for the HUD: ground-projected forward point, used by path arrows. */
export function projectAhead(t: MachineTelemetry, seconds: number) {
  const f = headingVector(t.heading);
  const d = t.speed * seconds;
  const x = t.x + f.x * d;
  const z = t.z + f.z * d;
  return { x, z, y: terrainHeight(x, z) };
}

/** Re-exported so callers do not need to reach into terrain.ts directly. */
export { sampleAttitude, terrainHeight };
