/**
 * Lightweight heavy-vehicle model.
 *
 * Not a physics engine — an integrator tuned so the machine *feels* like forty
 * tonnes: it takes seconds to reach speed, carries momentum through a stop,
 * leans into turns, squats under acceleration and loses power up a grade.
 *
 * The model owns the intermediate state (yaw rate, smoothed hydraulic rates,
 * suspension phase) that does not belong on the wire format, and writes its
 * results into a `MachineTelemetry` object it mutates in place.
 */

import type { MachineTelemetry, VehicleInput } from "@/types/twin";
import { SITE_HALF, clamp, headingVector, normalizeHeading } from "./site";
import { sampleAttitude } from "./terrain";
import {
  ARM_LIMITS,
  ARM_RATES,
  AMBIENT_HYDRAULIC,
  DEG,
  MAX_PAYLOAD,
  computeTipOverMargin,
  detectActivity,
} from "./telemetry";

/** Frame-rate independent exponential smoothing. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export interface VehicleTuning {
  maxSpeed: number;
  accel: number;
  brake: number;
  rollingDrag: number;
  maxYawRate: number;
  yawAccel: number;
  wheelbase: number;
  trackWidth: number;
  /** Excavators have an arm; haul trucks do not. */
  hasArm: boolean;
}

export const TUNING: Record<string, VehicleTuning> = {
  excavator: {
    // A real 320 travels ~5.5 km/h; 2.4 m/s (8.6 km/h) keeps the site
    // crossable in a demo without feeling like a go-kart.
    maxSpeed: 2.4,
    accel: 1.0,
    brake: 1.9,
    rollingDrag: 1.35,
    maxYawRate: 0.55,
    yawAccel: 1.1,
    wheelbase: 4.6,
    trackWidth: 3.2,
    hasArm: true,
  },
  bulldozer: {
    maxSpeed: 2.6,
    accel: 0.9,
    brake: 1.7,
    rollingDrag: 1.5,
    maxYawRate: 0.5,
    yawAccel: 1.0,
    wheelbase: 4.2,
    trackWidth: 3.4,
    hasArm: false,
  },
  loader: {
    maxSpeed: 4.6,
    accel: 1.5,
    brake: 2.2,
    rollingDrag: 1.2,
    maxYawRate: 0.62,
    yawAccel: 1.4,
    wheelbase: 4.4,
    trackWidth: 3.0,
    hasArm: false,
  },
  grader: {
    maxSpeed: 3.2,
    accel: 1.0,
    brake: 1.8,
    rollingDrag: 1.2,
    maxYawRate: 0.45,
    yawAccel: 1.0,
    wheelbase: 6.2,
    trackWidth: 2.6,
    hasArm: false,
  },
  truck: {
    maxSpeed: 6.4,
    accel: 1.7,
    brake: 2.4,
    rollingDrag: 0.9,
    maxYawRate: 0.5,
    yawAccel: 1.2,
    wheelbase: 6.4,
    trackWidth: 3.4,
    hasArm: false,
  },
};

export interface StepContext {
  /** Latched emergency stop — overrides operator intent. */
  emergencyStopped: boolean;
  /** Added to the hydraulic target: heat wave up, rain down. */
  hydraulicAmbientBias: number;
  /** Director-panel injected offset that decays back to zero. */
  hydraulicSpike: number;
  /** Rain makes the ground slick: less grip, longer stops. */
  grip: number;
  /**
   * Injected attitude offset, in radians. The director panel uses it to put the
   * machine on an adverse grade; because it feeds the real attitude the
   * tip-over margin degrades through the normal path rather than being faked.
   */
  attitudeBias: { pitch: number; roll: number };
}

const DEFAULT_CONTEXT: StepContext = {
  emergencyStopped: false,
  hydraulicAmbientBias: 0,
  hydraulicSpike: 0,
  grip: 1,
  attitudeBias: { pitch: 0, roll: 0 },
};

export class VehicleModel {
  /** Current turn rate, rad/s. Smoothed so the machine cannot snap around. */
  yawRate = 0;
  /** Smoothed hydraulic command values, -1..1. */
  armRate = { boom: 0, stick: 0, bucket: 0, swing: 0 };
  /** Metres of track travelled — drives the track-pattern animation. */
  trackTravel = 0;

  private dynPitch = 0;
  private dynRoll = 0;
  private bobPhase = Math.random() * Math.PI * 2;
  private lastAccel = 0;

  constructor(
    public telemetry: MachineTelemetry,
    public tuning: VehicleTuning,
  ) {}

  /** Integrates one frame. Mutates `this.telemetry` in place. */
  step(input: VehicleInput, dt: number, ctx: StepContext = DEFAULT_CONTEXT): void {
    const t = this.telemetry;
    const tune = this.tuning;
    const stopped = ctx.emergencyStopped || input.emergencyStop;

    // An e-stop dumps the pilot valves: no drive, no hydraulics.
    const cmd: VehicleInput = stopped
      ? {
          throttle: 0,
          steer: 0,
          swing: 0,
          boom: 0,
          stick: 0,
          bucket: 0,
          emergencyStop: true,
        }
      : input;

    this.integrateDrive(cmd, dt, ctx, stopped);
    this.integrateAttitude(dt, ctx);
    if (tune.hasArm) this.integrateArm(cmd, dt);
    this.integrateEngine(cmd, dt, ctx, stopped);

    t.tipOverMargin = computeTipOverMargin(t);
    t.activity = detectActivity(t, cmd, stopped);
  }

  /* --------------------------------------------------------------------- */

  private integrateDrive(
    input: VehicleInput,
    dt: number,
    ctx: StepContext,
    stopped: boolean,
  ): void {
    const t = this.telemetry;
    const tune = this.tuning;

    // Reverse is deliberately slower, like a real travel lever.
    const targetSpeed = input.throttle * tune.maxSpeed * (input.throttle < 0 ? 0.6 : 1);
    const diff = targetSpeed - t.speed;

    let accel: number;
    if (Math.abs(input.throttle) < 0.01) {
      // Coasting: rolling resistance only, so the machine rolls to a stop.
      const drag = tune.rollingDrag * (stopped ? 2.2 : 1);
      if (Math.abs(t.speed) <= drag * dt) {
        t.speed = 0;
        accel = 0;
      } else {
        accel = -Math.sign(t.speed) * drag;
      }
    } else {
      // Slowing down uses the brake rate, speeding up uses the (lower) accel rate.
      const gaining = Math.abs(targetSpeed) > Math.abs(t.speed);
      const limit = gaining ? tune.accel : tune.brake;
      accel = clamp(diff * 1.6, -limit, limit);
    }

    // Gravity along the grade — the machine labours uphill and runs away downhill.
    accel -= Math.sin(t.pitch) * 3.0;

    t.speed = clamp(t.speed + accel * dt, -tune.maxSpeed * 0.65, tune.maxSpeed);
    this.lastAccel = accel;

    // Yaw: tracked machines counter-rotate, so they still steer when stationary.
    const speedFactor = 0.45 + 0.55 * Math.min(Math.abs(t.speed) / tune.maxSpeed, 1);
    const targetYaw = input.steer * tune.maxYawRate * speedFactor * ctx.grip;
    const yawStep = tune.yawAccel * dt;
    this.yawRate += clamp(targetYaw - this.yawRate, -yawStep, yawStep);
    t.heading = normalizeHeading(t.heading + this.yawRate * dt);

    const f = headingVector(t.heading);
    const bound = SITE_HALF - 12;
    t.x = clamp(t.x + f.x * t.speed * dt, -bound, bound);
    t.z = clamp(t.z + f.z * t.speed * dt, -bound, bound);

    this.trackTravel += t.speed * dt;
  }

  private integrateAttitude(dt: number, ctx: StepContext): void {
    const t = this.telemetry;
    const att = sampleAttitude(
      t.x,
      t.z,
      t.heading,
      this.tuning.wheelbase,
      this.tuning.trackWidth,
    );
    t.y = att.y;

    // Squat under power, dive under braking.
    this.dynPitch = damp(this.dynPitch, clamp(-this.lastAccel * 0.02, -0.05, 0.05), 4.5, dt);
    // Lean out of the turn, proportional to lateral acceleration.
    this.dynRoll = damp(
      this.dynRoll,
      clamp(this.yawRate * this.telemetry.speed * 0.05, -0.06, 0.06),
      4,
      dt,
    );

    // Suspension bob — barely visible, but the machine stops looking rigid.
    const speed = Math.abs(t.speed);
    this.bobPhase += dt * (1.6 + speed * 3.2);
    const bob = Math.sin(this.bobPhase) * 0.011 * Math.min(speed, 2.2);

    // The director's injected grade feeds the real attitude, so the tip-over
    // margin degrades through the normal path instead of being faked.
    t.pitch = att.pitch + this.dynPitch + bob + ctx.attitudeBias.pitch;
    t.roll = att.roll + this.dynRoll + bob * 0.5 + ctx.attitudeBias.roll;
  }

  private integrateArm(input: VehicleInput, dt: number): void {
    const t = this.telemetry;
    const r = this.armRate;

    // Hydraulics ramp rather than snap — this is what makes the arm feel heavy.
    r.boom = damp(r.boom, input.boom, 6, dt);
    r.stick = damp(r.stick, input.stick, 6, dt);
    r.bucket = damp(r.bucket, input.bucket, 7, dt);
    r.swing = damp(r.swing, input.swing, 4.5, dt);

    t.boomAngle = clamp(
      t.boomAngle + r.boom * ARM_RATES.boom * dt,
      ARM_LIMITS.boom.min,
      ARM_LIMITS.boom.max,
    );
    t.stickAngle = clamp(
      t.stickAngle + r.stick * ARM_RATES.stick * dt,
      ARM_LIMITS.stick.min,
      ARM_LIMITS.stick.max,
    );
    t.bucketAngle = clamp(
      t.bucketAngle + r.bucket * ARM_RATES.bucket * dt,
      ARM_LIMITS.bucket.min,
      ARM_LIMITS.bucket.max,
    );
    // Swing is continuous — the house turns through a full circle.
    t.swingAngle = t.swingAngle + r.swing * ARM_RATES.swing * dt;

    this.integratePayload(dt);
  }

  private integratePayload(dt: number): void {
    const t = this.telemetry;
    const r = this.armRate;

    // Curling a low bucket scoops material; opening it dumps the load.
    const bucketDown = t.boomAngle < 28 * DEG;
    if (r.bucket > 0.15 && bucketDown && t.payload < MAX_PAYLOAD) {
      t.payload = Math.min(MAX_PAYLOAD, t.payload + 900 * r.bucket * dt);
    } else if (r.bucket < -0.15 && t.payload > 0) {
      t.payload = Math.max(0, t.payload + 1600 * r.bucket * dt);
    }
  }

  private integrateEngine(
    input: VehicleInput,
    dt: number,
    ctx: StepContext,
    stopped: boolean,
  ): void {
    const t = this.telemetry;
    const speedRatio = Math.min(Math.abs(t.speed) / this.tuning.maxSpeed, 1);
    const armAction = Math.min(
      (Math.abs(this.armRate.boom) +
        Math.abs(this.armRate.stick) +
        Math.abs(this.armRate.bucket) +
        Math.abs(this.armRate.swing)) /
        1.6,
      1,
    );
    const load = clamp(t.payload / MAX_PAYLOAD, 0, 1);
    const grade = Math.max(0, Math.sin(t.pitch));

    const targetRpm = stopped
      ? 700
      : clamp(
          800 + speedRatio * 900 + armAction * 520 + load * 150 + grade * 260,
          700,
          2200,
        );
    t.engineRpm = damp(t.engineRpm, targetRpm, 2.6, dt);

    // Burn rate tracks engine load.
    const burn = 0.002 + ((t.engineRpm - 700) / 1500) * 0.006;
    t.fuel = clamp(t.fuel - burn * dt, 0, 100);

    // Hydraulic oil heats with work and sheds heat to ambient.
    const ambient = AMBIENT_HYDRAULIC + ctx.hydraulicAmbientBias;
    const target = ambient + armAction * 26 + speedRatio * 8 + load * 6 + ctx.hydraulicSpike;
    t.hydraulicTemperature = damp(t.hydraulicTemperature, target, 0.35, dt);
  }

  /** Snaps everything back to a known-good state (the `R` key). */
  reset(x: number, z: number, heading: number): void {
    const t = this.telemetry;
    t.x = x;
    t.z = z;
    t.heading = heading;
    t.speed = 0;
    t.swingAngle = 0;
    t.boomAngle = 22 * DEG;
    t.stickAngle = -10 * DEG;
    t.bucketAngle = 10 * DEG;
    t.payload = 0;
    t.engineRpm = 800;
    t.activity = "idle";
    this.yawRate = 0;
    this.armRate = { boom: 0, stick: 0, bucket: 0, swing: 0 };
    this.dynPitch = 0;
    this.dynRoll = 0;
    this.trackTravel = 0;

    const att = sampleAttitude(x, z, heading, this.tuning.wheelbase, this.tuning.trackWidth);
    t.y = att.y;
    t.pitch = att.pitch;
    t.roll = att.roll;
    t.tipOverMargin = computeTipOverMargin(t);
  }
}

/**
 * Turns a waypoint into operator input, so autonomous machines drive through
 * exactly the same physics as the keyboard-controlled one.
 */
export function steerToward(
  t: MachineTelemetry,
  targetX: number,
  targetZ: number,
  opts: { cruise?: number; arriveRadius?: number } = {},
): VehicleInput {
  const cruise = opts.cruise ?? 0.7;
  const arriveRadius = opts.arriveRadius ?? 6;

  const dx = targetX - t.x;
  const dz = targetZ - t.z;
  const dist = Math.hypot(dx, dz);

  const desired = Math.atan2(dx, -dz);
  let turn = desired - t.heading;
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;

  // Slow into the corner, and crawl on the final approach.
  const turnPenalty = 1 - Math.min(Math.abs(turn) / (Math.PI * 0.6), 0.75);
  const arrivePenalty = Math.min(dist / arriveRadius, 1);

  return {
    throttle: cruise * turnPenalty * arrivePenalty,
    steer: clamp(turn * 1.6, -1, 1),
    swing: 0,
    boom: 0,
    stick: 0,
    bucket: 0,
    emergencyStop: false,
  };
}
