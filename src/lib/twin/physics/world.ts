/**
 * The twin's physics world.
 *
 * Rapier (`@dimforge/rapier3d-compat`, WASM) steps rigid bodies for the local
 * fleet at a fixed 60 Hz. It is created asynchronously — the WASM module has
 * to load — and the simulation engine keeps using its kinematic model until
 * the world is ready, so nothing ever blocks on it.
 *
 * Ground: one static triangle mesh built from `buildHeightGrid()`, the same
 * array the terrain mesh is displaced by, split into the same triangles — the
 * collider and the visible ground are identical surfaces. (Rapier's cheaper
 * heightfield shape was tried first and rejected: its ray casts miss for
 * vertical rays, which is exactly what a wheel on level ground casts. See
 * PHYSICS.md.)
 *
 * Structures: one fixed cuboid per `SITE_COLLIDERS` entry (long runs split
 * into ground-following pieces). Loose material and bench face C live in
 * `material.ts` and `face.ts`.
 *
 * The live WebSocket path never touches any of this: when a backend drives
 * the fleet, the engine simply doesn't step the world.
 */

import type RAPIER_NS from "@dimforge/rapier3d-compat";
import type { MachineKind, MachineTelemetry, ProximityReading, SiteWorker } from "@/types/twin";
import { SITE_COLLIDERS, type StaticCollider } from "../site";
import { buildHeightGrid, terrainHeight } from "../terrain";
import { frictionFor } from "../surface";
import { LAYER, PhysicsMachine, groups } from "./machine";
import { LooseMaterial } from "./material";
import { FaceC } from "./face";
import { qAxis, qMul } from "./math";

type R = typeof RAPIER_NS;

export const PHYSICS_DT = 1 / 60;
const MAX_SUBSTEPS = 3;

let rapierPromise: Promise<R> | null = null;

/** Loads and initialises the Rapier WASM module once per page. */
export function loadRapier(): Promise<R> {
  if (!rapierPromise) {
    rapierPromise = import("@dimforge/rapier3d-compat").then(async (mod) => {
      const R = (mod.default ?? mod) as R;
      await R.init();
      return R;
    });
  }
  return rapierPromise;
}

export interface ContactEvent {
  a: string;
  b: string;
  /** Component ids of the colliders that touched. */
  partA: string;
  partB: string;
  /** Peak contact force, newtons. */
  force: number;
}

export interface PhysicsStats {
  /** Wall-clock ms of the last physics update (all substeps). */
  lastStepMs: number;
  /** Exponential moving average of the above. */
  avgStepMs: number;
  /** 95th percentile over the last ~2 s. */
  p95StepMs: number;
  bodies: number;
  awake: number;
}

export class PhysicsWorld {
  readonly world: RAPIER_NS.World;
  readonly machines = new Map<string, PhysicsMachine>();
  readonly material: LooseMaterial;
  readonly face: FaceC;
  private readonly events: RAPIER_NS.EventQueue;
  private readonly terrain: RAPIER_NS.Collider;
  private accumulator = 0;
  private samples: number[] = [];
  /** Machine pairs currently touching, "A|B" sorted. */
  readonly touching = new Map<string, ContactEvent>();
  /** Contacts that started since the engine last read them. */
  private fresh: ContactEvent[] = [];
  /** Handle -> machine id, for decoding contact events. */
  private owner = new Map<number, string>();
  wetness = 0;
  stats: PhysicsStats = { lastStepMs: 0, avgStepMs: 0, p95StepMs: 0, bodies: 0, awake: 0 };

  static async create(): Promise<PhysicsWorld> {
    const R = await loadRapier();
    return new PhysicsWorld(R);
  }

  constructor(readonly R: R) {
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = PHYSICS_DT;
    this.events = new R.EventQueue(true);

    this.terrain = this.buildTerrain();
    this.buildStructures();
    this.material = new LooseMaterial(R, this.world);
    this.face = new FaceC(R, this.world);
  }

  /* ------------------------------------------------------------ ground */

  private buildTerrain(): RAPIER_NS.Collider {
    const R = this.R;
    const grid = buildHeightGrid();
    const n = grid.segments + 1;
    const half = grid.size / 2;
    // Vertices: exactly the shared grid, in the render mesh's vertex order.
    const vertices = new Float32Array(n * n * 3);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        vertices[i * 3] = ix * grid.cell - half;
        vertices[i * 3 + 1] = grid.heights[i];
        vertices[i * 3 + 2] = iz * grid.cell - half;
      }
    }
    // Triangles: the same diagonal split PlaneGeometry uses, wound upward.
    const indices = new Uint32Array(grid.segments * grid.segments * 6);
    let k = 0;
    for (let iz = 0; iz < grid.segments; iz++) {
      for (let ix = 0; ix < grid.segments; ix++) {
        const a = iz * n + ix;
        const b = (iz + 1) * n + ix;
        const c = (iz + 1) * n + ix + 1;
        const d = iz * n + ix + 1;
        indices[k++] = a;
        indices[k++] = b;
        indices[k++] = d;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = d;
      }
    }
    // A trimesh rather than Rapier's heightfield shape: in rapier3d-compat
    // 0.12, rays within ~1e-4 of vertical miss a heightfield entirely, and
    // the wheel rays point straight down on level ground. Same triangles,
    // same grid; see PHYSICS.md for the measurements.
    const desc = R.ColliderDesc.trimesh(vertices, indices)
      .setFriction(0.8)
      .setCollisionGroups(groups(LAYER.terrain, 0xffff));
    return this.world.createCollider(desc);
  }

  private buildStructures(): void {
    const R = this.R;
    const add = (c: StaticCollider, x: number, z: number, hx: number, hz: number, pitch = 0, y?: number) => {
      const ground = y ?? terrainHeight(x, z);
      const rot = qMul(qAxis("y", c.rot), qAxis("x", pitch));
      const desc = R.ColliderDesc.cuboid(hx, c.hy, hz)
        .setTranslation(x, ground + (c.lift ?? c.hy), z)
        .setRotation(rot)
        .setFriction(0.6)
        .setCollisionGroups(groups(LAYER.structure, 0xffff));
      this.world.createCollider(desc);
    };
    for (const c of SITE_COLLIDERS) {
      if (!c.follow) {
        add(c, c.x, c.z, c.hx, c.hz);
        continue;
      }
      // Long runs: 3 m pieces, each seated and pitched on the ground.
      const alongX = c.hx >= c.hz;
      const len = (alongX ? c.hx : c.hz) * 2;
      const pieces = Math.max(1, Math.ceil(len / 3));
      const piece = len / pieces;
      for (let i = 0; i < pieces; i++) {
        const t = (i + 0.5) * piece - len / 2;
        const x = alongX ? c.x + t : c.x;
        const z = alongX ? c.z : c.z + t;
        if (alongX) {
          add(c, x, z, piece / 2 + 0.05, c.hz);
        } else {
          const y1 = terrainHeight(x, z - piece / 2);
          const y2 = terrainHeight(x, z + piece / 2);
          // Pitch about X so the rail follows the grade along Z.
          add(c, x, z, c.hx, piece / 2 + 0.05, Math.atan2(y1 - y2, piece), (y1 + y2) / 2);
        }
      }
    }
  }

  /* ---------------------------------------------------------- machines */

  addMachine(id: string, kind: MachineKind, telemetry: MachineTelemetry): PhysicsMachine {
    const m = new PhysicsMachine(this.R, this.world, id, kind, telemetry);
    this.machines.set(id, m);
    for (const c of m.colliders) this.owner.set(c.handle, id);
    return m;
  }

  machine(id: string): PhysicsMachine | undefined {
    return this.machines.get(id);
  }

  /** Removes every machine and all loose material, and restores face C. */
  resetSite(): void {
    for (const m of this.machines.values()) {
      for (const c of m.colliders) this.owner.delete(c.handle);
      m.dispose();
    }
    this.machines.clear();
    this.touching.clear();
    this.fresh = [];
    this.material.clear();
    this.face.reset();
  }

  /* -------------------------------------------------------------- step */

  /**
   * Advances the world by `dt` of wall time in fixed substeps. `preStep`
   * runs before each substep so drive forces and the moving centre of mass
   * are re-applied at the physics rate, not the render rate.
   */
  step(dt: number): void {
    const t0 = now();
    this.accumulator = Math.min(this.accumulator + dt, PHYSICS_DT * MAX_SUBSTEPS);
    let steps = 0;
    while (this.accumulator >= PHYSICS_DT - 1e-6 && steps < MAX_SUBSTEPS) {
      this.accumulator -= PHYSICS_DT;
      steps++;
      this.terrain.setFriction(frictionFor("natural", this.wetness));
      for (const m of this.machines.values()) {
        if (m.kinematic) m.followTelemetry();
        else m.preStep(PHYSICS_DT, this.wetness);
      }
      this.material.preStep(this.wetness);
      this.face.preStep(this);
      this.world.step(this.events);
      this.drainEvents();
      for (const m of this.machines.values()) if (!m.kinematic) m.postStep();
      this.material.postStep();
    }
    const ms = now() - t0;
    this.recordTiming(ms);
  }

  private drainEvents(): void {
    this.events.drainCollisionEvents((h1, h2, started) => {
      const a = this.owner.get(h1);
      const b = this.owner.get(h2);
      if (!a || !b || a === b) return;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!started) {
        this.touching.delete(key);
        return;
      }
      const ev: ContactEvent = {
        a: a < b ? a : b,
        b: a < b ? b : a,
        partA: this.partName(a < b ? h1 : h2),
        partB: this.partName(a < b ? h2 : h1),
        force: 0,
      };
      if (!this.touching.has(key)) this.fresh.push(ev);
      this.touching.set(key, ev);
    });
    this.events.drainContactForceEvents((e) => {
      const a = this.owner.get(e.collider1());
      const b = this.owner.get(e.collider2());
      if (!a || !b || a === b) return;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const ev = this.touching.get(key);
      if (ev) ev.force = Math.max(ev.force, e.totalForceMagnitude());
    });
  }

  private partName(handle: number): string {
    for (const m of this.machines.values()) {
      const p = m.partOf.get(handle);
      if (p) return p;
    }
    return "body";
  }

  /** Contacts that began since the last call. */
  takeNewContacts(): ContactEvent[] {
    const out = this.fresh;
    this.fresh = [];
    return out;
  }

  private recordTiming(ms: number): void {
    const s = this.stats;
    s.lastStepMs = ms;
    s.avgStepMs = s.avgStepMs === 0 ? ms : s.avgStepMs * 0.95 + ms * 0.05;
    this.samples.push(ms);
    if (this.samples.length > 120) this.samples.shift();
    const sorted = [...this.samples].sort((a, b) => a - b);
    s.p95StepMs = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? ms;
    let bodies = 0;
    let awake = 0;
    this.world.bodies.forEach((b) => {
      bodies++;
      if (b.isDynamic() && !b.isSleeping()) awake++;
    });
    s.bodies = bodies;
    s.awake = awake;
  }

  /* ----------------------------------------------------------- queries */

  /**
   * Worker proximity through the physics world: the broadphase finds which
   * machine hulls are within `radius` of each worker, the narrowphase gives
   * the exact distance to the hull. Same `ProximityReading` contract as the
   * geometric version in proximity.ts.
   */
  proximity(subjectId: string, workers: SiteWorker[], radius: number): (ProximityReading & { part?: string })[] {
    const m = this.machines.get(subjectId);
    if (!m) return [];
    const R = this.R;
    const ball = new R.Ball(radius);
    const out: (ProximityReading & { part?: string })[] = [];
    for (const w of workers) {
      const p = { x: w.x, y: terrainHeight(w.x, w.z) + 0.9, z: w.z };
      let hit = false;
      this.world.intersectionsWithShape(
        p,
        { x: 0, y: 0, z: 0, w: 1 },
        ball,
        (c) => {
          if (this.owner.get(c.handle) === subjectId) {
            hit = true;
            return false;
          }
          return true;
        },
        undefined,
        groups(0xffff, LAYER.machine | LAYER.tool),
      );
      const d = hit ? m.distanceTo(p) : Infinity;
      out.push({ workerId: w.id, distance: d, level: "safe" });
    }
    return out;
  }

  /**
   * How far ahead (or behind, when reversing) the path is clear of other
   * machines: a shape cast of the machine's own footprint. Infinity if clear.
   */
  clearance(id: string, lookAhead: number): { distance: number; other: string | null } {
    const m = this.machines.get(id);
    if (!m) return { distance: Infinity, other: null };
    const R = this.R;
    const dir = Math.sign(m.speed || 1);
    const q = m.rotation();
    // Cast the machine's footprint, including blade or bucket out front.
    const halfLen = m.kind === "truck" ? 4.6 : m.kind === "loader" ? 4.3 : m.kind === "bulldozer" ? 3.3 : 2.8;
    const origin = m.toWorld({ x: 0, y: 1.4, z: 0 });
    const f = m.toWorld({ x: 0, y: 1.4, z: -dir });
    const vel = { x: (f.x - origin.x) * lookAhead, y: 0, z: (f.z - origin.z) * lookAhead };
    const shape = new R.Cuboid(1.7, 0.9, halfLen);
    const hit = this.world.castShape(
      origin,
      q,
      vel,
      shape,
      1,
      true,
      undefined,
      groups(0xffff, LAYER.machine),
      undefined,
      m.body,
    );
    if (!hit) return { distance: Infinity, other: null };
    return { distance: hit.toi * lookAhead, other: this.owner.get(hit.collider.handle) ?? null };
  }

  /** Which machine owns a collider handle — X-ray picking uses this too. */
  ownerOf(handle: number): string | undefined {
    return this.owner.get(handle);
  }

  dispose(): void {
    for (const m of this.machines.values()) m.dispose();
    this.machines.clear();
    this.world.free();
  }
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
