"use client";

/**
 * DZR001 — CAT D6 style track-type tractor.
 *
 * Same contract as the excavator: telemetry in, transforms out. Less detail,
 * because only the primary machine needs to hold up at close range.
 */

import type { MachineTelemetry } from "@/types/twin";
import { PALETTE } from "./materials";
import { useChassis, useRunningGear } from "./chassis";

export function Bulldozer({ telemetry }: { telemetry: MachineTelemetry }) {
  const { root, tilt } = useChassis(telemetry);
  const { texture, register } = useRunningGear(telemetry, 0.3);

  return (
    <group ref={root}>
      <group ref={tilt}>
        {/* tracks */}
        {[-1.35, 1.35].map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.95, 1.0, 4.2]} />
              <meshStandardMaterial map={texture} roughness={0.95} metalness={0.15} />
            </mesh>
            {[-2.0, 2.0].map((z) => (
              <mesh
                key={z}
                ref={register}
                position={[0, 0.5, z]}
                rotation={[0, 0, Math.PI / 2]}
                castShadow
              >
                <cylinderGeometry args={[0.5, 0.5, 0.97, 12]} />
                <meshStandardMaterial
                  color={PALETTE.steelDark}
                  roughness={0.8}
                  metalness={0.4}
                />
              </mesh>
            ))}
          </group>
        ))}

        {/* hull */}
        <mesh position={[0, 1.15, 0.2]} castShadow receiveShadow>
          <boxGeometry args={[2.3, 1.0, 3.2]} />
          <meshStandardMaterial color={PALETTE.catYellow} roughness={0.6} metalness={0.25} />
        </mesh>
        {/* hood */}
        <mesh position={[0, 1.5, -1.0]} castShadow>
          <boxGeometry args={[1.6, 0.7, 1.5]} />
          <meshStandardMaterial color={PALETTE.catYellow} roughness={0.6} metalness={0.25} />
        </mesh>
        {/* ROPS cab */}
        <mesh position={[0, 2.05, 0.75]} castShadow>
          <boxGeometry args={[1.7, 1.35, 1.6]} />
          <meshStandardMaterial
            color={PALETTE.glass}
            roughness={0.1}
            metalness={0.1}
            transparent
            opacity={0.6}
          />
        </mesh>
        <mesh position={[0, 2.76, 0.75]} castShadow>
          <boxGeometry args={[1.85, 0.12, 1.75]} />
          <meshStandardMaterial color={PALETTE.steelDark} roughness={0.8} />
        </mesh>

        {/* blade push arms */}
        {[-1.2, 1.2].map((x) => (
          <mesh key={x} position={[x, 0.75, -2.0]} rotation={[0.12, 0, 0]} castShadow>
            <boxGeometry args={[0.22, 0.22, 2.0]} />
            <meshStandardMaterial color={PALETTE.steel} roughness={0.8} metalness={0.4} />
          </mesh>
        ))}
        {/* blade */}
        <group position={[0, 0.72, -3.05]}>
          <mesh rotation={[0.16, 0, 0]} castShadow receiveShadow>
            <boxGeometry args={[3.9, 1.25, 0.22]} />
            <meshStandardMaterial color={PALETTE.catYellow} roughness={0.55} metalness={0.3} />
          </mesh>
          {/* cutting edge */}
          <mesh position={[0, -0.62, -0.06]} castShadow>
            <boxGeometry args={[3.9, 0.18, 0.3]} />
            <meshStandardMaterial color={PALETTE.steelLight} roughness={0.4} metalness={0.85} />
          </mesh>
        </group>

        {/* ripper */}
        <mesh position={[0, 0.7, 2.4]} rotation={[-0.3, 0, 0]} castShadow>
          <boxGeometry args={[0.3, 1.2, 0.25]} />
          <meshStandardMaterial color={PALETTE.steel} roughness={0.8} metalness={0.45} />
        </mesh>

        {/* exhaust */}
        <mesh position={[0.5, 2.1, -1.2]} castShadow>
          <cylinderGeometry args={[0.09, 0.1, 0.9, 8]} />
          <meshStandardMaterial color={PALETTE.steelDark} roughness={0.7} metalness={0.6} />
        </mesh>
      </group>
    </group>
  );
}
