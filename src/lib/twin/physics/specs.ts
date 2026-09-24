/**
 * Physical build of each machine kind.
 *
 * Masses mirror `simulator/config.py` `SPECS` (and `MachineSpec`'s
 * counterweight/arm/bucket defaults) — the backend simulator and the twin
 * must agree on how heavy a machine is:
 *
 *   320 excavator    22 000 kg  (counterweight 4 000, arm 2 500, bucket 1 200)
 *   D6 dozer         23 000 kg
 *   950 wheel loader 19 000 kg
 *   745 haul truck   30 000 kg empty, 41 000 kg rated payload
 *
 * Geometry is taken from the rig components (Excavator.tsx, Bulldozer.tsx,
 * Loader.tsx, Truck.tsx) so every collider sits under the part it stands for.
 * Body frame: origin on the ground under the machine centre, -Z forward,
 * +X right, +Y up — the same frame the meshes are modelled in.
 */

import type { MachineKind } from "@/types/twin";

/** A convex part of the machine. Half extents, centre in body frame. */
export interface PartCollider {
  /** Component id — shared with the X-ray component registry. */
  part: string;
  hx: number;
  hy: number;
  hz: number;
  x: number;
  y: number;
  z: number;
  /** kg carried by this collider. 0 = contact only (mass added elsewhere). */
  mass: number;
  /** Tools that cut the ground (bucket, blade) do not collide with terrain. */
  cutsGround?: boolean;
}

/** A ray-cast support: a wheel, or one roller station under a track. */
export interface Support {
  x: number;
  z: number;
  radius: number;
  /** True for wheels that steer. `-1` steers opposite (articulated rear). */
  steer?: 1 | -1;
  /** True if this support is driven. */
  driven: boolean;
}

export interface MachineBuild {
  /** Total operating mass, kg, without payload. */
  mass: number;
  tracked: boolean;
  parts: PartCollider[];
  supports: Support[];
  /** Height of the suspension hard points above the body origin. */
  hardPointY: number;
  suspensionRest: number;
  /** Per-support suspension stiffness (scaled by chassis mass in Rapier). */
  stiffness: number;
  /** Peak tractive effort at the ground, N. */
  tractiveForce: number;
  /** Service brake capacity, per support. */
  brake: number;
  /** Top speed forward, m/s (reverse is 60%). */
  maxSpeed: number;
  /** Max steer angle, radians (wheeled), or yaw rate target, rad/s (tracked). */
  steer: number;
  /** Lateral grip multiplier: tracks slide sideways more easily than they should grip. */
  sideGrip: number;
  /** Where the carried payload sits in the body frame (bed / bucket). */
  payloadAt: { x: number; y: number; z: number };
}

export const BUILDS: Record<MachineKind, MachineBuild> = {
  excavator: {
    mass: 22_000,
    tracked: true,
    parts: [
      // Undercarriage carries the fixed mass; the swinging upper structure
      // (house, counterweight, arm, bucket, payload) is applied as moving
      // mass every step so its centre of mass really moves.
      { part: "undercarriage", hx: 0.4, hy: 0.4, hz: 2.2, x: -1.25, y: 0.55, z: 0, mass: 2_600 },
      { part: "undercarriage", hx: 0.4, hy: 0.4, hz: 2.2, x: 1.25, y: 0.55, z: 0, mass: 2_600 },
      { part: "carbody", hx: 1.35, hy: 0.26, hz: 0.95, x: 0, y: 0.78, z: 0, mass: 2_600 },
    ],
    supports: [-1.8, -0.6, 0.6, 1.8].flatMap((z) => [
      { x: -1.25, z, radius: 0.4, driven: true },
      { x: 1.25, z, radius: 0.4, driven: true },
    ]),
    hardPointY: 0.9,
    suspensionRest: 0.5,
    stiffness: 40,
    // A 320 pulls roughly 200 kN at the drawbar.
    tractiveForce: 200_000,
    brake: 60_000,
    maxSpeed: 2.4,
    steer: 0.55,
    sideGrip: 0.35,
    payloadAt: { x: 0, y: 0, z: 0 }, // follows the bucket — see arm kinematics
  },
  bulldozer: {
    mass: 23_000,
    tracked: true,
    parts: [
      { part: "undercarriage", hx: 0.47, hy: 0.42, hz: 2.1, x: -1.35, y: 0.57, z: 0, mass: 5_500 },
      { part: "undercarriage", hx: 0.47, hy: 0.42, hz: 2.1, x: 1.35, y: 0.57, z: 0, mass: 5_500 },
      { part: "engine", hx: 1.15, hy: 0.5, hz: 1.6, x: 0, y: 1.15, z: 0.2, mass: 7_500 },
      { part: "cab", hx: 0.85, hy: 0.68, hz: 0.8, x: 0, y: 2.05, z: 0.75, mass: 1_200 },
      { part: "push_arms", hx: 1.3, hy: 0.12, hz: 1.0, x: 0, y: 0.75, z: -2.0, mass: 800 },
      { part: "moldboard", hx: 1.95, hy: 0.62, hz: 0.18, x: 0, y: 0.78, z: -3.05, mass: 2_500, cutsGround: true },
    ],
    supports: [-1.6, -0.53, 0.53, 1.6].flatMap((z) => [
      { x: -1.35, z, radius: 0.4, driven: true },
      { x: 1.35, z, radius: 0.4, driven: true },
    ]),
    hardPointY: 0.9,
    suspensionRest: 0.5,
    stiffness: 40,
    tractiveForce: 230_000,
    brake: 60_000,
    maxSpeed: 2.6,
    steer: 0.5,
    sideGrip: 0.35,
    payloadAt: { x: 0, y: 0.8, z: -3.3 },
  },
  loader: {
    mass: 19_000,
    tracked: false,
    parts: [
      { part: "engine", hx: 1.25, hy: 0.65, hz: 1.35, x: 0, y: 1.25, z: 1.85, mass: 7_500 },
      { part: "counterweight", hx: 1.15, hy: 0.5, hz: 0.3, x: 0, y: 0.95, z: 3.2, mass: 2_500 },
      { part: "front_frame", hx: 1.2, hy: 0.52, hz: 1.2, x: 0, y: 1.15, z: -1.1, mass: 5_000 },
      { part: "cab", hx: 0.85, hy: 0.75, hz: 0.85, x: 0, y: 2.25, z: 0.75, mass: 1_200 },
      { part: "lift_arms", hx: 1.1, hy: 0.17, hz: 1.4, x: 0, y: 1.05, z: -2.6, mass: 1_300 },
      { part: "bucket", hx: 1.45, hy: 0.55, hz: 0.65, x: 0, y: 0.6, z: -4.05, mass: 1_500, cutsGround: true },
    ],
    supports: [
      { x: -1.25, z: -1.7, radius: 0.82, steer: 1, driven: true },
      { x: 1.25, z: -1.7, radius: 0.82, steer: 1, driven: true },
      { x: -1.25, z: 1.75, radius: 0.82, steer: -1, driven: true },
      { x: 1.25, z: 1.75, radius: 0.82, steer: -1, driven: true },
    ],
    hardPointY: 1.25,
    suspensionRest: 0.45,
    stiffness: 22,
    tractiveForce: 160_000,
    brake: 50_000,
    maxSpeed: 4.6,
    steer: 0.32,
    sideGrip: 1,
    payloadAt: { x: 0, y: 1.0, z: -4.05 },
  },
  truck: {
    mass: 30_000,
    tracked: false,
    parts: [
      { part: "engine", hx: 1.3, hy: 0.45, hz: 1.7, x: 0, y: 1.15, z: -1.9, mass: 9_000 },
      { part: "engine", hx: 1.15, hy: 0.43, hz: 0.75, x: 0, y: 1.75, z: -3.2, mass: 2_000 },
      { part: "cab", hx: 1.0, hy: 0.75, hz: 0.85, x: 0, y: 2.35, z: -1.9, mass: 1_500 },
      { part: "hitch", hx: 0.4, hy: 0.4, hz: 0.4, x: 0, y: 1.05, z: -0.1, mass: 1_500 },
      { part: "rear_frame", hx: 1.1, hy: 0.25, hz: 2.0, x: 0, y: 1.0, z: 2.3, mass: 6_000 },
      { part: "dump_body", hx: 1.45, hy: 0.75, hz: 2.3, x: 0, y: 2.4, z: 2.0, mass: 10_000 },
    ],
    supports: [
      { x: -1.45, z: -2.6, radius: 0.95, steer: 1, driven: false },
      { x: 1.45, z: -2.6, radius: 0.95, steer: 1, driven: false },
      { x: -1.45, z: 1.5, radius: 0.95, driven: true },
      { x: 1.45, z: 1.5, radius: 0.95, driven: true },
      { x: -1.45, z: 3.1, radius: 0.95, driven: true },
      { x: 1.45, z: 3.1, radius: 0.95, driven: true },
    ],
    hardPointY: 1.4,
    suspensionRest: 0.45,
    stiffness: 26,
    tractiveForce: 260_000,
    brake: 90_000,
    maxSpeed: 6.4,
    steer: 0.4,
    sideGrip: 1,
    payloadAt: { x: 0, y: 2.3, z: 2.0 },
  },
};

/**
 * Excavator upper-structure masses, from `MachineSpec` defaults. The house
 * takes the remainder so the machine totals 22 t.
 */
export const EXCAVATOR_UPPER = {
  counterweight: 4_000,
  arm: 2_500,
  bucket: 1_200,
  house: 22_000 - 7_800 - 4_000 - 2_500 - 1_200,
};

/** Excavator arm geometry, from Excavator.tsx. House frame; -Z forward. */
export const EXCAVATOR_ARM = {
  /** House group origin above the body origin. */
  houseY: 1.14,
  boomPivot: { x: 0.45, y: 1.05, z: -1.55 },
  /** Stick pivot in the boom's frame. */
  stickPivot: { y: 0.257, z: -5.65 },
  /** Bucket pivot in the stick's frame. */
  bucketPivot: { z: -2.9 },
  stickRest: -0.85,
  bucketRest: -0.6,
  houseCom: { x: 0, y: 0.8, z: 0.35 },
  counterweightCom: { x: 0, y: 0.62, z: 2.28 },
};
