"use client";

/**
 * The proximity bubble that follows EXC001.
 *
 * Outer wall sits at the warning radius, the inner ring at the critical radius.
 * Colour and pulse come straight from `telemetry.nearestPerson`, so the bubble
 * is a pure read of the same number the HUD shows.
 */

import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { MachineTelemetry } from "@/types/twin";
import { LEVEL_COLORS, PROXIMITY, proximityLevel } from "@/lib/twin/proximity";

const WALL_HEIGHT = 4.2;

export function SafetyBubble({ telemetry }: { telemetry: MachineTelemetry }) {
  const group = useRef<THREE.Group>(null);
  const wallMat = useRef<THREE.MeshBasicMaterial>(null);
  const floorMat = useRef<THREE.MeshBasicMaterial>(null);
  const outerMat = useRef<THREE.MeshBasicMaterial>(null);
  const innerMat = useRef<THREE.MeshBasicMaterial>(null);
  const colour = useRef(new THREE.Color(LEVEL_COLORS.safe));

  useFrame((state) => {
    const g = group.current;
    if (!g) return;

    const t = telemetry;
    g.position.set(t.x, t.y + 0.06, t.z);

    const level = proximityLevel(t.nearestPerson);
    // Ease between levels so the transition green -> amber -> red is visible.
    colour.current.lerp(new THREE.Color(LEVEL_COLORS[level]), 0.12);

    const time = state.clock.elapsedTime;
    const pulse =
      level === "critical"
        ? 0.5 + Math.sin(time * 8) * 0.5
        : level === "warning"
          ? 0.5 + Math.sin(time * 3.4) * 0.5
          : 0;

    if (wallMat.current) {
      wallMat.current.color.copy(colour.current);
      wallMat.current.opacity = 0.05 + pulse * 0.1 + (level === "safe" ? 0.02 : 0.04);
    }
    if (floorMat.current) {
      floorMat.current.color.copy(colour.current);
      floorMat.current.opacity = 0.05 + pulse * 0.07;
    }
    if (outerMat.current) {
      outerMat.current.color.copy(colour.current);
      outerMat.current.opacity = 0.4 + pulse * 0.45;
    }
    if (innerMat.current) {
      innerMat.current.color.copy(colour.current);
      innerMat.current.opacity = level === "safe" ? 0.22 : 0.35 + pulse * 0.5;
    }
  });

  return (
    <group ref={group}>
      {/* cylinder wall at the warning radius */}
      <mesh position={[0, WALL_HEIGHT / 2, 0]}>
        <cylinderGeometry args={[PROXIMITY.warning, PROXIMITY.warning, WALL_HEIGHT, 48, 1, true]} />
        <meshBasicMaterial
          ref={wallMat}
          transparent
          opacity={0.07}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* translucent floor disc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[PROXIMITY.warning, 48]} />
        <meshBasicMaterial
          ref={floorMat}
          transparent
          opacity={0.06}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* outer boundary */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[PROXIMITY.warning - 0.22, PROXIMITY.warning, 64]} />
        <meshBasicMaterial
          ref={outerMat}
          transparent
          opacity={0.5}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* critical radius */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[PROXIMITY.critical - 0.18, PROXIMITY.critical, 56]} />
        <meshBasicMaterial
          ref={innerMat}
          transparent
          opacity={0.3}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
