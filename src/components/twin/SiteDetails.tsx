"use client";

/**
 * Everything that makes the site read as a real operation rather than a test
 * pad: the crusher plant and its running conveyor, the sediment pond, the
 * perimeter fence and gate, the site compound, a power line, stacked stores,
 * and the rocks, scrub and trees that fill the valley.
 *
 * Repeated items are instanced and placed with a seeded RNG, so the layer costs
 * a couple of dozen draw calls and looks identical on every load. Nothing here
 * affects the simulation — placement checks keep all of it off roads, pads,
 * zones and the pit so no prop ever sits in a machine's path.
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  CRUSHER,
  DUMP,
  FENCE,
  MOUNDS,
  PADS,
  PIT,
  POND,
  TERRAIN_SIZE,
  projectRoads,
  zoneAt,
} from "@/lib/twin/site";
import { distanceOutsideSite, pitCut, terrainHeight } from "@/lib/twin/terrain";
import { useTwinStore } from "@/store/twinStore";
import { PALETTE, beltTexture, chainLinkTexture, hazardTexture, signTexture } from "./materials";

/* ------------------------------------------------------------------------ */
/*  Helpers                                                                 */
/* ------------------------------------------------------------------------ */

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** True where nothing may be placed: roads, pads, zones, pit, pond, heaps, dump. */
function isWorkedGround(x: number, z: number, margin = 0): boolean {
  if (projectRoads(x, z).influence > 0.02) return true;
  if (zoneAt(x, z)) return true;
  for (const p of PADS) {
    if (Math.abs(x - p.x) < p.rx + margin + 4 && Math.abs(z - p.z) < p.rz + margin + 4) return true;
  }
  if (pitCut(x, z).into > 0) return true;
  if (Math.hypot((x - POND.x) / POND.rx, (z - POND.z) / POND.rz) < 1.6) return true;
  if (Math.hypot(x - DUMP.x, z - DUMP.z) < DUMP.r + 14) return true;
  for (const m of MOUNDS) {
    if (m.cone && Math.hypot(x - m.x, z - m.z) < m.r + margin) return true;
  }
  return false;
}

/** Pit crest: the band just outside the top bench, where loose boulders collect. */
function onPitCrest(x: number, z: number): boolean {
  const f = PIT.floor;
  const dx = Math.max(f.x0 - x, 0, x - f.x1);
  const dz = Math.max(f.z0 - z, 0, z - f.z1);
  const d = Math.hypot(dx, dz);
  return d > PIT.wallWidth && d < PIT.wallWidth + 8;
}

function useInstances(
  ref: React.RefObject<THREE.InstancedMesh | null>,
  matrices: THREE.Matrix4[],
  colors?: THREE.Color[],
) {
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    if (colors) {
      colors.forEach((c, i) => mesh.setColorAt(i, c));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    mesh.computeBoundingSphere();
  }, [ref, matrices, colors]);
}

/* ------------------------------------------------------------------------ */
/*  Rocks, scrub and trees                                                  */
/* ------------------------------------------------------------------------ */

function Rocks() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { matrices, colors } = useMemo(() => {
    const rand = rng(1234);
    const dummy = new THREE.Object3D();
    const matrices: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];
    const half = TERRAIN_SIZE / 2 - 6;
    let tries = 0;
    while (matrices.length < 420 && tries++ < 9000) {
      const x = (rand() * 2 - 1) * half;
      const z = (rand() * 2 - 1) * half;
      if (isWorkedGround(x, z, 3)) continue;
      // Boulders collect on the valley walls and the pit crest.
      const outside = distanceOutsideSite(x, z);
      if (outside === 0 && !onPitCrest(x, z) && rand() > 0.35) continue;

      const s = (0.35 + rand() * rand() * (outside > 20 ? 2.6 : 1.3));
      dummy.position.set(x, terrainHeight(x, z) + s * 0.25, z);
      dummy.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      dummy.scale.set(s * (0.8 + rand() * 0.6), s * (0.55 + rand() * 0.4), s * (0.8 + rand() * 0.6));
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
      colors.push(new THREE.Color().setHSL(0.08 + rand() * 0.04, 0.12 + rand() * 0.1, 0.34 + rand() * 0.14));
    }
    return { matrices, colors };
  }, []);
  useInstances(ref, matrices, colors);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, matrices.length]} castShadow receiveShadow>
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial roughness={0.95} flatShading />
    </instancedMesh>
  );
}

function Scrub() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { matrices, colors } = useMemo(() => {
    const rand = rng(98765);
    const dummy = new THREE.Object3D();
    const matrices: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];
    const half = TERRAIN_SIZE / 2 - 4;
    let tries = 0;
    while (matrices.length < 900 && tries++ < 14000) {
      // Clumped: pick a clump centre, then scatter around it.
      const cx = (rand() * 2 - 1) * half;
      const cz = (rand() * 2 - 1) * half;
      for (let k = 0; k < 5 && matrices.length < 900; k++) {
        const x = cx + (rand() - 0.5) * 9;
        const z = cz + (rand() - 0.5) * 9;
        if (isWorkedGround(x, z, 2)) continue;
        const s = 0.5 + rand() * 1.1;
        dummy.position.set(x, terrainHeight(x, z) + s * 0.3, z);
        dummy.rotation.set(0, rand() * Math.PI * 2, 0);
        dummy.scale.set(s * 1.3, s * 0.75, s * 1.3);
        dummy.updateMatrix();
        matrices.push(dummy.matrix.clone());
        colors.push(new THREE.Color().setHSL(0.14 + rand() * 0.07, 0.28 + rand() * 0.15, 0.24 + rand() * 0.12));
      }
    }
    return { matrices, colors };
  }, []);
  useInstances(ref, matrices, colors);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, matrices.length]} castShadow receiveShadow>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial roughness={1} flatShading />
    </instancedMesh>
  );
}

function Trees() {
  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const crownRef = useRef<THREE.InstancedMesh>(null);
  const { trunks, crowns, crownColors } = useMemo(() => {
    const rand = rng(4242);
    const dummy = new THREE.Object3D();
    const trunks: THREE.Matrix4[] = [];
    const crowns: THREE.Matrix4[] = [];
    const crownColors: THREE.Color[] = [];
    const half = TERRAIN_SIZE / 2 - 4;
    let tries = 0;
    while (trunks.length < 360 && tries++ < 12000) {
      const x = (rand() * 2 - 1) * half;
      const z = (rand() * 2 - 1) * half;
      // Only beyond the fence line, thicker the further up the valley walls.
      const outside = distanceOutsideSite(x, z);
      if (outside < 6 || rand() > 0.25 + Math.min(outside / 90, 0.7)) continue;
      const y = terrainHeight(x, z);
      const h = 5 + rand() * 7;
      const lean = (rand() - 0.5) * 0.08;

      dummy.position.set(x, y + h * 0.22, z);
      dummy.rotation.set(lean, rand() * Math.PI, lean);
      dummy.scale.set(1, h * 0.44, 1);
      dummy.updateMatrix();
      trunks.push(dummy.matrix.clone());

      dummy.position.set(x, y + h * 0.62, z);
      const w = 1.6 + rand() * 1.6;
      dummy.scale.set(w, h * 0.7, w);
      dummy.updateMatrix();
      crowns.push(dummy.matrix.clone());
      crownColors.push(new THREE.Color().setHSL(0.2 + rand() * 0.07, 0.3 + rand() * 0.15, 0.2 + rand() * 0.1));
    }
    return { trunks, crowns, crownColors };
  }, []);
  useInstances(trunkRef, trunks);
  useInstances(crownRef, crowns, crownColors);

  return (
    <group>
      <instancedMesh ref={trunkRef} args={[undefined, undefined, trunks.length]} castShadow>
        <cylinderGeometry args={[0.12, 0.2, 1, 5]} />
        <meshStandardMaterial color="#4a3a2a" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={crownRef} args={[undefined, undefined, crowns.length]} castShadow receiveShadow>
        <coneGeometry args={[1, 1, 7]} />
        <meshStandardMaterial roughness={1} flatShading />
      </instancedMesh>
    </group>
  );
}

/* ------------------------------------------------------------------------ */
/*  Perimeter fence and gate                                                */
/* ------------------------------------------------------------------------ */

interface FenceRun {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

function fenceRuns(): FenceRun[] {
  const { x0, x1, z0, z1, gateZ, gateWidth } = FENCE;
  const g0 = gateZ - gateWidth / 2;
  const g1 = gateZ + gateWidth / 2;
  return [
    { ax: x0, az: z0, bx: x1, bz: z0 },
    { ax: x1, az: z0, bx: x1, bz: z1 },
    { ax: x1, az: z1, bx: x0, bz: z1 },
    // West side, opened for the gate.
    { ax: x0, az: z1, bx: x0, bz: g1 },
    { ax: x0, az: g0, bx: x0, bz: z0 },
  ];
}

const FENCE_HEIGHT = 2.2;
const POST_SPACING = 3;

function PerimeterFence() {
  const postRef = useRef<THREE.InstancedMesh>(null);
  const meshTex = useMemo(() => {
    const t = chainLinkTexture().clone();
    t.needsUpdate = true;
    return t;
  }, []);

  const { posts, panels } = useMemo(() => {
    const dummy = new THREE.Object3D();
    const posts: THREE.Matrix4[] = [];
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (const run of fenceRuns()) {
      const len = Math.hypot(run.bx - run.ax, run.bz - run.az);
      const n = Math.max(1, Math.round(len / POST_SPACING));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = run.ax + (run.bx - run.ax) * t;
        const z = run.az + (run.bz - run.az) * t;
        const y = terrainHeight(x, z);
        dummy.position.set(x, y + FENCE_HEIGHT / 2, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        posts.push(dummy.matrix.clone());

        // Mesh panel follows the ground post to post.
        const base = positions.length / 3;
        positions.push(x, y + 0.08, z, x, y + FENCE_HEIGHT - 0.1, z);
        uvs.push((t * len) / 1.6, 0, (t * len) / 1.6, FENCE_HEIGHT / 1.6);
        if (i < n) indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }

    const panels = new THREE.BufferGeometry();
    panels.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    panels.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    panels.setIndex(indices);
    panels.computeVertexNormals();
    return { posts, panels };
  }, []);
  useInstances(postRef, posts);

  return (
    <group>
      <instancedMesh ref={postRef} args={[undefined, undefined, posts.length]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, FENCE_HEIGHT, 5]} />
        <meshStandardMaterial color="#8d949a" metalness={0.6} roughness={0.5} />
      </instancedMesh>
      <mesh geometry={panels}>
        <meshStandardMaterial
          map={meshTex}
          transparent
          alphaTest={0.3}
          side={THREE.DoubleSide}
          metalness={0.4}
          roughness={0.6}
        />
      </mesh>
    </group>
  );
}

/** Gatehouse, boom barrier and entry signage on the west access road. */
function SiteGate() {
  const x = FENCE.x0;
  const z = FENCE.gateZ;
  const y = terrainHeight(x + 8, z);
  const stripes = useMemo(() => {
    const t = hazardTexture("#e0453c").clone();
    t.needsUpdate = true;
    t.repeat.set(6, 1);
    return t;
  }, []);
  const sign = useMemo(() => signTexture("SITE 07 · AUTHORISED ENTRY", "PPE · HI-VIS · HARD HAT", PALETTE.catYellow), []);
  const boom = useRef<THREE.Group>(null);
  const engine = useTwinStore((s) => s.engine);

  // The boom lifts for anything that comes within 25 m of the gate.
  useFrame((_, delta) => {
    const g = boom.current;
    if (!g) return;
    const near = engine
      .allTelemetry()
      .some((t) => Math.hypot(t.x - (x + 8), t.z - z) < 25);
    const target = near ? -1.3 : 0;
    g.rotation.z += (target - g.rotation.z) * (1 - Math.exp(-3 * delta));
  });

  return (
    <group>
      {/* gatehouse */}
      <group position={[x + 10, y, z - 12]}>
        <mesh position={[0, 1.4, 0]} castShadow receiveShadow>
          <boxGeometry args={[4, 2.8, 3.2]} />
          <meshStandardMaterial color="#dcd6c8" roughness={0.9} />
        </mesh>
        <mesh position={[0, 2.95, 0]} castShadow>
          <boxGeometry args={[4.6, 0.2, 3.8]} />
          <meshStandardMaterial color={PALETTE.steelDark} />
        </mesh>
        <mesh position={[0, 1.7, 1.61]}>
          <planeGeometry args={[3, 1]} />
          <meshStandardMaterial color={PALETTE.glass} emissive="#2a3f52" emissiveIntensity={0.5} roughness={0.2} />
        </mesh>
      </group>

      {/* boom barrier, pivoting at its post */}
      <group position={[x + 8, y, z - 7]}>
        <mesh position={[0, 0.6, 0]} castShadow>
          <boxGeometry args={[0.5, 1.2, 0.5]} />
          <meshStandardMaterial color="#e0453c" roughness={0.6} />
        </mesh>
        <group ref={boom} position={[0, 1.05, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <mesh position={[6.5, 0, 0]} castShadow>
            <boxGeometry args={[13, 0.14, 0.14]} />
            <meshStandardMaterial map={stripes} roughness={0.6} />
          </mesh>
        </group>
      </group>

      {/* entry sign */}
      <group position={[x + 16, terrainHeight(x + 16, z + 11), z + 11]} rotation={[0, -Math.PI / 2, 0]}>
        {[-1.5, 1.5].map((px) => (
          <mesh key={px} position={[px, 1.2, 0]} castShadow>
            <cylinderGeometry args={[0.08, 0.08, 2.4, 6]} />
            <meshStandardMaterial color={PALETTE.steel} />
          </mesh>
        ))}
        {[0, Math.PI].map((r) => (
          <mesh key={r} position={[0, 2.3, r ? -0.02 : 0.02]} rotation={[0, r, 0]}>
            <planeGeometry args={[4.4, 1.4]} />
            <meshStandardMaterial map={sign} roughness={0.7} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------------ */
/*  Crusher plant                                                           */
/* ------------------------------------------------------------------------ */

function Crusher() {
  const y = terrainHeight(CRUSHER.x, CRUSHER.z);
  const belt = useMemo(() => {
    const t = beltTexture().clone();
    t.needsUpdate = true;
    t.wrapT = THREE.RepeatWrapping;
    return t;
  }, []);
  const screen = useRef<THREE.Mesh>(null);

  const { mid, length, yaw, pitch, legs } = useMemo(() => {
    const ground = terrainHeight(CRUSHER.conveyorFrom.x, CRUSHER.conveyorFrom.z);
    const from = new THREE.Vector3(CRUSHER.conveyorFrom.x, ground + CRUSHER.conveyorFrom.y, CRUSHER.conveyorFrom.z);
    const to = new THREE.Vector3(CRUSHER.conveyorTo.x, ground + CRUSHER.conveyorTo.y, CRUSHER.conveyorTo.z);
    const dir = to.clone().sub(from);
    const length = dir.length();
    const legs = [1, 2, 3, 4].map((i) => from.clone().lerp(to, i / 5));
    return {
      mid: from.clone().add(to).multiplyScalar(0.5),
      length,
      yaw: Math.atan2(dir.x, dir.z),
      pitch: Math.asin(dir.y / length),
      legs,
    };
  }, []);

  belt.repeat.set(1, length / 2.5);

  // Belt runs; the vibrating screen shakes.
  useFrame((state, delta) => {
    belt.offset.y -= delta * 0.9;
    if (screen.current) {
      screen.current.position.y = 5.1 + Math.sin(state.clock.elapsedTime * 38) * 0.025;
    }
  });

  return (
    <group>
      <group position={[CRUSHER.x, y, CRUSHER.z]} rotation={[0, CRUSHER.rot, 0]}>
        {/* feed hopper */}
        <mesh position={[-5, 4.2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[3.2, 1.4, 3, 4, 1, true]} />
          <meshStandardMaterial color={PALETTE.catYellowDark} side={THREE.DoubleSide} roughness={0.7} metalness={0.3} />
        </mesh>
        {/* hopper frame */}
        {[
          [-7, -2],
          [-3, -2],
          [-7, 2],
          [-3, 2],
        ].map(([lx, lz], i) => (
          <mesh key={i} position={[lx, 1.4, lz]} castShadow>
            <boxGeometry args={[0.3, 2.8, 0.3]} />
            <meshStandardMaterial color={PALETTE.steel} metalness={0.5} roughness={0.6} />
          </mesh>
        ))}
        {/* jaw crusher body */}
        <mesh position={[0, 2.2, 0]} castShadow receiveShadow>
          <boxGeometry args={[4.2, 4.4, 3.4]} />
          <meshStandardMaterial color={PALETTE.catYellow} roughness={0.6} metalness={0.25} />
        </mesh>
        <mesh position={[0, 4.6, 0]} castShadow>
          <boxGeometry args={[4.6, 0.3, 3.8]} />
          <meshStandardMaterial color={PALETTE.steelDark} />
        </mesh>
        {/* flywheels */}
        {[-1.85, 1.85].map((fz) => (
          <mesh key={fz} position={[0.6, 2.8, fz]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[1.3, 1.3, 0.3, 20]} />
            <meshStandardMaterial color={PALETTE.steelDark} metalness={0.7} roughness={0.4} />
          </mesh>
        ))}
        {/* vibrating screen deck */}
        <mesh ref={screen} position={[5.5, 5.1, 0]} rotation={[0, 0, -0.18]} castShadow>
          <boxGeometry args={[5, 0.6, 3]} />
          <meshStandardMaterial color="#5f6b73" metalness={0.5} roughness={0.5} />
        </mesh>
        {[
          [3.6, -1.3],
          [7.4, -1.3],
          [3.6, 1.3],
          [7.4, 1.3],
        ].map(([lx, lz], i) => (
          <mesh key={i} position={[lx, 2.4, lz]} castShadow>
            <boxGeometry args={[0.3, 4.8, 0.3]} />
            <meshStandardMaterial color={PALETTE.steel} metalness={0.5} roughness={0.6} />
          </mesh>
        ))}
        {/* control cabin */}
        <mesh position={[-1, 1.3, -4.4]} castShadow receiveShadow>
          <boxGeometry args={[2.6, 2.6, 2]} />
          <meshStandardMaterial color="#dcd6c8" roughness={0.85} />
        </mesh>
        <mesh position={[-1, 1.6, -3.39]}>
          <planeGeometry args={[1.8, 0.8]} />
          <meshStandardMaterial color={PALETTE.glass} emissive="#2a3f52" emissiveIntensity={0.5} roughness={0.2} />
        </mesh>
      </group>

      {/* conveyor: belt, side stringers and trestle legs */}
      <group position={mid} rotation={[0, yaw, 0]}>
        <group rotation={[-pitch, 0, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[1.1, length]} />
            <meshStandardMaterial map={belt} roughness={0.9} />
          </mesh>
          {[-0.65, 0.65].map((sx) => (
            <mesh key={sx} position={[sx, 0.05, 0]} castShadow>
              <boxGeometry args={[0.12, 0.35, length]} />
              <meshStandardMaterial color={PALETTE.catYellowDark} metalness={0.3} roughness={0.6} />
            </mesh>
          ))}
        </group>
      </group>
      {legs.map((p, i) => {
        const gy = terrainHeight(p.x, p.z);
        const h = p.y - gy;
        return (
          <mesh key={i} position={[p.x, gy + h / 2, p.z]} castShadow>
            <boxGeometry args={[0.18, h, 1.3]} />
            <meshStandardMaterial color={PALETTE.steel} metalness={0.5} roughness={0.6} />
          </mesh>
        );
      })}
    </group>
  );
}

/* ------------------------------------------------------------------------ */
/*  Sediment pond                                                           */
/* ------------------------------------------------------------------------ */

function SedimentPond() {
  const water = useRef<THREE.MeshStandardMaterial>(null);
  const engine = useTwinStore((s) => s.engine);

  useFrame((state) => {
    const m = water.current;
    if (!m) return;
    // Rain roughens the surface; still water mirrors the sky.
    m.roughness = 0.08 + engine.wetness * 0.35 + Math.sin(state.clock.elapsedTime * 0.7) * 0.02;
  });

  return (
    <group>
      <mesh
        position={[POND.x, POND.waterY, POND.z]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[POND.rx * 1.05, POND.rz * 1.05, 1]}
      >
        <circleGeometry args={[1, 48]} />
        <meshStandardMaterial
          ref={water}
          color={PALETTE.water}
          metalness={0.35}
          roughness={0.1}
          transparent
          opacity={0.88}
        />
      </mesh>
      {/* dewatering pump on a pontoon, with its discharge line to the bank */}
      <group position={[POND.x - 3, POND.waterY + 0.25, POND.z + 2]}>
        <mesh castShadow>
          <boxGeometry args={[2.4, 0.5, 1.6]} />
          <meshStandardMaterial color="#e08b3c" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.55, 0]} castShadow>
          <boxGeometry args={[1.2, 0.7, 0.9]} />
          <meshStandardMaterial color={PALETTE.steelDark} roughness={0.6} metalness={0.4} />
        </mesh>
      </group>
      <mesh
        position={[POND.x - 12, POND.waterY + 0.35, POND.z + 2]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow
      >
        <cylinderGeometry args={[0.12, 0.12, 18, 8]} />
        <meshStandardMaterial color="#2a2d31" roughness={0.8} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------------ */
/*  Site compound by the gate                                               */
/* ------------------------------------------------------------------------ */

const PORTACABINS: [number, number, number, number][] = [
  // x, z, rotation, storey
  [-190, 114, 0, 0],
  [-190, 114, 0, 1],
  [-178, 114, 0, 0],
  [-178, 114, 0, 1],
];

const PICKUPS: [number, number, number, string][] = [
  [-185, 142, 0.02, "#f2f2ee"],
  [-182, 142, 0.02, "#f2f2ee"],
  [-179, 142, -0.02, "#c9ccd0"],
  [-176, 142, 0.01, "#f2f2ee"],
  [-173, 142, 0.03, "#2c3e57"],
];

function Pickup({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, 0.85, 0]} castShadow>
        <boxGeometry args={[5.2, 0.8, 1.9]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.4} />
      </mesh>
      <mesh position={[0.6, 1.55, 0]} castShadow>
        <boxGeometry args={[2.2, 0.75, 1.8]} />
        <meshStandardMaterial color={PALETTE.glass} roughness={0.15} metalness={0.3} />
      </mesh>
      {/* beacon, mandatory on site vehicles */}
      <mesh position={[1.1, 2.0, 0]}>
        <boxGeometry args={[0.3, 0.14, 0.3]} />
        <meshStandardMaterial color="#ff9d00" emissive="#ff9d00" emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      {[-1.7, 1.7].flatMap((wx) =>
        [-0.95, 0.95].map((wz) => (
          <mesh key={`${wx}${wz}`} position={[wx, 0.42, wz]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.42, 0.42, 0.3, 12]} />
            <meshStandardMaterial color="#141517" roughness={0.9} />
          </mesh>
        )),
      )}
    </group>
  );
}

function Windsock() {
  const sock = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (sock.current) sock.current.rotation.y = 0.6 + Math.sin(state.clock.elapsedTime * 0.4) * 0.35;
  });
  const x = -200;
  const z = 104;
  const y = terrainHeight(x, z);
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 3.5, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.08, 7, 6]} />
        <meshStandardMaterial color={PALETTE.steel} />
      </mesh>
      <group ref={sock} position={[0, 6.8, 0]}>
        <mesh position={[0, 0, 1.1]} rotation={[Math.PI / 2 + 0.2, 0, 0]}>
          <cylinderGeometry args={[0.35, 0.18, 2.2, 10, 1, true]} />
          <meshStandardMaterial color="#ff6a1a" side={THREE.DoubleSide} roughness={0.8} />
        </mesh>
      </group>
    </group>
  );
}

function Compound() {
  const muster = useMemo(() => signTexture("MUSTER POINT", "EMERGENCY ASSEMBLY", "#3ddc84"), []);
  return (
    <group>
      {PORTACABINS.map(([x, z, rot, storey], i) => {
        const y = terrainHeight(x, z) + storey * 2.9;
        return (
          <group key={i} position={[x, y, z]} rotation={[0, rot, 0]}>
            <mesh position={[0, 1.45, 0]} castShadow receiveShadow>
              <boxGeometry args={[10, 2.9, 3]} />
              <meshStandardMaterial color={storey ? "#cfd6dc" : "#dcd6c8"} roughness={0.85} />
            </mesh>
            {[-3, 0, 3].map((wx) => (
              <mesh key={wx} position={[wx, 1.7, 1.51]}>
                <planeGeometry args={[1.5, 0.9]} />
                <meshStandardMaterial color={PALETTE.glass} emissive="#2a3f52" emissiveIntensity={0.5} roughness={0.2} />
              </mesh>
            ))}
            <mesh position={[0, 2.95, 0]} castShadow>
              <boxGeometry args={[10.2, 0.1, 3.2]} />
              <meshStandardMaterial color={PALETTE.steelDark} />
            </mesh>
          </group>
        );
      })}
      {/* external stair to the upper cabins */}
      <mesh position={[-196.2, terrainHeight(-196.2, 110) + 1.45, 110]} rotation={[0.55, 0, 0]} castShadow>
        <boxGeometry args={[1.2, 0.15, 6]} />
        <meshStandardMaterial color={PALETTE.catYellowDark} metalness={0.4} roughness={0.6} />
      </mesh>

      {PICKUPS.map(([x, z, rot, color], i) => (
        <group key={i} position={[x, terrainHeight(x, z), z]} rotation={[0, rot + Math.PI / 2, 0]}>
          <Pickup color={color} />
        </group>
      ))}

      {/* parking bay lines */}
      {[-186.5, -183.5, -180.5, -177.5, -174.5, -171.5].map((px) => (
        <mesh key={px} position={[px, terrainHeight(px, 142) + 0.06, 142]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.15, 6]} />
          <meshStandardMaterial color="#e8e4d4" />
        </mesh>
      ))}

      {/* muster point */}
      <group position={[-200, terrainHeight(-200, 150), 150]}>
        <mesh position={[0, 1.2, 0]}>
          <cylinderGeometry args={[0.07, 0.07, 2.4, 6]} />
          <meshStandardMaterial color={PALETTE.steel} />
        </mesh>
        {[0, Math.PI].map((r) => (
          <mesh key={r} position={[0, 2.5, r ? -0.02 : 0.02]} rotation={[0, r, 0]}>
            <planeGeometry args={[2.8, 0.9]} />
            <meshStandardMaterial map={muster} />
          </mesh>
        ))}
      </group>

      {/* water tank on a stand */}
      <group position={[-201, terrainHeight(-201, 122), 122]}>
        {[
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ].map(([lx, lz], i) => (
          <mesh key={i} position={[lx, 2, lz]} castShadow>
            <boxGeometry args={[0.18, 4, 0.18]} />
            <meshStandardMaterial color={PALETTE.steel} />
          </mesh>
        ))}
        <mesh position={[0, 5.1, 0]} castShadow>
          <cylinderGeometry args={[1.6, 1.6, 2.4, 18]} />
          <meshStandardMaterial color="#2f6b8a" roughness={0.6} />
        </mesh>
      </group>

      <Windsock />
    </group>
  );
}

/* ------------------------------------------------------------------------ */
/*  Power line along the north boundary                                     */
/* ------------------------------------------------------------------------ */

function PowerLine() {
  const { poles, wires } = useMemo(() => {
    const poles: [number, number, number][] = [];
    const z = FENCE.z0 - 14;
    for (let x = FENCE.x0 - 10; x <= FENCE.x1 + 10; x += 42) {
      poles.push([x, terrainHeight(x, z), z]);
    }
    // Three conductors, each sagging between poles.
    const positions: number[] = [];
    for (const off of [-1.3, 0, 1.3]) {
      for (let i = 0; i < poles.length - 1; i++) {
        const [ax, ay, az] = poles[i];
        const [bx, by] = poles[i + 1];
        const steps = 10;
        for (let s = 0; s < steps; s++) {
          for (const t of [s / steps, (s + 1) / steps]) {
            const sag = Math.sin(t * Math.PI) * 1.6;
            positions.push(ax + (bx - ax) * t, ay + (by - ay) * t + 10.2 - sag, az + off);
          }
        }
      }
    }
    const wires = new THREE.BufferGeometry();
    wires.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return { poles, wires };
  }, []);

  return (
    <group>
      {poles.map(([x, y, z], i) => (
        <group key={i} position={[x, y, z]}>
          <mesh position={[0, 5.4, 0]} castShadow>
            <cylinderGeometry args={[0.14, 0.2, 10.8, 7]} />
            <meshStandardMaterial color="#5c4a38" roughness={1} />
          </mesh>
          <mesh position={[0, 10.3, 0]} castShadow>
            <boxGeometry args={[0.18, 0.18, 3.2]} />
            <meshStandardMaterial color="#5c4a38" roughness={1} />
          </mesh>
        </group>
      ))}
      <lineSegments geometry={wires}>
        <lineBasicMaterial color="#1f2124" />
      </lineSegments>
    </group>
  );
}

/* ------------------------------------------------------------------------ */
/*  Stores yard: concrete pipes, pallets and jersey barriers                */
/* ------------------------------------------------------------------------ */

function StoresYard() {
  const pipeRef = useRef<THREE.InstancedMesh>(null);
  const palletRef = useRef<THREE.InstancedMesh>(null);
  const barrierRef = useRef<THREE.InstancedMesh>(null);

  const { pipes, pallets, barriers } = useMemo(() => {
    const dummy = new THREE.Object3D();
    const pipes: THREE.Matrix4[] = [];
    const pallets: THREE.Matrix4[] = [];
    const barriers: THREE.Matrix4[] = [];

    // Pyramid stack of concrete pipes behind the maintenance bay.
    const px = 86;
    const pz = 150;
    const gy = terrainHeight(px, pz);
    const rows = [4, 3, 2];
    rows.forEach((count, row) => {
      for (let i = 0; i < count; i++) {
        dummy.position.set(px, gy + 0.6 + row * 1.04, pz + (i - (count - 1) / 2) * 1.22);
        dummy.rotation.set(0, 0, Math.PI / 2);
        dummy.updateMatrix();
        pipes.push(dummy.matrix.clone());
      }
    });

    // Pallets of materials.
    for (let i = 0; i < 8; i++) {
      const x = 84 + (i % 4) * 2.2;
      const z = 160 + Math.floor(i / 4) * 2.4;
      dummy.position.set(x, terrainHeight(x, z) + 0.5, z);
      dummy.rotation.set(0, (i * 0.37) % 0.3, 0);
      dummy.updateMatrix();
      pallets.push(dummy.matrix.clone());
    }

    // Jersey barriers along the pit's east crest, above zone B's work.
    const crestX = PIT.floor.x1 + PIT.wallWidth + 5;
    for (let i = 0; i < 12; i++) {
      const z = PIT.floor.z0 + 6 + i * 3.8;
      dummy.position.set(crestX, terrainHeight(crestX, z) + 0.42, z);
      dummy.rotation.set(0, Math.PI / 2, 0);
      dummy.updateMatrix();
      barriers.push(dummy.matrix.clone());
    }
    return { pipes, pallets, barriers };
  }, []);
  useInstances(pipeRef, pipes);
  useInstances(palletRef, pallets);
  useInstances(barrierRef, barriers);

  return (
    <group>
      <instancedMesh ref={pipeRef} args={[undefined, undefined, pipes.length]} castShadow receiveShadow>
        <cylinderGeometry args={[0.6, 0.6, 2.4, 16, 1, true]} />
        <meshStandardMaterial color={PALETTE.concrete} roughness={0.95} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={palletRef} args={[undefined, undefined, pallets.length]} castShadow receiveShadow>
        <boxGeometry args={[1.8, 1, 1.8]} />
        <meshStandardMaterial color="#9a8a6a" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={barrierRef} args={[undefined, undefined, barriers.length]} castShadow receiveShadow>
        <boxGeometry args={[3.6, 0.84, 0.6]} />
        <meshStandardMaterial color={PALETTE.concrete} roughness={0.95} />
      </instancedMesh>
    </group>
  );
}

export function SiteDetails() {
  return (
    <group>
      <Rocks />
      <Scrub />
      <Trees />
      <PerimeterFence />
      <SiteGate />
      <Crusher />
      <SedimentPond />
      <Compound />
      <PowerLine />
      <StoresYard />
    </group>
  );
}
