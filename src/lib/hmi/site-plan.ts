/**
 * Plan-frame positions as the HMI map draws them.
 *
 * `Machine.position` is the centred plan frame (`siteToPlan` in
 * `web/lib/stream/geo.ts`: 400 x 300 m scaled by 0.55, +z north). The HMI map is
 * a 0-100 SVG box whose site boundary sits at x 4-96, y 6-94, with north up.
 */

import { PLAN, SITE } from "@web/lib/stream/geo";

const HALF_W = (SITE.width * PLAN.scale) / 2;
const HALF_H = (SITE.height * PLAN.scale) / 2;

/** Plan position -> percentage inside the map's site boundary. */
export function planToMapPct(p: { x: number; z: number }): { left: number; top: number } {
  const fx = (p.x + HALF_W) / (2 * HALF_W);
  const fz = (p.z + HALF_H) / (2 * HALF_H);
  return {
    left: 4 + Math.min(Math.max(fx, 0), 1) * 92,
    // North (+z) is up the screen.
    top: 6 + (1 - Math.min(Math.max(fz, 0), 1)) * 88,
  };
}

/** Site origin and scale from the simulator (`simulator/config.py`). */
const ORIGIN_LAT = 13.0827;
const ORIGIN_LON = 80.2707;
const METRES_PER_DEG_LAT = 111_320;

/** Plan position -> real latitude/longitude on the Chennai demo site. */
export function planToLatLon(p: { x: number; z: number }): { lat: number; lon: number } {
  const siteX = p.x / PLAN.scale + PLAN.centerX;
  const siteY = p.z / PLAN.scale + PLAN.centerY;
  const lat = ORIGIN_LAT + siteY / METRES_PER_DEG_LAT;
  const lon = ORIGIN_LON + siteX / (METRES_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return { lat, lon };
}
