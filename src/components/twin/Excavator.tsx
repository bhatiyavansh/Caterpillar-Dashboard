"use client";

/**
 * CAT 320 hydraulic excavator.
 *
 * Structure (each level is its own THREE.Group so it rotates independently):
 *
 *   Excavator            position + heading
 *   ├── Tilt             pitch / roll from the terrain
 *   │   ├── Undercarriage   track loops, rollers, idlers, sprockets
 *   │   └── House        swing
 *   │       ├── Cab, engine hood, counterweight, handrails, beacon
 *   │       └── Boom     boomAngle          (boom rams pinned to the house)
 *   │           └── Stick    stickAngle     (stick ram pinned to the boom)
 *   │               └── Bucket   bucketAngle (bucket ram + linkage)
 *
 * This component contains NO input handling and NO physics. It reads telemetry
 * and writes transforms — that is the entire contract.
 */

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import type { MachineTelemetry, ProximityLevel } from "@/types/twin";
import { useTwinStore } from "@/store/twinStore";
import { PALETTE } from "./materials";
import {
  Anchor,
  Beacon,
  Decal,
  Lamp,
  MAT,
  Ram,
  profileGeometry,
  shoeTexture,
} from "./rig";

interface ExcavatorProps {
  telemetry: MachineTelemetry;
  /** Drives the roof beacon colour on the operator's machine. */
  safety?: ProximityLevel;
  /** The operator's machine gets the safety beacon; others the standard amber. */
  primary?: boolean;
}

/** Rest offsets, in radians, so zeroed joints sit in a natural parked pose. */
const STICK_REST = -0.85;
const BUCKET_REST = -0.6;

const TRACK_GAUGE = 1.25;
const TRACK_LENGTH = 4.46;
const TRACK_WIDTH = 0.62;
const IDLER_R = 0.4;

/* ------------------------------------------------------------------------ */
/*  Geometry profiles (u forward, v up)                                     */
/* ------------------------------------------------------------------------ */

/** Banana boom: rises from the foot pin, crests, falls to the stick pin at (5.65, 0.26). */
const BOOM_PROFILE: [number, number][] = [
  [-0.38, -0.22],
  [0.9, 0.22],
  [2.55, 0.86],
  [3.35, 0.9],
  [5.9, 0.02],
  [5.95, 0.52],
  [3.45, 1.66],
  [2.5, 1.68],
  [0.85, 0.9],
  [-0.38, 0.34],
];

/** Stick: heavy back end (stick ram pin), tapering to the bucket pin at (2.9, 0). */
const STICK_PROFILE: [number, number][] = [
  [-0.78, 0.2],
  [-0.62, 0.66],
  [0.35, 0.42],
  [2.95, 0.16],
  [3.05, -0.14],
  [0.25, -0.3],
  [-0.5, -0.22],
];

/** Bucket shell (a C-section) and its side plate, pivot at the origin. */
const BUCKET_SHELL: [number, number][] = [
  [-0.12, 0.22],
  [0.35, 0.3],
  [0.82, 0.12],
  [1.1, -0.22],
  [1.06, -0.62],
  [0.94, -0.62],
  [0.96, -0.26],
  [0.74, 0.0],
  [0.34, 0.16],
  [0.0, 0.08],
  [-0.12, -0.06],
];
const BUCKET_SIDE: [number, number][] = [
  [-0.14, 0.24],
  [0.36, 0.32],
  [0.84, 0.13],
  [1.12, -0.22],
  [1.08, -0.64],
  [0.62, -0.52],
  [0.2, -0.3],
  [-0.14, -0.08],
];

/* ------------------------------------------------------------------------ */

export function Excavator({
  telemetry,
  safety = "safe",
  primary = false,
}: ExcavatorProps) {
  const root = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const house = useRef<THREE.Group>(null);
  const boom = useRef<THREE.Group>(null);
  const stick = useRef<THREE.Group>(null);
  const bucket = useRef<THREE.Group>(null);
  const load = useRef<THREE.Mesh>(null);
  const beacon = useRef<THREE.MeshStandardMaterial>(null);
  const wheels = useRef<THREE.Object3D[]>([]);

  // Ram anchors.
  const boomBaseL = useRef<THREE.Group>(null);
  const boomBaseR = useRef<THREE.Group>(null);
  const boomRodL = useRef<THREE.Group>(null);
  const boomRodR = useRef<THREE.Group>(null);
  const stickBase = useRef<THREE.Group>(null);
  const stickRod = useRef<THREE.Group>(null);
  const bucketBase = useRef<THREE.Group>(null);
  const bucketRod = useRef<THREE.Group>(null);

  const engine = useTwinStore((s) => s.engine);

  const geo = useMemo(
    () => ({
      boom: profileGeometry(BOOM_PROFILE, 0.62, 0.04),
      stick: profileGeometry(STICK_PROFILE, 0.46, 0.03),
      shell: profileGeometry(BUCKET_SHELL, 1.2, 0.01),
      side: profileGeometry(BUCKET_SIDE, 0.05, 0),
    }),
    [],
  );

  // Own shoe texture instances: top and bottom runs scroll in opposite directions.
  const shoes = useMemo(() => {
    const make = () => {
      const t = shoeTexture().clone();
      t.needsUpdate = true;
      t.repeat.set(1, TRACK_LENGTH / 1.8);
      return new THREE.MeshStandardMaterial({
        map: t,
        roughness: 0.9,
        metalness: 0.35,
      });
    };
    return { bottom: make(), top: make() };
  }, []);

  useFrame((state) => {
    const t = telemetry;
    const r = root.current;
    if (!r || !tilt.current || !house.current) return;

    r.position.set(t.x, t.y, t.z);
    // Model forward is -Z; world heading is clockwise from north, hence -heading.
    r.rotation.y = -t.heading;
    // Roll is positive leaning right, which is a negative rotation about local Z.
    tilt.current.rotation.x = t.pitch;
    tilt.current.rotation.z = -t.roll;

    house.current.rotation.y = -t.swingAngle;
    if (boom.current) boom.current.rotation.x = t.boomAngle;
    if (stick.current) stick.current.rotation.x = STICK_REST + t.stickAngle;
    if (bucket.current) bucket.current.rotation.x = BUCKET_REST + t.bucketAngle;
    if (load.current) {
      const fill = Math.min(t.payload / 2100, 1);
      load.current.visible = fill > 0.05;
      load.current.scale.set(1, 0.2 + fill * 0.8, 0.4 + fill * 0.6);
    }

    // Tracks: shoes scroll; idlers, sprockets and rollers turn.
    const travel = engine.modelOf(t.machineId).trackTravel;
    shoes.bottom.map!.offset.y = -travel / 1.8;
    shoes.top.map!.offset.y = travel / 1.8;
    for (const w of wheels.current) w.rotation.x = -travel / IDLER_R;

    if (primary && beacon.current) {
      const pulse = 0.55 + Math.sin(state.clock.elapsedTime * 6) * 0.45;
      const colour =
        safety === "critical"
          ? PALETTE.crit
          : safety === "warning"
            ? PALETTE.warn
            : PALETTE.catYellow;
      beacon.current.color.set(colour);
      beacon.current.emissive.set(colour);
      beacon.current.emissiveIntensity = safety === "safe" ? 0.8 : pulse * 3;
    }
  });

  const register = (el: THREE.Object3D | null) => {
    if (el && !wheels.current.includes(el)) wheels.current.push(el);
  };

  return (
    <group ref={root} {...handlers}>
      <group ref={tilt}>
        {/* ---------------- undercarriage ---------------- */}
        {[-1, 1].map((side) => (
          <TrackLoop
            key={side}
            side={side as -1 | 1}
            shoes={shoes}
            register={register}
          />
        ))}
        {/* car body tying the frames together */}
        <mesh
          position={[0, 0.72, 0]}
          material={MAT.steelDark}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[2.0, 0.44, 1.7]} />
        </mesh>
        <mesh position={[0, 0.98, 0]} material={MAT.black} castShadow>
          <cylinderGeometry args={[0.95, 1.0, 0.16, 28]} />
        </mesh>

        {/* ---------------- upper structure ---------------- */}
        <group ref={house} position={[0, 1.06, 0]}>
          {/* deck frame */}
          <mesh
            position={[0, 0.12, 0.3]}
            material={MAT.steelDark}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[2.52, 0.24, 3.9]} />
          </mesh>

          {/* right-side tool box / pump compartment */}
          <RoundedBox
            args={[1.2, 0.95, 1.6]}
            radius={0.08}
            position={[0.64, 0.72, -0.5]}
            material={MAT.paint}
            castShadow
            receiveShadow
          />
          {/* engine hood, sloping to the rear */}
          <RoundedBox
            args={[2.46, 0.95, 1.55]}
            radius={0.12}
            position={[0, 0.72, 1.12]}
            material={MAT.paint}
            castShadow
            receiveShadow
          />
          <RoundedBox
            args={[2.3, 0.18, 1.35]}
            radius={0.06}
            position={[0, 1.26, 1.12]}
            material={MAT.paintDark}
            castShadow
          />
          {/* engine grille slats on the hood side */}
          {[0.82, 1.02, 1.22, 1.42].map((z) => (
            <mesh key={z} position={[1.24, 0.78, z]} material={MAT.grille}>
              <boxGeometry args={[0.02, 0.5, 0.1]} />
            </mesh>
          ))}
          {/* counterweight: heavy rounded casting across the tail */}
          <RoundedBox
            args={[2.54, 1.02, 0.78]}
            radius={0.3}
            smoothness={5}
            position={[0, 0.64, 2.2]}
            material={MAT.paint}
            castShadow
            receiveShadow
          />
          <Decal
            text="CAT"
            logo
            position={[0, 0.72, 2.6]}
            rotation={[0, 0, 0]}
            width={0.95}
          />
          <TailLights />

          {/* exhaust stack with rain cap */}
          <mesh position={[0.72, 1.62, 1.05]} material={MAT.black} castShadow>
            <cylinderGeometry args={[0.07, 0.08, 0.55, 10]} />
          </mesh>
          <mesh
            position={[0.72, 1.9, 1.02]}
            rotation={[0.5, 0, 0]}
            material={MAT.black}
          >
            <cylinderGeometry args={[0.1, 0.1, 0.02, 10]} />
          </mesh>
          {/* air cleaner */}
          <mesh position={[0.25, 1.47, 0.72]} material={MAT.black} castShadow>
            <cylinderGeometry args={[0.13, 0.13, 0.3, 12]} />
          </mesh>

          {/* handrails along the right deck and over the hood */}
          <Handrail
            from={[1.2, 1.55, -1.25]}
            to={[1.2, 1.55, 0.25]}
            posts={0.35}
          />
          <Handrail
            from={[1.0, 1.66, 0.55]}
            to={[1.0, 1.66, 1.75]}
            posts={0.3}
          />

          {/* boom foot bracket on the house front */}
          <mesh
            position={[0.45, 0.62, -1.62]}
            material={MAT.steelDark}
            castShadow
          >
            <boxGeometry args={[0.95, 0.8, 0.7]} />
          </mesh>

          {/* cab riser */}
          <RoundedBox
            args={[1.1, 0.5, 1.7]}
            radius={0.05}
            position={[-0.7, 0.47, -0.74]}
            material={MAT.paint}
            castShadow
            receiveShadow
          />
          <Cab />
          <Lamp position={[0.65, 1.28, -1.33]} size={[0.24, 0.16, 0.08]} />

          {primary ? (
            <mesh position={[-0.48, 2.34, 0.05]}>
              <cylinderGeometry args={[0.09, 0.11, 0.2, 12]} />
              <meshStandardMaterial ref={beacon} toneMapped={false} />
            </mesh>
          ) : (
            <Beacon telemetry={telemetry} position={[-0.48, 2.24, 0.05]} />
          )}

          {/* boom ram bases on the house */}
          <Anchor anchorRef={boomBaseL} position={[0.09, 0.32, -1.95]} />
          <Anchor anchorRef={boomBaseR} position={[0.81, 0.32, -1.95]} />

          {/* ---------------- boom ---------------- */}
          <group ref={boom} position={[0.45, 1.05, -1.55]}>
            <mesh
              geometry={geo.boom}
              material={MAT.paint}
              castShadow
              receiveShadow
            />
            <Decal
              text="CAT"
              logo
              position={[0.32, 1.28, -2.95]}
              rotation={[0, Math.PI / 2, 0]}
              width={1.1}
            />
            <Decal
              text="CAT"
              logo
              position={[-0.32, 1.28, -2.95]}
              rotation={[0, -Math.PI / 2, 0]}
              width={1.1}
            />
            {/* foot pin boss and stick pin boss */}
            <mesh rotation={[0, 0, Math.PI / 2]} material={MAT.steelDark}>
              <cylinderGeometry args={[0.2, 0.2, 0.72, 14]} />
            </mesh>
            <mesh
              position={[0, 0.26, -5.65]}
              rotation={[0, 0, Math.PI / 2]}
              material={MAT.steelDark}
            >
              <cylinderGeometry args={[0.17, 0.17, 0.68, 14]} />
            </mesh>
            {/* hydraulic lines along the boom top */}
            <mesh
              position={[0.12, 1.72, -2.9]}
              rotation={[Math.PI / 2, 0, 0]}
              material={MAT.black}
            >
              <cylinderGeometry args={[0.035, 0.035, 1.6, 6]} />
            </mesh>
            <Anchor anchorRef={boomRodL} position={[-0.36, 0.72, -2.4]} />
            <Anchor anchorRef={boomRodR} position={[0.36, 0.72, -2.4]} />
            <Anchor anchorRef={stickBase} position={[0, 1.78, -2.85]} />

            {/* ---------------- stick ---------------- */}
            <group ref={stick} position={[0, 0.257, -5.65]}>
              <mesh
                geometry={geo.stick}
                material={MAT.paint}
                castShadow
                receiveShadow
              />
              <Anchor anchorRef={stickRod} position={[0, 0.6, 0.66]} />
              <Anchor anchorRef={bucketBase} position={[0, 0.5, -0.35]} />
              <mesh
                position={[0, 0, -2.9]}
                rotation={[0, 0, Math.PI / 2]}
                material={MAT.steelDark}
              >
                <cylinderGeometry args={[0.13, 0.13, 0.56, 12]} />
              </mesh>

              {/* ---------------- bucket ---------------- */}
              <group ref={bucket} position={[0, 0, -2.9]}>
                <mesh
                  geometry={geo.shell}
                  material={MAT.paintWorn}
                  castShadow
                  receiveShadow
                />
                <mesh
                  geometry={geo.side}
                  position={[0.6, 0, 0]}
                  material={MAT.paintWorn}
                  castShadow
                />
                <mesh
                  geometry={geo.side}
                  position={[-0.6, 0, 0]}
                  material={MAT.paintWorn}
                  castShadow
                />
                {/* linkage ear the bucket ram pulls on */}
                <mesh
                  position={[0, 0.28, -0.1]}
                  material={MAT.steelDark}
                  castShadow
                >
                  <boxGeometry args={[0.3, 0.3, 0.34]} />
                </mesh>
                <Anchor anchorRef={bucketRod} position={[0, 0.42, -0.02]} />
                {/* wear strips and teeth along the lip */}
                <mesh position={[0, -0.64, -1.0]} material={MAT.wear}>
                  <boxGeometry args={[1.22, 0.06, 0.16]} />
                </mesh>
                {[-0.48, -0.24, 0, 0.24, 0.48].map((x) => (
                  <mesh
                    key={x}
                    position={[x, -0.76, -1.0]}
                    rotation={[0.25, 0, 0]}
                    material={MAT.wear}
                    castShadow
                  >
                    <coneGeometry args={[0.07, 0.3, 4]} />
                  </mesh>
                ))}
                {/* the load */}
                <mesh
                  ref={load}
                  position={[0, -0.2, -0.55]}
                  material={MAT.dirt}
                  visible={false}
                >
                  <sphereGeometry args={[0.46, 9, 7]} />
                </mesh>
              </group>
            </group>
          </group>

          {/* rams: twin boom rams, stick ram, bucket ram */}
          <Ram from={boomBaseL} to={boomRodL} radius={0.11} />
          <Ram from={boomBaseR} to={boomRodR} radius={0.11} />
          <Ram from={stickBase} to={stickRod} radius={0.1} />
          <Ram from={bucketBase} to={bucketRod} radius={0.085} />
        </group>
      </group>
    </group>
  );
}

/* ----------------------------------------------------------------------- */

function TrackLoop({
  side,
  shoes,
  register,
}: {
  side: -1 | 1;
  shoes: { bottom: THREE.Material; top: THREE.Material };
  register: (el: THREE.Object3D | null) => void;
}) {
  const half = TRACK_LENGTH / 2 - IDLER_R;
  const run = half * 2;
  const top = IDLER_R * 2;
  return (
    <group position={[TRACK_GAUGE * side, 0, 0]}>
      {/* ground and top runs of shoes */}
      <mesh
        position={[0, 0.05, 0]}
        material={shoes.bottom}
        receiveShadow
        castShadow
      >
        <boxGeometry args={[TRACK_WIDTH, 0.1, run]} />
      </mesh>
      <mesh position={[0, top + 0.05, 0]} material={shoes.top} castShadow>
        <boxGeometry args={[TRACK_WIDTH, 0.1, run]} />
      </mesh>
      {/* the loop wraps round the idler (front) and sprocket (rear) */}
      {[-1, 1].map((end) => (
        <mesh
          key={end}
          position={[0, IDLER_R + 0.05, end * half]}
          rotation={[0, 0, Math.PI / 2]}
          material={MAT.rubber}
          castShadow
        >
          <cylinderGeometry
            args={[
              IDLER_R + 0.05,
              IDLER_R + 0.05,
              TRACK_WIDTH,
              16,
              1,
              true,
              end > 0 ? -Math.PI / 2 : Math.PI / 2,
              Math.PI,
            ]}
          />
        </mesh>
      ))}
      {/* track frame */}
      <mesh position={[0, 0.46, 0]} material={MAT.steelDark} castShadow>
        <boxGeometry args={[0.42, 0.42, run - 0.2]} />
      </mesh>
      {/* front idler */}
      <group ref={register} position={[0, IDLER_R + 0.05, -half]}>
        <mesh rotation={[0, 0, Math.PI / 2]} material={MAT.steel}>
          <cylinderGeometry
            args={[IDLER_R - 0.02, IDLER_R - 0.02, TRACK_WIDTH - 0.1, 18]}
          />
        </mesh>
        <mesh position={[side * 0.27, 0.22, 0]} material={MAT.paint}>
          <boxGeometry args={[0.03, 0.08, 0.3]} />
        </mesh>
      </group>
      {/* drive sprocket with teeth */}
      <group ref={register} position={[0, IDLER_R + 0.05, half]}>
        <mesh rotation={[0, 0, Math.PI / 2]} material={MAT.steelDark}>
          <cylinderGeometry args={[IDLER_R - 0.04, IDLER_R - 0.04, 0.3, 14]} />
        </mesh>
        {Array.from({ length: 10 }, (_, i) => {
          const a = (i / 10) * Math.PI * 2;
          return (
            <mesh
              key={i}
              position={[
                0,
                Math.sin(a) * (IDLER_R - 0.02),
                Math.cos(a) * (IDLER_R - 0.02),
              ]}
              rotation={[a, 0, 0]}
              material={MAT.steel}
            >
              <boxGeometry args={[0.24, 0.08, 0.09]} />
            </mesh>
          );
        })}
        {/* final drive */}
        <mesh
          position={[side * 0.3, 0, 0]}
          rotation={[0, 0, Math.PI / 2]}
          material={MAT.black}
        >
          <cylinderGeometry args={[0.3, 0.33, 0.28, 16]} />
        </mesh>
      </group>
      {/* bottom rollers */}
      {[-1.25, -0.63, 0, 0.63, 1.25].map((z) => (
        <group key={z} ref={register} position={[0, 0.2, z]}>
          <mesh rotation={[0, 0, Math.PI / 2]} material={MAT.steel}>
            <cylinderGeometry args={[0.13, 0.13, 0.46, 10]} />
          </mesh>
        </group>
      ))}
      {/* carrier rollers */}
      {[-0.7, 0.7].map((z) => (
        <mesh
          key={z}
          position={[0, top - 0.08, z]}
          rotation={[0, 0, Math.PI / 2]}
          material={MAT.steel}
        >
          <cylinderGeometry args={[0.09, 0.09, 0.3, 8]} />
        </mesh>
      ))}
      {/* track guard */}
      <mesh position={[side * 0.24, 0.5, 0]} material={MAT.steelDark}>
        <boxGeometry args={[0.04, 0.2, run - 0.4]} />
      </mesh>
    </group>
  );
}

/** ROPS cab: black pillars, tinted glass, roof guard, an operator inside. */
function Cab() {
  const pillars: [number, number][] = [
    [-0.47, -0.78],
    [0.47, -0.78],
    [-0.47, 0.72],
    [0.47, 0.72],
  ];
  return (
    <group position={[-0.7, 1.42, -0.72]}>
      {/* glazing volume */}
      <mesh position={[0, 0, -0.03]} material={MAT.glass}>
        <boxGeometry args={[0.98, 1.38, 1.5]} />
      </mesh>
      {/* frame: pillars, roof, sill */}
      {pillars.map(([x, z]) => (
        <mesh
          key={`${x}${z}`}
          position={[x, 0, z]}
          material={MAT.black}
          castShadow
        >
          <boxGeometry args={[0.07, 1.42, 0.07]} />
        </mesh>
      ))}
      <RoundedBox
        args={[1.08, 0.14, 1.66]}
        radius={0.05}
        position={[0, 0.76, -0.02]}
        material={MAT.paint}
        castShadow
      />
      <mesh position={[0, -0.66, -0.02]} material={MAT.paint} castShadow>
        <boxGeometry args={[1.04, 0.14, 1.62]} />
      </mesh>
      {/* front guard bars */}
      {[-0.25, 0, 0.25].map((x) => (
        <mesh key={x} position={[x, 0.05, -0.83]} material={MAT.black}>
          <boxGeometry args={[0.03, 1.2, 0.03]} />
        </mesh>
      ))}
      {/* operator and seat */}
      <mesh position={[0, -0.28, 0.25]} material={MAT.seat}>
        <boxGeometry args={[0.5, 0.5, 0.5]} />
      </mesh>
      <mesh position={[0, 0.1, 0.18]} material={MAT.seat}>
        <sphereGeometry args={[0.13, 10, 8]} />
      </mesh>
      <mesh position={[0, 0.18, 0.2]}>
        <sphereGeometry args={[0.135, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#f5f5f0" roughness={0.5} />
      </mesh>
      {/* mirrors */}
      <mesh position={[-0.62, 0.35, -0.85]} material={MAT.black}>
        <boxGeometry args={[0.04, 0.3, 0.18]} />
      </mesh>
      {/* work lights on the roof */}
      <Lamp position={[-0.3, 0.86, -0.78]} />
      <Lamp position={[0.3, 0.86, -0.78]} />
    </group>
  );
}

function TailLights() {
  return (
    <group>
      {[-1.1, 1.1].map((x) => (
        <mesh key={x} position={[x, 0.95, 2.6]} material={MAT.lampRed}>
          <boxGeometry args={[0.16, 0.1, 0.03]} />
        </mesh>
      ))}
    </group>
  );
}

function Handrail({
  from,
  to,
  posts = 0.5,
}: {
  from: [number, number, number];
  to: [number, number, number];
  posts?: number;
}) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const len = a.distanceTo(b);
  return (
    <group>
      <mesh position={mid} rotation={[Math.PI / 2, 0, 0]} material={MAT.paint}>
        <cylinderGeometry args={[0.025, 0.025, len, 6]} />
      </mesh>
      {[0, 0.5, 1].map((k) => {
        const p = a.clone().lerp(b, k);
        return (
          <mesh
            key={k}
            position={[p.x, p.y - posts / 2, p.z]}
            material={MAT.paint}
          >
            <cylinderGeometry args={[0.022, 0.022, posts, 6]} />
          </mesh>
        );
      })}
    </group>
  );
}
