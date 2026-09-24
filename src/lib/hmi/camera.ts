/**
 * What each cab camera would see, from real site positions.
 *
 * The site has no video. It does have the position of every machine and every
 * worker's UWB tag, streamed by the hub. From those, each object's bearing
 * relative to this machine's heading tells us which camera it falls in, and its
 * distance tells us where the box sits in the frame — the same overlay a vision
 * system would draw, computed from the positioning data instead.
 */

import type { Machine as HubMachine, Worker as HubWorker } from "@web/lib/stream";

export type CameraView = "front" | "rear" | "left" | "right" | "360";

export interface Detection {
  label: string;
  distance: number;
  /** Percent of the frame. */
  x: number;
  y: number;
  critical: boolean;
  kind: "person" | "vehicle";
}

/** Anything beyond this is out of camera range. */
const RANGE_M = 28;
/** Inside the simulator's red bubble radius: a hazard. */
const CRITICAL_M = 5;

const MODEL_NAME: Record<string, string> = {
  excavator: "Excavator",
  wheel_loader: "Wheel loader",
  truck: "Haul truck",
  dozer: "Dozer",
  grader: "Grader",
};

/** Degrees in (-180, 180]. */
function wrap(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

function viewFor(relative: number): Exclude<CameraView, "360"> {
  const a = Math.abs(relative);
  if (a <= 45) return "front";
  if (a >= 135) return "rear";
  return relative > 0 ? "right" : "left";
}

interface Target {
  label: string;
  kind: Detection["kind"];
  x: number;
  y: number;
}

/**
 * Detections for every camera, keyed by view. Positions are site metres
 * (x east, y north); heading is degrees clockwise from north.
 */
export function detectionsFrom(
  self: HubMachine,
  machines: HubMachine[],
  workers: HubWorker[],
): Record<CameraView, Detection[]> {
  const out: Record<CameraView, Detection[]> = { front: [], rear: [], left: [], right: [], "360": [] };

  const targets: Target[] = [
    ...machines
      .filter((m) => m.machine_id !== self.machine_id)
      .map((m) => ({
        label: `${MODEL_NAME[m.machine_type] ?? "Machine"} ${m.machine_id}`,
        kind: "vehicle" as const,
        x: m.pos.x,
        y: m.pos.y,
      })),
    ...workers.map((w) => ({ label: `Worker ${w.worker_id}`, kind: "person" as const, x: w.pos.x, y: w.pos.y })),
  ];

  for (const t of targets) {
    const dx = t.x - self.pos.x;
    const dy = t.y - self.pos.y;
    const distance = Math.hypot(dx, dy);
    if (distance > RANGE_M) continue;

    const bearing = (Math.atan2(dx, dy) * 180) / Math.PI;
    const relative = wrap(bearing - self.heading_deg);
    const view = viewFor(relative);
    // Offset from the centre of that camera's field, -45..45 degrees.
    const centre = view === "front" ? 0 : view === "rear" ? 180 : view === "right" ? 90 : -90;
    const across = wrap(relative - centre);
    const near = 1 - distance / RANGE_M;

    const detection = {
      label: t.label,
      distance: Number(distance.toFixed(1)),
      critical: distance <= CRITICAL_M,
      kind: t.kind,
    };

    out[view].push({
      ...detection,
      // Rear camera looks backwards, so its left/right are mirrored.
      x: 50 + ((view === "rear" ? -across : across) / 45) * 38,
      // Closer objects sit lower in the frame, nearer the machine.
      y: 44 + near * 26,
    });

    const rad = (relative * Math.PI) / 180;
    out["360"].push({
      ...detection,
      x: 50 + Math.sin(rad) * (distance / RANGE_M) * 42,
      y: 50 - Math.cos(rad) * (distance / RANGE_M) * 42,
    });
  }

  for (const list of Object.values(out)) list.sort((a, b) => a.distance - b.distance);
  return out;
}
