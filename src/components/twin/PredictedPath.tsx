"use client";

/**
 * Five-second dead-reckoned trajectories, drawn as ground ribbons with an
 * arrowhead, plus a pulsing marker wherever two of them conflict.
 *
 * Geometry is allocated once and its vertex buffer is rewritten in place each
 * frame — no per-frame allocation, no React involvement.
 */

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { HORIZON, MOVING_THRESHOLD } from "@/lib/twin/collision";
import { terrainHeight } from "@/lib/twin/terrain";
import { headingVector } from "@/lib/twin/site";
import { useTwinStore } from "@/store/twinStore";
import { PALETTE } from "./materials";

const SAMPLES = 14;
const RIBBON_WIDTH = 1.4;

function buildRibbon(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array((SAMPLES + 1) * 2 * 3);
  const uvs = new Float32Array((SAMPLES + 1) * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    uvs[i * 4 + 0] = 0;
    uvs[i * 4 + 1] = t;
    uvs[i * 4 + 2] = 1;
    uvs[i * 4 + 3] = t;
    if (i < SAMPLES) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

export function PredictedPath({ machineId }: { machineId: string }) {
  const engine = useTwinStore((s) => s.engine);
  const geometry = useMemo(buildRibbon, []);
  const mesh = useRef<THREE.Mesh>(null);
  const arrow = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const arrowMat = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((state) => {
    const t = engine.telemetryOrPrimary(machineId);
    const moving = Math.abs(t.speed) > MOVING_THRESHOLD;

    if (mesh.current) mesh.current.visible = moving;
    if (arrow.current) arrow.current.visible = moving;
    if (!moving) return;

    const f = headingVector(t.heading);
    // Perpendicular in the ground plane, for the ribbon width.
    const px = -f.z;
    const pz = f.x;

    const position = geometry.attributes.position as THREE.BufferAttribute;
    const array = position.array as Float32Array;

    for (let i = 0; i <= SAMPLES; i++) {
      const frac = i / SAMPLES;
      const d = t.speed * HORIZON * frac;
      const cx = t.x + f.x * d;
      const cz = t.z + f.z * d;
      // Taper toward the far end so the ribbon reads as a direction, not a wall.
      const half = (RIBBON_WIDTH / 2) * (1 - frac * 0.45);
      const y = terrainHeight(cx, cz) + 0.16;

      const o = i * 6;
      array[o + 0] = cx - px * half;
      array[o + 1] = y;
      array[o + 2] = cz - pz * half;
      array[o + 3] = cx + px * half;
      array[o + 4] = y;
      array[o + 5] = cz + pz * half;
    }
    position.needsUpdate = true;
    geometry.computeBoundingSphere();

    // Arrowhead at the predicted position.
    if (arrow.current) {
      const d = t.speed * HORIZON;
      const ax = t.x + f.x * d;
      const az = t.z + f.z * d;
      arrow.current.position.set(ax, terrainHeight(ax, az) + 0.2, az);
      arrow.current.rotation.y = -t.heading;
    }

    // Conflicting machines flash; clear ones stay calm.
    const conflicted = engine
      .liveRisks()
      .some((r) => r.a === machineId || r.b === machineId);
    const flash = conflicted ? 0.45 + Math.sin(state.clock.elapsedTime * 9) * 0.35 : 0;
    const colour = conflicted ? PALETTE.crit : PALETTE.catYellow;

    if (material.current) {
      material.current.color.set(colour);
      material.current.opacity = 0.2 + flash * 0.5;
    }
    if (arrowMat.current) {
      arrowMat.current.color.set(colour);
      arrowMat.current.opacity = 0.55 + flash * 0.45;
    }
  });

  return (
    <group>
      <mesh ref={mesh} geometry={geometry} frustumCulled={false}>
        <meshBasicMaterial
          ref={material}
          transparent
          opacity={0.28}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* flat chevron marking the predicted position */}
      <mesh ref={arrow} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.9, 1.9, 3]} />
        <meshBasicMaterial
          ref={arrowMat}
          transparent
          opacity={0.7}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/** Pulsing markers at each predicted conflict point. */
export function CollisionMarkers() {
  const engine = useTwinStore((s) => s.engine);
  const slots = useRef<THREE.Group[]>([]);

  const register = (i: number) => (el: THREE.Group | null) => {
    if (el) slots.current[i] = el;
  };

  useFrame((state) => {
    const risks = engine.liveRisks();
    const t = state.clock.elapsedTime;

    for (let i = 0; i < slots.current.length; i++) {
      const slot = slots.current[i];
      if (!slot) continue;
      const risk = risks[i];
      slot.visible = Boolean(risk);
      if (!risk) continue;

      slot.position.set(risk.point[0], risk.point[1], risk.point[2]);
      const pulse = 1 + Math.sin(t * 7) * 0.16;
      slot.scale.setScalar(pulse);
      slot.rotation.y = t * 0.9;
    }
  });

  // Enough slots for every pair of four machines.
  return (
    <group>
      {Array.from({ length: 6 }, (_, i) => (
        <group key={i} ref={register(i)} visible={false}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[2.1, 2.7, 32]} />
            <meshBasicMaterial
              color={PALETTE.crit}
              transparent
              opacity={0.75}
              side={THREE.DoubleSide}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[0, 1.4, 0]}>
            <octahedronGeometry args={[0.7, 0]} />
            <meshBasicMaterial color={PALETTE.crit} transparent opacity={0.85} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** All machines' trajectories. */
export function PredictedPaths({ machineIds }: { machineIds: string[] }) {
  return (
    <group>
      {machineIds.map((id) => (
        <PredictedPath key={id} machineId={id} />
      ))}
      <CollisionMarkers />
    </group>
  );
}
