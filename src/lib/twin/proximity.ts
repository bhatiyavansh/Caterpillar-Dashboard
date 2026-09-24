/**
 * Simulated proximity-sensor ring around a machine.
 *
 * A real installation would fuse radar and camera returns. With the physics
 * world running, the distance is from the worker to the machine's actual hull
 * (broadphase + narrowphase in Rapier — see `PhysicsWorld.proximity`); for
 * live telemetry and replays, where there is no physics, it is the
 * ground-plane distance to the machine centre. Either way the downstream
 * signal is the same: a level, a nearest distance, and who triggered it.
 */

import type {
  MachineTelemetry,
  ProximityLevel,
  ProximityReading,
  ProximityResult,
  SiteWorker,
} from "@/types/twin";

/** Metres. Outside `warning` is clear ground. */
export const PROXIMITY = {
  warning: 10,
  critical: 6,
  /** Below this the alert escalates its wording to "stop machine". */
  imminent: 3,
} as const;

export function proximityLevel(distance: number): ProximityLevel {
  if (distance > PROXIMITY.warning) return "safe";
  if (distance > PROXIMITY.critical) return "warning";
  return "critical";
}

export function distanceToWorker(t: MachineTelemetry, w: SiteWorker): number {
  return Math.hypot(w.x - t.x, w.z - t.z);
}

export function evaluateProximity(
  t: MachineTelemetry,
  workers: SiteWorker[],
): ProximityResult {
  return proximityFromDistances(workers.map((w) => ({ workerId: w.id, distance: distanceToWorker(t, w) })));
}

/** Builds the result from per-worker distances, however they were measured. */
export function proximityFromDistances(
  distances: { workerId: string; distance: number }[],
): ProximityResult {
  const readings: ProximityReading[] = [];
  let nearest = Infinity;
  let nearestWorkerId: string | null = null;

  for (const { workerId, distance } of distances) {
    if (distance < nearest) {
      nearest = distance;
      nearestWorkerId = workerId;
    }
    // Only surface workers that are actually inside the sensor ring.
    if (distance <= PROXIMITY.warning) {
      readings.push({ workerId, distance, level: proximityLevel(distance) });
    }
  }

  readings.sort((a, b) => a.distance - b.distance);

  return {
    level: proximityLevel(nearest),
    nearest,
    nearestWorkerId,
    readings,
  };
}

/** The visual radius of the safety bubble — always the outer sensor ring. */
export const BUBBLE_RADIUS = PROXIMITY.warning;

export const LEVEL_COLORS: Record<ProximityLevel, string> = {
  safe: "#3ddc84",
  warning: "#ffb020",
  critical: "#ff3b30",
};

export function levelRank(level: ProximityLevel): number {
  return level === "critical" ? 2 : level === "warning" ? 1 : 0;
}

export function worstLevel(a: ProximityLevel, b: ProximityLevel): ProximityLevel {
  return levelRank(a) >= levelRank(b) ? a : b;
}
