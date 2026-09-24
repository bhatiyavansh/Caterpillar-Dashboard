/**
 * Procedural terrain.
 *
 * `terrainHeight` is the authoritative ground function: the mesh is displaced by
 * it, and the vehicle model samples it to derive pitch, roll and therefore the
 * tip-over margin. Mesh and physics can never disagree because there is only one
 * definition.
 *
 * The landform is built the way a real site is: natural rolling ground in a
 * valley, then the engineering cut into it — a benched pit, graded pads with
 * batter slopes, a raised waste-dump tip head, trenches with their spoil,
 * stockpiles at their angle of repose, and haul roads cut and filled to grade
 * with safety windrows on their shoulders.
 *
 * The physics world samples the same function: `buildHeightGrid` turns it into
 * the collider, so what a machine drives on is what is drawn. `surfaceAt`
 * classifies the same ground into running surfaces (haul road, windrow gravel,
 * loose spoil, wet clay…) for the tyre and track friction.
 */

import {
  DUMP,
  MOUNDS,
  PADS,
  PIT,
  POND,
  ROADS,
  ROAD_SHOULDER,
  SHALLOW_FACE,
  SIDEHILL,
  SITE_BOUNDS,
  SITE_SIZE,
  TRENCHES,
  headingVector,
  projectRoads,
  segmentProjection,
  smoothstep,
} from "./site";

/* ------------------------------------------------------------------------ */
/*  Noise                                                                   */
/* ------------------------------------------------------------------------ */

/** Integer lattice hash -> [0, 1). Deterministic, so the site never reshuffles. */
function hash2(i: number, j: number): number {
  let n = Math.imul(i, 374761393) + Math.imul(j, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}

/** Smooth value noise in [-1, 1]. */
export function valueNoise(x: number, z: number): number {
  const i = Math.floor(x);
  const j = Math.floor(z);
  const fx = x - i;
  const fz = z - j;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(i, j);
  const b = hash2(i + 1, j);
  const c = hash2(i, j + 1);
  const d = hash2(i + 1, j + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

/** Fractal noise: `octaves` layers, each twice the frequency and half the weight. */
export function fbm(x: number, z: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * freq + o * 17.3, z * freq - o * 9.1) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/* ------------------------------------------------------------------------ */
/*  Landform pieces                                                         */
/* ------------------------------------------------------------------------ */

/** How far (metres) a point lies outside the graded site box. 0 inside. */
export function distanceOutsideSite(x: number, z: number): number {
  const dx = Math.max(SITE_BOUNDS.x0 - x, 0, x - SITE_BOUNDS.x1);
  const dz = Math.max(SITE_BOUNDS.z0 - z, 0, z - SITE_BOUNDS.z1);
  return Math.hypot(dx, dz);
}

/** Undisturbed ground: broad rolling relief with a gentle fall to the south. */
function naturalGround(x: number, z: number): number {
  return (
    fbm(x * 0.0085 + 12, z * 0.0085 - 4, 4) * 5.5 +
    fbm(x * 0.03, z * 0.03, 3) * 1.1 +
    valueNoise(x * 0.17, z * 0.17) * 0.12 -
    z * 0.012
  );
}

/** Valley walls: rise from the site edge into ridged hills; highest behind the pit. */
function valleyWalls(x: number, z: number): number {
  const d = distanceOutsideSite(x, z);
  if (d <= 0) return 0;
  const rise = smoothstep(0, 95, d);
  // Taller range to the north, behind the pit.
  const north = 0.55 + 0.9 * smoothstep(-110, -190, z);
  const ridges = 1 - Math.abs(fbm(x * 0.011 + 40, z * 0.011 - 11, 4));
  const bulk = fbm(x * 0.0055 - 3, z * 0.0055 + 8, 3) * 0.5 + 0.5;
  return rise * north * (14 + bulk * 26 + ridges * ridges * 20);
}

/** Metres outside an axis-aligned rectangle (0 inside). */
function outsideRect(x: number, z: number, x0: number, x1: number, z0: number, z1: number): number {
  const dx = Math.max(x0 - x, 0, x - x1);
  const dz = Math.max(z0 - z, 0, z - z1);
  return Math.hypot(dx, dz);
}

/**
 * Benched pit. Returns the cut below natural ground and how far into the pit
 * the point is (0 at the crest, 1 on the floor).
 */
export function pitCut(x: number, z: number): { cut: number; into: number } {
  const f = PIT.floor;
  const d = outsideRect(x, z, f.x0, f.x1, f.z0, f.z1);
  if (d >= PIT.wallWidth) return { cut: 0, into: 0 };
  const into = 1 - d / PIT.wallWidth;
  // Each bench: a level berm, then a steep face down to the next.
  const s = into * PIT.benches;
  const k = Math.floor(s);
  const frac = s - k;
  const stepped =
    (Math.min(k + smoothstep(0.52, 0.98, frac), PIT.benches) / PIT.benches) * PIT.depth;
  return { cut: stepped, into };
}

function padLevel(h: number, x: number, z: number): number {
  for (const p of PADS) {
    const feather = p.feather ?? 8;
    let d: number;
    if (p.shape === "rect") {
      d = outsideRect(x, z, p.x - p.rx, p.x + p.rx, p.z - p.rz, p.z + p.rz);
    } else {
      d = (Math.hypot((x - p.x) / p.rx, (z - p.z) / p.rz) - 1) * Math.min(p.rx, p.rz);
    }
    if (d >= feather) continue;
    const inside = 1 - smoothstep(0, feather, d);
    h = h + ((p.y ?? 0) - h) * inside;
  }
  return h;
}

function mounds(x: number, z: number): number {
  let add = 0;
  for (const m of MOUNDS) {
    const dist = Math.hypot(x - m.x, z - m.z);
    if (m.cone) {
      if (dist >= m.r) continue;
      const d = dist / m.r;
      // Straight flanks at the angle of repose, a rounded crest and toe, and a
      // little lumpiness where loads were tipped.
      const flank = 1 - d;
      const crest = d < 0.15 ? 1 - ((0.15 - d) * (0.15 - d)) / 0.3 : 1;
      const toe = smoothstep(1, 0.86, d);
      const lumps = 1 + valueNoise(x * 0.45, z * 0.45) * 0.06;
      add += m.h * flank * crest * toe * lumps;
    } else {
      const d = dist / m.r;
      if (d < 1.8) add += m.h * Math.exp(-d * d * 1.4);
    }
  }
  return add;
}

/** Trenches: vertical-sided cuts along the dug length, spoil windrowed alongside. */
function trenches(x: number, z: number): number {
  let add = 0;
  for (const t of TRENCHES) {
    const dugTo = t.x0 + (t.x1 - t.x0) * t.progress;
    if (x < t.x0 - 3 || x > dugTo + 3) continue;
    const along = smoothstep(t.x0 - 1.5, t.x0 + 0.5, x) * smoothstep(dugTo + 1.5, dugTo - 0.5, x);
    const dz = z - t.z;
    const half = t.width / 2;
    const cut = t.depth * (1 - smoothstep(half - 0.35, half + 0.25, Math.abs(dz)));
    // Spoil heaped on the north side, clear of the trench edge.
    const s = (dz + half + 2.8) / 1.35;
    const spoil = 1.25 * Math.exp(-s * s);
    add += (spoil - cut) * along;
  }
  return add;
}

/** Safety windrows along bermed roads, opened wherever another road joins. */
function windrows(x: number, z: number): number {
  let best = 0;
  for (let i = 0; i < ROADS.length; i++) {
    const r = ROADS[i];
    if (!r.berm) continue;
    const { t, dist } = segmentProjection(r, x, z);
    const centre = r.width / 2 + 3.4;
    const across = (dist - centre) / 1.25;
    if (Math.abs(across) > 3) continue;

    // Other roads' running surfaces break the windrow (junctions, crossings).
    let other = 0;
    for (let j = 0; j < ROADS.length; j++) {
      if (j === i) continue;
      const o = ROADS[j];
      const p = segmentProjection(o, x, z);
      const half = o.width / 2;
      if (p.dist < half + ROAD_SHOULDER + 4) {
        other = Math.max(other, 1 - smoothstep(half + 1, half + ROAD_SHOULDER + 4, p.dist));
      }
    }
    const len = Math.hypot(r.x2 - r.x1, r.z2 - r.z1);
    const along = t * len;
    const ends = smoothstep(6, 16, along) * smoothstep(6, 16, len - along);
    const lumps = 0.82 + valueNoise(x * 0.4, z * 0.4) * 0.18;
    const h = 0.95 * Math.exp(-across * across) * (1 - other) * ends * lumps;
    if (h > best) best = h;
  }
  return best;
}

/* ------------------------------------------------------------------------ */
/*  Face C and the sidehill bench                                           */
/* ------------------------------------------------------------------------ */

function lerpN(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

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

/** Grades the face C working area level, then cuts the failed face profile. */
function faceC(h: number, x: number, z: number): number {
  const f = SHALLOW_FACE;
  if (z >= f.crestZ + 16 || z <= f.exitZ - 6 || x <= f.x1 - 8 || x >= f.x2 + 8) return h;
  // The cut, including its approach, is graded flat before carving.
  const grade =
    smoothstep(f.x1 - 8, f.x1 - 3, x) *
    (1 - smoothstep(f.x2 + 3, f.x2 + 8, x)) *
    smoothstep(f.exitZ - 6, f.exitZ, z) *
    (1 - smoothstep(f.crestZ + 10, f.crestZ + 16, z));
  h = lerpN(h, 0, grade);
  // 0..1 across the face's length, feathered over 3 m at each end.
  const along = smoothstep(f.x1 - 3, f.x1, x) * (1 - smoothstep(f.x2, f.x2 + 3, x));
  return lerpN(h, faceFailedHeight(z), along);
}

/** The sidehill's east edge sits on the natural ground there; the west edge is `high` above it. */
const SIDEHILL_BASE = naturalGround(SIDEHILL.x2, (SIDEHILL.z1 + SIDEHILL.z2) / 2);

/** Sidehill bench: a planar cross-slope falling east, feathered at the edges. */
function sidehill(h: number, x: number, z: number): number {
  const sh = SIDEHILL;
  if (x <= sh.x1 - 6 || x >= sh.x2 + 6 || z <= sh.z1 - 6 || z >= sh.z2 + 6) return h;
  const w =
    smoothstep(sh.x1 - 6, sh.x1, x) *
    (1 - smoothstep(sh.x2, sh.x2 + 6, x)) *
    smoothstep(sh.z1 - 6, sh.z1, z) *
    (1 - smoothstep(sh.z2, sh.z2 + 6, z));
  const across = (Math.min(Math.max(x, sh.x1), sh.x2) - sh.x1) / (sh.x2 - sh.x1);
  return lerpN(h, SIDEHILL_BASE + sh.high * (1 - across), w);
}

/* ------------------------------------------------------------------------ */
/*  Ground height                                                           */
/* ------------------------------------------------------------------------ */

export function terrainHeight(x: number, z: number): number {
  let h = naturalGround(x, z) + valleyWalls(x, z);

  // The pit: benches stepping down to a level floor.
  const pit = pitCut(x, z);
  if (pit.into > 0) {
    h = h * (1 - pit.into) - pit.cut + valueNoise(x * 0.3, z * 0.3) * 0.05;
  }

  // Sediment pond.
  const pondDist = Math.hypot((x - POND.x) / POND.rx, (z - POND.z) / POND.rz);
  if (pondDist < 1.35) h -= POND.depth * (1 - smoothstep(0.3, 1.25, pondDist));

  // Graded pads and the raised tip head, each with its batter slope.
  h = padLevel(h, x, z);

  // Face C and the sidehill bench: the physics scenarios' ground.
  h = faceC(h, x, z);
  h = sidehill(h, x, z);

  // Material on top of the graded ground.
  h += mounds(x, z);
  h += trenches(x, z);

  // Roads win so every running surface is at grade; the shoulder becomes the
  // cut or fill batter where the road passes through relief.
  const road = projectRoads(x, z);
  if (road.influence > 0) h = h + (road.y - h) * road.influence;

  // Windrows sit on the shoulders, outside the running surface.
  h += windrows(x, z);

  return h;
}

/* ------------------------------------------------------------------------ */
/*  Running surfaces                                                        */
/* ------------------------------------------------------------------------ */

/**
 * Running-surface classes. Each has a friction coefficient per weather in
 * `surface.ts`.
 */
export type SurfaceClass =
  | "road"
  | "packed"
  | "natural"
  | "gravel_windrow"
  | "loose_spoil"
  | "wet_clay"
  | "rock_face";

/** Metres from the nearest point of a pad (0 inside it). */
function padDistance(p: (typeof PADS)[number], x: number, z: number): number {
  if (p.shape === "rect") return outsideRect(x, z, p.x - p.rx, p.x + p.rx, p.z - p.rz, p.z + p.rz);
  return Math.max(0, (Math.hypot((x - p.x) / p.rx, (z - p.z) / p.rz) - 1) * Math.min(p.rx, p.rz));
}

/**
 * What the ground at (x, z) is made of.
 *
 * `slope` (radians) may be passed when the caller already has it; otherwise
 * it is sampled.
 */
export function surfaceAt(x: number, z: number, slope?: number): SurfaceClass {
  if (windrows(x, z) > 0.35) return "gravel_windrow";

  const road = projectRoads(x, z);
  if (road.influence > 0.55) {
    // The tip ramp is tipped spoil, not a maintained road.
    return ROADS[road.index]?.id === "dump-ramp" ? "loose_spoil" : "road";
  }

  if (Math.hypot((x - POND.x) / POND.rx, (z - POND.z) / POND.rz) < 1.8) return "wet_clay";

  // The tip head and its tipped faces.
  if (Math.hypot(x - DUMP.x, z - DUMP.z) < DUMP.r + 6) return "loose_spoil";

  // Trenches, and the spoil windrowed on their north side.
  for (const t of TRENCHES) {
    const dugTo = t.x0 + (t.x1 - t.x0) * t.progress;
    if (x > t.x0 - 1 && x < dugTo + 1 && z > t.z - t.width / 2 - 4.5 && z < t.z + t.width / 2 + 0.3) {
      return "loose_spoil";
    }
  }

  // Stockpiles and tipped heaps (natural knolls are not cones).
  for (const m of MOUNDS) if (m.cone && Math.hypot(x - m.x, z - m.z) < m.r * 0.9) return "loose_spoil";

  const f = SHALLOW_FACE;
  if (x > f.x1 && x < f.x2) {
    if (z < f.crestZ && z > f.slumpToeZ) return "rock_face";
    if (z <= f.slumpToeZ && z > f.floorEndZ) return "packed";
    if (z >= f.crestZ && z < f.crestZ + 10) return "packed";
  }

  // Steep ground that is not a feature above reads as a rock face.
  if ((slope ?? slopeAngle(x, z)) > 0.42) return "rock_face";

  if (x > SIDEHILL.x1 && x < SIDEHILL.x2 && z > SIDEHILL.z1 && z < SIDEHILL.z2) return "packed";
  if (pitCut(x, z).into > 0) return "packed";
  for (const p of PADS) if (padDistance(p, x, z) < 1) return "packed";
  return "natural";
}

/* ------------------------------------------------------------------------ */
/*  Shared height grid (the physics collider)                               */
/* ------------------------------------------------------------------------ */

export interface HeightGrid {
  /** Vertices per side minus one. */
  segments: number;
  /** World size of the square, metres. */
  size: number;
  /** Metres between samples. */
  cell: number;
  /**
   * Row-major heights: index `iz * (segments + 1) + ix`, world
   * x = ix * cell - size/2, z = iz * cell - size/2 — the vertex order of a
   * `PlaneGeometry` rotated flat.
   */
  heights: Float32Array;
}

/**
 * One metre between samples over the drivable site: fine enough for a 0.9 m
 * windrow and the 1.5 m face C toe.
 */
export const GRID_SEGMENTS = SITE_SIZE;

const gridCache = new Map<number, HeightGrid>();

/** Samples `terrainHeight` on a square grid over the site once, and shares it. */
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
 * split the collider uses: what the machines actually drive on, as opposed to
 * the continuous function it was sampled from.
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
  // Each quad splits along the (ix, iz+1)-(ix+1, iz) diagonal.
  if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
  return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
}

/* ------------------------------------------------------------------------ */
/*  Attitude                                                                */
/* ------------------------------------------------------------------------ */

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
  const e = 2;
  const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return Math.atan(Math.hypot(dx, dz) / (2 * e));
}
