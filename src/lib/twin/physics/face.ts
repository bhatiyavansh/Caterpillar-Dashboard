/**
 * Bench face C: an over-steep face that can fail.
 *
 * The terrain function already describes the face *after* failure (a 19°
 * slump plane — see `faceFailedHeight`). The intact face is the wedge of rock
 * between that plane and the original near-vertical profile
 * (`faceIntactHeight`), cut into blocks. While the face holds, the blocks are
 * fixed bodies: machines drive on them like ground. When a heavy machine
 * loads the crest for long enough — or a scenario says so — they become
 * dynamic and the wedge slides and topples down onto the floor, taking
 * anything standing on it along.
 */

import type RAPIER_NS from "@dimforge/rapier3d-compat";
import { SHALLOW_FACE } from "../site";
import { faceFailedHeight, faceIntactHeight } from "../terrain";
import { LAYER, groups } from "./machine";
import type { PhysicsWorld } from "./world";

type R = typeof RAPIER_NS;

interface Block {
  body: RAPIER_NS.RigidBody;
  home: { x: number; y: number; z: number };
  hx: number;
  hy: number;
  hz: number;
}

/** Broken rock in place, kg/m³. */
const ROCK = 2_300;
/** Mass on the crest that the face will not carry for long, kg. */
const CREST_LIMIT = 15_000;
/** Seconds of loading before the face lets go. */
const HOLD_S = 1.5;

export class FaceC {
  private blocks: Block[] = [];
  released = false;
  /** Seconds the crest has been loaded past its limit. */
  private load = 0;
  /** Set when the face fails; the engine reads and clears it. */
  failedBy: string | null = null;
  readonly transforms: Float32Array;
  /** Box half extents per block, for the renderer (fixed for the block's life). */
  readonly sizes: Float32Array;
  version = 0;

  constructor(
    private readonly R: R,
    private readonly world: RAPIER_NS.World,
  ) {
    const f = SHALLOW_FACE;
    const cols = 12;
    const colW = (f.x2 - f.x1) / cols;
    // The wedge runs from the post-failure crest back to where the intact
    // face meets the slump plane.
    const zBack = f.crestZ;
    const zFront = intersectZ();
    const slices = 5;
    const sliceD = (zBack - zFront) / slices;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < slices; j++) {
        const zHi = zBack - j * sliceD;
        const zLo = zHi - sliceD;
        const zc = (zHi + zLo) / 2;
        const top = faceIntactHeight(zc);
        // Seat on the slump plane at the block's centre. The high edge starts
        // a few decimetres into the ground; fixed bodies ignore that, and on
        // release the contact solver pushes the block out — part of the heave.
        const bottom = faceFailedHeight(zc);
        const hy = (top - bottom) / 2;
        if (hy < 0.12) continue;
        const x = f.x1 + (i + 0.5) * colW;
        const home = { x, y: bottom + hy, z: zc };
        const hx = colW / 2 - 0.02;
        const hz = sliceD / 2 - 0.02;
        const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(home.x, home.y, home.z));
        world.createCollider(
          R.ColliderDesc.cuboid(hx, hy, hz)
            .setMass(ROCK * hx * hy * hz * 8)
            .setFriction(0.55)
            .setCollisionGroups(groups(LAYER.face, 0xffff)),
          body,
        );
        this.blocks.push({ body, home, hx, hy, hz });
      }
    }
    this.transforms = new Float32Array(this.blocks.length * 7);
    this.sizes = new Float32Array(this.blocks.length * 3);
    this.blocks.forEach((b, i) => {
      this.sizes.set([b.hx, b.hy, b.hz], i * 3);
    });
    this.write();
  }

  get count(): number {
    return this.blocks.length;
  }

  /** Watches the crest; lets the face go under sustained load. */
  preStep(world: PhysicsWorld): void {
    if (this.released) {
      this.write();
      return;
    }
    const f = SHALLOW_FACE;
    let heavy: string | null = null;
    for (const m of world.machines.values()) {
      if (m.kinematic || m.build.mass + m.telemetry.payload < CREST_LIMIT) continue;
      // Count the supports standing on the blocks or within 1.5 m of the
      // failure line behind them.
      let on = 0;
      for (const s of m.build.supports) {
        const p = m.toWorld({ x: s.x, y: 0, z: s.z });
        if (p.x > f.x1 && p.x < f.x2 && p.z < f.crestZ + 1.5 && p.z > f.intactCrestZ - 0.5) on++;
      }
      // Half the machine's weight on the crest.
      if (on >= Math.ceil(m.build.supports.length / 2)) heavy = m.id;
    }
    this.load = heavy ? this.load + 1 / 60 : Math.max(0, this.load - 2 / 60);
    if (heavy && this.load >= HOLD_S) this.release(heavy);
  }

  /** The face gives way. */
  release(by = "scenario"): void {
    if (this.released) return;
    this.released = true;
    this.failedBy = by;
    for (const b of this.blocks) {
      b.body.setBodyType(this.R.RigidBodyType.Dynamic, true);
      // The wedge rotates out from its toe: a little outward shove and spin.
      const k = b.body.mass();
      b.body.applyImpulse({ x: 0, y: 0, z: -0.35 * k }, true);
    }
  }

  /** Puts every block back where it was, locked. */
  reset(): void {
    this.released = false;
    this.load = 0;
    this.failedBy = null;
    for (const b of this.blocks) {
      b.body.setBodyType(this.R.RigidBodyType.Fixed, true);
      b.body.setTranslation(b.home, true);
      b.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.write();
  }

  /** Metres the face debris has travelled from home, on average. */
  displacement(): number {
    if (!this.blocks.length) return 0;
    let s = 0;
    for (const b of this.blocks) {
      const p = b.body.translation();
      s += Math.hypot(p.x - b.home.x, p.y - b.home.y, p.z - b.home.z);
    }
    return s / this.blocks.length;
  }

  /** True once every released block has come to rest. */
  settled(): boolean {
    return this.blocks.every((b) => b.body.isSleeping() || Math.hypot(...Object.values(b.body.linvel())) < 0.05);
  }

  private write(): void {
    const t = this.transforms;
    this.blocks.forEach((b, i) => {
      const p = b.body.translation();
      const r = b.body.rotation();
      t.set([p.x, p.y, p.z, r.x, r.y, r.z, r.w], i * 7);
    });
    this.version++;
  }
}

/** z where the intact face profile drops below the slump plane. */
function intersectZ(): number {
  const f = SHALLOW_FACE;
  let lo = f.slumpToeZ;
  let hi = f.intactCrestZ;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (faceIntactHeight(mid) > faceFailedHeight(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}
