/**
 * Forward-projected collision screening.
 *
 * Dead-reckons every machine five seconds ahead along its current heading and
 * looks for overlapping safety footprints. Deliberately simple and explainable —
 * it is a visual demo, not a certified conflict-detection system.
 */

import type { CollisionRisk, MachineTelemetry, PredictedPath } from "@/types/twin";
import { headingVector } from "./site";
import { terrainHeight } from "./terrain";

/** Seconds of look-ahead. */
export const HORIZON = 5;
/** Metres. Two machines closer than this at the same moment is a conflict. */
export const CONFLICT_RADIUS = 9;

/**
 * Metres the pair must actually close by before it counts.
 *
 * Without this, a machine parked beside a haul road raised a permanent
 * "collision risk" every time another machine drove past at normal separation,
 * which pinned the site safety indicator to CRITICAL and made it meaningless.
 * A real conflict means the gap is shrinking.
 */
export const MIN_CLOSING = 1.5;
/** Below this speed a machine is parked and cannot cause a conflict. */
export const MOVING_THRESHOLD = 0.35;

/** Ground-hugging polyline from the machine to where it will be in `seconds`. */
export function predictPath(
  t: MachineTelemetry,
  seconds = HORIZON,
  samples = 10,
): PredictedPath {
  const f = headingVector(t.heading);
  const points: [number, number, number][] = [];

  for (let i = 0; i <= samples; i++) {
    const dt = (i / samples) * seconds;
    const d = t.speed * dt;
    const x = t.x + f.x * d;
    const z = t.z + f.z * d;
    // Ride the terrain so the path does not sink into hills.
    points.push([x, terrainHeight(x, z) + 0.35, z]);
  }

  return {
    machineId: t.machineId,
    from: points[0],
    to: points[points.length - 1],
    points,
    speed: t.speed,
  };
}

function positionAt(t: MachineTelemetry, seconds: number): { x: number; z: number } {
  const f = headingVector(t.heading);
  const d = t.speed * seconds;
  return { x: t.x + f.x * d, z: t.z + f.z * d };
}

/**
 * Finds pairs whose predicted footprints overlap inside the horizon.
 * Returns the closest approach for each conflicting pair.
 */
export function detectCollisionRisks(
  machines: MachineTelemetry[],
  horizon = HORIZON,
): CollisionRisk[] {
  const risks: CollisionRisk[] = [];
  const steps = 10;

  for (let i = 0; i < machines.length; i++) {
    for (let j = i + 1; j < machines.length; j++) {
      const a = machines[i];
      const b = machines[j];

      // At least one machine has to actually be going somewhere.
      if (
        Math.abs(a.speed) < MOVING_THRESHOLD &&
        Math.abs(b.speed) < MOVING_THRESHOLD
      ) {
        continue;
      }

      const currentSeparation = Math.hypot(a.x - b.x, a.z - b.z);

      let minSeparation = Infinity;
      let minTime = 0;
      let point: [number, number, number] = [0, 0, 0];

      for (let s = 0; s <= steps; s++) {
        const time = (s / steps) * horizon;
        const pa = positionAt(a, time);
        const pb = positionAt(b, time);
        const separation = Math.hypot(pa.x - pb.x, pa.z - pb.z);

        if (separation < minSeparation) {
          minSeparation = separation;
          minTime = time;
          const mx = (pa.x + pb.x) / 2;
          const mz = (pa.z + pb.z) / 2;
          point = [mx, terrainHeight(mx, mz) + 1.2, mz];
        }
      }

      // Both conditions matter: they end up close, AND they are converging.
      const closing = currentSeparation - minSeparation;
      if (minSeparation < CONFLICT_RADIUS && closing >= MIN_CLOSING) {
        risks.push({
          id: `${a.machineId}-${b.machineId}`,
          a: a.machineId,
          b: b.machineId,
          separation: minSeparation,
          timeToClosest: minTime,
          point,
        });
      }
    }
  }

  // Most urgent first.
  risks.sort((x, y) => x.separation - y.separation);
  return risks;
}
