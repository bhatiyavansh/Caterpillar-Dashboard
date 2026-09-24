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
 */

import {
  MOUNDS,
  PADS,
  PIT,
  POND,
  ROADS,
  ROAD_SHOULDER,
  SITE_BOUNDS,
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
