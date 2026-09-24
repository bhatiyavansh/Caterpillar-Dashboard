/**
 * Single source of truth for the site layout.
 *
 * The layout is not invented for the twin: it is the backend simulator's own
 * site (`simulator/site.py`) translated into twin coordinates, so a machine the
 * live feed reports "at the loader point" is standing at the loader point in
 * 3D, on the right road, on the right bench. Terrain, roads, props, zone
 * markers and the local fleet autonomy all read from here.
 *
 * Coordinate convention: +X is east, -Z is north, +Y is up. Metres throughout.
 * Simulator (x, y) maps to twin (x - 192, -(y - 192)) — a translation only, the
 * same one `liveFrame.ts` applies to every live frame.
 */

/** Simulator site coordinates -> twin world coordinates. */
export function fromSim(x: number, y: number): { x: number; z: number } {
  return { x: x - 192, z: -(y - 192) };
}

/** Half-extent of the drivable working area. Covers the whole simulator site. */
export const SITE_HALF = 205;
export const SITE_SIZE = SITE_HALF * 2;

/** The rendered ground: the site plus the valley walls around it. */
export const TERRAIN_SIZE = 700;

/** Inside this box the ground is the site proper; outside it rises into hills. */
export const SITE_BOUNDS = { x0: -214, x1: 226, z0: -150, z1: 206 } as const;

/** Perimeter fence. The gate is on the west side, where the simulator's gate node is. */
export const FENCE = { x0: -206, x1: 218, z0: -144, z1: 200, gateZ: 92, gateWidth: 18 } as const;

/* ------------------------------------------------------------------------ */
/*  Operational points (straight from simulator/site.py)                    */
/* ------------------------------------------------------------------------ */

export const LOADER_POINT = fromSim(300, 150); // (108, 42)
export const DUMP_POINT = fromSim(40, 40); // (-152, 152)
export const STOCKPILE_POINT = fromSim(340, 165); // (148, 27)
export const FUEL_POINT = fromSim(200, 30); // (8, 162)
export const GATE_POINT = fromSim(0, 100); // (-192, 92)

/** Laden trucks: loader -> north lane -> west end -> up onto the dump. */
export const LOADED_ROUTE = [
  LOADER_POINT,
  fromSim(210, 118),
  fromSim(60, 118),
  fromSim(30, 118),
  fromSim(30, 50),
  DUMP_POINT,
];

/** Empty trucks: dump -> south lane -> east end -> back into the loading bay. */
export const EMPTY_ROUTE = [
  DUMP_POINT,
  fromSim(55, 20),
  fromSim(200, 82),
  fromSim(345, 82),
  fromSim(365, 110),
  LOADER_POINT,
];

/* ------------------------------------------------------------------------ */
/*  Zones                                                                   */
/* ------------------------------------------------------------------------ */

export interface SiteZone {
  id: string;
  label: string;
  sub: string;
  x: number;
  z: number;
  /** Half-extents. */
  rx: number;
  rz: number;
  /** Rectangular zones match the simulator's rectangles exactly. */
  shape?: "rect" | "ellipse";
  color: string;
  kind:
    | "excavation"
    | "stockpile"
    | "loading"
    | "maintenance"
    | "fuel"
    | "restricted"
    | "processing"
    | "dump";
}

function simRect(x0: number, y0: number, x1: number, y1: number) {
  const a = fromSim(x0, y0);
  const b = fromSim(x1, y1);
  return {
    x: (a.x + b.x) / 2,
    z: (a.z + b.z) / 2,
    rx: Math.abs(b.x - a.x) / 2,
    rz: Math.abs(b.z - a.z) / 2,
    shape: "rect" as const,
  };
}

export const ZONES: SiteZone[] = [
  {
    id: "zone-a",
    label: "PIT · ZONE A",
    sub: "BULK EXCAVATION",
    ...simRect(40, 180, 140, 280),
    color: "#f2b705",
    kind: "excavation",
  },
  {
    id: "zone-b",
    label: "ZONE B",
    sub: "TRENCHING",
    ...simRect(160, 180, 260, 280),
    color: "#f2b705",
    kind: "excavation",
  },
  {
    id: "zone-c",
    label: "ZONE C",
    sub: "GRADING",
    ...simRect(280, 180, 380, 280),
    color: "#8fb8d8",
    kind: "processing",
  },
  {
    id: "stockpile",
    label: "STOCKPILE",
    sub: "ROM MATERIAL",
    x: STOCKPILE_POINT.x + 8,
    z: STOCKPILE_POINT.z + 6,
    rx: 20,
    rz: 16,
    color: "#c9962f",
    kind: "stockpile",
  },
  {
    id: "loading",
    label: "LOADING BAY",
    sub: "TRUCK QUEUE",
    x: LOADER_POINT.x,
    z: LOADER_POINT.z,
    rx: 15,
    rz: 13,
    color: "#5ec26a",
    kind: "loading",
  },
  {
    id: "dump",
    label: "WASTE DUMP",
    sub: "TIP HEAD",
    x: DUMP_POINT.x,
    z: DUMP_POINT.z,
    rx: 19,
    rz: 17,
    color: "#b07a4a",
    kind: "dump",
  },
  {
    id: "fuel",
    label: "FUEL BAY",
    sub: "DIESEL / DEF",
    x: FUEL_POINT.x,
    z: FUEL_POINT.z,
    rx: 12,
    rz: 10,
    color: "#e08b3c",
    kind: "fuel",
  },
  {
    id: "maintenance",
    label: "WORKSHOP",
    sub: "SERVICE BAY",
    x: 60,
    z: 160,
    rx: 17,
    rz: 13,
    color: "#5aa0d6",
    kind: "maintenance",
  },
  {
    id: "restricted",
    label: "SEDIMENT POND",
    sub: "NO ENTRY",
    x: 116,
    z: 166,
    rx: 19,
    rz: 16,
    color: "#e0453c",
    kind: "restricted",
  },
  {
    id: "crusher",
    label: "CRUSHER PLANT",
    sub: "PRIMARY / SCREEN",
    x: 172,
    z: 158,
    rx: 17,
    rz: 18,
    color: "#b58cd9",
    kind: "processing",
  },
];

export function getZone(id: string): SiteZone {
  const zone = ZONES.find((z) => z.id === id);
  if (!zone) throw new Error(`Unknown zone: ${id}`);
  return zone;
}

export function insideZone(zone: SiteZone, x: number, z: number): boolean {
  const dx = (x - zone.x) / zone.rx;
  const dz = (z - zone.z) / zone.rz;
  if (zone.shape === "rect") return Math.abs(dx) <= 1 && Math.abs(dz) <= 1;
  return dx * dx + dz * dz <= 1;
}

/** Returns the zone containing (x, z), or null for open ground. Small zones win. */
export function zoneAt(x: number, z: number): SiteZone | null {
  let best: SiteZone | null = null;
  for (const zone of ZONES) {
    if (!insideZone(zone, x, z)) continue;
    if (!best || zone.rx * zone.rz < best.rx * best.rz) best = zone;
  }
  return best;
}

/* ------------------------------------------------------------------------ */
/*  Landforms                                                               */
/* ------------------------------------------------------------------------ */

/**
 * The pit: a rectangular floor inside zone A, with benched walls stepping up to
 * natural ground outside it. Wall width = benches x (face + berm).
 */
export const PIT = {
  floor: { x0: -148, x1: -58, z0: -84, z1: 6 },
  depth: 10,
  benches: 4,
  wallWidth: 30,
};

/** Centre of the pit floor, handy for props and cameras. */
export const PIT_CENTRE = {
  x: (PIT.floor.x0 + PIT.floor.x1) / 2,
  z: (PIT.floor.z0 + PIT.floor.z1) / 2,
};

/** Trenches being cut in zone B. `progress` is how much of the run is dug. */
export const TRENCHES = [
  { x0: -18, x1: 52, z: -58, width: 2.6, depth: 1.9, progress: 0.62 },
  { x0: -6, x1: 40, z: -18, width: 2.2, depth: 1.5, progress: 0.35 },
];

/** Sediment pond inside the restricted zone. */
export const POND = { x: 116, z: 168, rx: 13, rz: 10, depth: 3, waterY: -1.35 };

/** The waste dump is a raised tip head; trucks climb onto it and tip over the edge. */
export const DUMP = { x: DUMP_POINT.x, z: DUMP_POINT.z, r: 17, height: 3.6 };

/** Crusher plant layout. */
export const CRUSHER = {
  x: 170,
  z: 156,
  rot: -0.4,
  conveyorFrom: { x: 176, z: 150, y: 3.2 },
  conveyorTo: { x: 192, z: 138, y: 8.8 },
};

export interface Mound {
  x: number;
  z: number;
  r: number;
  h: number;
  /** Tipped/stockpiled material stands at its angle of repose: a cone, not a hill. */
  cone?: boolean;
}

export const MOUNDS: Mound[] = [
  // ROM stockpile the loader digs from (its toe is at STOCKPILE_POINT)
  { x: STOCKPILE_POINT.x + 13, z: STOCKPILE_POINT.z + 7, r: 13, h: 8.5, cone: true },
  { x: STOCKPILE_POINT.x + 2, z: STOCKPILE_POINT.z + 22, r: 8, h: 5, cone: true },
  // crusher feed and product piles
  { x: 196, z: 136, r: 9, h: 6.2, cone: true },
  { x: 150, z: 176, r: 7, h: 4.4, cone: true },
  // spoil beside the pit excavator
  { x: -114, z: -44, r: 6, h: 3.1, cone: true },
  // tipped loads down the dump face
  { x: DUMP_POINT.x - 22, z: DUMP_POINT.z + 6, r: 6, h: 2.8, cone: true },
  { x: DUMP_POINT.x - 14, z: DUMP_POINT.z + 20, r: 7, h: 3.2, cone: true },
  { x: DUMP_POINT.x - 26, z: DUMP_POINT.z - 8, r: 5, h: 2.2, cone: true },
  // natural knolls in the undeveloped south
  { x: -84, z: 186, r: 26, h: 7 },
  { x: 32, z: 198, r: 20, h: 5 },
  { x: 208, z: 60, r: 18, h: 4.5 },
];

export interface Pad {
  x: number;
  z: number;
  rx: number;
  rz: number;
  shape?: "rect" | "ellipse";
  /** Finished level. Default 0. */
  y?: number;
  /** Width of the batter slope around the pad. */
  feather?: number;
}

/** Graded, level working areas. */
export const PADS: Pad[] = [
  { ...simRect(160, 180, 260, 280), feather: 10 }, // zone B
  { ...simRect(280, 180, 380, 280), feather: 10 }, // zone C
  { x: LOADER_POINT.x, z: LOADER_POINT.z, rx: 17, rz: 15 },
  { x: STOCKPILE_POINT.x + 4, z: STOCKPILE_POINT.z + 6, rx: 26, rz: 22 },
  { x: FUEL_POINT.x, z: FUEL_POINT.z, rx: 14, rz: 12 },
  { x: 60, z: 160, rx: 20, rz: 15, shape: "rect", feather: 6 },
  { x: 172, z: 156, rx: 22, rz: 24, shape: "rect", feather: 6 },
  { x: -186, z: 128, rx: 16, rz: 20, shape: "rect", feather: 6 }, // compound
  { x: DUMP.x, z: DUMP.z, rx: DUMP.r, rz: DUMP.r, y: DUMP.height, feather: 6.5 },
];

/* ------------------------------------------------------------------------ */
/*  Roads                                                                   */
/* ------------------------------------------------------------------------ */

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
  /** Safety windrows down both shoulders. */
  berm?: boolean;
}

function road(
  id: string,
  a: { x: number; z: number },
  b: { x: number; z: number },
  opts: Partial<Pick<RoadSegment, "y1" | "y2" | "width" | "markings" | "berm">> = {},
): RoadSegment {
  return {
    id,
    x1: a.x,
    z1: a.z,
    x2: b.x,
    z2: b.z,
    y1: opts.y1 ?? 0,
    y2: opts.y2 ?? opts.y1 ?? 0,
    width: opts.width ?? 11,
    markings: opts.markings ?? false,
    berm: opts.berm ?? false,
  };
}

const L = LOADED_ROUTE;
const E = EMPTY_ROUTE;

/** Top of the pit ramp, and its foot on the pit floor. */
export const RAMP_TOP = { x: -30, z: 30 };
export const RAMP_FOOT = { x: -132, z: 10 };

export const ROADS: RoadSegment[] = [
  // The simulator's haul road spine.
  road("haul-main", fromSim(20, 100), fromSim(380, 100), { width: 14, markings: true, berm: true }),
  road("haul-east", fromSim(380, 100), fromSim(380, 170), { width: 12, markings: true, berm: true }),
  // Laden lane (north) and empty lane (south) the trucks actually drive.
  road("loaded-exit", L[0], L[1], { width: 12 }),
  road("loaded-lane", L[1], L[3], { width: 12, markings: true, berm: true }),
  road("dump-approach", L[3], { x: L[3].x, z: 110 }, { width: 12 }),
  road("dump-ramp", { x: L[3].x, z: 110 }, { x: L[4].x, z: 138 }, { width: 12, y2: DUMP.height, berm: true }),
  road("dump-access", { x: L[4].x, z: 138 }, L[5], { width: 12, y1: DUMP.height }),
  road("dump-exit", L[5], E[1], { width: 12, y1: DUMP.height, y2: 0 }),
  road("empty-diagonal", E[1], E[2], { width: 12, berm: true }),
  road("empty-lane", E[2], E[3], { width: 12, markings: true, berm: true }),
  road("empty-turn", E[3], E[4], { width: 12 }),
  road("loader-entry", E[4], E[5], { width: 12 }),
  // Pit access: spur off the laden lane, then a ramp down the south wall.
  road("pit-spur", { x: RAMP_TOP.x, z: 74 }, RAMP_TOP, { width: 12, markings: true }),
  road("pit-ramp", RAMP_TOP, RAMP_FOOT, { width: 12, y2: -PIT.depth, berm: true }),
  road("pit-ramp-foot", RAMP_FOOT, { x: RAMP_FOOT.x - 6, z: -2 }, { width: 13, y1: -PIT.depth }),
  // Zone B and zone C access.
  road("zone-b-access", { x: 18, z: 74 }, { x: 18, z: 12 }, { width: 10 }),
  road("zone-c-access", { x: 140, z: 92 }, { x: 128, z: 12 }, { width: 10 }),
  // Services.
  road("fuel-spur", { x: FUEL_POINT.x, z: 110 }, FUEL_POINT, { width: 11, markings: true }),
  road("workshop-spur", { x: 60, z: 110 }, { x: 60, z: 148 }, { width: 11 }),
  road("crusher-spur", { x: 150, z: 110 }, { x: 168, z: 140 }, { width: 11 }),
  road("compound-spur", { x: -186, z: 92 }, { x: -186, z: 110 }, { width: 10 }),
  // Public access road through the gate, cut into the valley side.
  road("access-west", fromSim(20, 100), { x: -345, z: 104 }, { width: 13, markings: true, y2: 12 }),
];

export interface RoadProjection {
  /** 0 = off-road, 1 = fully on the running surface. */
  influence: number;
  /** Target height of the road surface at this point. */
  y: number;
  /** Index of the road that won. */
  index: number;
  /** Distance from that road's centre line. */
  dist: number;
}

/** Nearest point on a segment, as (t, distance). */
export function segmentProjection(road: RoadSegment, x: number, z: number): { t: number; dist: number } {
  const dx = road.x2 - road.x1;
  const dz = road.z2 - road.z1;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((x - road.x1) * dx + (z - road.z1) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { t, dist: Math.hypot(x - (road.x1 + dx * t), z - (road.z1 + dz * t)) };
}

/** Shoulder over which a road blends into the surrounding ground (cut/fill batter). */
export const ROAD_SHOULDER = 8;

/**
 * Projects (x, z) onto the road network.
 *
 * Used by the terrain generator to flatten the running surface, and by the road
 * ribbon builder to sit flush on it.
 */
export function projectRoads(x: number, z: number): RoadProjection {
  let best = 0;
  let bestY = 0;
  let bestIndex = -1;
  let bestDist = Infinity;

  for (let i = 0; i < ROADS.length; i++) {
    const r = ROADS[i];
    const { t, dist } = segmentProjection(r, x, z);
    const half = r.width / 2;
    if (dist > half + ROAD_SHOULDER) continue;
    const influence = 1 - smoothstep(half, half + ROAD_SHOULDER, dist);
    // Where two surfaces overlap (a junction), the one you are actually on wins.
    const tie = Math.abs(influence - best) < 1e-6 && dist < bestDist;
    if (influence > best + 1e-6 || tie) {
      best = influence;
      bestY = r.y1 + (r.y2 - r.y1) * t;
      bestIndex = i;
      bestDist = dist;
    }
  }

  return { influence: best, y: bestY, index: bestIndex, dist: bestDist };
}

/* ------------------------------------------------------------------------ */
/*  Maths                                                                   */
/* ------------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------------ */
/*  Machines and crew                                                       */
/* ------------------------------------------------------------------------ */

export interface Waypoint {
  x: number;
  z: number;
  /** Seconds to hold here — loading, dumping, dozing. */
  dwell?: number;
}

/** Where EXC001 starts, and where `R` returns it to: at the trench in zone B. */
export const EXCAVATOR_HOME = {
  x: 16,
  z: -52,
  heading: 0, // facing north, square to the trench face
};

/** Work stations for the local (no-backend) fleet autonomy. */
export const WORK_STATIONS = {
  pitExcavator: { x: -104, z: -44, heading: 0 },
  dozerLanes: { x0: -142, x1: -70, z0: -78, z1: -58 },
  graderLanes: { x0: 96, x1: 180, z0: -80, z1: 4 },
  loaderDig: { x: STOCKPILE_POINT.x, z: STOCKPILE_POINT.z },
  loaderDump: { x: LOADER_POINT.x + 9, z: LOADER_POINT.z - 3 },
};

/**
 * Paths the local fleet repeatedly drives. Used for tyre-rut shading too, so
 * the ground wears where the machines actually go.
 */
export const MACHINE_ROUTES: Record<string, Waypoint[]> = {
  HAUL_EMPTY: EMPTY_ROUTE.map((p) => ({ ...p })),
  HAUL_LOADED: LOADED_ROUTE.map((p) => ({ ...p })),
  LOADER: [
    { x: STOCKPILE_POINT.x, z: STOCKPILE_POINT.z },
    { x: LOADER_POINT.x + 9, z: LOADER_POINT.z - 3 },
  ],
};

/** Patrol loops for the site crew (local mode; live mode uses the feed). */
export const WORKER_ROUTES: Record<string, Waypoint[]> = {
  // Pipe crew working along the zone B trench.
  WRK001: [
    { x: 30, z: -62, dwell: 8 },
    { x: 42, z: -63, dwell: 6 },
    { x: 46, z: -54, dwell: 5 },
    { x: 34, z: -53, dwell: 4 },
  ],
  WRK002: [
    { x: -8, z: -24, dwell: 6 },
    { x: 8, z: -24, dwell: 7 },
    { x: 14, z: -12, dwell: 4 },
    { x: -2, z: -12, dwell: 5 },
  ],
  // The spotter. Periodically walks toward EXC001 for the proximity demo.
  WRK003: [
    { x: 2, z: -36, dwell: 4 },
    { x: 30, z: -38, dwell: 5 },
    { x: 32, z: -26, dwell: 4 },
    { x: 4, z: -26, dwell: 5 },
  ],
  // Banksman at the loading bay.
  WRK004: [
    { x: 92, z: 30, dwell: 9 },
    { x: 94, z: 52, dwell: 7 },
  ],
  // Surveyor on the pit floor.
  WRK005: [
    { x: -130, z: -70, dwell: 9 },
    { x: -90, z: -76, dwell: 8 },
    { x: -80, z: -20, dwell: 7 },
    { x: -128, z: -12, dwell: 6 },
  ],
  // Fitter at the workshop.
  WRK006: [
    { x: 50, z: 156, dwell: 10 },
    { x: 70, z: 158, dwell: 8 },
    { x: 64, z: 168, dwell: 6 },
  ],
};

/** Static props: containers, site office, fuel tanks, light masts. */
export const STATIC_PROPS = {
  containers: [
    { x: 44, z: 170, rot: 0, color: "#c2601f" },
    { x: 44, z: 176, rot: 0, color: "#2f6b8a" },
    { x: 78, z: 172, rot: 0.1, color: "#4a7c4e" },
    { x: -176, z: 142, rot: Math.PI / 2, color: "#8a4a2f" },
  ],
  office: { x: -192, z: 138, rot: Math.PI / 2 },
  fuelTanks: [
    { x: FUEL_POINT.x - 5, z: FUEL_POINT.z + 7 },
    { x: FUEL_POINT.x + 4, z: FUEL_POINT.z + 7 },
  ],
  lightMasts: [
    { x: -40, z: 40 },
    { x: -160, z: 30 },
    { x: -40, z: -100 },
    { x: 60, z: -2 },
    { x: 94, z: 28 },
    { x: -172, z: 166 },
    { x: 150, z: -2 },
    { x: 24, z: 150 },
  ],
};
