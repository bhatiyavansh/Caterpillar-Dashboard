/**
 * Site-frame converters. The wire uses Person C's frame: metres, origin at the SW corner of a
 * 400 x 300 m site, +x east, +y north, heading degrees clockwise from north.
 *
 * Constants marked [TEAM TO CONFIRM] are shared with backend/copilot/adapters/twin_mapping.py.
 */

export interface SitePos {
  x: number;
  y: number;
}

export const SITE = { width: 400, height: 300 } as const;

/* ----------------------------------------------------------------- Person D: 2D SitePlan */
/** [TEAM TO CONFIRM: D] Plan frame = centred, uniformly scaled so 400 m fits x in [-110, 110]. */
export const PLAN = { centerX: 200, centerY: 150, scale: 0.55 } as const;

/** Site metres -> D's `SitePosition` {x: east, z: north} in the plan's extent. */
export function siteToPlan(p: SitePos): { x: number; z: number } {
  return { x: (p.x - PLAN.centerX) * PLAN.scale, z: (p.y - PLAN.centerY) * PLAN.scale };
}

/* ----------------------------------------------------------------- Person A: 3D twin */
/** [TEAM TO CONFIRM: A] twin_x = x - 200 ; twin_z = -(y - 150)   (twin: -Z is north). */
export const TWIN = { offsetX: 200, offsetY: 150, scale: 1 } as const;

export function siteToTwin(p: SitePos): { x: number; z: number } {
  return { x: (p.x - TWIN.offsetX) / TWIN.scale, z: -(p.y - TWIN.offsetY) / TWIN.scale };
}

export function twinToSite(x: number, z: number): SitePos {
  return { x: x * TWIN.scale + TWIN.offsetX, y: -z * TWIN.scale + TWIN.offsetY };
}

export const DEG = Math.PI / 180;
export const degToRad = (d: number) => d * DEG;
export const radToDeg = (r: number) => r / DEG;
