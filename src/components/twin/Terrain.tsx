"use client";

/**
 * Displaced ground mesh, plus the valley and mountain backdrop around it.
 *
 * The vertices are pushed by the same `terrainHeight` the vehicle model samples
 * for pitch and roll, so what you see is exactly what the machine is driving on.
 * Surface type is baked into vertex colours — no textures, no extra draw calls —
 * and is chosen from what the ground *is*: haul-road shoulder, graded pad, cut
 * bench face, wet pit floor, pond mud, windrow, tyre-rutted track, scrub.
 */

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  DUMP,
  MACHINE_ROUTES,
  MOUNDS,
  PADS,
  PIT,
  POND,
  TERRAIN_SIZE,
  TRENCHES,
  WORK_STATIONS,
  projectRoads,
  smoothstep,
  zoneAt,
} from "@/lib/twin/site";
import { distanceOutsideSite, fbm, pitCut, terrainHeight, valueNoise } from "@/lib/twin/terrain";
import { useTwinStore } from "@/store/twinStore";
import { PALETTE } from "./materials";

/** 350x350 quads across 700m — 2m resolution over the site and the valley walls. */
const SEGMENTS = 350;

const C = {
  topsoil: new THREE.Color(PALETTE.topsoil),
  dirtLight: new THREE.Color(PALETTE.dirtLight),
  dirtDark: new THREE.Color(PALETTE.dirtDark),
  scrub: new THREE.Color(PALETTE.scrub),
  scrubDry: new THREE.Color(PALETTE.scrubDry),
  gravel: new THREE.Color(PALETTE.gravel),
  gravelDark: new THREE.Color(PALETTE.gravelDark),
  clay: new THREE.Color(PALETTE.clay),
  strataLight: new THREE.Color(PALETTE.strataLight),
  strataDark: new THREE.Color(PALETTE.strataDark),
  rock: new THREE.Color("#7d7468"),
  forest: new THREE.Color("#4d5634"),
  mountain: new THREE.Color("#6d7078"),
  mountainHaze: new THREE.Color("#8a93a0"),
  spoil: new THREE.Color("#8d7456"),
  crushed: new THREE.Color("#9a978f"),
  rom: new THREE.Color("#7a6a58"),
  wetClay: new THREE.Color("#4a3a2b"),
  bench: new THREE.Color("#a88f6b"),
};

/** Off-road machine routes, as segments, so repeated passes can wear ruts. */
const RUT_SEGMENTS = Object.values(MACHINE_ROUTES).flatMap((route) =>
  route.map((p, i) => {
    const q = route[(i + 1) % route.length];
    return { x1: p.x, z1: p.z, x2: q.x, z2: q.z };
  }),
);

function distanceToSegment(x: number, z: number, s: (typeof RUT_SEGMENTS)[number]): number {
  const dx = s.x2 - s.x1;
  const dz = s.z2 - s.z1;
  const len2 = dx * dx + dz * dz || 1;
  const t = Math.min(1, Math.max(0, ((x - s.x1) * dx + (z - s.z1) * dz) / len2));
  return Math.hypot(x - (s.x1 + dx * t), z - (s.z1 + dz * t));
}

function padInfluence(x: number, z: number): number {
  let best = 0;
  for (const p of PADS) {
    let d: number;
    if (p.shape === "rect") {
      const dx = Math.max(p.x - p.rx - x, 0, x - p.x - p.rx);
      const dz = Math.max(p.z - p.rz - z, 0, z - p.z - p.rz);
      d = Math.hypot(dx, dz);
    } else {
      d = (Math.hypot((x - p.x) / p.rx, (z - p.z) / p.rz) - 1) * Math.min(p.rx, p.rz);
    }
    if (d < 6) best = Math.max(best, 1 - smoothstep(-2, 5, d));
  }
  return best;
}

/** Which heap (if any) this point is on, for its material colour. */
function heapAt(x: number, z: number): { colour: THREE.Color; k: number } | null {
  for (let i = 0; i < MOUNDS.length; i++) {
    const m = MOUNDS[i];
    if (!m.cone) continue;
    const d = Math.hypot(x - m.x, z - m.z) / m.r;
    if (d >= 1.05) continue;
    const colour = i < 2 ? C.rom : i < 4 ? C.crushed : C.spoil;
    return { colour, k: 1 - smoothstep(0.85, 1.05, d) };
  }
  return null;
}

/** Colour of the ground at one vertex. `steep` is 0 flat .. 1 vertical. */
function surfaceColor(x: number, z: number, h: number, steep: number, out: THREE.Color) {
  // Natural ground: topsoil drifting toward dry grass and scrub.
  out.copy(C.topsoil);
  const patch = fbm(x * 0.028 + 3, z * 0.028 - 5, 3) * 0.5 + 0.5;
  out.lerp(C.scrubDry, patch * 0.45);

  const outside = distanceOutsideSite(x, z);
  const road = projectRoads(x, z);
  const pad = padInfluence(x, z);
  const pit = pitCut(x, z);
  const pondDist = Math.hypot((x - POND.x) / POND.rx, (z - POND.z) / POND.rz);
  const zone = zoneAt(x, z);

  // How much people and machines have worked this ground.
  const disturbed = Math.max(
    road.influence,
    pad,
    pit.into > 0 ? 1 : 0,
    zone ? 0.75 : 0,
  );

  // Vegetation survives where nobody drives. Much more of it on the valley walls.
  const growth = smoothstep(-0.15, 0.45, fbm(x * 0.045 - 11, z * 0.045 + 4, 3));
  const wild = Math.min(1, growth * 0.6 + smoothstep(0, 60, outside) * 0.8);
  out.lerp(C.scrub, wild * (1 - disturbed) * 0.75);
  if (outside > 25) out.lerp(C.forest, smoothstep(25, 120, outside) * 0.45 * growth);

  // Exposed rock on steep natural slopes.
  if (outside > 0 && steep > 0.25) out.lerp(C.rock, smoothstep(0.25, 0.6, steep) * 0.7);

  // Worked ground is bare, compacted and paler than the topsoil around it.
  out.lerp(C.dirtLight, disturbed * 0.45);

  // Pit: banded strata on the cut faces, compacted bench tops, wet clay floor.
  if (pit.into > 0) {
    const band = Math.sin(h * 3.1 + valueNoise(x * 0.06, z * 0.06) * 1.6) * 0.5 + 0.5;
    const face = C.strataDark.clone().lerp(C.strataLight, band);
    const faceWeight = smoothstep(0.12, 0.4, steep);
    out.lerp(C.bench, (1 - faceWeight) * 0.55);
    out.lerp(face, faceWeight);
    const floor = smoothstep(-PIT.depth + 0.7, -PIT.depth + 0.15, h);
    out.lerp(C.wetClay, floor * 0.6 * (0.6 + 0.4 * (valueNoise(x * 0.09, z * 0.09) * 0.5 + 0.5)));
  }

  // The tip head: loose spoil streaking down its faces.
  const dumpD = Math.hypot(x - DUMP.x, z - DUMP.z);
  if (dumpD < DUMP.r + 12) {
    const faces = smoothstep(DUMP.r - 2, DUMP.r + 3, dumpD) * (1 - smoothstep(DUMP.r + 6, DUMP.r + 12, dumpD));
    const streak = valueNoise(Math.atan2(z - DUMP.z, x - DUMP.x) * 14, dumpD * 0.2) * 0.5 + 0.5;
    out.lerp(C.spoil, faces * (0.55 + streak * 0.35));
  }

  // Stockpiles and tipped heaps show their material.
  const heap = heapAt(x, z);
  if (heap) out.lerp(heap.colour, heap.k * 0.9);

  // Trenches: freshly dug dark soil, spoil beside them.
  for (const t of TRENCHES) {
    const dugTo = t.x0 + (t.x1 - t.x0) * t.progress;
    if (x > t.x0 - 2 && x < dugTo + 2) {
      const dz = z - t.z;
      if (Math.abs(dz) < t.width) out.lerp(C.wetClay, 0.8);
      else if (dz < 0 && dz > -t.width / 2 - 5) out.lerp(C.spoil, 0.5);
    } else if (x >= dugTo + 2 && x < t.x1 && Math.abs(z - t.z) < 0.25) {
      // Pegged-out line still to dig.
      out.lerp(C.dirtLight, 0.6);
    }
  }

  // Dozer lanes across the pit floor and grader passes across zone C.
  const L = WORK_STATIONS.dozerLanes;
  if (x > L.x0 && x < L.x1 && z > L.z0 - 3 && z < L.z1 + 3) {
    const lane = Math.abs(((z - L.z0) % 5) - 2.5) / 2.5;
    out.lerp(C.dirtDark, (1 - lane) * 0.25);
  }
  const G = WORK_STATIONS.graderLanes;
  if (x > G.x0 && x < G.x1 && z > G.z0 - 3 && z < G.z1 + 3) {
    const pass = ((z - G.z0) % 7) / 7;
    out.lerp(C.dirtLight, smoothstep(0.8, 0.95, pass) * 0.35);
  }

  // Pond margins are mud.
  if (pondDist < 1.5) out.lerp(C.clay, (1 - smoothstep(0.7, 1.5, pondDist)) * 0.8);

  // Graded pads read as packed fill.
  out.lerp(C.gravelDark, pad * 0.5);

  // Road shoulders: loose gravel spill either side of the running surface.
  if (road.influence > 0.02) out.lerp(C.gravel, road.influence * 0.8);

  // Tyre ruts where the autonomous fleet repeatedly leaves the road.
  if (road.influence < 0.5 && outside === 0) {
    let rut = Infinity;
    for (const s of RUT_SEGMENTS) {
      rut = Math.min(rut, distanceToSegment(x, z, s));
      if (rut < 0.5) break;
    }
    if (rut < 3) out.lerp(C.dirtDark, (1 - smoothstep(0.6, 3, rut)) * 0.4 * (1 - road.influence));
  }

  // A light wash of the zone colour keeps the layout legible from above.
  if (zone && road.influence < 0.4) {
    out.lerp(new THREE.Color(zone.color), zone.kind === "restricted" ? 0.1 : 0.05);
  }

  // Fine grain, at a frequency the 2m grid can actually resolve (no moiré).
  out.offsetHSL(0, 0, valueNoise(x * 0.21, z * 0.21) * 0.025);
}

function buildGround(): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, SEGMENTS, SEGMENTS);
  geo.rotateX(-Math.PI / 2);

  const position = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    position.setY(i, terrainHeight(position.getX(i), position.getZ(i)));
  }
  geo.computeVertexNormals();

  // Colour pass after the normals exist, so steepness comes for free.
  const normal = geo.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const scratch = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const steep = 1 - Math.abs(normal.getY(i));
    surfaceColor(position.getX(i), position.getZ(i), position.getY(i), steep * 2.2, scratch);
    scratch.toArray(colors, i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

/* ------------------------------------------------------------------------ */
/*  Backdrop: rolling valley beyond the mesh, then a ring of mountains      */
/* ------------------------------------------------------------------------ */

const BACKDROP_INNER = TERRAIN_SIZE / 2 - 4;
const BACKDROP_OUTER = 2300;

function backdropHeight(x: number, z: number, r: number): number {
  // Continue the real valley walls, then lift into distant ranges.
  const near = terrainHeight(x, z);
  const range = smoothstep(650, 1350, r);
  const ridged = 1 - Math.abs(fbm(x * 0.0022 + 5, z * 0.0022 - 7, 5));
  return near + range * (60 + ridged * ridged * 260);
}

function buildBackdrop(): THREE.BufferGeometry {
  const geo = new THREE.RingGeometry(BACKDROP_INNER, BACKDROP_OUTER, 180, 48);
  geo.rotateX(-Math.PI / 2);

  const position = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const scratch = new THREE.Color();

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const r = Math.hypot(x, z);
    // Sunk slightly so the coarse ring never pokes through the detailed mesh.
    const y = backdropHeight(x, z, r) - 1.6;
    position.setY(i, y);

    scratch.copy(C.scrub).lerp(C.forest, smoothstep(0, 1, fbm(x * 0.01, z * 0.01, 3) * 0.5 + 0.5));
    scratch.lerp(C.mountain, smoothstep(700, 1300, r) * 0.8);
    scratch.lerp(C.rock, smoothstep(140, 260, y) * 0.5);
    scratch.lerp(C.mountainHaze, smoothstep(1300, 2200, r) * 0.6);
    scratch.toArray(colors, i * 3);
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function Backdrop() {
  const geometry = useMemo(buildBackdrop, []);
  return (
    <mesh geometry={geometry} receiveShadow={false}>
      <meshStandardMaterial vertexColors roughness={1} metalness={0} flatShading />
    </mesh>
  );
}

export function Terrain() {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const engine = useTwinStore((s) => s.engine);
  const geometry = useMemo(buildGround, []);

  // Rain darkens and slicks the ground.
  useFrame(() => {
    const m = materialRef.current;
    if (!m) return;
    const wet = engine.wetness;
    const shade = 1 - wet * 0.42;
    m.color.setRGB(shade, shade, shade * (1 - wet * 0.04));
    m.roughness = 0.96 - wet * 0.55;
    m.metalness = wet * 0.18;
  });

  return (
    <group>
      <mesh geometry={geometry} receiveShadow castShadow={false}>
        <meshStandardMaterial
          ref={materialRef}
          vertexColors
          roughness={0.96}
          metalness={0}
          dithering
        />
      </mesh>
      <Backdrop />
    </group>
  );
}
