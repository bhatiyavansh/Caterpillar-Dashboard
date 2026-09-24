/**
 * Interprets a `PhysicsScenario` against the running engine.
 *
 * The runner never moves a machine itself. It sets operator-style inputs
 * (throttle, steer, hydraulic levers) through the engine's override map,
 * places machines, changes the weather, loads buckets — and the physics world
 * decides what happens. Whether a face fails, a machine tips or a truck
 * slides is an outcome, checked by the scenario's expectations, not a script.
 */

import type { MachineTelemetry, VehicleInput, WeatherMode } from "@/types/twin";
import { angleDelta, clamp } from "../../site";
import { DEG, emptyInput } from "../../telemetry";
import { terrainHeight } from "../../terrain";
import { steerReverse, steerToward, type VehicleModel } from "../../vehicle";
import type { PhysicsWorld } from "../world";
import type { Action, Condition, PhysicsScenario, ScenarioStatus } from "./types";

/** What the runner needs from the engine. `SimulationEngine` implements it. */
export interface ScenarioHost {
  physics: PhysicsWorld | null;
  weather: WeatherMode;
  wetness: number;
  readonly overrides: Map<string, VehicleInput>;
  readonly avoidanceOff: Set<string>;
  telemetryOf(id: string): MachineTelemetry;
  modelOf(id: string): VehicleModel;
  setWeather(mode: WeatherMode): void;
  placeWorker(side: "front" | "rear" | "left" | "right", distance: number, holdS?: number): void;
  pushEvent(text: string, severity?: "info" | "warning" | "critical"): void;
  /** Forget route-AI manoeuvre state (turning, yielding) for a machine. */
  clearAi(id: string): void;
}

type Drive =
  | { kind: "hold"; throttle: number; steer: number }
  | { kind: "to"; x: number; z: number; cruise: number; reverse: boolean }
  | { kind: "stop" };

interface Saved {
  x: number;
  z: number;
  heading: number;
  payload: number;
  boom: number;
  stick: number;
  bucket: number;
  swing: number;
}

interface Active {
  def: PhysicsScenario;
  t: number;
  step: number;
  stepT: number;
  endedAt: number | null;
  drives: Map<string, Drive>;
  arms: Map<string, { boom?: number; stick?: number; bucket?: number; swing?: number }>;
  marks: Map<string, { x: number; z: number; heading: number }>;
  met: Map<string, number | null>;
  saved: { weather: WeatherMode; cast: Map<string, Saved> };
}

export class ScenarioRunner {
  private active: Active | null = null;
  private lastStatus: ScenarioStatus | null = null;

  get running(): boolean {
    return this.active !== null;
  }

  get focus(): string | null {
    return this.active?.def.focus ?? null;
  }

  start(def: PhysicsScenario, host: ScenarioHost): boolean {
    if (!host.physics) {
      host.pushEvent("Physics scenarios need the local simulation (physics not loaded)", "warning");
      return false;
    }
    if (this.active) this.stop(host);
    const cast = new Map<string, Saved>();
    for (const id of def.cast) {
      const t = host.telemetryOf(id);
      cast.set(id, {
        x: t.x,
        z: t.z,
        heading: t.heading,
        payload: t.payload,
        boom: t.boomAngle,
        stick: t.stickAngle,
        bucket: t.bucketAngle,
        swing: t.swingAngle,
      });
      host.clearAi(id);
      host.overrides.set(id, emptyInput());
    }
    this.active = {
      def,
      t: 0,
      step: 0,
      stepT: 0,
      endedAt: null,
      drives: new Map(),
      arms: new Map(),
      marks: new Map(),
      met: new Map(def.expect.map((e) => [e.label, null])),
      saved: { weather: host.weather, cast },
    };
    host.pushEvent(`Scenario started — ${def.title}`, "warning");
    for (const a of def.setup) this.apply(a, host);
    return true;
  }

  /** Drops the scenario without restoring anything (the site is being rebuilt). */
  abandon(): void {
    this.active = null;
    this.lastStatus = null;
  }

  /** Ends the scenario, restoring the cast and site if the definition asks. */
  stop(host: ScenarioHost): void {
    const a = this.active;
    if (!a) return;
    this.lastStatus = this.status();
    if (this.lastStatus) this.lastStatus.done = true;
    this.active = null;
    for (const id of a.def.cast) {
      host.overrides.delete(id);
      host.avoidanceOff.delete(id);
      host.clearAi(id);
    }
    if (a.def.restore) {
      for (const [id, s] of a.saved.cast) {
        const model = host.modelOf(id);
        model.reset(s.x, s.z, s.heading);
        const t = host.telemetryOf(id);
        t.payload = s.payload;
        t.boomAngle = s.boom;
        t.stickAngle = s.stick;
        t.bucketAngle = s.bucket;
        t.swingAngle = s.swing;
      }
      host.setWeather(a.saved.weather);
      host.physics?.face.reset();
    }
    const met = [...a.met.entries()].filter(([, at]) => at !== null).length;
    host.pushEvent(`Scenario ended — ${a.def.title} (${met}/${a.met.size} outcomes observed)`, "info");
  }

  /** Called every engine frame, before machines take their inputs. */
  tick(dt: number, host: ScenarioHost): void {
    const a = this.active;
    if (!a) return;
    a.t += dt;
    a.stepT += dt;

    // Expectations are watched continuously; the first moment each is met is kept.
    for (const e of a.def.expect) {
      if (a.met.get(e.label) === null && this.check(e.when, host, a)) {
        a.met.set(e.label, a.t);
        host.pushEvent(`Observed: ${e.label} (${a.t.toFixed(1)} s)`, "info");
      }
    }

    // Steps run in order; each waits for its own trigger.
    while (a.endedAt === null && a.step < a.def.steps.length) {
      const step = a.def.steps[a.step];
      if (step.when && !this.check(step.when, host, a)) break;
      a.step++;
      a.stepT = 0;
      for (const act of step.do) this.apply(act, host);
    }

    if (a.endedAt !== null || a.t >= a.def.timeoutS) {
      this.stop(host);
      return;
    }

    // Turn drive and arm intents into operator input for each cast machine.
    for (const id of a.def.cast) {
      const t = host.telemetryOf(id);
      const input = { ...emptyInput() };
      const drive = a.drives.get(id);
      if (drive?.kind === "hold") {
        input.throttle = drive.throttle;
        input.steer = drive.steer;
      } else if (drive?.kind === "to") {
        const skid = host.modelOf(id).tuning.hasArm || t.machineId.startsWith("DOZ");
        const i = drive.reverse
          ? steerReverse(t, drive.x, drive.z, drive.cruise, skid)
          : steerToward(t, drive.x, drive.z, { cruise: drive.cruise, arriveRadius: 2 });
        input.throttle = i.throttle;
        input.steer = i.steer;
      }
      const arm = a.arms.get(id);
      if (arm) {
        const lever = (target: number | undefined, current: number) =>
          target === undefined ? 0 : clamp(((target * DEG - current) / (10 * DEG)) * 1.2, -1, 1);
        input.boom = lever(arm.boom, t.boomAngle);
        input.stick = lever(arm.stick, t.stickAngle);
        input.bucket = lever(arm.bucket, t.bucketAngle);
        input.swing =
          arm.swing === undefined ? 0 : clamp((angleDelta(t.swingAngle, arm.swing * DEG) / (10 * DEG)) * 1.2, -1, 1);
      }
      host.overrides.set(id, input);
    }
  }

  private apply(action: Action, host: ScenarioHost): void {
    const a = this.active;
    if (!a) return;
    switch (action.kind) {
      case "weather":
        host.setWeather(action.mode);
        break;
      case "soak":
        host.wetness = action.level;
        break;
      case "place": {
        const model = host.modelOf(action.machine);
        model.reset(action.x, action.z, action.heading * DEG);
        if (action.payload !== undefined) host.telemetryOf(action.machine).payload = action.payload;
        a.drives.set(action.machine, { kind: "stop" });
        break;
      }
      case "arm": {
        const { boom, stick, bucket, swing } = action;
        const prev = a.arms.get(action.machine) ?? {};
        a.arms.set(action.machine, {
          boom: boom ?? prev.boom,
          stick: stick ?? prev.stick,
          bucket: bucket ?? prev.bucket,
          swing: swing ?? prev.swing,
        });
        break;
      }
      case "drive":
        a.drives.set(action.machine, { kind: "hold", throttle: action.throttle, steer: action.steer ?? 0 });
        break;
      case "driveTo":
        a.drives.set(action.machine, {
          kind: "to",
          x: action.x,
          z: action.z,
          cruise: action.cruise ?? 0.6,
          reverse: action.reverse ?? false,
        });
        break;
      case "stop":
        a.drives.set(action.machine, { kind: "stop" });
        break;
      case "release":
        a.drives.delete(action.machine);
        a.arms.delete(action.machine);
        host.overrides.delete(action.machine);
        break;
      case "payload":
        host.telemetryOf(action.machine).payload = action.kg;
        break;
      case "avoidance":
        if (action.on) host.avoidanceOff.delete(action.machine);
        else host.avoidanceOff.add(action.machine);
        break;
      case "releaseFace":
        host.physics?.face.release("scenario");
        break;
      case "pour":
        host.physics?.material.pour(
          { x: action.x, y: terrainHeight(action.x, action.z) + (action.height ?? 3), z: action.z },
          action.tonnes * 1000,
        );
        break;
      case "worker":
        host.placeWorker(action.side, action.distance);
        break;
      case "mark": {
        const t = host.telemetryOf(action.machine);
        a.marks.set(action.machine, { x: t.x, z: t.z, heading: t.heading });
        break;
      }
      case "event":
        host.pushEvent(action.text, action.severity ?? "info");
        break;
      case "end":
        a.endedAt = a.t;
        break;
    }
  }

  private check(c: Condition, host: ScenarioHost, a: Active): boolean {
    const body = (id: string) => host.physics?.machine(id);
    switch (c.kind) {
      case "elapsed":
        return a.stepT >= c.s;
      case "faceFailed":
        return host.physics?.face.released ?? false;
      case "contact": {
        const key = c.a < c.b ? `${c.a}|${c.b}` : `${c.b}|${c.a}`;
        return host.physics?.touching.has(key) ?? false;
      }
      case "tipped":
        return body(c.machine)?.tippedOver ?? false;
      case "tiltAbove":
        return (body(c.machine)?.tilt ?? 0) > c.deg * DEG;
      case "marginBelow":
        return host.telemetryOf(c.machine).tipOverMargin < c.value;
      case "slipping":
        return (body(c.machine)?.slip ?? 0) > (c.above ?? 0.4);
      case "rolledBack": {
        const m = a.marks.get(c.machine);
        if (!m) return false;
        const t = host.telemetryOf(c.machine);
        // Displacement against the marked heading.
        const back = -((t.x - m.x) * Math.sin(m.heading) - (t.z - m.z) * Math.cos(m.heading));
        return back >= c.metres;
      }
      case "near": {
        const t = host.telemetryOf(c.machine);
        return Math.hypot(t.x - c.x, t.z - c.z) <= c.within;
      }
      case "stopped":
        return Math.abs(host.telemetryOf(c.machine).speed) < 0.1;
      case "armSettled": {
        const arm = a.arms.get(c.machine);
        if (!arm) return true;
        const t = host.telemetryOf(c.machine);
        const near = (target: number | undefined, v: number) => target === undefined || Math.abs(target * DEG - v) < 2 * DEG;
        return (
          near(arm.boom, t.boomAngle) &&
          near(arm.stick, t.stickAngle) &&
          near(arm.bucket, t.bucketAngle) &&
          (arm.swing === undefined || Math.abs(angleDelta(t.swingAngle, arm.swing * DEG)) < 2 * DEG)
        );
      }
      case "any":
        return c.of.some((x) => this.check(x, host, a));
      case "all":
        return c.of.every((x) => this.check(x, host, a));
    }
  }

  status(): ScenarioStatus | null {
    const a = this.active;
    if (!a) return this.lastStatus;
    const step = a.def.steps[Math.max(0, a.step - 1)];
    return {
      id: a.def.id,
      title: a.def.title,
      t: a.t,
      step: step?.label ?? "Setting up",
      done: false,
      met: [...a.met.entries()].map(([label, at]) => ({ label, at })),
    };
  }
}
