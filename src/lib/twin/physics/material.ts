/**
 * Loose material: bucket loads, tipped truck loads and dozer-pushed spoil.
 *
 * Material is simulated as parcels — rounded rock-sized rigid bodies of about
 * half a cubic metre and a tonne each — that tumble out of a bed or bucket,
 * land on the terrain collider and pile up by contact and friction. A dozer
 * blade (a `tool` collider) shoves them; a wheel rolling over one is lifted
 * by it.
 *
 * The pool is capped. Rapier puts settled parcels to sleep, where they cost
 * next to nothing; when the pool is full the oldest parcel is recycled.
 * Rendering reads `transforms` (one instanced mesh, one draw call).
 */

import type RAPIER_NS from "@dimforge/rapier3d-compat";
import { terrainHeight } from "../terrain";
import { LAYER, groups } from "./machine";
import type { V3 } from "./math";

type R = typeof RAPIER_NS;

export const PARCEL = {
  /** Half extents, metres. */
  hx: 0.45,
  hy: 0.32,
  hz: 0.42,
  /** kg per parcel (~0.5 m³ of broken rock at ~1 900 kg/m³). */
  mass: 1_000,
};

export const MATERIAL_CAP = 160;

interface Pending {
  at: V3;
  vel: V3;
  spread: number;
}

interface Parcel {
  body: RAPIER_NS.RigidBody;
  collider: RAPIER_NS.Collider;
  born: number;
  scale: number;
  /** Transform has been written at least once since the last reshuffle. */
  written: boolean;
}

export class LooseMaterial {
  private parcels: Parcel[] = [];
  private queue: Pending[] = [];
  private seq = 0;
  private lastWet = -1;
  /** Indices shifted (spawn, recycle, clear): rewrite every transform. */
  private dirty = true;
  /** x, y, z, qx, qy, qz, qw, scale per parcel. */
  readonly transforms = new Float32Array(MATERIAL_CAP * 8);
  count = 0;
  /** Bumped whenever transforms change, so the renderer can skip idle frames. */
  version = 0;

  constructor(
    private readonly R: R,
    private readonly world: RAPIER_NS.World,
  ) {}

  /**
   * Queues `kg` of material to pour from `at`, with an initial velocity.
   * Parcels are released over the next few substeps so a load flows out
   * rather than appearing as one overlapping heap.
   */
  pour(at: V3, kg: number, vel: V3 = { x: 0, y: 0, z: 0 }, spread = 0.6): number {
    const n = Math.max(1, Math.round(kg / PARCEL.mass));
    for (let i = 0; i < n; i++) this.queue.push({ at, vel, spread });
    return n;
  }

  /** Places settled material directly (site set-up, not a pour). */
  scatter(cx: number, cz: number, radius: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 * 2.618;
      const r = radius * Math.sqrt((i + 0.5) / count);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      this.spawn({ x, y: terrainHeight(x, z) + PARCEL.hy + 0.05, z }, { x: 0, y: 0, z: 0 }, true);
    }
  }

  private spawn(at: V3, vel: V3, asleep = false): void {
    const R = this.R;
    if (this.parcels.length >= MATERIAL_CAP) {
      // Recycle the oldest parcel.
      const old = this.parcels.shift();
      if (old) this.world.removeRigidBody(old.body);
    }
    const scale = 0.8 + ((this.seq * 0.618) % 1) * 0.45;
    const yaw = (this.seq * 2.39996) % (Math.PI * 2);
    this.seq++;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(at.x, at.y, at.z)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setLinvel(vel.x, vel.y, vel.z)
        .setLinearDamping(0.15)
        .setAngularDamping(0.6)
        .setCanSleep(true),
    );
    const collider = this.world.createCollider(
      R.ColliderDesc.roundCuboid(PARCEL.hx * scale * 0.85, PARCEL.hy * scale * 0.85, PARCEL.hz * scale * 0.85, 0.06 * scale)
        .setMass(PARCEL.mass * scale ** 3)
        .setFriction(0.75)
        .setRestitution(0.05)
        .setCollisionGroups(groups(LAYER.material, 0xffff)),
      body,
    );
    if (asleep) body.sleep();
    this.parcels.push({ body, collider, born: this.seq, scale, written: false });
    this.dirty = true;
  }

  preStep(wetness: number): void {
    // Release up to two queued parcels per substep, jittered around the pour point.
    for (let k = 0; k < 2 && this.queue.length; k++) {
      const p = this.queue.shift()!;
      const j = (this.seq * 0.7548) % 1;
      const jj = (this.seq * 0.5698) % 1;
      this.spawn(
        { x: p.at.x + (j - 0.5) * p.spread * 2, y: p.at.y + jj * 0.4, z: p.at.z + (jj - 0.5) * p.spread * 2 },
        p.vel,
      );
    }
    // Wet spoil slides: retune friction when the soak level moves.
    if (Math.abs(wetness - this.lastWet) > 0.05) {
      this.lastWet = wetness;
      const mu = 0.75 - wetness * 0.4;
      for (const p of this.parcels) p.collider.setFriction(mu);
    }
  }

  postStep(): void {
    const t = this.transforms;
    const all = this.dirty;
    this.dirty = false;
    let moved = all;
    this.count = this.parcels.length;
    for (let i = 0; i < this.parcels.length; i++) {
      const p = this.parcels[i];
      if (!all && p.written && p.body.isSleeping()) continue;
      p.written = true;
      const tr = p.body.translation();
      const r = p.body.rotation();
      const o = i * 8;
      t[o] = tr.x;
      t[o + 1] = tr.y;
      t[o + 2] = tr.z;
      t[o + 3] = r.x;
      t[o + 4] = r.y;
      t[o + 5] = r.z;
      t[o + 6] = r.w;
      t[o + 7] = p.scale;
      moved = true;
      // Anything that fell off the world is recycled.
      if (tr.y < -60) p.body.setTranslation({ x: tr.x, y: -1000, z: tr.z }, false);
    }
    if (moved) this.version++;
  }

  /** Total tonnes of loose material on the ground. */
  tonnes(): number {
    return this.parcels.reduce((s, p) => s + (PARCEL.mass * p.scale ** 3) / 1000, 0);
  }

  clear(): void {
    for (const p of this.parcels) this.world.removeRigidBody(p.body);
    this.parcels = [];
    this.queue = [];
    this.count = 0;
    this.dirty = true;
    this.version++;
  }
}
