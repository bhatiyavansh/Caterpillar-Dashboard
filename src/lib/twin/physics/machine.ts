/**
 * One machine as a rigid body.
 *
 * Each machine is a single dynamic Rapier body carrying a compound of convex
 * colliders (one per major part, from `specs.ts`), sprung on ray-cast
 * supports — wheels for the loader and truck, roller stations under each track
 * for the excavator and dozer. Rapier's `DynamicRayCastVehicleController`
 * resolves suspension, traction and braking at each support against whatever
 * the ray hits: the terrain heightfield, a structure, a face block, a pile of
 * spoil.
 *
 * What replaced the old kinematic integrator:
 *  - speed comes from tractive force against inertia, grade and friction
 *    (no more `damp()` toward a target speed);
 *  - traction at each support is capped by the friction of the ground under
 *    it (`surfaceAt` x weather), so a loaded truck really can slide back down
 *    a wet ramp;
 *  - the excavator's house, counterweight, arm, bucket and payload are moving
 *    mass: the centre of mass follows the arm and the swing, so an overloaded
 *    bucket slung over the side really does roll the machine.
 *
 * The body only writes pose and speed back into `MachineTelemetry`; the
 * contract every other part of the app reads is unchanged.
 */

import type RAPIER_NS from "@dimforge/rapier3d-compat";
import type { MachineKind, MachineTelemetry, VehicleInput } from "@/types/twin";
import { DEG } from "../telemetry";
import { sampleAttitude, surfaceAt } from "../terrain";
import { frictionFor } from "../surface";
import { BUILDS, EXCAVATOR_ARM, EXCAVATOR_UPPER, type MachineBuild } from "./specs";
import { add, attitudeToQuat, quatToAttitude, qRotate, rotX, rotY, tiltOf, type Quat, type V3 } from "./math";

type R = typeof RAPIER_NS;

/** Collision layers (membership bits). */
export const LAYER = {
  terrain: 1 << 0,
  structure: 1 << 1,
  machine: 1 << 2,
  material: 1 << 3,
  face: 1 << 4,
  tool: 1 << 5,
} as const;

/** Rapier interaction groups: membership in the high 16 bits, filter in the low 16. */
export function groups(member: number, filter: number): number {
  return ((member & 0xffff) << 16) | (filter & 0xffff);
}

const ALL = 0xffff;

export class PhysicsMachine {
  readonly body: RAPIER_NS.RigidBody;
  readonly controller: RAPIER_NS.DynamicRayCastVehicleController;
  readonly build: MachineBuild;
  /** Collider handle -> component id, for contact reports and X-ray picking. */
  readonly partOf = new Map<number, string>();
  readonly colliders: RAPIER_NS.Collider[] = [];

  private input: VehicleInput | null = null;
  private stopped = false;
  private armCollider: RAPIER_NS.Collider | null = null;
  private bucketCollider: RAPIER_NS.Collider | null = null;
  /** World position of the bucket/blade/bed load point, refreshed each step. */
  loadPoint: V3 = { x: 0, y: 0, z: 0 };
  /** Signed forward speed, m/s. */
  speed = 0;
  /** Heading rate, rad/s, clockwise positive (same sense as heading). */
  yawRate = 0;
  /** 0..1: how much of the demanded traction the ground refused (wheel slip). */
  slip = 0;
  /** Tilt of the body's up axis from vertical, radians. */
  tilt = 0;
  /** Latched once the machine goes past its tipping point. */
  tippedOver = false;
  /** Friction under the machine centre right now (for the HUD and scenarios). */
  groundFriction = 0.8;
  /** Rest height of the body origin above ground, from the suspension sag. */
  private sag = 0;
  kinematic = false;

  constructor(
    private readonly R: R,
    private readonly world: RAPIER_NS.World,
    readonly id: string,
    readonly kind: MachineKind,
    readonly telemetry: MachineTelemetry,
  ) {
    const build = BUILDS[kind];
    this.build = build;

    const desc = R.RigidBodyDesc.dynamic()
      .setLinearDamping(0.05)
      .setAngularDamping(0.4)
      .setCanSleep(false)
      .setCcdEnabled(true);
    this.body = world.createRigidBody(desc);
    this.body.userData = { machineId: id };

    for (const p of build.parts) {
      const layer = p.cutsGround ? LAYER.tool : LAYER.machine;
      const filter = p.cutsGround ? ALL & ~LAYER.terrain & ~LAYER.face : ALL;
      const cd = R.ColliderDesc.cuboid(p.hx, p.hy, p.hz)
        .setTranslation(p.x, p.y, p.z)
        .setMass(p.mass)
        .setFriction(0.5)
        .setCollisionGroups(groups(layer, filter))
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS | R.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(40_000);
      const c = world.createCollider(cd, this.body);
      this.colliders.push(c);
      this.partOf.set(c.handle, p.part);
    }

    if (kind === "excavator") this.buildExcavatorUpper();

    this.controller = world.createVehicleController(this.body);
    // Model forward is -Z: Rapier's forward axis index 2 is +Z, so drive
    // forces are negated below.
    (this.controller as unknown as { setIndexForwardAxis: number }).setIndexForwardAxis = 2;
    build.supports.forEach((s, i) => {
      this.controller.addWheel(
        { x: s.x, y: build.hardPointY, z: s.z },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        build.suspensionRest,
        s.radius,
      );
      this.controller.setWheelSuspensionStiffness(i, build.stiffness);
      this.controller.setWheelSuspensionCompression(i, 0.9 * Math.sqrt(build.stiffness));
      this.controller.setWheelSuspensionRelaxation(i, 1.1 * Math.sqrt(build.stiffness));
      this.controller.setWheelMaxSuspensionTravel(i, build.suspensionRest * 0.9);
      this.controller.setWheelMaxSuspensionForce(i, build.mass * 60);
      this.controller.setWheelSideFrictionStiffness(i, build.sideGrip);
      this.controller.setWheelFrictionSlip(i, 0.8);
    });
    const n = build.supports.length;
    // Static sag: n supports share m·g with stiffness·compression·m each.
    this.sag = 9.81 / (n * build.stiffness);

    this.updateMassProperties();
    this.placeAt(telemetry.x, telemetry.z, telemetry.heading);
  }

  /* ----------------------------------------------------------- excavator */

  private buildExcavatorUpper(): void {
    const R = this.R;
    // House: symmetric about the swing axis, so it needs no update on swing.
    const house = this.world.createCollider(
      R.ColliderDesc.cylinder(0.72, 1.7)
        .setTranslation(0, EXCAVATOR_ARM.houseY + 0.72, 0.2)
        .setMass(0)
        .setFriction(0.5)
        .setCollisionGroups(groups(LAYER.machine, ALL))
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS | R.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(40_000),
      this.body,
    );
    this.colliders.push(house);
    this.partOf.set(house.handle, "house");
    // Arm and bucket follow the joints; they cut the ground, so no terrain contact.
    const toolGroups = groups(LAYER.tool, ALL & ~LAYER.terrain & ~LAYER.face);
    this.armCollider = this.world.createCollider(
      R.ColliderDesc.cuboid(0.3, 0.35, 2.8).setMass(0).setCollisionGroups(toolGroups),
      this.body,
    );
    this.partOf.set(this.armCollider.handle, "boom");
    this.bucketCollider = this.world.createCollider(
      R.ColliderDesc.cuboid(0.6, 0.45, 0.5)
        .setMass(0)
        .setCollisionGroups(toolGroups)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    this.partOf.set(this.bucketCollider.handle, "bucket");
    this.colliders.push(this.armCollider, this.bucketCollider);
  }

  /** Arm joint positions in the body frame, from the current telemetry. */
  armKinematics(): { boomMid: V3; stickMid: V3; bucket: V3; boomPivot: V3; stickPivot: V3 } {
    const t = this.telemetry;
    const A = EXCAVATOR_ARM;
    const swing = -t.swingAngle;
    const boom = t.boomAngle;
    const stick = A.stickRest + t.stickAngle;
    const bucket = A.bucketRest + t.bucketAngle;
    const pivot: V3 = { x: A.boomPivot.x, y: A.boomPivot.y, z: A.boomPivot.z };
    // Boom frame -> house frame.
    const boomToHouse = (v: V3) => add(rotX(v, boom), pivot);
    const stickPivotB: V3 = { x: 0, y: A.stickPivot.y, z: A.stickPivot.z };
    const stickToBoom = (v: V3) => add(rotX(v, stick), stickPivotB);
    const bucketPivotS: V3 = { x: 0, y: 0, z: A.bucketPivot.z };
    const bucketCom = add(rotX({ x: 0, y: -0.45, z: -0.55 }, bucket), bucketPivotS);
    const house = (v: V3) => add(rotY(v, swing), { x: 0, y: A.houseY, z: 0 });
    return {
      boomPivot: house(pivot),
      boomMid: house(boomToHouse({ x: 0, y: 0.45, z: -2.8 })),
      stickPivot: house(boomToHouse(stickPivotB)),
      stickMid: house(boomToHouse(stickToBoom({ x: 0, y: 0, z: -1.45 }))),
      bucket: house(boomToHouse(stickToBoom(bucketCom))),
    };
  }

  /**
   * Sets the swinging upper structure's mass, centre of mass and inertia.
   * Called every step for the excavator: this is the real load shift.
   */
  private updateMassProperties(): void {
    const t = this.telemetry;
    const payload = Math.max(0, t.payload);
    const pts: { m: number; p: V3 }[] = [];

    if (this.kind === "excavator") {
      const A = EXCAVATOR_ARM;
      const swing = -t.swingAngle;
      const up = (v: V3) => add(rotY(v, swing), { x: 0, y: A.houseY, z: 0 });
      const k = this.armKinematics();
      pts.push({ m: EXCAVATOR_UPPER.house, p: up(A.houseCom) });
      pts.push({ m: EXCAVATOR_UPPER.counterweight, p: up(A.counterweightCom) });
      pts.push({ m: EXCAVATOR_UPPER.arm * 0.64, p: k.boomMid });
      pts.push({ m: EXCAVATOR_UPPER.arm * 0.36, p: k.stickMid });
      pts.push({ m: EXCAVATOR_UPPER.bucket + payload, p: k.bucket });
      this.loadPoint = k.bucket;
      this.poseArmColliders(k);
    } else if (payload > 0) {
      pts.push({ m: payload, p: this.build.payloadAt });
    }
    if (this.kind !== "excavator") this.loadPoint = this.build.payloadAt;

    let m = 0;
    const c = { x: 0, y: 0, z: 0 };
    for (const q of pts) {
      m += q.m;
      c.x += q.m * q.p.x;
      c.y += q.m * q.p.y;
      c.z += q.m * q.p.z;
    }
    if (m <= 0) {
      this.body.setAdditionalMassProperties(0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, true);
      return;
    }
    c.x /= m;
    c.y /= m;
    c.z /= m;
    // Point masses about their common centre, with a little self-inertia each
    // so the tensor never degenerates. Off-diagonal terms are dropped: the
    // principal axes stay aligned with the body.
    const I = { x: 0, y: 0, z: 0 };
    for (const q of pts) {
      const dx = q.p.x - c.x;
      const dy = q.p.y - c.y;
      const dz = q.p.z - c.z;
      I.x += q.m * (dy * dy + dz * dz + 0.5);
      I.y += q.m * (dx * dx + dz * dz + 0.5);
      I.z += q.m * (dx * dx + dy * dy + 0.5);
    }
    this.body.setAdditionalMassProperties(m, c, I, { x: 0, y: 0, z: 0, w: 1 }, true);
  }

  private poseArmColliders(k: ReturnType<PhysicsMachine["armKinematics"]>): void {
    const arm = this.armCollider;
    const bucket = this.bucketCollider;
    if (!arm || !bucket) return;
    // Arm box spans boom pivot -> bucket, aligned in the swing plane.
    const a = k.boomPivot;
    const b = k.bucket;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const q = quatFromYawPitch(yaw, pitch);
    arm.setHalfExtents({ x: 0.3, y: 0.35, z: Math.max(0.5, len / 2 - 0.6) });
    arm.setTranslationWrtParent(mid);
    arm.setRotationWrtParent(q);
    bucket.setTranslationWrtParent(b);
    bucket.setRotationWrtParent(q);
  }

  /* ------------------------------------------------------------- control */

  setCommand(input: VehicleInput, stopped: boolean): void {
    this.input = input;
    this.stopped = stopped;
  }

  /**
   * Applies drive, brake and steering for one physics substep, then lets the
   * vehicle controller resolve the supports against the ground.
   */
  preStep(dt: number, wetness: number): void {
    if (this.kinematic) return;
    this.updateMassProperties();

    const b = this.build;
    const input = this.input;
    const stopped = this.stopped || !input || this.tippedOver;
    const throttle = stopped ? 0 : input.throttle;
    const steer = stopped ? 0 : input.steer;

    const v = this.speed;
    const vmax = b.maxSpeed;
    const target = throttle * vmax * (throttle < 0 ? 0.6 : 1);

    // Tractive effort: a governor holding target speed, capped at the
    // machine's rated pull. Everything else — grade, inertia, friction — is
    // the physics.
    let drive = 0;
    let brake = 0;
    if (Math.abs(throttle) < 0.02) {
      brake = b.brake * (stopped ? 1.4 : 1);
    } else if (Math.sign(target) !== Math.sign(v) && Math.abs(v) > 0.25) {
      // Changing direction: brake to a stop first.
      brake = b.brake;
    } else {
      const err = target - v;
      drive = b.tractiveForce * clamp(err / 0.6, -1, 1);
      // Over-running the governor (downhill): hold it back on the brakes.
      if (Math.sign(err) !== Math.sign(target) && Math.abs(err) > 0.15) {
        drive = 0;
        brake = b.brake * clamp(Math.abs(err) / 0.8, 0.1, 1);
      }
    }

    const driven = b.supports.filter((s) => s.driven).length;
    const perWheel = drive / Math.max(driven, 1);
    const q = this.rotation();
    const bodyPos = this.body.translation();

    let frictionSum = 0;
    for (let i = 0; i < b.supports.length; i++) {
      const s = b.supports[i];
      // Friction of the ground actually under this support.
      const world = add(qRotate(q, { x: s.x, y: 0, z: s.z }), bodyPos);
      const mu = frictionFor(surfaceAt(world.x, world.z, 0), wetness) * (b.tracked ? 1.1 : 1);
      frictionSum += mu;
      this.controller.setWheelFrictionSlip(i, mu);

      if (b.tracked) {
        // Skid steer: one track pushes harder than the other.
        const side = s.x < 0 ? 1 : -1; // left track leads a right (clockwise) turn
        const bias = throttle === 0 ? steer : steer * 0.6;
        const f = perWheel + side * bias * (b.tractiveForce / b.supports.length) * 0.8;
        this.controller.setWheelEngineForce(i, -f);
      } else {
        this.controller.setWheelEngineForce(i, s.driven ? -perWheel : 0);
        // Positive steer is a right (clockwise) turn: a negative wheel angle about +Y.
        this.controller.setWheelSteering(i, (s.steer ?? 0) * -steer * b.steer);
      }
      this.controller.setWheelBrake(i, brake / b.supports.length);
    }
    this.groundFriction = frictionSum / b.supports.length;

    if (b.tracked && !stopped) {
      // Skid steering is a torque the track differential produces, limited by
      // what the tracks can push against the ground. Aim for the commanded
      // yaw rate; the ground friction caps how hard it can try.
      const targetYaw = steer * b.steer;
      const err = targetYaw - this.yawRate;
      const trackGauge = Math.abs(b.supports[0].x) * 2;
      const maxTorque = this.groundFriction * b.mass * 9.81 * trackGauge * 0.25;
      const inertia = b.mass * 2.5;
      const torque = clamp(err * inertia * 6, -maxTorque, maxTorque);
      // Heading is clockwise, i.e. negative about +Y.
      const up = qRotate(q, { x: 0, y: 1, z: 0 });
      this.body.addTorque({ x: -up.x * torque, y: -up.y * torque, z: -up.z * torque }, true);
    }

    // Supports stand on anything solid except this machine itself and cutting
    // tools. The terrain and structures have no parent body.
    this.controller.updateVehicle(dt, undefined, undefined, (c) => {
      const parent = c.parent();
      return (parent === null || parent.handle !== this.body.handle) && !isTool(c);
    });
  }

  /** Reads the body back into telemetry after a world step. */
  postStep(): void {
    const t = this.telemetry;
    const p = this.body.translation();
    const q = this.rotation();
    const att = quatToAttitude(q);
    t.x = p.x;
    // The model's y = 0 is the bottom of its wheels/tracks: put it where the
    // physics wheels actually are on their springs.
    t.y = p.y + this.groundOffset();
    t.z = p.z;
    t.heading = att.heading;
    t.pitch = att.pitch;
    t.roll = att.roll;

    const lv = this.body.linvel();
    const f = qRotate(q, { x: 0, y: 0, z: -1 });
    this.speed = lv.x * f.x + lv.y * f.y + lv.z * f.z;
    t.speed = this.speed;
    const av = this.body.angvel();
    const up = qRotate(q, { x: 0, y: 1, z: 0 });
    this.yawRate = -(av.x * up.x + av.y * up.y + av.z * up.z);

    this.tilt = tiltOf(q);
    // Past ~50 degrees nothing brings a machine back: it is going over.
    if (this.tilt > 50 * DEG) this.tippedOver = true;

    // Slip: commanded governor speed vs what the ground allowed.
    const input = this.input;
    if (input && Math.abs(input.throttle) > 0.1 && !this.stopped) {
      const want = input.throttle * this.build.maxSpeed;
      const shortfall = Math.max(0, (want - this.speed) * Math.sign(want));
      this.slip = clamp(shortfall / Math.max(Math.abs(want), 0.5), 0, 1);
    } else {
      // Sliding while not driving is slip too (a braked truck sliding back).
      this.slip = clamp((Math.abs(this.speed) - 0.15) / 1.5, 0, 1);
    }
  }

  /** Mean height of the wheel/track bottoms relative to the body origin. */
  private groundOffset(): number {
    const b = this.build;
    let sum = 0;
    for (let i = 0; i < b.supports.length; i++) {
      const len = this.controller.wheelSuspensionLength(i) ?? b.suspensionRest;
      sum += b.hardPointY - len - b.supports[i].radius;
    }
    return sum / b.supports.length;
  }

  rotation(): Quat {
    const r = this.body.rotation();
    return { x: r.x, y: r.y, z: r.z, w: r.w };
  }

  /** World position of a body-frame point. */
  toWorld(v: V3): V3 {
    return add(qRotate(this.rotation(), v), this.body.translation());
  }

  /* ------------------------------------------------------ pose authority */

  /** Drops the machine onto the ground at (x, z), upright on the local slope. */
  placeAt(x: number, z: number, heading: number): void {
    const att = sampleAttitude(x, z, heading, 4.2, 3.0);
    const q = attitudeToQuat(heading, att.pitch, att.roll);
    this.body.setTranslation({ x, y: att.y + this.sag * 0.5 + 0.05, z }, true);
    this.body.setRotation(q, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.tippedOver = false;
    this.speed = 0;
    this.yawRate = 0;
  }

  /**
   * Hands pose authority to someone else (a recorded replay, the scenario
   * frame driver, the mock IoT feed) or takes it back. While kinematic the
   * body follows telemetry, so other machines still collide with it and
   * proximity queries still see its hull.
   */
  setKinematic(on: boolean): void {
    if (on === this.kinematic) return;
    this.kinematic = on;
    this.body.setBodyType(on ? this.R.RigidBodyType.KinematicPositionBased : this.R.RigidBodyType.Dynamic, true);
    if (!on) {
      const t = this.telemetry;
      this.body.setTranslation({ x: t.x, y: t.y + this.sag * 0.5 + 0.05, z: t.z }, true);
      this.body.setRotation(attitudeToQuat(t.heading, t.pitch, t.roll), true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  /** Kinematic mode: move the body to where telemetry says the machine is. */
  followTelemetry(): void {
    const t = this.telemetry;
    this.body.setNextKinematicTranslation({ x: t.x, y: t.y + this.sag * 0.5, z: t.z });
    this.body.setNextKinematicRotation(attitudeToQuat(t.heading, t.pitch, t.roll));
    if (this.kind === "excavator") this.poseArmColliders(this.armKinematics());
  }

  /** Shortest distance from a world point to this machine's hull. */
  distanceTo(p: V3): number {
    let best = Infinity;
    for (const c of this.colliders) {
      if (isTool(c) && c !== this.bucketCollider) continue;
      const proj = c.projectPoint(p, true);
      if (!proj) continue;
      const d = proj.isInside ? 0 : Math.hypot(proj.point.x - p.x, proj.point.y - p.y, proj.point.z - p.z);
      if (d < best) best = d;
    }
    return best;
  }

  dispose(): void {
    this.world.removeVehicleController(this.controller);
    this.world.removeRigidBody(this.body);
  }
}

function isTool(c: RAPIER_NS.Collider): boolean {
  return ((c.collisionGroups() >>> 16) & LAYER.tool) !== 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Rotation that points local -Z along (yaw, pitch). */
function quatFromYawPitch(yaw: number, pitch: number): Quat {
  const cy = Math.cos(yaw / 2);
  const sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2);
  const sp = Math.sin(pitch / 2);
  // q = Ry(yaw) * Rx(pitch)
  return { w: cy * cp, x: cy * sp, y: sy * cp, z: -sy * sp };
}
