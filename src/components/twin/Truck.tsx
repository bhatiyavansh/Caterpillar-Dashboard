"use client";

/**
 * CAT 745 articulated haul truck.
 *
 *   Truck            position + heading
 *   └── Tilt         pitch / roll
 *       ├── Tractor  (yaws about the hitch)  cab, engine, front axle
 *       └── Trailer  (yaws about the hitch)  tandem bogies, frame
 *           └── Body (hinged at the tail)    tips with bucketAngle < 0
 *
 * Steering is articulation: each half turns half the steer angle about the
 * hitch, which is how these trucks actually corner. The body rides up on two
 * hoist rams, and the load heap inside scales with payload.
 */

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import type { MachineTelemetry } from "@/types/twin";
import { TRUCK_FULL_KG } from "@/lib/twin/fleet";
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

const HITCH_Z = -0.9;
const TYRE_R = 0.95;
const TYRE_W = 0.78;
const TRACK = 1.36;

/** Body side silhouette, pivot (tail hinge) at the origin, u forward. */
const BODY_SIDE: [number, number][] = [
  [-1.05, 0.25],
  [0.1, 0.0],
  [4.85, 0.38],
  [5.2, 0.6],
  [5.45, 2.05],
  [4.95, 2.2],
  [0.1, 1.72],
  [-1.05, 1.3],
];

export function Truck({ telemetry }: { telemetry: MachineTelemetry }) {
  const { root, tilt, steer, travel } = useMachineMotion(telemetry, 5.8);
  const tractor = useRef<THREE.Group>(null);
  const trailer = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const heap = useRef<THREE.Mesh>(null);
  const wheels = useRef<THREE.Group[]>([]);
  const hoistBaseL = useRef<THREE.Group>(null);
  const hoistBaseR = useRef<THREE.Group>(null);
  const hoistRodL = useRef<THREE.Group>(null);
  const hoistRodR = useRef<THREE.Group>(null);
  const { handlers } = useXray(telemetry.machineId, root);

  const geo = useMemo(
    () => ({ side: profileGeometry(BODY_SIDE, 0.12, 0.02) }),
    [],
  );

  useFrame(() => {
    const t = telemetry;
    const s = steer.current;
    if (tractor.current) tractor.current.rotation.y = -s * 0.5;
    if (trailer.current) trailer.current.rotation.y = s * 0.5;
    if (body.current)
      body.current.rotation.x = Math.min(Math.max(-t.bucketAngle, 0), 1) * 0.95;
    if (heap.current) {
      const fill = Math.min(t.payload / TRUCK_FULL_KG, 1);
      heap.current.visible = fill > 0.03;
      heap.current.scale.set(1, 0.15 + fill * 0.85, 0.35 + fill * 0.65);
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
        {/* ---------------- tractor unit ---------------- */}
        <group ref={tractor} position={[0, 0, HITCH_Z]}>
          {/* front axle tyres */}
          {[-1, 1].map((side) => (
            <group
              key={side}
              position={[side * TRACK, TYRE_R, -3.05]}
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
          {/* chassis rails */}
          <mesh position={[0, 1.1, -2.2]} material={MAT.steelDark} castShadow>
            <boxGeometry args={[1.1, 0.6, 3.9]} />
          </mesh>
          {/* engine bonnet and grille */}
          <group userData={{ part: "engine" }}>
            <RoundedBox
              args={[1.95, 1.25, 2.3]}
              radius={0.14}
              position={[0, 1.98, -3.45]}
              material={MAT.paint}
              castShadow
              receiveShadow
            />
            <mesh position={[0, 1.92, -4.62]} material={MAT.grille}>
              <boxGeometry args={[1.5, 0.95, 0.06]} />
            </mesh>
            {[-0.45, -0.15, 0.15, 0.45].map((y) => (
              <mesh
                key={y}
                position={[0, 1.92 + y, -4.66]}
                material={MAT.steel}
              >
                <boxGeometry args={[1.5, 0.05, 0.03]} />
              </mesh>
            ))}
            <Decal
              text="CAT"
              logo
              position={[0.99, 2.05, -3.5]}
              rotation={[0, Math.PI / 2, 0]}
              width={1.1}
            />
            <Decal
              text="CAT"
              logo
              position={[-0.99, 2.05, -3.5]}
              rotation={[0, -Math.PI / 2, 0]}
              width={1.1}
            />
          </group>
          {/* front bumper with lights */}
          <mesh position={[0, 1.05, -4.78]} material={MAT.steelDark} castShadow>
            <boxGeometry args={[2.7, 0.35, 0.3]} />
          </mesh>
          <Lamp position={[-1.0, 1.08, -4.95]} size={[0.3, 0.18, 0.04]} />
          <Lamp position={[1.0, 1.08, -4.95]} size={[0.3, 0.18, 0.04]} />
          {/* front fenders */}
          {[-1, 1].map((side) => (
            <RoundedBox
              key={side}
              args={[0.95, 0.14, 2.3]}
              radius={0.05}
              position={[side * TRACK, 2.02, -3.05]}
              material={MAT.paint}
              castShadow
            />
          ))}
          {/* cab on its platform */}
          <group userData={{ part: "cab" }}>
            <mesh position={[0, 2.0, -1.55]} material={MAT.paint} castShadow>
              <boxGeometry args={[2.4, 0.2, 1.9]} />
            </mesh>
            <group position={[0, 2.95, -1.55]}>
              <mesh material={MAT.glass}>
                <boxGeometry args={[1.95, 1.6, 1.6]} />
              </mesh>
              {[
                [-0.95, -0.78],
                [0.95, -0.78],
                [-0.95, 0.78],
                [0.95, 0.78],
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
                args={[2.1, 0.16, 1.8]}
                radius={0.05}
                position={[0, 0.86, 0]}
                material={MAT.paint}
                castShadow
              />
              <mesh position={[0, -0.35, 0.2]} material={MAT.seat}>
                <boxGeometry args={[0.5, 0.5, 0.5]} />
              </mesh>
              <mesh position={[0, 0.05, 0.15]} material={MAT.seat}>
                <sphereGeometry args={[0.13, 10, 8]} />
              </mesh>
              <Beacon telemetry={telemetry} position={[0.6, 0.94, 0.5]} />
              <Lamp position={[-0.6, 0.97, -0.8]} />
              <Lamp position={[0.6, 0.97, -0.8]} />
              {/* mirrors on arms */}
              {[-1, 1].map((side) => (
                <group key={side} position={[side * 1.3, 0.2, -0.8]}>
                  <mesh position={[-side * 0.18, 0, 0]} material={MAT.black}>
                    <boxGeometry args={[0.4, 0.04, 0.04]} />
                  </mesh>
                  <mesh material={MAT.black}>
                    <boxGeometry args={[0.05, 0.42, 0.24]} />
                  </mesh>
                </group>
              ))}
            </group>
            {/* access ladder */}
            <group position={[-1.25, 1.2, -1.2]}>
              {[-0.2, 0.2].map((z) => (
                <mesh key={z} position={[0, 0, z]} material={MAT.black}>
                  <boxGeometry args={[0.04, 1.6, 0.04]} />
                </mesh>
              ))}
              {[-0.6, -0.2, 0.2, 0.6].map((y) => (
                <mesh key={y} position={[0, y, 0]} material={MAT.steel}>
                  <boxGeometry args={[0.05, 0.04, 0.44]} />
                </mesh>
              ))}
            </group>
          </group>
          {/* exhaust */}
          <mesh
            position={[0.95, 3.0, -2.5]}
            material={MAT.black}
            castShadow
            userData={{ part: "engine" }}
          >
            <cylinderGeometry args={[0.08, 0.09, 1.2, 10]} />
          </mesh>
          {/* hitch */}
          <mesh
            userData={{ part: "hitch" }}
            position={[0, 1.05, 0]}
            rotation={[0, 0, 0]}
            material={MAT.steelDark}
            castShadow
          >
            <cylinderGeometry args={[0.38, 0.38, 0.9, 14]} />
          </mesh>

          {/* X-ray internals: engine block, hoist pump, lines back to the hitch */}
          <InternalBox
            part="engine"
            position={[0, 1.95, -3.4]}
            size={[1.4, 0.95, 1.7]}
          />
          <InternalBox
            part="hydraulic_pump"
            position={[0.5, 1.3, -0.4]}
            size={[0.4, 0.4, 0.5]}
          />
          <InternalTube
            part="hydraulic_lines"
            from={[0.5, 1.25, -0.6]}
            to={[0.3, 1.1, 0]}
          />
        </group>

        {/* ---------------- trailer unit ---------------- */}
        <group ref={trailer} position={[0, 0, HITCH_Z]}>
          {/* tandem bogies */}
          {[3.1, 4.9].map((z) =>
            [-1, 1].map((side) => (
              <group
                key={`${z}${side}`}
                position={[side * TRACK, TYRE_R, z]}
                userData={{ part: "undercarriage" }}
              >
                <Tyre
                  radius={TYRE_R}
                  width={TYRE_W}
                  spinRef={spinRef}
                  side={side as 1 | -1}
                />
              </group>
            )),
          )}
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[side * 0.85, 1.0, 4.0]}
              material={MAT.steelDark}
              castShadow
            >
              <boxGeometry args={[0.3, 0.45, 2.4]} />
            </mesh>
          ))}
          {/* frame rails */}
          <mesh position={[0, 1.2, 2.6]} material={MAT.steelDark} castShadow>
            <boxGeometry args={[1.2, 0.5, 5.2]} />
          </mesh>
          <Anchor anchorRef={hoistBaseL} position={[-0.75, 1.25, 1.2]} />
          <Anchor anchorRef={hoistBaseR} position={[0.75, 1.25, 1.2]} />
          <TailLamps
            telemetry={telemetry}
            positions={[
              [-1.2, 1.35, 5.62],
              [1.2, 1.35, 5.62],
            ]}
          />

          {/* ---------------- dump body, hinged at the tail ---------------- */}
          <group
            ref={body}
            position={[0, 1.55, 5.2]}
            userData={{ part: "dump_body" }}
          >
            <mesh
              geometry={geo.side}
              position={[1.62, 0, 0]}
              material={MAT.paint}
              castShadow
              receiveShadow
            />
            <mesh
              geometry={geo.side}
              position={[-1.62, 0, 0]}
              material={MAT.paint}
              castShadow
              receiveShadow
            />
            <Decal
              text="CAT"
              logo
              position={[1.7, 1.05, -2.3]}
              rotation={[0, Math.PI / 2, 0]}
              width={2.0}
            />
            <Decal
              text="CAT"
              logo
              position={[-1.7, 1.05, -2.3]}
              rotation={[0, -Math.PI / 2, 0]}
              width={2.0}
            />
            <Decal
              text="745"
              position={[1.7, 0.55, -4.3]}
              rotation={[0, Math.PI / 2, 0]}
              width={0.9}
            />
            {/* floor, rising to the headboard */}
            <mesh
              position={[0, 0.2, -2.4]}
              rotation={[-0.08, 0, 0]}
              material={MAT.paintWorn}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[3.3, 0.14, 5.1]} />
            </mesh>
            {/* tail chute lip */}
            <mesh
              position={[0, 0.15, 0.55]}
              rotation={[0.2, 0, 0]}
              material={MAT.paintWorn}
              castShadow
            >
              <boxGeometry args={[3.3, 0.12, 1.2]} />
            </mesh>
            {/* headboard with canopy over the hitch */}
            <mesh
              position={[0, 1.3, -5.25]}
              rotation={[-0.08, 0, 0]}
              material={MAT.paint}
              castShadow
            >
              <boxGeometry args={[3.3, 1.85, 0.14]} />
            </mesh>
            <mesh position={[0, 2.18, -5.55]} material={MAT.paint} castShadow>
              <boxGeometry args={[3.3, 0.12, 0.8]} />
            </mesh>
            {/* reinforcing ribs on the sides */}
            {[-1.0, -2.2, -3.4, -4.4].map((z) =>
              [-1, 1].map((side) => (
                <mesh
                  key={`${z}${side}`}
                  position={[side * 1.7, 0.95, z]}
                  material={MAT.paintDark}
                >
                  <boxGeometry args={[0.06, 1.5, 0.1]} />
                </mesh>
              )),
            )}
            {/* the load */}
            <mesh
              ref={heap}
              position={[0, 0.55, -2.5]}
              material={MAT.dirt}
              visible={false}
              castShadow
            >
              <sphereGeometry
                args={[1.55, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]}
              />
            </mesh>
            <Anchor anchorRef={hoistRodL} position={[-0.75, 0.15, -3.6]} />
            <Anchor anchorRef={hoistRodR} position={[0.75, 0.15, -3.6]} />
          </group>
          <Ram
            from={hoistBaseL}
            to={hoistRodL}
            radius={0.12}
            part="hydraulic_lines"
          />
          <Ram
            from={hoistBaseR}
            to={hoistRodR}
            radius={0.12}
            part="hydraulic_lines"
          />
          {[-1, 1].map((side) => (
            <InternalTube
              key={side}
              part="hydraulic_lines"
              from={[0.2 * side, 1.1, 0.1]}
              to={[0.75 * side, 1.25, 1.2]}
            />
          ))}
        </group>
      </group>
    </group>
  );
}
