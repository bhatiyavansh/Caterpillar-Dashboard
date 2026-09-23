"use client";

/**
 * TRK001 — CAT 745 style articulated haul truck.
 *
 * The bed tips when the truck drops its load at the stockpile, driven entirely
 * by the reported payload falling to zero.
 */

import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { MachineTelemetry } from "@/types/twin";
import { PALETTE } from "./materials";
import { useChassis, useRunningGear } from "./chassis";
import { damp } from "@/lib/twin/vehicle";

const WHEELS: [number, number][] = [
  [-1.45, -2.6],
  [1.45, -2.6],
  [-1.45, 1.5],
  [1.45, 1.5],
  [-1.45, 3.1],
  [1.45, 3.1],
];

export function Truck({ telemetry }: { telemetry: MachineTelemetry }) {
  const { root, tilt } = useChassis(telemetry);
  const { register } = useRunningGear(telemetry, 0.28);
  const bed = useRef<THREE.Group>(null);
  const load = useRef<THREE.Mesh>(null);
  const tipping = useRef(0);

  useFrame((_, delta) => {
    if (!bed.current) return;
    // Empty and stationary at a dump point reads as "tipping".
    const shouldTip = telemetry.payload < 200 && Math.abs(telemetry.speed) < 0.3;
    tipping.current = damp(tipping.current, shouldTip ? 1 : 0, 1.4, delta);
    bed.current.rotation.x = -tipping.current * 0.62;

    // Toggled imperatively: this component never re-renders, because telemetry
    // is a stable object mutated in place rather than React state.
    if (load.current) load.current.visible = telemetry.payload > 200;
  });

  return (
    <group ref={root}>
      <group ref={tilt}>
        {/* wheels */}
        {WHEELS.map(([x, z]) => (
          <group key={`${x}:${z}`} ref={register} position={[x, 0.95, z]}>
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.95, 0.95, 0.68, 16]} />
              <meshStandardMaterial color={PALETTE.track} roughness={0.95} />
            </mesh>
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.44, 0.44, 0.72, 12]} />
              <meshStandardMaterial color={PALETTE.steelDark} roughness={0.7} metalness={0.5} />
            </mesh>
          </group>
        ))}

        {/* tractor chassis */}
        <mesh position={[0, 1.15, -1.9]} castShadow receiveShadow>
          <boxGeometry args={[2.6, 0.9, 3.4]} />
          <meshStandardMaterial color={PALETTE.catYellow} roughness={0.6} metalness={0.25} />
        </mesh>
        {/* bonnet */}
        <mesh position={[0, 1.75, -3.2]} castShadow>
          <boxGeometry args={[2.3, 0.85, 1.5]} />
          <meshStandardMaterial color={PALETTE.catYellow} roughness={0.6} metalness={0.25} />
        </mesh>
        {/* cab */}
        <mesh position={[0, 2.35, -1.9]} castShadow>
          <boxGeometry args={[2.0, 1.5, 1.7]} />
          <meshStandardMaterial
            color={PALETTE.glass}
            roughness={0.1}
            metalness={0.1}
            transparent
            opacity={0.6}
          />
        </mesh>
        <mesh position={[0, 3.14, -1.9]} castShadow>
          <boxGeometry args={[2.15, 0.12, 1.85]} />
          <meshStandardMaterial color={PALETTE.steelDark} roughness={0.8} />
        </mesh>

        {/* hitch */}
        <mesh position={[0, 1.05, -0.1]} castShadow>
          <cylinderGeometry args={[0.4, 0.4, 0.8, 12]} />
          <meshStandardMaterial color={PALETTE.steelDark} roughness={0.7} metalness={0.5} />
        </mesh>
        {/* rear frame */}
        <mesh position={[0, 1.0, 2.3]} castShadow>
          <boxGeometry args={[2.2, 0.5, 4.0]} />
          <meshStandardMaterial color={PALETTE.steel} roughness={0.85} metalness={0.35} />
        </mesh>

        {/* dump bed, hinged at the rear */}
        <group ref={bed} position={[0, 1.35, 3.9]}>
          <group position={[0, 0.45, -1.9]}>
            {/* floor */}
            <mesh castShadow receiveShadow>
              <boxGeometry args={[2.9, 0.22, 4.6]} />
              <meshStandardMaterial
                color={PALETTE.catYellow}
                roughness={0.6}
                metalness={0.3}
              />
            </mesh>
            {/* side walls */}
            {[-1.45, 1.45].map((x) => (
              <mesh key={x} position={[x, 0.62, 0]} castShadow>
                <boxGeometry args={[0.2, 1.05, 4.6]} />
                <meshStandardMaterial
                  color={PALETTE.catYellow}
                  roughness={0.6}
                  metalness={0.3}
                />
              </mesh>
            ))}
            {/* headboard */}
            <mesh position={[0, 0.85, -2.3]} castShadow>
              <boxGeometry args={[2.9, 1.5, 0.2]} />
              <meshStandardMaterial
                color={PALETTE.catYellow}
                roughness={0.6}
                metalness={0.3}
              />
            </mesh>
            {/* load — visibility driven from telemetry in useFrame */}
            <mesh ref={load} position={[0, 0.52, 0.1]} castShadow>
              <boxGeometry args={[2.5, 0.72, 4.0]} />
              <meshStandardMaterial color={PALETTE.dirtDark} roughness={1} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}
