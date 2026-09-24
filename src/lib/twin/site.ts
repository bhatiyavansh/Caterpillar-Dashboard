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
  kind: "excavation" | "stockpile" | "loading" | "maintenance" | "fuel" | "restricted" | "dump";
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
  {
    id: "dump",
    label: "WASTE DUMP",
    sub: "TIP HEAD · 20% RAMP",
    x: -100,
    z: -50,
    rx: 26,
    rz: 22,
    color: "#b07a4a",
    kind: "dump",
  },
  {
    id: "face-c",
    label: "BENCH FACE C",
    sub: "UNSTABLE GROUND",
    x: 37,
    z: -96,
    rx: 19,
    rz: 11,
    color: "#e0453c",
    kind: "excavation",
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
  // Former cosmetic spoil cones (SiteProps) — now part of the ground, so
  // machines have to go round them like any other heap.
  { x: 8, z: -84, r: 5, h: 1.8 },
  { x: -36, z: -86, r: 5.5, h: 2.1 },
];

/** Graded, flat working pads. */
export const PADS = [
  { x: 34, z: 44, rx: 22, rz: 18 },
  { x: 74, z: 30, rx: 20, rz: 16 },
  { x: -2, z: 76, rx: 14, rz: 12 },
  // Crusher pad.
  { x: 74, z: 84, rx: 18, rz: 13 },
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
    // Runs out to the gate in the perimeter fence.
    x2: 156,
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
    z2: -22,
    y2: 0,
    width: 12,
    markings: true,
  },
  {
    id: "ramp-pit",
    // 40 m for 4.6 m of fall: an 11.5% haul grade, close to the 10% a real
    // pit ramp is held to. It runs out over the pit floor as an embankment,
    // so both edges carry a safety berm and a guardrail.
    x1: -5,
    z1: -22,
    y1: 0,
    x2: -5,
    z2: -62,
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
  {
    id: "ramp-dump",
    // 30 m for 6 m of climb: a 20% tip-head ramp on loose spoil. Deliberately
    // steeper than the pit ramp — wet, it is where trucks lose traction.
    x1: -96,
    z1: 0,
    y1: 0,
    x2: -96,
    z2: -30,
    y2: 6,
    width: 12,
    markings: false,
  },
  {
    id: "spur-face",
    // Service track up to bench face C, over natural ground.
    x1: 37,
    z1: 8,
    y1: 0,
    x2: 37,
    z2: -80,
    y2: 0,
    width: 9,
    markings: false,
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
  let bestDist = Infinity;

  for (const road of ROADS) {
    // Cheap reject: outside the segment's box grown by the shoulder.
    const reach = road.width / 2 + 7;
    if (x < Math.min(road.x1, road.x2) - reach || x > Math.max(road.x1, road.x2) + reach) continue;
    if (z < Math.min(road.z1, road.z2) - reach || z > Math.max(road.z1, road.z2) + reach) continue;
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
    // Where two segments both fully cover a point (a spur's end cap over the
    // head of the ramp it feeds), the nearer centreline wins — otherwise the
    // listing order decides, and the ramp head gets a step in it.
    if (influence > best || (influence === best && influence > 0 && dist < bestDist)) {
      best = influence;
      bestY = road.y1 + (road.y2 - road.y1) * t;
      bestDist = dist;
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
  /** Drive this leg in reverse: how trucks back into a tip or load point. */
  reverse?: boolean;
}

/** Looping routes for the autonomous machines, so the site feels alive. */
export const MACHINE_ROUTES: Record<string, Waypoint[]> = {
  // Road -> down the pit ramp -> push spoil across the floor -> back out.
  // The floor is the only part of the benched pit a dozer can reach: the
  // bench faces are 30-40 degrees and the physics will not let it climb them.
  DOZ001: [
    { x: 30, z: 8 },
    { x: -5, z: 8 },
    { x: -5, z: -26 },
    { x: -5, z: -62 },
    { x: -20, z: -60, dwell: 2.5 },
    { x: -10, z: -68, dwell: 3 },
    { x: 8, z: -60, dwell: 2.5 },
    { x: -5, z: -62 },
    { x: -5, z: -26 },
    { x: -5, z: 8 },
    { x: 46, z: 8, dwell: 1.5 },
  ],
  // Stockpile -> loading zone -> stockpile. It loads at the toe of the
  // stockpile, where the ground is workable, and loads the truck from the
  // west side of the loading pad, clear of the truck's reversing line.
  WHL001: [
    { x: -52, z: 32, dwell: 3 },
    { x: -58, z: 20 },
    { x: -58, z: 8 },
    { x: 27, z: 8 },
    { x: 27, z: 30 },
    { x: 27, z: 42, dwell: 3.5 },
    { x: 27, z: 24 },
    { x: 27, z: 8 },
    { x: -58, z: 8 },
    { x: -58, z: 24 },
  ],
  // Load, haul, tip, return. Like a real haul truck it never turns round on
  // a spur: it runs past the junction and reverses in to load and to tip.
  TRK001: [
    { x: 36, z: 42, dwell: 4, reverse: true },
    { x: 34, z: 16 },
    { x: 20, z: 8 },
    { x: -40, z: 8 },
    { x: -74, z: 8 },
    { x: -58, z: 30, dwell: 3, reverse: true },
    { x: -58, z: 10 },
    { x: -30, z: 8 },
    { x: 34, z: 8 },
    { x: 52, z: 8 },
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

/**
 * Where EXC001 starts, and where `R` returns it to: on the level ground west
 * of the ramp head, facing the pit. Not on the spur itself — the ramp is the only way
 * into the pit, and with real collision a parked excavator there blocks it.
 */
export const EXCAVATOR_HOME = {
  x: -21,
  z: -14,
  heading: 0,
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

/* ------------------------------------------------------------------------ */
/*  Landforms                                                                */
/*                                                                          */
/*  Everything below is geometry the terrain function carves or raises, or   */
/*  a solid structure standing on it. `terrainHeight` (terrain.ts) turns the */
/*  landforms into ground; `SITE_COLLIDERS` lists every structure the        */
/*  physics world must treat as solid. Nothing here is visual-only.          */
/* ------------------------------------------------------------------------ */

/**
 * Pit terraces, as normalised ellipse distance (1 = PIT rim) -> level.
 * Floor, two working benches, then the rim. Faces between levels are
 * 1.5 m high and 30-40 degrees steep: machines stay on a level or use the ramp.
 */
export const PIT_BENCHES = [
  { from: 0, to: 0.62, y: -PIT.depth },
  { from: 0.68, to: 0.8, y: -3.1 },
  { from: 0.86, to: 0.98, y: -1.6 },
  { from: 1.04, to: 1.2, y: 0 },
] as const;

/** Raised waste dump: a flat tip head reached by `ramp-dump`. */
export const DUMP = { x: -100, z: -50, rx: 24, rz: 20, h: 6 };

/**
 * Bench face C: a second, shallower cut, left over-steep on purpose.
 *
 * The ground function describes the face *after* it has failed: the crest
 * has slumped back to `crestZ` along a 19 degree plane that meets the floor.
 * The intact face — vertical-ish, crest at `intactCrestZ` — is made of loose
 * rock blocks the physics world stacks on that plane. Until a heavy machine
 * works too close to the edge, the blocks are locked in place; then they
 * break free and slide. One ground function either way. The wedge between
 * the two profiles is roughly 30 x 6.7 x 1.2 m: about 600 t of rock.
 */
export const SHALLOW_FACE = {
  x1: 22,
  x2: 52,
  /** Crest of the intact face. */
  intactCrestZ: -92,
  /** Toe of the intact face: 5.5 m of fall in 1.5 m, about 75 degrees. */
  intactToeZ: -93.5,
  /** Where the crest ends up after the failure: 6 m of retreat. */
  crestZ: -86,
  /** Where the 21-degree slump plane meets the floor. */
  slumpToeZ: -100,
  floorY: -5.5,
  /** Floor runs north to here, then climbs back to natural ground. */
  floorEndZ: -112,
  exitZ: -125,
};

export interface LineFeature {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  /** Full width across the feature, metres. */
  width: number;
  /** Height (ridges) or depth (trenches), metres. */
  h: number;
}

/**
 * Windrows: the gravel ridges graders leave along haul-road edges. Gaps at
 * every junction so nothing has to climb one to turn off.
 */
const WINDROW_N = -1.2;
const WINDROW_S = 17.2;
export const WINDROWS: LineFeature[] = [
  ...[
    [-87, -14],
    [4, 29],
    [45, 150],
  ].map(([a, b]) => ({ x1: a, z1: WINDROW_N, x2: b, z2: WINDROW_N, width: 2.6, h: 0.9 })),
  // South side: wide gaps at the stockpile and loading spurs, where trucks
  // run past and reverse in.
  ...[
    [-104, -72],
    [-44, -10.5],
    [6.5, 18],
    [50, 65.5],
    [82.5, 150],
  ].map(([a, b]) => ({ x1: a, z1: WINDROW_S, x2: b, z2: WINDROW_S, width: 2.6, h: 0.9 })),
];

/**
 * Safety berms: along both edges of the two ramps, which run as embankments
 * with a drop on either side. Half a haul-truck wheel high, as the rule says.
 */
export const BERMS: LineFeature[] = [
  { x1: -12.4, z1: -26, x2: -12.4, z2: -58, width: 2.2, h: 1.3 },
  { x1: 2.4, z1: -26, x2: 2.4, z2: -58, width: 2.2, h: 1.3 },
  { x1: -103.4, z1: -3, x2: -103.4, z2: -29, width: 2.2, h: 1.3 },
  { x1: -88.6, z1: -3, x2: -88.6, z2: -29, width: 2.2, h: 1.3 },
];

/** Service trenches, each with its spoil ridge thrown up alongside. */
export const TRENCHES: (LineFeature & { spoilOffset: number })[] = [
  { x1: 48, z1: -18, x2: 96, z2: -18, width: 2.2, h: 1.8, spoilOffset: -4 },
  { x1: 108, z1: 22, x2: 108, z2: 62, width: 2.2, h: 1.8, spoilOffset: 4 },
];

/** Settling pond. The ring of clay around it stays wet. */
export const POND = { x: -110, z: 96, r: 13, depth: 1.8, clayR: 24 };

/** Perimeter: fence line, gate on the haul road, rising valley walls behind. */
export const PERIMETER = { fence: 152, wallStart: 158, wallHeight: 9, gate: { z1: 0, z2: 16 } };

/** Oriented box resting on the ground: a structure the physics world treats as solid. */
export interface StaticCollider {
  id: string;
  x: number;
  z: number;
  /** Rotation about Y, radians (three.js convention, as the meshes use). */
  rot: number;
  /** Half extents. */
  hx: number;
  hy: number;
  hz: number;
  /** Lift of the box centre above ground at (x, z). Defaults to hy. */
  lift?: number;
  /**
   * Long runs (rails, fences) follow the ground: the physics world splits
   * them into short pieces, each seated on the terrain, rather than laying
   * one level box across a grade.
   */
  follow?: boolean;
}

function guardrail(id: string, x: number, z1: number, z2: number): StaticCollider {
  return { id, x, z: (z1 + z2) / 2, rot: 0, hx: 0.12, hy: 0.45, hz: Math.abs(z2 - z1) / 2, lift: 0.9, follow: true };
}

/** Crusher plant: a U-shaped hopper wall, the crusher house and the conveyor. */
export const CRUSHER = {
  x: 74,
  z: 84,
  walls: [
    { dx: 0, dz: -5, hx: 5, hz: 0.4 },
    { dx: -5, dz: 0, hx: 0.4, hz: 5 },
    { dx: 5, dz: 0, hx: 0.4, hz: 5 },
  ],
  house: { dx: 0, dz: 7, hx: 3.5, hy: 3.2, hz: 3 },
};

/**
 * Every solid structure on site. Derived from the same numbers the meshes are
 * drawn from, so there is nothing a machine can see and still drive through.
 * Traffic cones and zone marker posts are deliberately absent: they are
 * sub-metre and a 20-tonne machine does not stop for them.
 */
export const SITE_COLLIDERS: StaticCollider[] = [
  ...STATIC_PROPS.containers.map((c, i) => ({ id: `container-${i}`, x: c.x, z: c.z, rot: c.rot, hx: 3.05, hy: 1.3, hz: 1.22 })),
  { id: "office", x: STATIC_PROPS.office.x, z: STATIC_PROPS.office.z, rot: STATIC_PROPS.office.rot, hx: 4.6, hy: 1.6, hz: 2.2 },
  ...STATIC_PROPS.fuelTanks.map((t, i) => ({ id: `fuel-tank-${i}`, x: t.x, z: t.z, rot: 0, hx: 2.6, hy: 1.1, hz: 1.1, lift: 1.5 })),
  ...STATIC_PROPS.lightMasts.map((m, i) => ({ id: `light-mast-${i}`, x: m.x, z: m.z, rot: 0, hx: 0.6, hy: 2.5, hz: 0.6 })),
  // Barrier run at the pit-ramp junction (SiteProps HaulRoadBarriers).
  ...[0, 1, 2, 3, 4].flatMap((i) => [
    { id: `barrier-w${i}`, x: -16 - i * 3.4, z: -28, rot: 0, hx: 1.6, hy: 0.5, hz: 0.07 },
    { id: `barrier-e${i}`, x: 6 + i * 3.4, z: -28, rot: 0, hx: 1.6, hy: 0.5, hz: 0.07 },
  ]),
  // Guardrails on the drop side of both ramps (on the inside of the berm).
  guardrail("rail-pit-w", -11.2, -27, -57),
  guardrail("rail-pit-e", 1.2, -27, -57),
  guardrail("rail-dump-w", -102.2, -4, -28),
  guardrail("rail-dump-e", -89.8, -4, -28),
  // Crusher plant.
  ...CRUSHER.walls.map((w, i) => ({ id: `hopper-wall-${i}`, x: CRUSHER.x + w.dx, z: CRUSHER.z + w.dz, rot: 0, hx: w.hx, hy: 1.6, hz: w.hz })),
  { id: "crusher-house", x: CRUSHER.x + CRUSHER.house.dx, z: CRUSHER.z + CRUSHER.house.dz, rot: 0, hx: CRUSHER.house.hx, hy: CRUSHER.house.hy, hz: CRUSHER.house.hz },
  // Perimeter fence, with the gate gap where the haul road leaves site.
  { id: "fence-n", x: 0, z: -PERIMETER.fence, rot: 0, hx: PERIMETER.fence, hy: 1.1, hz: 0.08, follow: true },
  { id: "fence-s", x: 0, z: PERIMETER.fence, rot: 0, hx: PERIMETER.fence, hy: 1.1, hz: 0.08, follow: true },
  { id: "fence-w", x: -PERIMETER.fence, z: 0, rot: 0, hx: 0.08, hy: 1.1, hz: PERIMETER.fence, follow: true },
  {
    id: "fence-e1",
    x: PERIMETER.fence,
    z: (-PERIMETER.fence + PERIMETER.gate.z1) / 2,
    rot: 0,
    hx: 0.08,
    hy: 1.1,
    hz: (PERIMETER.fence + PERIMETER.gate.z1) / 2,
    follow: true,
  },
  {
    id: "fence-e2",
    x: PERIMETER.fence,
    z: (PERIMETER.fence + PERIMETER.gate.z2) / 2,
    rot: 0,
    hx: 0.08,
    hy: 1.1,
    hz: (PERIMETER.fence - PERIMETER.gate.z2) / 2,
    follow: true,
  },
];

/** Distance from (x, z) to a line segment, and the position along it (0..1). */
export function segmentDistance(x: number, z: number, f: { x1: number; z1: number; x2: number; z2: number }): { d: number; t: number } {
  const dx = f.x2 - f.x1;
  const dz = f.z2 - f.z1;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((x - f.x1) * dx + (z - f.z1) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { d: Math.hypot(x - (f.x1 + dx * t), z - (f.z1 + dz * t)), t };
}
