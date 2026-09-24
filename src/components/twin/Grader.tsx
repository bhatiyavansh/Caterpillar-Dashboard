"use client";

/**
 * CAT 140 motor grader.
 *
 * Long arched front frame, steerable front wheels, a drawbar-and-circle that
 * carries the moldboard (raised and lowered with `boomAngle`, turned on the
 * circle with `swingAngle`), a tall glass cab, rear engine, and tandem drives.
 */

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import type { MachineTelemetry } from "@/types/twin";
import { Anchor, Beacon, Decal, Lamp, MAT, Ram, TailLamps, Tyre, profileGeometry, useMachineMotion } from "./rig";
import { InternalBox, InternalTube, useXray } from "./xray";

const TYRE_R = 0.66;
const TYRE_W = 0.46;
const FRONT_Z = -4.3;
const TANDEM = [1.55, 3.05];

/** Gooseneck frame side profile: front axle up and back to the cab. */
const FRAME_PROFILE: [number, number][] = [
  [4.55, 0.9],
  [4.55, 1.35],
  [3.4, 1.85],
  [-0.5, 1.85],
  [-0.5, 1.45],
  [3.2, 1.45],
  [4.2, 0.9],
];

/** Moldboard: a curved blade section. */
const BLADE_PROFILE: [number, number][] = [
  [0.22, -0.02],
  [0.08, 0.2],
  [0.02, 0.45],
  [0.1, 0.66],
  [-0.04, 0.68],
  [-0.1, 0.44],
  [-0.05, 0.18],
  [0.08, -0.02],
];

export function Grader({ telemetry }: { telemetry: MachineTelemetry }) {
  const { root, tilt, steer, travel } = useMachineMotion(telemetry, 6.0);
  const { handlers } = useXray(telemetry.machineId, root);
  const frontWheels = useRef<THREE.Group[]>([]);
  const spin = useRef<THREE.Group[]>([]);
  const circle = useRef<THREE.Group>(null);
  const liftBaseL = useRef<THREE.Group>(null);
  const liftBaseR = useRef<THREE.Group>(null);
  const liftRodL = useRef<THREE.Group>(null);
  const liftRodR = useRef<THREE.Group>(null);

  const geo = useMemo(
    () => ({ frame: profileGeometry(FRAME_PROFILE, 0.42, 0.03), blade: profileGeometry(BLADE_PROFILE, 3.7, 0.02) }),
    [],
  );

  useFrame(() => {
    const t = telemetry;
    for (const w of frontWheels.current) w.rotation.y = -steer.current;
    const s = -travel.current / TYRE_R;
    for (const w of spin.current) w.rotation.x = s;
    if (circle.current) {
      const lift = Math.max(-0.08, Math.min(t.boomAngle, 0.5));
      circle.current.position.y = 0.5 + lift * 1.6;
      circle.current.rotation.y = -t.swingAngle;
    }
  });

  const steerRef = (el: THREE.Group | null) => {
    if (el && !frontWheels.current.includes(el)) frontWheels.current.push(el);
  };
  const spinRef = (el: THREE.Group | null) => {
    if (el && !spin.current.includes(el)) spin.current.push(el);
  };

  return (
    <group ref={root} {...handlers}>
      <group ref={tilt}>
        {/* front axle with steerable wheels */}
        <mesh position={[0, TYRE_R, FRONT_Z]} rotation={[0, 0, Math.PI / 2]} material={MAT.steelDark} castShadow>
          <cylinderGeometry args={[0.1, 0.1, 2.0, 8]} />
        </mesh>
        {[-1, 1].map((side) => (
          <group key={side} ref={steerRef} position={[side * 1.08, TYRE_R, FRONT_Z]} userData={{ part: "undercarriage" }}>
            <Tyre radius={TYRE_R} width={TYRE_W} spinRef={spinRef} side={side as 1 | -1} />
          </group>
        ))}
        <Lamp position={[-0.5, 1.5, FRONT_Z - 0.25]} />
        <Lamp position={[0.5, 1.5, FRONT_Z - 0.25]} />

        {/* gooseneck front frame */}
        <mesh geometry={geo.frame} material={MAT.paint} castShadow receiveShadow />
        <Decal text="CAT" logo position={[0.22, 1.66, -2.2]} rotation={[0, Math.PI / 2, 0]} width={0.9} />
        <Decal text="CAT" logo position={[-0.22, 1.66, -2.2]} rotation={[0, -Math.PI / 2, 0]} width={0.9} />
        <Anchor anchorRef={liftBaseL} position={[-0.55, 1.75, -1.6]} />
        <Anchor anchorRef={liftBaseR} position={[0.55, 1.75, -1.6]} />

        {/* drawbar from the front to the circle */}
        {[-1, 1].map((side) => (
          <mesh
            key={side}
            position={[side * 0.4, 0.78, -2.75]}
            rotation={[-0.13, side * 0.14, 0]}
            material={MAT.paintDark}
            castShadow
          >
            <boxGeometry args={[0.14, 0.14, 3.0]} />
          </mesh>
        ))}

        {/* circle and moldboard */}
        <group ref={circle} position={[0, 0.5, -1.2]} userData={{ part: "moldboard" }}>
          <mesh rotation={[Math.PI / 2, 0, 0]} material={MAT.steelDark} castShadow>
            <torusGeometry args={[0.85, 0.08, 8, 28]} />
          </mesh>
          <mesh geometry={geo.blade} position={[0, -0.35, -0.2]} material={MAT.paint} castShadow receiveShadow />
          <mesh position={[0, -0.36, -0.42]} material={MAT.wear}>
            <boxGeometry args={[3.7, 0.08, 0.06]} />
          </mesh>
          <Anchor anchorRef={liftRodL} position={[-0.65, 0.1, 0]} />
          <Anchor anchorRef={liftRodR} position={[0.65, 0.1, 0]} />
        </group>
        <Ram from={liftBaseL} to={liftRodL} radius={0.07} part="hydraulic_lines" />
        <Ram from={liftBaseR} to={liftRodR} radius={0.07} part="hydraulic_lines" />

        {/* cab */}
        <group userData={{ part: "cab" }}>
          <RoundedBox args={[1.9, 0.3, 1.9]} radius={0.05} position={[0, 1.65, 0.9]} material={MAT.paint} castShadow />
          <group position={[0, 2.7, 0.9]}>
            <mesh material={MAT.glass}>
              <boxGeometry args={[1.75, 1.8, 1.65]} />
            </mesh>
            {[
              [-0.86, -0.8],
              [0.86, -0.8],
              [-0.86, 0.8],
              [0.86, 0.8],
            ].map(([x, z]) => (
              <mesh key={`${x}${z}`} position={[x, 0, z]} material={MAT.black} castShadow>
                <boxGeometry args={[0.07, 1.82, 0.07]} />
              </mesh>
            ))}
            <RoundedBox args={[1.95, 0.15, 1.85]} radius={0.05} position={[0, 0.97, 0]} material={MAT.paint} castShadow />
            <mesh position={[0, -0.45, 0.2]} material={MAT.seat}>
              <boxGeometry args={[0.5, 0.5, 0.5]} />
            </mesh>
            <mesh position={[0, -0.05, 0.15]} material={MAT.seat}>
              <sphereGeometry args={[0.13, 10, 8]} />
            </mesh>
            <Beacon telemetry={telemetry} position={[0.55, 1.04, 0.5]} />
            <Lamp position={[-0.55, 1.07, -0.85]} />
            <Lamp position={[0.55, 1.07, -0.85]} />
          </group>
        </group>

        {/* rear frame and engine */}
        <mesh position={[0, 1.0, 2.4]} material={MAT.steelDark} castShadow>
          <boxGeometry args={[1.0, 0.5, 3.2]} />
        </mesh>
        <group userData={{ part: "engine" }}>
          <RoundedBox args={[1.75, 1.15, 2.4]} radius={0.14} position={[0, 1.85, 2.75]} material={MAT.paint} castShadow receiveShadow />
          <mesh position={[0, 1.85, 3.96]} material={MAT.grille}>
            <boxGeometry args={[1.4, 0.8, 0.04]} />
          </mesh>
          <Decal text="140" position={[0.89, 1.9, 2.7]} rotation={[0, Math.PI / 2, 0]} width={0.8} />
          <mesh position={[0.45, 2.7, 2.2]} material={MAT.black} castShadow>
            <cylinderGeometry args={[0.07, 0.08, 0.55, 10]} />
          </mesh>
        </group>
        <TailLamps telemetry={telemetry} positions={[[-0.7, 1.4, 4.0], [0.7, 1.4, 4.0]]} />

        {/* X-ray internals: engine block, pump, lines forward to the lift rams */}
        <InternalBox part="engine" position={[0, 1.85, 2.8]} size={[1.3, 0.85, 1.8]} />
        <InternalBox part="hydraulic_pump" position={[0.4, 1.4, 1.6]} size={[0.4, 0.4, 0.5]} />
        {[-1, 1].map((side) => (
          <InternalTube key={side} part="hydraulic_lines" from={[0.3 * side, 1.5, 1.4]} to={[0.55 * side, 1.75, -1.6]} />
        ))}

        {/* tandem drives */}
        {[-1, 1].map((side) => (
          <group key={side}>
            <mesh position={[side * 0.72, TYRE_R, (TANDEM[0] + TANDEM[1]) / 2]} material={MAT.steelDark} castShadow>
              <boxGeometry args={[0.22, 0.45, TANDEM[1] - TANDEM[0] + 0.5]} />
            </mesh>
            {TANDEM.map((z) => (
              <group key={z} position={[side * 1.08, TYRE_R, z]} userData={{ part: "undercarriage" }}>
                <Tyre radius={TYRE_R} width={TYRE_W} spinRef={spinRef} side={side as 1 | -1} />
              </group>
            ))}
            <RoundedBox
              args={[0.55, 0.1, TANDEM[1] - TANDEM[0] + 1.3]}
              radius={0.03}
              position={[side * 1.08, TYRE_R * 2 + 0.12, (TANDEM[0] + TANDEM[1]) / 2]}
              material={MAT.paint}
              castShadow
            />
          </group>
        ))}
      </group>
    </group>
  );
}
