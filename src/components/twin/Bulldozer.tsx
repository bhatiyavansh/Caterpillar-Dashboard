"use client";

/**
 * CAT D6 track-type tractor.
 *
 * The signature elevated-sprocket ("high drive") track triangle, a curved
 * moldboard on push arms that rises and falls on twin lift rams with
 * `boomAngle`, and a rear ripper that drops when `bucketAngle` is positive.
 */

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import type { MachineTelemetry } from "@/types/twin";
import { useTwinStore } from "@/store/twinStore";
import {
  Anchor,
  Beacon,
  Decal,
  Lamp,
  MAT,
  Ram,
  Strut,
  TailLamps,
  TrackRun,
  profileGeometry,
  useMachineMotion,
  useShoeMaterial,
} from "./rig";

const GAUGE = 0.98;
const SHOE = 0.56;
const IDLER = { z: -1.55, y: 0.38, r: 0.36 };
const SPROCKET = { z: 1.2, y: 1.18, r: 0.46 };
const REAR = { z: 1.5, y: 0.3 };

/** Moldboard cross-section: a curved face, cutting edge at the bottom front. */
const BLADE_PROFILE: [number, number][] = [
  [0.28, -0.1],
  [0.12, 0.25],
  [0.02, 0.62],
  [0.06, 1.0],
  [0.22, 1.22],
  [0.08, 1.26],
  [-0.1, 1.0],
  [-0.14, 0.6],
  [-0.06, 0.2],
  [0.12, -0.1],
];

export function Bulldozer({ telemetry }: { telemetry: MachineTelemetry }) {
  const { root, tilt } = useMachineMotion(telemetry, 3.2);
  const engine = useTwinStore((s) => s.engine);
  const blade = useRef<THREE.Group>(null);
  const ripper = useRef<THREE.Group>(null);
  const wheels = useRef<THREE.Object3D[]>([]);
  const shoes = useShoeMaterial(2.2);
  const liftBaseL = useRef<THREE.Group>(null);
  const liftBaseR = useRef<THREE.Group>(null);
  const liftRodL = useRef<THREE.Group>(null);
  const liftRodR = useRef<THREE.Group>(null);
  const armBaseL = useRef<THREE.Group>(null);
  const armBaseR = useRef<THREE.Group>(null);
  const armEndL = useRef<THREE.Group>(null);
  const armEndR = useRef<THREE.Group>(null);

  const bladeGeo = useMemo(() => profileGeometry(BLADE_PROFILE, 3.3, 0.03), []);

  useFrame(() => {
    const t = telemetry;
    if (blade.current) {
      const lift = Math.max(-0.1, Math.min(t.boomAngle, 0.6));
      blade.current.position.y = 0.05 + lift * 2.2;
      blade.current.rotation.x = -lift * 0.25;
    }
    if (ripper.current) {
      const down = Math.max(0, Math.min(t.bucketAngle / 0.5, 1));
      ripper.current.rotation.x = -0.6 + down * 0.6;
    }
    const travel = engine.modelOf(t.machineId).trackTravel;
    shoes.map!.offset.y = -travel / 1.36;
    for (const w of wheels.current) w.rotation.x = -travel / 0.4;
  });

  const register = (el: THREE.Object3D | null) => {
    if (el && !wheels.current.includes(el)) wheels.current.push(el);
  };

  return (
    <group ref={root}>
      <group ref={tilt}>
        {/* ---------------- high-drive tracks ---------------- */}
        {[-1, 1].map((side) => (
          <group key={side} position={[side * GAUGE, 0, 0]}>
            <TrackRun from={[IDLER.z, 0.05]} to={[REAR.z, 0.05]} width={SHOE} material={shoes} />
            <TrackRun from={[IDLER.z, IDLER.y + IDLER.r]} to={[SPROCKET.z - 0.1, SPROCKET.y + SPROCKET.r]} width={SHOE} material={shoes} />
            <TrackRun from={[SPROCKET.z + SPROCKET.r, SPROCKET.y]} to={[REAR.z + 0.25, REAR.y]} width={SHOE} material={shoes} />
            <mesh position={[0, IDLER.y, IDLER.z]} rotation={[0, 0, Math.PI / 2]} material={MAT.rubber}>
              <cylinderGeometry args={[IDLER.r + 0.05, IDLER.r + 0.05, SHOE, 16, 1, true, Math.PI / 2, Math.PI]} />
            </mesh>
            <group ref={register} position={[0, IDLER.y, IDLER.z]}>
              <mesh rotation={[0, 0, Math.PI / 2]} material={MAT.steel}>
                <cylinderGeometry args={[IDLER.r, IDLER.r, SHOE - 0.1, 16]} />
              </mesh>
            </group>
            {/* elevated sprocket with final drive */}
            <group ref={register} position={[0, SPROCKET.y, SPROCKET.z]}>
              <mesh rotation={[0, 0, Math.PI / 2]} material={MAT.steelDark}>
                <cylinderGeometry args={[SPROCKET.r, SPROCKET.r, 0.3, 16]} />
              </mesh>
              {Array.from({ length: 11 }, (_, i) => {
                const a = (i / 11) * Math.PI * 2;
                return (
                  <mesh key={i} position={[0, Math.sin(a) * SPROCKET.r, Math.cos(a) * SPROCKET.r]} rotation={[a, 0, 0]} material={MAT.steel}>
                    <boxGeometry args={[0.24, 0.08, 0.1]} />
                  </mesh>
                );
              })}
            </group>
            <mesh position={[side * 0.26, SPROCKET.y, SPROCKET.z]} rotation={[0, 0, Math.PI / 2]} material={MAT.black}>
              <cylinderGeometry args={[0.32, 0.36, 0.22, 16]} />
            </mesh>
            {/* roller frame and bogie rollers */}
            <mesh position={[0, 0.42, -0.05]} material={MAT.steelDark} castShadow>
              <boxGeometry args={[0.4, 0.4, 2.6]} />
            </mesh>
            {[-1.0, -0.5, 0, 0.5, 1.0].map((z) => (
              <group key={z} ref={register} position={[0, 0.2, z]}>
                <mesh rotation={[0, 0, Math.PI / 2]} material={MAT.steel}>
                  <cylinderGeometry args={[0.13, 0.13, 0.44, 10]} />
                </mesh>
              </group>
            ))}
            <Anchor anchorRef={side < 0 ? armBaseL : armBaseR} position={[side * 0.3, 0.52, 0.1]} />
          </group>
        ))}

        {/* ---------------- main frame and hood ---------------- */}
        <mesh position={[0, 0.9, 0.1]} material={MAT.steelDark} castShadow receiveShadow>
          <boxGeometry args={[1.5, 0.6, 3.2]} />
        </mesh>
        <RoundedBox args={[1.45, 1.05, 2.1]} radius={0.12} position={[0, 1.55, -0.85]} material={MAT.paint} castShadow receiveShadow />
        {/* radiator guard and grille */}
        <mesh position={[0, 1.5, -1.92]} material={MAT.grille}>
          <boxGeometry args={[1.2, 0.85, 0.05]} />
        </mesh>
        {[-0.3, -0.1, 0.1, 0.3].map((y) => (
          <mesh key={y} position={[0, 1.5 + y, -1.96]} material={MAT.steel}>
            <boxGeometry args={[1.2, 0.05, 0.03]} />
          </mesh>
        ))}
        <Decal text="CAT" logo position={[0.74, 1.62, -0.85]} rotation={[0, Math.PI / 2, 0]} width={1.0} />
        <Decal text="CAT" logo position={[-0.74, 1.62, -0.85]} rotation={[0, -Math.PI / 2, 0]} width={1.0} />
        <Decal text="D6" position={[0.74, 1.25, -0.2]} rotation={[0, Math.PI / 2, 0]} width={0.6} />
        {/* exhaust and precleaner */}
        <mesh position={[0.35, 2.35, -1.05]} material={MAT.black} castShadow>
          <cylinderGeometry args={[0.07, 0.08, 0.6, 10]} />
        </mesh>
        <mesh position={[-0.35, 2.25, -1.1]} material={MAT.black}>
          <cylinderGeometry args={[0.11, 0.11, 0.35, 12]} />
        </mesh>
        <Anchor anchorRef={liftBaseL} position={[-0.62, 2.0, -1.55]} />
        <Anchor anchorRef={liftBaseR} position={[0.62, 2.0, -1.55]} />

        {/* ---------------- ROPS cab ---------------- */}
        <RoundedBox args={[1.8, 0.3, 1.7]} radius={0.05} position={[0, 1.3, 0.75]} material={MAT.paint} castShadow />
        <group position={[0, 2.25, 0.75]}>
          <mesh material={MAT.glass}>
            <boxGeometry args={[1.5, 1.55, 1.45]} />
          </mesh>
          {[
            [-0.74, -0.7],
            [0.74, -0.7],
            [-0.74, 0.7],
            [0.74, 0.7],
          ].map(([x, z]) => (
            <mesh key={`${x}${z}`} position={[x, 0, z]} material={MAT.black} castShadow>
              <boxGeometry args={[0.08, 1.58, 0.08]} />
            </mesh>
          ))}
          <RoundedBox args={[1.7, 0.14, 1.65]} radius={0.05} position={[0, 0.84, 0]} material={MAT.paint} castShadow />
          <mesh position={[0, -0.35, 0.15]} material={MAT.seat}>
            <boxGeometry args={[0.5, 0.5, 0.5]} />
          </mesh>
          <mesh position={[0, 0.05, 0.1]} material={MAT.seat}>
            <sphereGeometry args={[0.13, 10, 8]} />
          </mesh>
          <Beacon telemetry={telemetry} position={[0.5, 0.91, 0.5]} />
          <Lamp position={[-0.5, 0.94, -0.75]} />
          <Lamp position={[0.5, 0.94, -0.75]} />
        </group>
        {/* rear fuel tank */}
        <RoundedBox args={[1.6, 0.8, 0.55]} radius={0.1} position={[0, 1.35, 1.85]} material={MAT.paint} castShadow />
        <TailLamps telemetry={telemetry} positions={[[-0.6, 1.5, 2.14], [0.6, 1.5, 2.14]]} />

        {/* ---------------- ripper ---------------- */}
        <group ref={ripper} position={[0, 0.95, 2.15]}>
          <mesh position={[0, 0, 0.5]} material={MAT.paint} castShadow>
            <boxGeometry args={[1.5, 0.22, 1.0]} />
          </mesh>
          <mesh position={[0, -0.55, 1.0]} rotation={[0.25, 0, 0]} material={MAT.steelDark} castShadow>
            <boxGeometry args={[0.12, 1.2, 0.3]} />
          </mesh>
          <mesh position={[0, -1.12, 0.86]} rotation={[0.9, 0, 0]} material={MAT.wear}>
            <coneGeometry args={[0.07, 0.3, 4]} />
          </mesh>
        </group>

        {/* ---------------- blade ---------------- */}
        <group ref={blade} position={[0, 0.05, -2.6]}>
          <mesh geometry={bladeGeo} material={MAT.paint} castShadow receiveShadow />
          <mesh position={[0, 0.02, -0.26]} material={MAT.wear}>
            <boxGeometry args={[3.3, 0.14, 0.08]} />
          </mesh>
          {/* end bits */}
          {[-1.62, 1.62].map((x) => (
            <mesh key={x} position={[x, 0.55, -0.02]} material={MAT.paintDark} castShadow>
              <boxGeometry args={[0.08, 1.1, 0.4]} />
            </mesh>
          ))}
          <Anchor anchorRef={liftRodL} position={[-0.62, 1.05, 0.22]} />
          <Anchor anchorRef={liftRodR} position={[0.62, 1.05, 0.22]} />
          <Anchor anchorRef={armEndL} position={[-1.28, 0.35, 0.2]} />
          <Anchor anchorRef={armEndR} position={[1.28, 0.35, 0.2]} />
        </group>
        <Strut from={armBaseL} to={armEndL} size={[0.2, 0.26]} />
        <Strut from={armBaseR} to={armEndR} size={[0.2, 0.26]} />
        <Ram from={liftBaseL} to={liftRodL} radius={0.09} />
        <Ram from={liftBaseR} to={liftRodR} radius={0.09} />
      </group>
    </group>
  );
}
