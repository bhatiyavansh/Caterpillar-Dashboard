/**
 * Procedural terrain.
 *
 * `terrainHeight` is the authoritative ground function: the render mesh is
 * displaced by it, the physics heightfield is sampled from it, and every
 * scene prop sits on it. Mesh and physics can never disagree because there is
 * only one definition — and `buildHeightGrid` makes sure they don't even
 * sample it separately: the mesh and the collider share one grid.
 *
 * `surfaceAt` classifies the same ground into running surfaces (haul road,
 * windrow gravel, loose spoil, wet clay…). The terrain colours and the physics
 * friction coefficients both come from it, so what looks slippery is.
 */

import {
  BERMS,
  DUMP,
  MOUNDS,
  PADS,
  PERIMETER,
  PIT,
  PIT_BENCHES,
  POND,
  ROADS,
  SHALLOW_FACE,
  SIDEHILL,
  SITE_SIZE,
  TRENCHES,
  WINDROWS,
  projectRoads,
  segmentDistance,
  smoothstep,
  headingVector,
} from "./site";

/** Cheap deterministic value noise — no dependencies, stable across reloads. */
function noise(x: number, z: number): number {
  return (
    Math.sin(x * 0.0401 + 1.7) * Math.cos(z * 0.0333 - 0.6) * 1.15 +
    Math.sin(x * 0.0172 + z * 0.0231 + 2.3) * 0.85 +
    Math.cos(x * 0.0113 - z * 0.0151 - 1.1) * 0.6 +
    Math.sin(x * 0.087 + z * 0.079) * 0.22
  );
}

function lerpN(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Normalised distance from the pit centre: 1 at the rim ellipse. */
function pitDistance(x: number, z: number): number {
  return Math.hypot((x - PIT.x) / PIT.rx, (z - PIT.z) / PIT.rz);
}

/**
 * Terraced pit profile. Between terraces the level eases across a face with
 * smoothstep, so faces are steep but the collider has no vertical cliffs.
 * Returns the level and how strongly it overrides natural ground (0..1).
 */
function pitProfile(d: number): { y: number; w: number } {
  const b = PIT_BENCHES;
  if (d >= b[b.length - 1].to) return { y: 0, w: 1 - smoothstep(b[b.length - 1].to, 1.34, d) };
  for (let i = 0; i < b.length; i++) {
    const lv = b[i];
    if (d <= lv.to) {
      if (d >= lv.from || i === 0) return { y: lv.y, w: 1 };
      // On the face between the previous terrace and this one.
      const prev = b[i - 1];
      return { y: lerpN(prev.y, lv.y, smoothstep(prev.to, lv.from, d)), w: 1 };
    }
  }
  return { y: 0, w: 0 };
}

/* ------------------------------------------------------------ face C */

/** Height of bench face C *before* it fails (the rock blocks' top surface). */
export function faceIntactHeight(z: number): number {
  const f = SHALLOW_FACE;
  if (z >= f.intactCrestZ) return 0;
  if (z <= f.intactToeZ) return f.floorY;
  return lerpN(0, f.floorY, (f.intactCrestZ - z) / (f.intactCrestZ - f.intactToeZ));
}

/** Height of bench face C *after* it fails: the slump plane, then the floor. */
export function faceFailedHeight(z: number): number {
  const f = SHALLOW_FACE;
  if (z >= f.crestZ) return 0;
  const slump = lerpN(0, f.floorY, (f.crestZ - z) / (f.crestZ - f.slumpToeZ));
  const floor = z < f.floorEndZ ? lerpN(f.floorY, 0, smoothstep(f.floorEndZ, f.exitZ, z)) : f.floorY;
  return Math.min(Math.max(slump, f.floorY), Math.max(faceIntactHeight(z), floor));
}

/** 0..1 across the face's length, feathered over 3 m at each end. */
function faceSpan(x: number): number {
  const f = SHALLOW_FACE;
  return smoothstep(f.x1 - 3, f.x1, x) * (1 - smoothstep(f.x2, f.x2 + 3, x));
}

/* ----------------------------------------------------- line features */

interface Line {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  width: number;
  h: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Line features with their bounding boxes, so most samples skip them outright. */
function boxed(f: { x1: number; z1: number; x2: number; z2: number; width: number; h: number }, reach = f.width): Line {
  return {
    ...f,
    minX: Math.min(f.x1, f.x2) - reach,
    maxX: Math.max(f.x1, f.x2) + reach,
    minZ: Math.min(f.z1, f.z2) - reach,
    maxZ: Math.max(f.z1, f.z2) + reach,
  };
}

function inBox(l: Line, x: number, z: number): boolean {
  return x >= l.minX && x <= l.maxX && z >= l.minZ && z <= l.maxZ;
}

function spoilLine(t: (typeof TRENCHES)[number]) {
  const dx = t.x2 - t.x1;
  const dz = t.z2 - t.z1;
  const len = Math.hypot(dx, dz) || 1;
  // Perpendicular to the trench, on the side `spoilOffset` points to.
  const nx = (-dz / len) * t.spoilOffset;
  const nz = (dx / len) * t.spoilOffset;
  return { x1: t.x1 + nx, z1: t.z1 + nz, x2: t.x2 + nx, z2: t.z2 + nz, width: 3.2, h: 1.1 };
}

const RIDGES: Line[] = [...WINDROWS, ...BERMS].map((f) => boxed(f));
const TRENCH_LINES: Line[] = TRENCHES.map((t) => boxed(t, t.width));
const SPOIL_LINES: Line[] = TRENCHES.map((t) => boxed(spoilLine(t)));
const RAMP_DUMP = boxed({ ...(ROADS.find((r) => r.id === "ramp-dump") ?? ROADS[0]), h: 0 }, 13);

/** Rounded ridge profile across a line feature: 1 on the crest, 0 at the edge. */
function ridge(d: number, width: number): number {
  const half = width / 2;
  if (d >= half) return 0;
  const u = d / half;
  return Math.cos(u * Math.PI * 0.5) ** 2;
}

/**
 * Ground height at a world position.
 *
 * Layered: rolling base noise and the perimeter valley walls; the benched pit
 * and face C are cut; mounds and the waste dump are raised; pads and the pond
 * are graded; the road network is blended in so running surfaces are always
 * drivable; and finally the linear features — windrows, ramp berms, trenches
 * and their spoil — are laid on top.
 */
export function terrainHeight(x: number, z: number): number {
  let h = noise(x, z);

  // Valley walls beyond the fence line.
  const edge = Math.max(Math.abs(x), Math.abs(z));
  if (edge > PERIMETER.wallStart) {
    h += smoothstep(PERIMETER.wallStart, SITE_SIZE / 2, edge) * PERIMETER.wallHeight;
  }

  // Benched excavation pit.
  const pd = pitDistance(x, z);
  if (pd < 1.34) {
    const p = pitProfile(pd);
    h = lerpN(h, p.y + (pd < 0.62 ? noise(x * 3, z * 3) * 0.08 : 0), p.w);
  }

  // Face C: grade the working area level, then cut the failed face profile.
  const f = SHALLOW_FACE;
  if (z < f.crestZ + 16 && z > f.exitZ - 6 && x > f.x1 - 8 && x < f.x2 + 8) {
    const along = faceSpan(x);
    // The cut, including its approach, is graded flat before carving.
    const grade =
      smoothstep(f.x1 - 8, f.x1 - 3, x) *
      (1 - smoothstep(f.x2 + 3, f.x2 + 8, x)) *
      smoothstep(f.exitZ - 6, f.exitZ, z) *
      (1 - smoothstep(f.crestZ + 10, f.crestZ + 16, z));
    h = lerpN(h, 0, grade);
    h = lerpN(h, faceFailedHeight(z), along);
  }

  // Sidehill bench: a planar cross-slope falling east, feathered at the edges.
  const sh = SIDEHILL;
  if (x > sh.x1 - 6 && x < sh.x2 + 6 && z > sh.z1 - 6 && z < sh.z2 + 6) {
    const w =
      smoothstep(sh.x1 - 6, sh.x1, x) *
      (1 - smoothstep(sh.x2, sh.x2 + 6, x)) *
      smoothstep(sh.z1 - 6, sh.z1, z) *
      (1 - smoothstep(sh.z2, sh.z2 + 6, z));
    const plane = sh.high * (1 - (Math.min(Math.max(x, sh.x1), sh.x2) - sh.x1) / (sh.x2 - sh.x1));
    h = lerpN(h, plane, w);
  }

  // Stockpile mounds and spoil heaps.
  for (const m of MOUNDS) {
    const d = Math.hypot(x - m.x, z - m.z) / m.r;
    if (d < 1.7) h += m.h * Math.exp(-d * d * 1.5);
  }

  // Waste dump: a flat tip head on 38-degree tipped sides.
  const dd = Math.hypot((x - DUMP.x) / DUMP.rx, (z - DUMP.z) / DUMP.rz);
  if (dd < 1.4) {
    const top = DUMP.h + noise(x * 2.5, z * 2.5) * 0.05;
    h = lerpN(h, top, 1 - smoothstep(1.0, 1.35, dd));
  }

  // Graded working pads.
  for (const p of PADS) {
    const d = Math.hypot((x - p.x) / p.rx, (z - p.z) / p.rz);
    if (d < 1.35) h = lerpN(h, 0, 1 - smoothstep(0.7, 1.32, d));
  }

  // Settling pond basin.
  const dp = Math.hypot(x - POND.x, z - POND.z);
  if (dp < POND.r * 1.6) {
    h = lerpN(h, -0.2, 1 - smoothstep(POND.r, POND.r * 1.6, dp));
    h -= POND.depth * (1 - smoothstep(POND.r * 0.35, POND.r, dp));
  }

  // Roads win over everything so ramps and haul routes stay smooth.
  const road = projectRoads(x, z);
  if (road.influence > 0) h = lerpN(h, road.y, road.influence);

  // Dump crest berm, open where the ramp arrives.
  if (dd > 0.82 && dd < 1.02) {
    const ramp = rampDumpInfluence(x, z);
    h += 1.2 * ridge(Math.abs(dd - 0.92) * DUMP.rz, 2.4) * (1 - ramp);
  }

  // Windrows and ramp berms sit on the finished surface.
  for (const w of RIDGES) {
    if (!inBox(w, x, z)) continue;
    const { d } = segmentDistance(x, z, w);
    if (d < w.width) h += w.h * ridge(d, w.width);
  }

  // Trenches, with the spoil thrown up on one side.
  for (let i = 0; i < TRENCH_LINES.length; i++) {
    const t = TRENCH_LINES[i];
    if (inBox(t, x, z)) {
      const { d, t: along } = segmentDistance(x, z, t);
      if (d < t.width / 2 + 0.6 && along > 0 && along < 1) {
        h -= t.h * (1 - smoothstep(t.width / 2 - 0.4, t.width / 2 + 0.6, d));
      }
    }
    const sp = SPOIL_LINES[i];
    if (inBox(sp, x, z)) {
      const s = segmentDistance(x, z, sp);
      if (s.d < sp.width) h += sp.h * ridge(s.d, sp.width);
    }
  }

  return h;
}

/** Influence of the dump ramp at (x, z), 0..1 — same falloff as projectRoads. */
function rampDumpInfluence(x: number, z: number): number {
  if (!inBox(RAMP_DUMP, x, z)) return 0;
  const { d } = segmentDistance(x, z, RAMP_DUMP);
  return 1 - smoothstep(RAMP_DUMP.width / 2, RAMP_DUMP.width / 2 + 7, d);
}

/* ------------------------------------------------------------- surfaces */

/**
 * Running-surface classes. Each has a friction coefficient per weather in
 * `surface.ts`; the terrain colours use the same classes.
 */
export type SurfaceClass =
  | "road"
  | "packed"
  | "natural"
  | "gravel_windrow"
  | "loose_spoil"
  | "wet_clay"
  | "rock_face";

/**
 * What the ground at (x, z) is made of.
 *
 * `slope` (radians) may be passed when the caller already has it — the mesh
 * builder derives it from the shared grid — otherwise it is sampled.
 */
export function surfaceAt(x: number, z: number, slope?: number): SurfaceClass {
  const road = projectRoads(x, z);

  for (const w of RIDGES) if (inBox(w, x, z) && segmentDistance(x, z, w).d < w.width / 2) return "gravel_windrow";

  // The dump ramp is a tipped-spoil ramp, not a maintained road.
  if (rampDumpInfluence(x, z) > 0.5) return "loose_spoil";
  if (road.influence > 0.55) return "road";

  const dp = Math.hypot(x - POND.x, z - POND.z);
  if (dp < POND.clayR) return "wet_clay";

  const dd = Math.hypot((x - DUMP.x) / DUMP.rx, (z - DUMP.z) / DUMP.rz);
  if (dd < 1.35) return "loose_spoil";

  for (let i = 0; i < TRENCH_LINES.length; i++) {
    const sp = SPOIL_LINES[i];
    if (inBox(sp, x, z) && segmentDistance(x, z, sp).d < 1.6) return "loose_spoil";
    const t = TRENCH_LINES[i];
    if (inBox(t, x, z)) {
      const tr = segmentDistance(x, z, t);
      if (tr.d < t.width / 2 + 0.3 && tr.t > 0 && tr.t < 1) return "loose_spoil";
    }
  }

  for (const m of MOUNDS) if (Math.hypot(x - m.x, z - m.z) < m.r * 0.9) return "loose_spoil";

  const f = SHALLOW_FACE;
  if (x > f.x1 && x < f.x2) {
    if (z < f.crestZ && z > f.slumpToeZ) return "rock_face";
    if (z <= f.slumpToeZ && z > f.floorEndZ) return "packed";
    if (z >= f.crestZ && z < f.crestZ + 10) return "packed";
  }

  // Steep ground that is not a feature above reads as a rock face.
  if ((slope ?? slopeAngle(x, z)) > 0.42) return "rock_face";

  if (x > SIDEHILL.x1 && x < SIDEHILL.x2 && z > SIDEHILL.z1 && z < SIDEHILL.z2) return "packed";
  if (pitDistance(x, z) < 1.04) return "packed";
  for (const p of PADS) {
    if (Math.hypot((x - p.x) / p.rx, (z - p.z) / p.rz) < 0.9) return "packed";
  }
  return "natural";
}

/* ---------------------------------------------------------- shared grid */

export interface HeightGrid {
  /** Vertices per side minus one. */
  segments: number;
  /** World size of the square, metres. */
  size: number;
  /** Metres between samples. */
  cell: number;
  /**
   * Row-major heights: index `iz * (segments + 1) + ix`, world
   * x = ix * cell - size/2, z = iz * cell - size/2. This is exactly the
   * vertex order of a `PlaneGeometry` rotated flat.
   */
  heights: Float32Array;
}

/**
 * One metre between samples: fine enough for a 0.9 m windrow and a 1.5 m
 * bench face, and the same grid feeds the mesh and the collider.
 */
export const GRID_SEGMENTS = SITE_SIZE;

const gridCache = new Map<number, HeightGrid>();

/** Samples `terrainHeight` on a square grid once, and shares it. */
export function buildHeightGrid(segments = GRID_SEGMENTS): HeightGrid {
  const hit = gridCache.get(segments);
  if (hit) return hit;
  const size = SITE_SIZE;
  const cell = size / segments;
  const n = segments + 1;
  const heights = new Float32Array(n * n);
  const half = size / 2;
  for (let iz = 0; iz < n; iz++) {
    const z = iz * cell - half;
    for (let ix = 0; ix < n; ix++) {
      heights[iz * n + ix] = terrainHeight(ix * cell - half, z);
    }
  }
  const grid = { segments, size, cell, heights };
  gridCache.set(segments, grid);
  return grid;
}

/**
 * Ground height from the shared grid, interpolated over the same triangle
 * split the render mesh uses. This is what the collider and the mesh actually
 * are, as opposed to the continuous function they were sampled from.
 */
export function gridHeight(grid: HeightGrid, x: number, z: number): number {
  const n = grid.segments + 1;
  const fx = (x + grid.size / 2) / grid.cell;
  const fz = (z + grid.size / 2) / grid.cell;
  const ix = Math.min(Math.max(Math.floor(fx), 0), grid.segments - 1);
  const iz = Math.min(Math.max(Math.floor(fz), 0), grid.segments - 1);
  const u = Math.min(Math.max(fx - ix, 0), 1);
  const v = Math.min(Math.max(fz - iz, 0), 1);
  const h00 = grid.heights[iz * n + ix];
  const h10 = grid.heights[iz * n + ix + 1];
  const h01 = grid.heights[(iz + 1) * n + ix];
  const h11 = grid.heights[(iz + 1) * n + ix + 1];
  // PlaneGeometry splits each quad along the (ix, iz+1)-(ix+1, iz) diagonal.
  if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
  return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
}

/* --------------------------------------------------------------- attitude */

export interface Attitude {
  /** Radians. Positive = nose up. */
  pitch: number;
  /** Radians. Positive = leaning right (right side lower). */
  roll: number;
  /** Ground height under the machine centre. */
  y: number;
}

/**
 * Derives machine attitude by sampling the terrain under a four-corner
 * footprint — the same thing a real IMU would report on this slope.
 *
 * With the physics world running, attitude comes from the rigid body instead;
 * this remains the path for live telemetry and recorded replays.
 */
export function sampleAttitude(
  x: number,
  z: number,
  heading: number,
  wheelbase = 4.2,
  trackWidth = 3.0,
): Attitude {
  const f = headingVector(heading);
  // Right-hand vector: forward rotated -90 degrees about Y.
  const r = { x: -f.z, z: f.x };

  const hf = wheelbase / 2;
  const ht = trackWidth / 2;

  const front = terrainHeight(x + f.x * hf, z + f.z * hf);
  const back = terrainHeight(x - f.x * hf, z - f.z * hf);
  const right = terrainHeight(x + r.x * ht, z + r.z * ht);
  const left = terrainHeight(x - r.x * ht, z - r.z * ht);

  return {
    pitch: Math.atan2(front - back, wheelbase),
    roll: Math.atan2(left - right, trackWidth),
    // Average the footprint so the machine rides the corners, not a single point.
    y: (front + back + right + left) / 4,
  };
}

/** Steepness in radians, regardless of direction. Used for risk scoring. */
export function slopeAngle(x: number, z: number): number {
  const e = 1;
  const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return Math.atan(Math.hypot(dx, dz) / (2 * e));
}
