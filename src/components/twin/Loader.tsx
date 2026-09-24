"use client";

/**
 * CAT 950 wheel loader.
 *
 *   Loader           position + heading
 *   └── Tilt         pitch / roll
 *       ├── Front frame  (yaws about the hitch)  axle, lift arms, bucket
 *       │   └── Arms     boomAngle (lift)          twin lift rams
 *       │       └── Bucket  bucketAngle (tilt), self-levelling with the arms
 *       └── Rear frame   (yaws about the hitch)  cab, engine, counterweight
 *
 * Articulated steering, arms that lift on rams, a bucket that stays level as
 * it rises (as a real Z-bar linkage does) and curls or dumps on its tilt ram.
 */

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import type { MachineTelemetry } from "@/types/twin";
import { LOADER_PASS_KG } from "@/lib/twin/fleet";
import {
  Anchor,
  Beacon,
  Decal,
  Lamp,
  MAT,
  Ram,
  TailLamps,
  Tyre,
  profileGeometry,
  useMachineMotion,
} from "./rig";
import { InternalBox, InternalTube, useXray } from "./xray";

const TYRE_R = 0.84;
const TYRE_W = 0.62;
const TRACK = 1.12;
const AXLE = 1.68;

/** Lift arm side profile: pivot to bucket pin at (3.3, -1.45). */
const ARM_PROFILE: [number, number][] = [
  [-0.22, 0.18],
  [1.4, -0.3],
  [3.4, -1.28],
  [3.42, -1.62],
  [3.1, -1.62],
  [1.3, -0.62],
  [-0.22, -0.2],
];

/** Bucket back and floor as one bent plate (C-section), pin at the origin. */
const BUCKET_SHELL: [number, number][] = [
  [1.5, -0.5],
  [0.1, -0.52],
  [-0.36, -0.2],
  [-0.44, 0.46],
  [-0.24, 0.98],
  [-0.14, 0.98],
  [-0.32, 0.46],
  [-0.25, -0.14],
  [0.14, -0.42],
  [1.5, -0.42],
];
const BUCKET_SIDE: [number, number][] = [
  [-0.22, 1.0],
  [0.3, 1.0],
  [1.55, -0.08],
  [1.55, -0.52],
  [0.1, -0.56],
  [-0.44, -0.2],
  [-0.46, 0.46],
];

export function Loader({ telemetry }: { telemetry: MachineTelemetry }) {
  const { root, tilt, steer, travel } = useMachineMotion(telemetry, 3.35);
  const front = useRef<THREE.Group>(null);
  const rear = useRef<THREE.Group>(null);
  const arms = useRef<THREE.Group>(null);
  const bucket = useRef<THREE.Group>(null);
  const load = useRef<THREE.Mesh>(null);
  const wheels = useRef<THREE.Group[]>([]);
  const liftBaseL = useRef<THREE.Group>(null);
  const liftBaseR = useRef<THREE.Group>(null);
  const liftRodL = useRef<THREE.Group>(null);
  const liftRodR = useRef<THREE.Group>(null);
  const tiltBase = useRef<THREE.Group>(null);
  const tiltRod = useRef<THREE.Group>(null);
  const { handlers } = useXray(telemetry.machineId, root);

  const geo = useMemo(
    () => ({
      arm: profileGeometry(ARM_PROFILE, 0.26, 0.03),
      shell: profileGeometry(BUCKET_SHELL, 2.9, 0.01),
      side: profileGeometry(BUCKET_SIDE, 0.06, 0),
    }),
    [],
  );

  useFrame(() => {
    const t = telemetry;
    const s = steer.current;
    if (front.current) front.current.rotation.y = -s * 0.5;
    if (rear.current) rear.current.rotation.y = s * 0.5;
    const lift = t.boomAngle;
    if (arms.current) arms.current.rotation.x = lift;
    // Z-bar linkage keeps the bucket level as the arms rise; tilt adds on top.
    if (bucket.current) bucket.current.rotation.x = -lift + t.bucketAngle;
    if (load.current) {
      const fill = Math.min(t.payload / LOADER_PASS_KG, 1);
      load.current.visible = fill > 0.05;
      load.current.scale.set(1, 0.3 + fill * 0.7, 1);
    }
    const spin = -travel.current / TYRE_R;
    for (const w of wheels.current) w.rotation.x = spin;
  });

  const spinRef = (el: THREE.Group | null) => {
    if (el && !wheels.current.includes(el)) wheels.current.push(el);
  };

  return (
    <group ref={root} {...handlers}>
      <group ref={tilt}>
        {/* ---------------- front frame ---------------- */}
        <group ref={front}>
          {[-1, 1].map((side) => (
            <group
              key={side}
              position={[side * TRACK, TYRE_R, -AXLE]}
              userData={{ part: "undercarriage" }}
            >
              <Tyre
                radius={TYRE_R}
                width={TYRE_W}
                spinRef={spinRef}
                side={side as 1 | -1}
              />
            </group>
          ))}
          <mesh
            userData={{ part: "articulation" }}
            position={[0, 1.05, -1.3]}
            material={MAT.paint}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[1.0, 0.85, 2.6]} />
          </mesh>
          {/* loader tower carrying the arm pivots */}
          <mesh position={[0, 1.75, -0.95]} material={MAT.paint} castShadow>
            <boxGeometry args={[1.2, 0.9, 0.6]} />
          </mesh>
          {[-1, 1].map((side) => (
            <RoundedBox
              key={side}
              args={[0.72, 0.12, 1.5]}
              radius={0.04}
              position={[side * TRACK, TYRE_R + 0.88, -AXLE - 0.1]}
              material={MAT.paint}
              castShadow
            />
          ))}
          <Lamp position={[-0.4, 1.95, -1.27]} />
          <Lamp position={[0.4, 1.95, -1.27]} />
          <Anchor anchorRef={liftBaseL} position={[-0.55, 0.95, -1.75]} />
          <Anchor anchorRef={liftBaseR} position={[0.55, 0.95, -1.75]} />
          <Anchor anchorRef={tiltBase} position={[0, 2.15, -1.2]} />

          {/* ---------------- lift arms ---------------- */}
          <group
            ref={arms}
            position={[0, 2.05, -0.9]}
            userData={{ part: "lift_arms" }}
          >
            {[-0.62, 0.62].map((x) => (
              <mesh
                key={x}
                geometry={geo.arm}
                position={[x, 0, 0]}
                material={MAT.paint}
                castShadow
              />
            ))}
            {/* cross tube */}
            <mesh
              position={[0, -0.72, -1.9]}
              rotation={[0, 0, Math.PI / 2]}
              material={MAT.paint}
              castShadow
            >
              <cylinderGeometry args={[0.12, 0.12, 1.24, 10]} />
            </mesh>
            <Anchor anchorRef={liftRodL} position={[-0.55, -0.55, -1.45]} />
            <Anchor anchorRef={liftRodR} position={[0.55, -0.55, -1.45]} />

            {/* ---------------- bucket ---------------- */}
            <group
              ref={bucket}
              position={[0, -1.45, -3.3]}
              userData={{ part: "bucket" }}
            >
              <mesh
                geometry={geo.shell}
                material={MAT.paintWorn}
                castShadow
                receiveShadow
              />
              <mesh
                geometry={geo.side}
                position={[1.45, 0, 0]}
                material={MAT.paintWorn}
                castShadow
              />
              <mesh
                geometry={geo.side}
                position={[-1.45, 0, 0]}
                material={MAT.paintWorn}
                castShadow
              />
              {/* bolt-on cutting edge */}
              <mesh position={[0, -0.48, -1.52]} material={MAT.wear}>
                <boxGeometry args={[2.92, 0.06, 0.18]} />
              </mesh>
              <Anchor anchorRef={tiltRod} position={[0, 0.85, 0.3]} />
              <mesh
                ref={load}
                position={[0, -0.25, -0.65]}
                material={MAT.dirt}
                visible={false}
                castShadow
              >
                <sphereGeometry
                  args={[0.95, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]}
                />
              </mesh>
            </group>
          </group>
          <Ram
            from={liftBaseL}
            to={liftRodL}
            radius={0.1}
            part="hydraulic_lines"
          />
          <Ram
            from={liftBaseR}
            to={liftRodR}
            radius={0.1}
            part="hydraulic_lines"
          />
          <Ram
            from={tiltBase}
            to={tiltRod}
            radius={0.11}
            part="hydraulic_lines"
          />
          <InternalTube
            part="hydraulic_lines"
            from={[0.3, 1.0, 0]}
            to={[0.55, 0.95, -1.7]}
          />
          {/* hitch */}
          <mesh
            position={[0, 1.0, 0]}
            material={MAT.steelDark}
            castShadow
            userData={{ part: "articulation" }}
          >
            <cylinderGeometry args={[0.32, 0.32, 0.9, 14]} />
          </mesh>
        </group>

        {/* ---------------- rear frame ---------------- */}
        <group ref={rear}>
          {[-1, 1].map((side) => (
            <group
              key={side}
              position={[side * TRACK, TYRE_R, AXLE]}
              userData={{ part: "undercarriage" }}
            >
              <Tyre
                radius={TYRE_R}
                width={TYRE_W}
                spinRef={spinRef}
                side={side as 1 | -1}
              />
            </group>
          ))}
          <mesh
            position={[0, 1.05, 1.4]}
            material={MAT.steelDark}
            castShadow
            userData={{ part: "articulation" }}
          >
            <boxGeometry args={[1.3, 0.7, 2.8]} />
          </mesh>
          {/* cab */}
          <group userData={{ part: "cab" }}>
            <RoundedBox
              args={[1.7, 0.3, 1.8]}
              radius={0.05}
              position={[0, 1.6, 0.75]}
              material={MAT.paint}
              castShadow
            />
            <group position={[0, 2.55, 0.75]}>
              <mesh material={MAT.glass}>
                <boxGeometry args={[1.5, 1.6, 1.55]} />
              </mesh>
              {[
                [-0.74, -0.76],
                [0.74, -0.76],
                [-0.74, 0.76],
                [0.74, 0.76],
              ].map(([x, z]) => (
                <mesh
                  key={`${x}${z}`}
                  position={[x, 0, z]}
                  material={MAT.black}
                  castShadow
                >
                  <boxGeometry args={[0.07, 1.62, 0.07]} />
                </mesh>
              ))}
              <RoundedBox
                args={[1.7, 0.15, 1.75]}
                radius={0.05}
                position={[0, 0.86, 0]}
                material={MAT.paint}
                castShadow
              />
              <mesh position={[0, -0.35, 0.15]} material={MAT.seat}>
                <boxGeometry args={[0.5, 0.5, 0.5]} />
              </mesh>
              <mesh position={[0, 0.05, 0.1]} material={MAT.seat}>
                <sphereGeometry args={[0.13, 10, 8]} />
              </mesh>
              <Beacon telemetry={telemetry} position={[0.5, 0.93, 0.5]} />
              <Lamp position={[-0.5, 0.96, -0.8]} />
              <Lamp position={[0.5, 0.96, -0.8]} />
            </group>
          </group>
          {/* engine enclosure, sloping down to the rear grille */}
          <group userData={{ part: "engine" }}>
            <RoundedBox
              args={[1.9, 1.2, 2.3]}
              radius={0.16}
              position={[0, 1.95, 2.55]}
              material={MAT.paint}
              castShadow
              receiveShadow
            />
            <mesh position={[0, 2.0, 3.71]} material={MAT.grille}>
              <boxGeometry args={[1.5, 0.9, 0.04]} />
            </mesh>
            <Decal
              text="CAT"
              logo
              position={[0.97, 2.0, 2.55]}
              rotation={[0, Math.PI / 2, 0]}
              width={1.1}
            />
            <Decal
              text="CAT"
              logo
              position={[-0.97, 2.0, 2.55]}
              rotation={[0, -Math.PI / 2, 0]}
              width={1.1}
            />
          </group>
          {/* counterweight bumper */}
          <group userData={{ part: "counterweight" }}>
            <RoundedBox
              args={[2.4, 0.9, 0.55]}
              radius={0.15}
              position={[0, 1.1, 3.95]}
              material={MAT.paint}
              castShadow
            />
            <Decal text="950" position={[0, 1.12, 4.23]} width={0.9} />
            <TailLamps
              telemetry={telemetry}
              positions={[
                [-0.95, 1.55, 4.22],
                [0.95, 1.55, 4.22],
              ]}
            />
          </group>
          {/* rear fenders */}
          {[-1, 1].map((side) => (
            <RoundedBox
              key={side}
              args={[0.72, 0.12, 1.6]}
              radius={0.04}
              position={[side * TRACK, TYRE_R + 0.9, AXLE]}
              material={MAT.paint}
              castShadow
            />
          ))}
          {/* exhaust stack and precleaner */}
          <group userData={{ part: "engine" }}>
            <mesh position={[0.45, 2.85, 2.2]} material={MAT.black} castShadow>
              <cylinderGeometry args={[0.07, 0.08, 0.6, 10]} />
            </mesh>
            <mesh position={[-0.45, 2.75, 2.1]} material={MAT.black}>
              <cylinderGeometry args={[0.12, 0.12, 0.4, 12]} />
            </mesh>
          </group>

          {/* X-ray internals: engine block, pump, lines forward to the hitch */}
          <InternalBox
            part="engine"
            position={[0, 1.95, 2.5]}
            size={[1.4, 0.9, 1.7]}
          />
          <InternalBox
            part="hydraulic_pump"
            position={[0.5, 1.25, 0.9]}
            size={[0.45, 0.45, 0.55]}
          />
          <InternalTube
            part="hydraulic_lines"
            from={[0.5, 1.2, 0.6]}
            to={[0.3, 1.0, 0]}
          />
        </group>
      </group>
    </group>
  );
}
