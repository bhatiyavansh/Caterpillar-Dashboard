/**
 * Single source of truth for the synthetic site layout.
 *
 * Terrain generation, road meshes, zone markers and machine AI all read from
 * here, so moving a zone moves everything that depends on it.
 *
 * Coordinate convention: +X is east, -Z is north, +Y is up. Metres throughout.
 */

/**
 * 360 m square. Larger than the twin's own layout needs, because the live
 * simulator's fleet ranges over x 46-339 / y 118-266 in its own frame, and
 * live coordinates are translated 1:1 (never scaled — see liveFrame.ts). The
 * extra ground keeps every machine on the mesh in live mode.
 */
export const SITE_SIZE = 360;
export const SITE_HALF = SITE_SIZE / 2;

export interface SiteZone {
  id: string;
  label: string;
  sub: string;
  x: number;
  z: number;
  /** Half-extents. */
  rx: number;
  rz: number;
  color: string;
  kind: "excavation" | "stockpile" | "loading" | "maintenance" | "fuel" | "restricted";
}

export const ZONES: SiteZone[] = [
  {
    id: "zone-b",
    label: "EXCAVATION ZONE B",
    sub: "ACTIVE DIG",
    x: -5,
    z: -55,
    rx: 40,
    rz: 28,
    color: "#f2b705",
    kind: "excavation",
  },
  {
    id: "stockpile",
    label: "STOCKPILE",
    sub: "MATERIAL",
    x: -58,
    z: 48,
    rx: 24,
    rz: 20,
    color: "#c9962f",
    kind: "stockpile",
  },
  {
    id: "loading",
    label: "LOADING ZONE",
    sub: "HAUL OUT",
    x: 34,
    z: 44,
    rx: 20,
    rz: 16,
    color: "#5ec26a",
    kind: "loading",
  },
  {
    id: "maintenance",
    label: "MAINTENANCE",
    sub: "SERVICE BAY",
    x: 74,
    z: 30,
    rx: 18,
    rz: 14,
    color: "#5aa0d6",
    kind: "maintenance",
  },
  {
    id: "fuel",
    label: "FUEL STATION",
    sub: "DIESEL / DEF",
    x: -2,
    z: 76,
    rx: 12,
    rz: 10,
    color: "#e08b3c",
    kind: "fuel",
  },
  {
    id: "restricted",
    label: "RESTRICTED",
    sub: "NO ENTRY",
    x: 76,
    z: -42,
    rx: 20,
    rz: 18,
    color: "#e0453c",
    kind: "restricted",
  },
];

export function getZone(id: string): SiteZone {
  const zone = ZONES.find((z) => z.id === id);
  if (!zone) throw new Error(`Unknown zone: ${id}`);
  return zone;
}

/** Returns the zone containing (x, z), or null for open ground. */
export function zoneAt(x: number, z: number): SiteZone | null {
  for (const zone of ZONES) {
    const dx = (x - zone.x) / zone.rx;
    const dz = (z - zone.z) / zone.rz;
    if (dx * dx + dz * dz <= 1) return zone;
  }
  return null;
}

/** The excavation pit. Terrain digs a flat-bottomed bowl here. */
export const PIT = { x: -5, z: -55, rx: 40, rz: 28, depth: 4.6 };

/** Stockpile mounds and spoil heaps. */
export const MOUNDS = [
  { x: -58, z: 48, r: 17, h: 5.4 },
  { x: -42, z: 57, r: 11, h: 3.4 },
  { x: -71, z: 37, r: 10, h: 2.9 },
  { x: 24, z: -12, r: 9, h: 2.4 },
  { x: -26, z: -30, r: 8, h: 2.0 },
];

/** Graded, flat working pads. */
export const PADS = [
  { x: 34, z: 44, rx: 22, rz: 18 },
  { x: 74, z: 30, rx: 20, rz: 16 },
  { x: -2, z: 76, rx: 14, rz: 12 },
];

export interface RoadSegment {
  id: string;
  x1: number;
  z1: number;
  y1: number;
  x2: number;
  z2: number;
  y2: number;
  width: number;
  /** Centre lane dashes. Ramps skip them. */
  markings: boolean;
}

/**
 * The haul road network. `y1`/`y2` let a segment ramp — the excavation spur
 * descends into the pit so the excavator can drive in without a cliff.
 */
export const ROADS: RoadSegment[] = [
  {
    id: "haul-main",
    x1: -104,
    z1: 8,
    y1: 0,
    x2: 104,
    z2: 8,
    y2: 0,
    width: 15,
    markings: true,
  },
  {
    id: "spur-excavation",
    x1: -5,
    z1: 8,
    y1: 0,
    x2: -5,
    z2: -30,
    y2: 0,
    width: 12,
    markings: true,
  },
  {
    id: "ramp-pit",
    x1: -5,
    z1: -30,
    y1: 0,
    x2: -5,
    z2: -52,
    y2: -PIT.depth,
    width: 12,
    markings: false,
  },
  {
    id: "spur-loading",
    x1: 34,
    z1: 8,
    y1: 0,
    x2: 34,
    z2: 40,
    y2: 0,
    width: 12,
    markings: true,
  },
  {
    id: "spur-stockpile",
    x1: -58,
    z1: 8,
    y1: 0,
    x2: -58,
    z2: 34,
    y2: 0,
    width: 12,
    markings: true,
  },
  {
    id: "spur-maintenance",
    x1: 74,
    z1: 8,
    y1: 0,
    x2: 74,
    z2: 26,
    y2: 0,
    width: 11,
    markings: false,
  },
  {
    id: "spur-fuel",
    x1: -2,
    z1: 8,
    y1: 0,
    x2: -2,
    z2: 70,
    y2: 0,
    width: 11,
    markings: true,
  },
];

export interface RoadProjection {
  /** 0 = off-road, 1 = fully on the running surface. */
  influence: number;
  /** Target height of the road surface at this point. */
  y: number;
}

/**
 * Projects (x, z) onto the road network.
 *
 * Used by the terrain generator to flatten the running surface, and by the road
 * ribbon builder to sit flush on it.
 */
export function projectRoads(x: number, z: number): RoadProjection {
  let best = 0;
  let bestY = 0;

  for (const road of ROADS) {
    const dx = road.x2 - road.x1;
    const dz = road.z2 - road.z1;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - road.x1) * dx + (z - road.z1) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;

    const cx = road.x1 + dx * t;
    const cz = road.z1 + dz * t;
    const dist = Math.hypot(x - cx, z - cz);

    const half = road.width / 2;
    // Full influence on the surface, feathering out over a 7m shoulder.
    const influence = 1 - smoothstep(half, half + 7, dist);
    if (influence > best) {
      best = influence;
      bestY = road.y1 + (road.y2 - road.y1) * t;
    }
  }

  return { influence: best, y: bestY };
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest signed angular difference, in radians. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Heading in radians where 0 = north (-Z), clockwise positive. */
export function headingTo(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(toX - fromX, -(toZ - fromZ));
}

/** Unit forward vector for a heading, in world space. */
export function headingVector(heading: number): { x: number; z: number } {
  return { x: Math.sin(heading), z: -Math.cos(heading) };
}

export function normalizeHeading(h: number): number {
  let a = h % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a;
}

export interface Waypoint {
  x: number;
  z: number;
  /** Seconds to hold here — loading, dumping, dozing. */
  dwell?: number;
}

/** Looping routes for the autonomous machines, so the site feels alive. */
export const MACHINE_ROUTES: Record<string, Waypoint[]> = {
  // Road -> excavation -> road: the dozer pushes spoil around the pit rim.
  DOZ001: [
    { x: 30, z: 8 },
    { x: -5, z: 8 },
    { x: -5, z: -26 },
    { x: -22, z: -40, dwell: 2.5 },
    { x: -30, z: -58, dwell: 3 },
    { x: -10, z: -66, dwell: 2.5 },
    { x: 12, z: -50 },
    { x: -5, z: -26 },
    { x: -5, z: 8 },
    { x: 46, z: 8, dwell: 1.5 },
  ],
  // Stockpile -> loading zone -> stockpile.
  WHL001: [
    { x: -50, z: 44, dwell: 3 },
    { x: -58, z: 20 },
    { x: -58, z: 8 },
    { x: 34, z: 8 },
    { x: 34, z: 40 },
    { x: 34, z: 48, dwell: 3.5 },
    { x: 34, z: 20 },
    { x: 34, z: 8 },
    { x: -58, z: 8 },
    { x: -58, z: 24 },
  ],
  // Loading zone -> stockpile -> loading zone.
  TRK001: [
    { x: 40, z: 48, dwell: 4 },
    { x: 34, z: 16 },
    { x: 20, z: 8 },
    { x: -40, z: 8 },
    { x: -58, z: 14 },
    { x: -58, z: 32, dwell: 3 },
    { x: -58, z: 10 },
    { x: -30, z: 8 },
    { x: 34, z: 8 },
    { x: 34, z: 34 },
  ],
};

/** Patrol loops for the site crew. */
export const WORKER_ROUTES: Record<string, Waypoint[]> = {
  WRK001: [
    { x: -30, z: -44, dwell: 6 },
    { x: -18, z: -50, dwell: 4 },
    { x: -20, z: -62, dwell: 7 },
    { x: -34, z: -56, dwell: 3 },
  ],
  WRK002: [
    { x: 18, z: -46, dwell: 5 },
    { x: 24, z: -58, dwell: 8 },
    { x: 8, z: -64, dwell: 4 },
    { x: 6, z: -44, dwell: 5 },
  ],
  // The spotter. Periodically walks toward EXC001 for the proximity demo.
  WRK003: [
    { x: -14, z: -30, dwell: 4 },
    { x: 4, z: -34, dwell: 5 },
    { x: 6, z: -20, dwell: 4 },
    { x: -16, z: -18, dwell: 5 },
  ],
  WRK004: [
    { x: 30, z: 40, dwell: 7 },
    { x: 44, z: 46, dwell: 5 },
    { x: 40, z: 56, dwell: 6 },
    { x: 26, z: 52, dwell: 4 },
  ],
  WRK005: [
    { x: -50, z: 36, dwell: 6 },
    { x: -64, z: 32, dwell: 5 },
    { x: -70, z: 46, dwell: 7 },
    { x: -52, z: 50, dwell: 4 },
  ],
  WRK006: [
    { x: 66, z: 26, dwell: 8 },
    { x: 80, z: 28, dwell: 6 },
    { x: 78, z: 38, dwell: 5 },
    { x: 64, z: 36, dwell: 6 },
  ],
};

/** Where EXC001 starts, and where `R` returns it to. */
export const EXCAVATOR_HOME = {
  x: -5,
  z: -20,
  heading: 0, // facing north, straight up the excavation spur
};

/** Static props: containers, site office, barriers, signage. */
export const STATIC_PROPS = {
  containers: [
    { x: 14, z: 80, rot: 0.1, color: "#c2601f" },
    { x: 14, z: 87, rot: 0.06, color: "#2f6b8a" },
    { x: 26, z: 82, rot: -0.35, color: "#4a7c4e" },
    { x: 68, z: 36, rot: 1.6, color: "#8a4a2f" },
  ],
  office: { x: -18, z: 82, rot: -0.08 },
  fuelTanks: [
    { x: -6, z: 76 },
    { x: 3, z: 76 },
  ],
  lightMasts: [
    { x: -30, z: -34 },
    { x: 20, z: -34 },
    { x: 46, z: 20 },
    { x: -44, z: 18 },
    { x: 2, z: 64 },
  ],
};
