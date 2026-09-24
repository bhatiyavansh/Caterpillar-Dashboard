"use client";

/**
 * WHL001 — CAT 966M style wheel loader.
 *
 * The bucket lifts and tips with the reported payload, so a loaded machine
 * visibly carries its bucket high on the way to the truck.
 */

import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { MachineTelemetry } from "@/types/twin";
import { PALETTE } from "./materials";
import { useChassis, useRunningGear } from "./chassis";
import { damp } from "@/lib/twin/vehicle";
import { InternalBox, InternalTube, useXray } from "./xray";

const WHEEL_POSITIONS: [number, number][] = [
  [-1.25, -1.7],
  [1.25, -1.7],
  [-1.25, 1.75],
  [1.25, 1.75],
];

export function Loader({ telemetry }: { telemetry: MachineTelemetry }) {
  const { root, tilt } = useChassis(telemetry);
  const { register } = useRunningGear(telemetry, 0.3);
  const arms = useRef<THREE.Group>(null);
  const { handlers } = useXray(telemetry.machineId, root);

  useFrame((_, delta) => {
    if (!arms.current) return;
    // Carry the bucket high when loaded, low when empty.
    const loaded = telemetry.payload > 500 ? 1 : 0;
    arms.current.rotation.x = damp(arms.current.rotation.x, loaded * 0.42, 2.2, delta);
  });

  return (
    <group ref={root} {...handlers}>
      <group ref={tilt}>
        {/* wheels */}
        {WHEEL_POSITIONS.map(([x, z]) => (
          <group key={`${x}:${z}`} ref={register} position={[x, 0.82, z]} userData={{ part: "undercarriage" }}>
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.82, 0.82, 0.6, 16]} />
              <meshStandardMaterial color={PALETTE.track} roughness={0.95} />
            </mesh>
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.4, 0.4, 0.64, 12]} />
              <meshStandardMaterial
                color={PALETTE.catYellowDark}
                roughness={0.6}
                metalness={0.4}
              />
            </mesh>
          </group>
        ))}

        {/* X-ray internals */}
        <InternalBox part="engine" position={[0, 1.25, 2.0]} size={[1.4, 0.9, 1.6]} />
        <InternalBox part="hydraulic_pump" position={[0.55, 1.1, 0.7]} size={[0.45, 0.45, 0.55]} />
        <InternalTube part="hydraulic_lines" from={[0.55, 1.1, 0.4]} to={[0.9, 1.2, -1.3]} />
        <InternalTube part="hydraulic_lines" from={[0.9, 1.2, -1.3]} to={[0.9, 1.0, -3.6]} />

        {/* rear body / engine */}
        <mesh position={[0, 1.25, 1.85]} castShadow receiveShadow userData={{ part: "engine" }}>
          <boxGeometry args={[2.5, 1.3, 2.7]} />
          <meshStandardMaterial color={PALETTE.catYellow} roughness={0.6} metalness={0.25} />
        </mesh>
        {/* counterweight */}
        <mesh position={[0, 0.95, 3.2]} castShadow userData={{ part: "counterweight" }}>
          <boxGeometry args={[2.3, 1.0, 0.6]} />
          <meshStandardMaterial color={PALETTE.steel} roughness={0.85} metalness={0.35} />
        </mesh>
        {/* front body */}
        <mesh position={[0, 1.15, -1.1]} castShadow receiveShadow userData={{ part: "articulation" }}>
          <boxGeometry args={[2.4, 1.05, 2.4]} />
          <meshStandardMaterial color={PALETTE.catYellow} roughness={0.6} metalness={0.25} />
        </mesh>
        {/* articulation joint */}
        <mesh position={[0, 1.1, 0.35]} castShadow userData={{ part: "articulation" }}>
          <cylinderGeometry args={[0.45, 0.45, 0.9, 12]} />
          <meshStandardMaterial color={PALETTE.steelDark} roughness={0.7} metalness={0.5} />
        </mesh>

        {/* cab */}
        <mesh position={[0, 2.25, 0.75]} castShadow userData={{ part: "cab" }}>
          <boxGeometry args={[1.7, 1.5, 1.7]} />
          <meshStandardMaterial
            color={PALETTE.glass}
            roughness={0.1}
            metalness={0.1}
            transparent
            opacity={0.6}
          />
        </mesh>
        <mesh position={[0, 3.03, 0.75]} castShadow userData={{ part: "cab" }}>
          <boxGeometry args={[1.85, 0.12, 1.85]} />
          <meshStandardMaterial color={PALETTE.steelDark} roughness={0.8} />
        </mesh>

        {/* lift arms + bucket, pivoting at the front axle */}
        <group ref={arms} position={[0, 1.15, -1.3]}>
          {[-1.05, 1.05].map((x) => (
            <mesh key={x} position={[x, -0.1, -1.3]} rotation={[-0.16, 0, 0]} castShadow userData={{ part: "lift_arms" }}>
              <boxGeometry args={[0.26, 0.34, 2.8]} />
              <meshStandardMaterial color={PALETTE.catYellow} roughness={0.6} metalness={0.3} />
            </mesh>
          ))}
          {/* tilt cylinder */}
          <mesh position={[0, 0.34, -1.0]} rotation={[-0.1, 0, 0]} castShadow userData={{ part: "hydraulic_lines" }}>
            <cylinderGeometry args={[0.1, 0.1, 1.8, 10]} />
            <meshStandardMaterial color={PALETTE.steelLight} roughness={0.3} metalness={0.85} />
          </mesh>

          {/* bucket */}
          <group position={[0, -0.55, -2.75]} userData={{ part: "bucket" }}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[2.9, 1.1, 1.3]} />
              <meshStandardMaterial color={PALETTE.steel} roughness={0.7} metalness={0.5} />
            </mesh>
            <mesh position={[0, -0.5, -0.66]} rotation={[0.4, 0, 0]} castShadow>
              <boxGeometry args={[2.9, 0.14, 0.5]} />
              <meshStandardMaterial
                color={PALETTE.steelLight}
                roughness={0.4}
                metalness={0.85}
              />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}
