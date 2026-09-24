/**
 * Local fleet autonomy.
 *
 * When no backend is attached the twin runs the site itself, with the same
 * roles and the same geometry as `simulator/machine.py`: the pit excavator runs
 * dig-swing-dump cycles, the dozer pushes lanes across the pit floor, the
 * grader cuts passes across zone C, the wheel loader digs the stockpile and
 * loads trucks at the loader point, and four haul trucks queue, load, haul the
 * laden lane up onto the dump, reverse to the tip edge, tip, and return empty.
 *
 * Machines interact: a truck only leaves the bay once the loader has put enough
 * passes in it, the loader waits holding a full bucket if no truck is spotted,
 * and trucks queue nose-to-tail rather than driving through each other.
 *
 * Everything drives through `VehicleModel`, the same integrator the operator's
 * machine uses, so the fleet accelerates, labours up ramps and leans in turns
 * exactly like EXC001. Implement poses are written onto telemetry — the renderer
 * animates whatever it is given, live or local.
 */

import type { MachineTelemetry, VehicleInput } from "@/types/twin";
import {
  DUMP,
  EMPTY_ROUTE,
  LOADED_ROUTE,
  LOADER_POINT,
  MOUNDS,
  STOCKPILE_POINT,
  WORK_STATIONS,
  angleDelta,
  clamp,
  headingTo,
  headingVector,
} from "./site";
import { DEG, emptyInput } from "./telemetry";
import { damp, steerToward, type StepContext, type VehicleModel } from "./vehicle";

export type FleetRole = "excavate" | "push" | "grade" | "load" | "haul";

/** Rated loads, kg. A 950 bucket pass, a 745 body, a 320 bucket. */
export const LOADER_PASS_KG = 9600;
export const TRUCK_FULL_KG = 28800;
export const EXCAVATOR_BUCKET_KG = 2100;

export interface Agent {
  id: string;
  role: FleetRole;
  t: MachineTelemetry;
  model: VehicleModel;
  /** Free-form behaviour state. */
  phase: string;
  timer: number;
  /** Route cursor for route-following roles. */
  index: number;
  /** Scratch points and counters. */
  lane: number;
  target: { x: number; z: number } | null;
}

export interface FleetWorld {
  agents: Agent[];
  ctx: StepContext;
}

/* ------------------------------------------------------------------------ */
/*  Driving helpers                                                         */
/* ------------------------------------------------------------------------ */

/** Reverse toward a point: the tail leads. */
function reverseToward(
  t: MachineTelemetry,
  x: number,
  z: number,
  cruise = 0.35,
): VehicleInput {
  const tail = t.heading + Math.PI;
  const desired = headingTo(t.x, t.z, x, z);
  const turn = angleDelta(tail, desired);
  const dist = Math.hypot(x - t.x, z - t.z);
  const input = emptyInput();
  input.throttle = -cruise * Math.min(dist / 4, 1) * (1 - Math.min(Math.abs(turn) / Math.PI, 0.7));
  input.steer = clamp(turn * 1.6, -1, 1);
  return input;
}

/** Turn on the spot (or nearly) to face a heading. Returns true when aligned. */
function faceHeading(t: MachineTelemetry, heading: number, input: VehicleInput): boolean {
  const turn = angleDelta(t.heading, heading);
  input.throttle = 0.12;
  input.steer = clamp(turn * 2, -1, 1);
  return Math.abs(turn) < 0.08;
}

/** Metres of clear road a travelling machine keeps to whatever is ahead of it. */
const FOLLOW_GAP_M = 18;

/**
 * Car-following: forward throttle fades to zero as anything else closes inside
 * the gap in a narrow cone ahead. Reversing and turning in place are exempt.
 */
function followLimit(agent: Agent, world: FleetWorld, throttle: number): number {
  if (throttle <= 0) return throttle;
  const t = agent.t;
  const f = headingVector(t.heading);
  let limit = 1;
  for (const other of world.agents) {
    if (other === agent) continue;
    const dx = other.t.x - t.x;
    const dz = other.t.z - t.z;
    const ahead = dx * f.x + dz * f.z;
    if (ahead <= 0 || ahead > FOLLOW_GAP_M + 8) continue;
    const lateral = Math.abs(dx * f.z - dz * f.x);
    if (lateral > 4.5) continue;
    limit = Math.min(limit, clamp((ahead - FOLLOW_GAP_M + 4) / 8, 0, 1));
  }
  return throttle * limit;
}

function drive(agent: Agent, input: VehicleInput, world: FleetWorld, dt: number): void {
  if (agent.role === "haul") input.throttle = followLimit(agent, world, input.throttle);
  agent.model.step(input, dt, { ...world.ctx, emergencyStopped: false });
}

function hold(agent: Agent, world: FleetWorld, dt: number): void {
  drive(agent, emptyInput(), world, dt);
}

/** Eases a joint toward a target, in radians. */
function ease(current: number, target: number, rate: number, dt: number): number {
  return damp(current, target, rate, dt);
}

/* ------------------------------------------------------------------------ */
/*  Pit excavator: dig -> lift -> swing -> dump -> swing back               */
/* ------------------------------------------------------------------------ */

interface Pose {
  boom: number;
  stick: number;
  bucket: number;
  swing: number;
}

/** Keyframes of one loading cycle, in degrees, with durations in seconds. */
const DIG_CYCLE: { pose: Pose; seconds: number; phase: string }[] = [
  { pose: { boom: 28, stick: -48, bucket: -45, swing: 0 }, seconds: 2.2, phase: "reach" },
  { pose: { boom: -12, stick: -38, bucket: -30, swing: 0 }, seconds: 1.8, phase: "penetrate" },
  { pose: { boom: -8, stick: 26, bucket: 10, swing: 0 }, seconds: 3.0, phase: "crowd" },
  { pose: { boom: -2, stick: 34, bucket: 62, swing: 0 }, seconds: 1.4, phase: "curl" },
  { pose: { boom: 46, stick: 22, bucket: 64, swing: 0 }, seconds: 2.2, phase: "lift" },
  { pose: { boom: 46, stick: 10, bucket: 64, swing: -90 }, seconds: 3.4, phase: "swing" },
  { pose: { boom: 40, stick: -12, bucket: -55, swing: -90 }, seconds: 2.0, phase: "dump" },
  { pose: { boom: 34, stick: -30, bucket: -45, swing: 0 }, seconds: 3.2, phase: "return" },
];

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function stepExcavator(agent: Agent, world: FleetWorld, dt: number): void {
  const t = agent.t;
  hold(agent, world, dt);

  agent.timer += dt * 0.95;
  let total = 0;
  for (const k of DIG_CYCLE) total += k.seconds;
  if (agent.timer >= total) {
    agent.timer -= total;
    agent.lane++;
  }

  // Locate the keyframe pair and blend.
  let acc = 0;
  let i = 0;
  while (i < DIG_CYCLE.length - 1 && acc + DIG_CYCLE[i].seconds < agent.timer) {
    acc += DIG_CYCLE[i].seconds;
    i++;
  }
  const from = DIG_CYCLE[(i + DIG_CYCLE.length - 1) % DIG_CYCLE.length].pose;
  const key = DIG_CYCLE[i];
  const k = smooth(clamp((agent.timer - acc) / key.seconds, 0, 1));
  t.boomAngle = (from.boom + (key.pose.boom - from.boom) * k) * DEG;
  t.stickAngle = (from.stick + (key.pose.stick - from.stick) * k) * DEG;
  t.bucketAngle = (from.bucket + (key.pose.bucket - from.bucket) * k) * DEG;
  t.swingAngle = (from.swing + (key.pose.swing - from.swing) * k) * DEG;
  agent.phase = key.phase;

  if (key.phase === "crowd" || key.phase === "curl") {
    t.payload = Math.min(EXCAVATOR_BUCKET_KG, t.payload + (EXCAVATOR_BUCKET_KG / 4.4) * dt);
  } else if (key.phase === "dump") {
    t.payload = Math.max(0, t.payload - (EXCAVATOR_BUCKET_KG / 1.2) * dt);
  }

  t.activity =
    key.phase === "swing" || key.phase === "return"
      ? "swinging"
      : key.phase === "dump"
        ? "loading"
        : "digging";
  t.engineRpm = damp(t.engineRpm, key.phase === "crowd" ? 1950 : 1650, 3, dt);
}

/* ------------------------------------------------------------------------ */
/*  Dozer: push lanes across the pit floor                                  */
/* ------------------------------------------------------------------------ */

function stepDozer(agent: Agent, world: FleetWorld, dt: number): void {
  const t = agent.t;
  const L = WORK_STATIONS.dozerLanes;
  const laneCount = Math.max(1, Math.floor((L.z1 - L.z0) / 5));
  const z = L.z0 + (agent.lane % (laneCount + 1)) * 5;

  if (agent.phase === "push") {
    const input = steerToward(t, L.x1, z, { cruise: 0.42, arriveRadius: 4 });
    drive(agent, input, world, dt);
    // Blade just below grade, carrying a growing load.
    t.boomAngle = ease(t.boomAngle, -0.06, 3, dt);
    t.bucketAngle = ease(t.bucketAngle, 0, 2, dt);
    t.payload = Math.min(9000, t.payload + 700 * dt * Math.abs(t.speed));
    t.activity = "digging";
    if (Math.hypot(L.x1 - t.x, z - t.z) < 3.5) {
      agent.phase = "lift";
      agent.timer = 0;
    }
  } else if (agent.phase === "lift") {
    hold(agent, world, dt);
    t.boomAngle = ease(t.boomAngle, 0.34, 3, dt);
    t.payload = Math.max(0, t.payload - 6000 * dt);
    agent.timer += dt;
    if (agent.timer > 1.6) agent.phase = "reverse";
  } else if (agent.phase === "reverse") {
    drive(agent, reverseToward(t, L.x0, z, 0.55), world, dt);
    t.boomAngle = ease(t.boomAngle, 0.3, 3, dt);
    // Rip the floor on the way back every other lane.
    t.bucketAngle = ease(t.bucketAngle, agent.lane % 2 ? 0.5 : 0, 2, dt);
    if (Math.hypot(L.x0 - t.x, z - t.z) < 3.5) {
      agent.lane++;
      agent.phase = "align";
    }
  } else {
    // Line up on the next lane, facing east.
    const input = emptyInput();
    const nz = L.z0 + (agent.lane % (laneCount + 1)) * 5;
    if (Math.abs(t.z - nz) > 1.5) {
      drive(agent, steerToward(t, L.x0 + 6, nz, { cruise: 0.3, arriveRadius: 2 }), world, dt);
    } else if (faceHeading(t, Math.PI / 2, input)) {
      agent.phase = "push";
    } else {
      drive(agent, input, world, dt);
    }
  }
}

/* ------------------------------------------------------------------------ */
/*  Grader: long passes across zone C                                       */
/* ------------------------------------------------------------------------ */

function stepGrader(agent: Agent, world: FleetWorld, dt: number): void {
  const t = agent.t;
  const G = WORK_STATIONS.graderLanes;
  const lanes = Math.floor((G.z1 - G.z0) / 7);
  const z = G.z0 + (agent.lane % (lanes + 1)) * 7;
  const eastbound = agent.lane % 2 === 0;
  const endX = eastbound ? G.x1 : G.x0;

  if (agent.phase === "pass") {
    drive(agent, steerToward(t, endX, z, { cruise: 0.5, arriveRadius: 5 }), world, dt);
    t.boomAngle = ease(t.boomAngle, -0.04, 2.5, dt); // blade down
    t.swingAngle = ease(t.swingAngle, 0.5, 1.5, dt); // moldboard angled to windrow
    t.activity = "digging";
    if (Math.abs(t.x - endX) < 5) {
      agent.lane++;
      agent.phase = "turn";
    }
  } else {
    // Swing wide onto the next pass, blade up.
    t.boomAngle = ease(t.boomAngle, 0.25, 2.5, dt);
    const nz = G.z0 + (agent.lane % (lanes + 1)) * 7;
    const nx = agent.lane % 2 === 0 ? G.x0 + 8 : G.x1 - 8;
    drive(agent, steerToward(t, nx, nz, { cruise: 0.4, arriveRadius: 4 }), world, dt);
    if (Math.hypot(nx - t.x, nz - t.z) < 5) agent.phase = "pass";
  }
}

/* ------------------------------------------------------------------------ */
/*  Haul trucks                                                             */
/* ------------------------------------------------------------------------ */

/** Arrival order at the queue, so trucks are served first come, first served. */
let queueTicket = 0;

/** Where trucks wait for the loading slot, nose to tail back up the entry lane. */
function queuePoint(slot: number): { x: number; z: number } {
  const a = EMPTY_ROUTE[4];
  const b = EMPTY_ROUTE[3];
  const back = 16 * slot;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const first = Math.min(back, len);
  const p = { x: a.x + (dx / len) * first, z: a.z + (dz / len) * first };
  if (back <= len) return p;
  // Further back than the short turn: continue west along the empty lane.
  const c = EMPTY_ROUTE[2];
  const rest = back - len;
  const ex = c.x - b.x;
  const ez = c.z - b.z;
  const elen = Math.hypot(ex, ez);
  return { x: b.x + (ex / elen) * rest, z: b.z + (ez / elen) * rest };
}

/** The truck currently spotted (or spotting) under the loader, if any. */
function spottedTruck(world: FleetWorld): Agent | null {
  return (
    world.agents.find((a) => a.role === "haul" && (a.phase === "loading" || a.phase === "spot")) ??
    null
  );
}

/** Tip spot on the dump edge, and the point a truck turns at before reversing to it. */
const TIP_SPOT = { x: DUMP.x - DUMP.r + 3, z: DUMP.z };
const TIP_TURN = { x: DUMP.x + 7, z: DUMP.z - 3 };

function stepTruck(agent: Agent, world: FleetWorld, dt: number): void {
  const t = agent.t;
  const cruise = t.payload > 1000 ? 0.72 : 0.9;
  t.boomAngle = 0;
  t.stickAngle = 0;

  switch (agent.phase) {
    case "empty": {
      const route = EMPTY_ROUTE;
      const target = route[agent.index];
      drive(agent, steerToward(t, target.x, target.z, { cruise }), world, dt);
      t.bucketAngle = ease(t.bucketAngle, 0, 2, dt);
      if (Math.hypot(target.x - t.x, target.z - t.z) < 6) {
        agent.index++;
        // Past the east end of the lane: join the queue for the loading bay.
        if (agent.index >= route.length - 2) {
          agent.phase = "queue";
          agent.timer = 0;
        }
      }
      return;
    }
    case "queue": {
      const waiting = world.agents
        .filter((a) => a.role === "haul" && a.phase === "queue")
        .sort((a, b) => a.timer - b.timer);
      if (agent.timer === 0) agent.timer = ++queueTicket;
      const slot = waiting.indexOf(agent) + (spottedTruck(world) ? 1 : 0);
      if (slot === 0 && !spottedTruck(world)) {
        agent.phase = "spot";
        agent.timer = 0;
        return;
      }
      const q = queuePoint(Math.max(0, slot - 1));
      if (Math.hypot(q.x - t.x, q.z - t.z) > 3) {
        drive(agent, steerToward(t, q.x, q.z, { cruise: 0.5, arriveRadius: 8 }), world, dt);
      } else hold(agent, world, dt);
      return;
    }
    case "spot": {
      drive(
        agent,
        steerToward(t, LOADER_POINT.x, LOADER_POINT.z, { cruise: 0.6, arriveRadius: 6 }),
        world,
        dt,
      );
      if (Math.hypot(LOADER_POINT.x - t.x, LOADER_POINT.z - t.z) < 2.5 && Math.abs(t.speed) < 0.6) {
        agent.phase = "loading";
      }
      return;
    }
    case "loading": {
      hold(agent, world, dt);
      t.activity = "loading";
      if (t.payload >= TRUCK_FULL_KG - 1) {
        agent.phase = "laden";
        agent.index = 1;
      }
      return;
    }
    case "laden": {
      const route = LOADED_ROUTE;
      const target = route[agent.index];
      drive(agent, steerToward(t, target.x, target.z, { cruise }), world, dt);
      if (Math.hypot(target.x - t.x, target.z - t.z) < 6) {
        agent.index++;
        if (agent.index >= route.length) agent.phase = "turn";
      }
      return;
    }
    case "turn": {
      drive(agent, steerToward(t, TIP_TURN.x, TIP_TURN.z, { cruise: 0.4, arriveRadius: 4 }), world, dt);
      if (Math.hypot(TIP_TURN.x - t.x, TIP_TURN.z - t.z) < 3.5) agent.phase = "reverse";
      return;
    }
    case "reverse": {
      drive(agent, reverseToward(t, TIP_SPOT.x, TIP_SPOT.z, 0.32), world, dt);
      if (Math.hypot(TIP_SPOT.x - t.x, TIP_SPOT.z - t.z) < 2.5) {
        agent.phase = "tip";
        agent.timer = 0;
      }
      return;
    }
    case "tip": {
      hold(agent, world, dt);
      agent.timer += dt;
      t.activity = "loading";
      // Body up over ~5 s, material slides out, hold, then lower.
      const up = agent.timer < 9;
      t.bucketAngle = ease(t.bucketAngle, up ? -1 : 0, up ? 0.9 : 1.4, dt);
      if (agent.timer > 2.5) t.payload = Math.max(0, t.payload - 9000 * dt);
      if (agent.timer > 13) {
        agent.phase = "empty";
        agent.index = 1;
      }
      return;
    }
  }
}

/* ------------------------------------------------------------------------ */
/*  Wheel loader                                                            */
/* ------------------------------------------------------------------------ */

const PILE = MOUNDS[0];

function stepLoader(agent: Agent, world: FleetWorld, dt: number): void {
  const t = agent.t;
  const truck = spottedTruck(world);
  const truckReady = truck && truck.phase === "loading";

  switch (agent.phase) {
    case "to_pile": {
      const p = STOCKPILE_POINT;
      drive(agent, steerToward(t, p.x, p.z, { cruise: 0.8, arriveRadius: 6 }), world, dt);
      t.boomAngle = ease(t.boomAngle, 0.05, 2, dt);
      t.bucketAngle = ease(t.bucketAngle, 0, 2, dt);
      if (Math.hypot(p.x - t.x, p.z - t.z) < 3) {
        agent.phase = "face_pile";
      }
      return;
    }
    case "face_pile": {
      const input = emptyInput();
      if (faceHeading(t, headingTo(t.x, t.z, PILE.x, PILE.z), input)) {
        agent.phase = "crowd";
        agent.timer = 0;
      } else drive(agent, input, world, dt);
      t.boomAngle = ease(t.boomAngle, -0.02, 3, dt);
      return;
    }
    case "crowd": {
      // Drive the bucket into the toe, curl and lift as it fills.
      agent.timer += dt;
      const input = emptyInput();
      input.throttle = agent.timer < 2.2 ? 0.25 : 0;
      drive(agent, input, world, dt);
      t.bucketAngle = ease(t.bucketAngle, agent.timer > 1.4 ? 0.75 : 0.1, 2.6, dt);
      t.boomAngle = ease(t.boomAngle, agent.timer > 2.4 ? 0.3 : -0.02, 1.8, dt);
      t.payload = Math.min(LOADER_PASS_KG, t.payload + (LOADER_PASS_KG / 2.6) * dt);
      t.activity = "digging";
      if (agent.timer > 3.4) agent.phase = "back_out";
      return;
    }
    case "back_out": {
      const f = headingVector(t.heading);
      const target = agent.target ?? { x: t.x - f.x * 11, z: t.z - f.z * 11 };
      agent.target = target;
      drive(agent, reverseToward(t, target.x, target.z, 0.6), world, dt);
      t.boomAngle = ease(t.boomAngle, 0.32, 2, dt);
      if (Math.hypot(target.x - t.x, target.z - t.z) < 2) {
        agent.target = null;
        agent.phase = "to_truck";
      }
      return;
    }
    case "to_truck": {
      // Approach from the truck's side, square to the body.
      const aim = truckSide(truck);
      drive(agent, steerToward(t, aim.x, aim.z, { cruise: 0.8, arriveRadius: 5 }), world, dt);
      t.boomAngle = ease(t.boomAngle, truckReady ? 0.85 : 0.35, 1.6, dt);
      t.bucketAngle = ease(t.bucketAngle, 0.7, 2, dt);
      if (Math.hypot(aim.x - t.x, aim.z - t.z) < 2.5) {
        agent.phase = truckReady ? "face_truck" : "wait";
        agent.timer = 0;
      }
      return;
    }
    case "face_truck": {
      const input = emptyInput();
      const aligned = truck ? faceHeading(t, headingTo(t.x, t.z, truck.t.x, truck.t.z), input) : true;
      t.boomAngle = ease(t.boomAngle, 0.85, 1.6, dt);
      if (aligned) {
        agent.phase = "dump";
        agent.timer = 0;
        hold(agent, world, dt);
      } else drive(agent, input, world, dt);
      return;
    }
    case "wait": {
      hold(agent, world, dt);
      t.boomAngle = ease(t.boomAngle, 0.4, 2, dt);
      if (truckReady) {
        agent.phase = "face_truck";
        agent.timer = 0;
      }
      return;
    }
    case "dump": {
      agent.timer += dt;
      hold(agent, world, dt);
      t.boomAngle = ease(t.boomAngle, 0.95, 2.2, dt);
      if (agent.timer > 1.4) t.bucketAngle = ease(t.bucketAngle, -0.8, 2.4, dt);
      t.activity = "loading";
      if (agent.timer > 1.8 && t.payload > 0) {
        const moved = Math.min(t.payload, (LOADER_PASS_KG / 1.4) * dt);
        t.payload -= moved;
        if (truck) truck.t.payload = Math.min(TRUCK_FULL_KG, truck.t.payload + moved);
      }
      if (agent.timer > 3.8) {
        agent.phase = "back_off";
        agent.target = null;
      }
      return;
    }
    case "back_off": {
      const f = headingVector(t.heading);
      const target = agent.target ?? { x: t.x - f.x * 10, z: t.z - f.z * 10 };
      agent.target = target;
      drive(agent, reverseToward(t, target.x, target.z, 0.6), world, dt);
      t.boomAngle = ease(t.boomAngle, 0.1, 1.5, dt);
      t.bucketAngle = ease(t.bucketAngle, 0, 2, dt);
      if (Math.hypot(target.x - t.x, target.z - t.z) < 2) {
        agent.target = null;
        agent.phase = "to_pile";
      }
      return;
    }
    default:
      agent.phase = "to_pile";
  }
}

/** Point beside a spotted truck's body where the loader stops to dump. */
function truckSide(truck: Agent | null): { x: number; z: number } {
  if (!truck) return WORK_STATIONS.loaderDump;
  const f = headingVector(truck.t.heading);
  // Right-hand side of the truck (the operator's side), level with the body.
  const right = { x: -f.z, z: f.x };
  return {
    x: truck.t.x - f.x * 1.8 + right.x * 7.4,
    z: truck.t.z - f.z * 1.8 + right.z * 7.4,
  };
}

/* ------------------------------------------------------------------------ */

export function stepAgent(agent: Agent, world: FleetWorld, dt: number): void {
  switch (agent.role) {
    case "excavate":
      return stepExcavator(agent, world, dt);
    case "push":
      return stepDozer(agent, world, dt);
    case "grade":
      return stepGrader(agent, world, dt);
    case "load":
      return stepLoader(agent, world, dt);
    case "haul":
      return stepTruck(agent, world, dt);
  }
}

/** Where each role starts, and in what phase, so the site is busy from frame one. */
export function initialPlacement(
  role: FleetRole,
  ordinal: number,
): { x: number; z: number; heading: number; phase: string; index: number; payload: number } {
  switch (role) {
    case "excavate":
      return { ...WORK_STATIONS.pitExcavator, phase: "reach", index: 0, payload: 0 };
    case "push": {
      const L = WORK_STATIONS.dozerLanes;
      return { x: L.x0 + 10, z: L.z0, heading: Math.PI / 2, phase: "push", index: 0, payload: 0 };
    }
    case "grade": {
      const G = WORK_STATIONS.graderLanes;
      return { x: G.x0 + 6, z: G.z0, heading: Math.PI / 2, phase: "pass", index: 0, payload: 0 };
    }
    case "load":
      return { x: STOCKPILE_POINT.x - 14, z: STOCKPILE_POINT.z + 4, heading: Math.PI / 2, phase: "to_pile", index: 0, payload: 0 };
    case "haul": {
      // Spread the trucks around the cycle: one loading, one queued, one laden, one empty.
      const spots = [
        { x: LOADER_POINT.x, z: LOADER_POINT.z, phase: "loading", index: 0, payload: TRUCK_FULL_KG * 0.5, route: EMPTY_ROUTE, from: 4 },
        { ...queuePoint(0), phase: "queue", index: 0, payload: 0, route: EMPTY_ROUTE, from: 3 },
        { ...LOADED_ROUTE[2], phase: "laden", index: 3, payload: TRUCK_FULL_KG, route: LOADED_ROUTE, from: 1 },
        { ...EMPTY_ROUTE[2], phase: "empty", index: 3, payload: 0, route: EMPTY_ROUTE, from: 2 },
      ];
      const s = spots[ordinal % spots.length];
      const next = s.route[Math.min(s.from + 1, s.route.length - 1)];
      const prev = s.route[s.from];
      const heading =
        s.phase === "loading"
          ? headingTo(EMPTY_ROUTE[4].x, EMPTY_ROUTE[4].z, LOADER_POINT.x, LOADER_POINT.z)
          : headingTo(prev.x, prev.z, next.x, next.z);
      return { x: s.x, z: s.z, heading, phase: s.phase, index: s.index, payload: s.payload };
    }
  }
}
