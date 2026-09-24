"use client";

/**
 * Static set dressing: containers, site office, fuel tanks, lighting masts,
 * cones and spoil heaps.
 *
 * Repeated items are instanced, so the whole layer costs a handful of draw
 * calls regardless of how much clutter is on screen.
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { PIT, RAMP_TOP, STATIC_PROPS, TRENCHES } from "@/lib/twin/site";
import { terrainHeight } from "@/lib/twin/terrain";
import { PALETTE, hazardTexture } from "./materials";

/* ----------------------------- cones ---------------------------------- */

function coneTransforms(): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();
  const place = (x: number, z: number, a: number) => {
    dummy.position.set(x, terrainHeight(x, z) + 0.38, z);
    dummy.rotation.set(0, a, 0);
    dummy.updateMatrix();
    out.push(dummy.matrix.clone());
  };

  // Along the pit crest, a couple of metres back from the edge.
  const f = PIT.floor;
  const o = PIT.wallWidth + 2.5;
  const x0 = f.x0 - o;
  const x1 = f.x1 + o;
  const z0 = f.z0 - o;
  const z1 = f.z1 + o;
  const step = 7;
  const edge = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    for (let d = 0; d < len; d += step) {
      const x = ax + ((bx - ax) * d) / len;
      const z = az + ((bz - az) * d) / len;
      // Leave the ramp mouth open.
      if (Math.hypot(x - RAMP_TOP.x, z - RAMP_TOP.z) < 16) continue;
      place(x, z, d);
    }
  };
  edge(x0, z0, x1, z0);
  edge(x1, z0, x1, z1);
  edge(x1, z1, x0, z1);
  edge(x0, z1, x0, z0);

  // Pegging out the trench runs still to be dug.
  for (const t of TRENCHES) {
    const dugTo = t.x0 + (t.x1 - t.x0) * t.progress;
    for (let x = dugTo + 3; x <= t.x1; x += 4) place(x, t.z + 1.6, x);
    // and guarding the open trench
    for (let x = t.x0; x <= dugTo; x += 5) place(x, t.z + 2.2, x);
  }
  return out;
}

function Cones() {
  const transforms = useMemo(coneTransforms, []);
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    transforms.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
  }, [transforms]);

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, transforms.length]}
      castShadow
      frustumCulled={false}
    >
      <coneGeometry args={[0.32, 0.78, 8]} />
      <meshStandardMaterial
        color={PALETTE.worker}
        roughness={0.7}
        emissive={PALETTE.worker}
        emissiveIntensity={0.18}
      />
    </instancedMesh>
  );
}

/* --------------------------- containers -------------------------------- */

function Containers() {
  return (
    <group>
      {STATIC_PROPS.containers.map((c, i) => {
        const y = terrainHeight(c.x, c.z);
        return (
          <group key={i} position={[c.x, y, c.z]} rotation={[0, c.rot, 0]}>
            <mesh position={[0, 1.3, 0]} castShadow receiveShadow>
              <boxGeometry args={[6.1, 2.6, 2.44]} />
              <meshStandardMaterial color={c.color} roughness={0.85} metalness={0.25} />
            </mesh>
            {/* corrugation suggestion */}
            <mesh position={[0, 2.63, 0]} castShadow>
              <boxGeometry args={[6.15, 0.08, 2.5]} />
              <meshStandardMaterial color="#1a1d21" roughness={0.9} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/* ---------------------------- site office ------------------------------ */

function SiteOffice() {
  const { x, z, rot } = STATIC_PROPS.office;
  const y = terrainHeight(x, z);

  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]}>
      <mesh position={[0, 1.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[9, 3, 4.2]} />
        <meshStandardMaterial color="#d8d3c6" roughness={0.9} />
      </mesh>
      {/* roof */}
      <mesh position={[0, 3.1, 0]} castShadow>
        <boxGeometry args={[9.4, 0.22, 4.6]} />
        <meshStandardMaterial color={PALETTE.steelDark} roughness={0.85} />
      </mesh>
      {/* windows */}
      {[-2.6, 0, 2.6].map((wx) => (
        <mesh key={wx} position={[wx, 1.8, -2.12]}>
          <planeGeometry args={[1.8, 1.0]} />
          <meshStandardMaterial
            color={PALETTE.glass}
            roughness={0.15}
            metalness={0.2}
            emissive="#2a3f52"
            emissiveIntensity={0.5}
          />
        </mesh>
      ))}
      {/* steps */}
      <mesh position={[3.4, 0.22, -2.4]} castShadow>
        <boxGeometry args={[1.6, 0.44, 0.9]} />
        <meshStandardMaterial color={PALETTE.steel} roughness={0.9} />
      </mesh>
    </group>
  );
}

/* ---------------------------- fuel station ----------------------------- */

function FuelStation() {
  return (
    <group>
      {STATIC_PROPS.fuelTanks.map((t, i) => {
        const y = terrainHeight(t.x, t.z);
        return (
          <group key={i} position={[t.x, y, t.z]}>
            {/* horizontal tank on cradles */}
            <mesh position={[0, 1.5, 0]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
              <cylinderGeometry args={[1.1, 1.1, 5.2, 18]} />
              <meshStandardMaterial
                color={i === 0 ? "#b9bec4" : "#7f8790"}
                roughness={0.5}
                metalness={0.65}
              />
            </mesh>
            {[-1.8, 1.8].map((cx) => (
              <mesh key={cx} position={[cx, 0.4, 0]} castShadow>
                <boxGeometry args={[0.5, 0.8, 1.9]} />
                <meshStandardMaterial color={PALETTE.steel} roughness={0.9} />
              </mesh>
            ))}
            {/* hazard placard */}
            <mesh position={[0, 1.6, 1.15]}>
              <planeGeometry args={[1.0, 0.7]} />
              <meshStandardMaterial
                color={PALETTE.catYellow}
                emissive={PALETTE.catYellowDark}
                emissiveIntensity={0.4}
                roughness={0.7}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/* ---------------------------- light masts ------------------------------ */

function LightMasts() {
  return (
    <group>
      {STATIC_PROPS.lightMasts.map((m, i) => {
        const y = terrainHeight(m.x, m.z);
        return (
          <group key={i} position={[m.x, y, m.z]}>
            {/* base */}
            <mesh position={[0, 0.25, 0]} castShadow>
              <boxGeometry args={[1.2, 0.5, 1.2]} />
              <meshStandardMaterial color={PALETTE.steelDark} roughness={0.9} />
            </mesh>
            {/* mast */}
            <mesh position={[0, 5, 0]} castShadow>
              <cylinderGeometry args={[0.12, 0.2, 9.5, 8]} />
              <meshStandardMaterial color={PALETTE.steel} roughness={0.75} metalness={0.5} />
            </mesh>
            {/* head */}
            <mesh position={[0, 9.9, 0]} castShadow>
              <boxGeometry args={[2.2, 0.3, 0.7]} />
              <meshStandardMaterial color={PALETTE.steelDark} roughness={0.8} />
            </mesh>
            {[-0.7, 0, 0.7].map((lx) => (
              <mesh key={lx} position={[lx, 9.7, 0]}>
                <boxGeometry args={[0.55, 0.22, 0.5]} />
                <meshStandardMaterial
                  color="#fff4d0"
                  emissive="#ffe9a8"
                  emissiveIntensity={1.8}
                  toneMapped={false}
                />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

/* --------------------------- barrier run ------------------------------- */

function HaulRoadBarriers() {
  const texture = useMemo(() => {
    const t = hazardTexture(PALETTE.catYellow);
    t.repeat.set(3, 1);
    return t;
  }, []);

  // Barrier runs either side of the pit ramp mouth.
  const panels = useMemo(() => {
    const out: [number, number][] = [];
    for (let i = 0; i < 4; i++) out.push([RAMP_TOP.x - 10 - i * 3.4, RAMP_TOP.z - 4]);
    for (let i = 0; i < 4; i++) out.push([RAMP_TOP.x + 10 + i * 3.4, RAMP_TOP.z - 4]);
    return out;
  }, []);

  return (
    <group>
      {panels.map(([x, z], i) => (
        <mesh key={i} position={[x, terrainHeight(x, z) + 0.5, z]} castShadow>
          <boxGeometry args={[3.2, 1.0, 0.14]} />
          <meshStandardMaterial map={texture} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

export function SiteProps() {
  return (
    <group>
      <Cones />
      <Containers />
      <SiteOffice />
      <FuelStation />
      <LightMasts />
      <HaulRoadBarriers />
    </group>
  );
}
