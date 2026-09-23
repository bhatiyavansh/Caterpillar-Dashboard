/**
 * Procedural terrain.
 *
 * `terrainHeight` is the authoritative ground function: the mesh is displaced by
 * it, and the vehicle model samples it to derive pitch, roll and therefore the
 * tip-over margin. Mesh and physics can never disagree because there is only one
 * definition.
 */

import { MOUNDS, PADS, PIT, projectRoads, smoothstep, headingVector } from "./site";

/** Cheap deterministic value noise — no dependencies, stable across reloads. */
function noise(x: number, z: number): number {
  return (
    Math.sin(x * 0.0401 + 1.7) * Math.cos(z * 0.0333 - 0.6) * 1.15 +
    Math.sin(x * 0.0172 + z * 0.0231 + 2.3) * 0.85 +
    Math.cos(x * 0.0113 - z * 0.0151 - 1.1) * 0.6 +
    Math.sin(x * 0.087 + z * 0.079) * 0.22
  );
}

/**
 * Ground height at a world position.
 *
 * Layered: rolling base noise, then the excavation pit is subtracted, mounds
 * are added, working pads are graded flat, and finally the road network is
 * blended in on top so the running surface is always drivable.
 */
export function terrainHeight(x: number, z: number): number {
  let h = noise(x, z);

  // Excavation pit: flat floor with smoothly sloped walls.
  const pitDist = Math.hypot((x - PIT.x) / PIT.rx, (z - PIT.z) / PIT.rz);
  if (pitDist < 1.4) {
    const inside = 1 - smoothstep(0.58, 1.32, pitDist);
    h -= PIT.depth * inside;
    // Flatten the floor so the pit reads as an excavated bench, not a dent.
    h = lerpN(h, -PIT.depth, inside * 0.75);
  }

  // Stockpile mounds and spoil heaps.
  for (const m of MOUNDS) {
    const d = Math.hypot(x - m.x, z - m.z) / m.r;
    if (d < 1.7) h += m.h * Math.exp(-d * d * 1.5);
  }

  // Graded working pads.
  for (const p of PADS) {
    const d = Math.hypot((x - p.x) / p.rx, (z - p.z) / p.rz);
    if (d < 1.35) {
      const inside = 1 - smoothstep(0.7, 1.32, d);
      h = lerpN(h, 0, inside);
    }
  }

  // Roads win over everything so ramps and haul routes stay smooth.
  const road = projectRoads(x, z);
  if (road.influence > 0) h = lerpN(h, road.y, road.influence);

  return h;
}

function lerpN(a: number, b: number, t: number): number {
  return a + (b - a) * t;
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
