"use client";

/**
 * EXC001 — the controllable machine.
 *
 * Structure (each level is its own THREE.Group so it rotates independently):
 *
 *   Excavator            position + heading
 *   ├── Tilt             pitch / roll from the terrain
 *   │   ├── Tracks       scrolling shoe texture + sprockets
 *   │   ├── Undercarriage
 *   │   └── House        swing
 *   │       ├── Cabin, counterweight, deck
 *   │       └── Boom     boomAngle
 *   │           └── Stick    stickAngle
 *   │               └── Bucket   bucketAngle
 *
 * This component contains NO input handling and NO physics. It reads telemetry
 * and writes transforms — that is the entire contract. Replacing the keyboard
 * with a WebSocket feed requires no change here.
 */

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { MachineTelemetry, ProximityLevel } from "@/types/twin";
import { useTwinStore } from "@/store/twinStore";
import { PALETTE, trackTexture } from "./materials";

interface ExcavatorProps {
  telemetry: MachineTelemetry;
  /** Drives the roof beacon colour. */
  safety?: ProximityLevel;
}

/** Rest offsets, in radians, so zeroed joints sit in a natural parked pose. */
const STICK_REST = -0.85;
const BUCKET_REST = -0.6;

export function Excavator({ telemetry, safety = "safe" }: ExcavatorProps) {
  const root = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const house = useRef<THREE.Group>(null);
  const boom = useRef<THREE.Group>(null);
  const stick = useRef<THREE.Group>(null);
  const bucket = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.MeshStandardMaterial>(null);
  const sprockets = useRef<THREE.Group[]>([]);

  const engine = useTwinStore((s) => s.engine);

  // Own texture instance so this machine's tracks scroll independently.
  const tracks = useMemo(() => {
    const t = trackTexture().clone();
    t.needsUpdate = true;
    return t;
  }, []);

  useFrame((state) => {
    const t = telemetry;
    const r = root.current;
    if (!r || !tilt.current || !house.current) return;

    // --- chassis -------------------------------------------------------
    r.position.set(t.x, t.y, t.z);
    // Model forward is -Z; world heading is clockwise from north, hence -heading.
    r.rotation.y = -t.heading;

    // Roll is positive leaning right, which is a negative rotation about local Z.
    tilt.current.rotation.x = t.pitch;
    tilt.current.rotation.z = -t.roll;

    // --- upper body ----------------------------------------------------
    house.current.rotation.y = -t.swingAngle;

    // --- arm -----------------------------------------------------------
    if (boom.current) boom.current.rotation.x = t.boomAngle;
    if (stick.current) stick.current.rotation.x = STICK_REST + t.stickAngle;
    if (bucket.current) bucket.current.rotation.x = BUCKET_REST + t.bucketAngle;

    // --- tracks --------------------------------------------------------
    const travel = engine.modelOf(t.machineId).trackTravel;
    tracks.offset.x = -travel * 0.32;
    for (const s of sprockets.current) {
      if (s) s.rotation.x = travel * 1.9;
    }

    // --- beacon --------------------------------------------------------
    if (beacon.current) {
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

  return (
    <group ref={root}>
      <group ref={tilt}>
        {/* ---------------- undercarriage ---------------- */}
        <TrackAssembly side={-1} texture={tracks} sprockets={sprockets} />
        <TrackAssembly side={1} texture={tracks} sprockets={sprockets} />

        {/* car body tying the tracks together */}
        <mesh position={[0, 0.78, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.7, 0.52, 1.9]} />
          <meshStandardMaterial color={PALETTE.steel} roughness={0.8} metalness={0.3} />
        </mesh>
        {/* swing bearing */}
        <mesh position={[0, 1.06, 0]} castShadow>
          <cylinderGeometry args={[0.92, 0.98, 0.22, 20]} />
          <meshStandardMaterial color={PALETTE.steelDark} roughness={0.6} metalness={0.5} />
        </mesh>

        {/* ---------------- upper body ---------------- */}
        <group ref={house} position={[0, 1.14, 0]}>
          {/* main housing */}
          <mesh position={[0, 0.7, 0.35]} castShadow receiveShadow>
            <boxGeometry args={[2.5, 1.35, 3.6]} />
            <meshStandardMaterial color={PALETTE.catYellow} roughness={0.55} metalness={0.25} />
          </mesh>
          {/* engine deck */}
          <mesh position={[0, 1.55, 1.25]} castShadow>
            <boxGeometry args={[2.3, 0.5, 1.7]} />
            <meshStandardMaterial color={PALETTE.catYellowDark} roughness={0.6} metalness={0.3} />
          </mesh>
          {/* counterweight */}
          <mesh position={[0, 0.62, 2.28]} castShadow>
            <boxGeometry args={[2.62, 1.25, 0.95]} />
            <meshStandardMaterial color={PALETTE.steel} roughness={0.85} metalness={0.35} />
          </mesh>
          {/* walkway */}
          <mesh position={[0, 0.04, 0.35]} receiveShadow>
            <boxGeometry args={[2.72, 0.12, 3.7]} />
            <meshStandardMaterial color={PALETTE.steelDark} roughness={0.9} />
          </mesh>

          <Cabin />
          <Exhaust />
          <Handrail x={-1.32} />
          <Handrail x={1.32} />

          {/* roof beacon */}
          <mesh position={[-0.72, 2.42, -0.35]} castShadow>
            <cylinderGeometry args={[0.11, 0.13, 0.2, 10]} />
            <meshStandardMaterial ref={beacon} toneMapped={false} />
          </mesh>

          {/* ---------------- boom ---------------- */}
          <group ref={boom} position={[0.45, 1.05, -1.55]}>
            {/* lower boom section, rising forward */}
            <mesh position={[0, 0.488, -1.576]} rotation={[0.3, 0, 0]} castShadow>
              <boxGeometry args={[0.62, 0.78, 3.3]} />
              <meshStandardMaterial
                color={PALETTE.catYellow}
                roughness={0.55}
                metalness={0.25}
              />
            </mesh>
            {/* upper boom section, falling away to the stick pivot */}
            <mesh position={[0, 0.616, -4.4]} rotation={[-0.28, 0, 0]} castShadow>
              <boxGeometry args={[0.56, 0.66, 2.6]} />
              <meshStandardMaterial
                color={PALETTE.catYellow}
                roughness={0.55}
                metalness={0.25}
              />
            </mesh>
            {/* boom lift cylinder */}
            <mesh position={[0, 0.05, -1.1]} rotation={[0.42, 0, 0]} castShadow>
              <cylinderGeometry args={[0.13, 0.13, 2.1, 10]} />
              <meshStandardMaterial color={PALETTE.steelLight} roughness={0.3} metalness={0.85} />
            </mesh>
            {/* stick cylinder riding on top of the boom */}
            <mesh position={[0, 1.02, -3.1]} rotation={[0.16, 0, 0]} castShadow>
              <cylinderGeometry args={[0.11, 0.11, 2.3, 10]} />
              <meshStandardMaterial color={PALETTE.steelLight} roughness={0.3} metalness={0.85} />
            </mesh>

            {/* ---------------- stick ---------------- */}
            <group ref={stick} position={[0, 0.257, -5.65]}>
              <mesh position={[0, 0, -1.45]} castShadow>
                <boxGeometry args={[0.46, 0.58, 2.9]} />
                <meshStandardMaterial
                  color={PALETTE.catYellow}
                  roughness={0.55}
                  metalness={0.25}
                />
              </mesh>
              {/* bucket cylinder */}
              <mesh position={[0, 0.42, -1.0]} rotation={[0.1, 0, 0]} castShadow>
                <cylinderGeometry args={[0.095, 0.095, 1.7, 10]} />
                <meshStandardMaterial
                  color={PALETTE.steelLight}
                  roughness={0.3}
                  metalness={0.85}
                />
              </mesh>

              {/* ---------------- bucket ---------------- */}
              <group ref={bucket} position={[0, 0, -2.9]}>
                <Bucket />
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

/* ----------------------------------------------------------------------- */

function TrackAssembly({
  side,
  texture,
  sprockets,
}: {
  side: -1 | 1;
  texture: THREE.Texture;
  sprockets: React.RefObject<THREE.Group[]>;
}) {
  const register = (el: THREE.Group | null) => {
    if (el && sprockets.current && !sprockets.current.includes(el)) {
      sprockets.current.push(el);
    }
  };

  return (
    <group position={[1.25 * side, 0, 0]}>
      {/* shoe belt */}
      <mesh position={[0, 0.48, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.8, 0.96, 4.4]} />
        <meshStandardMaterial map={texture} roughness={0.95} metalness={0.15} />
      </mesh>
      {/* idler and sprocket */}
      {[-2.2, 2.2].map((z) => (
        <group key={z} ref={register} position={[0, 0.48, z]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.48, 0.48, 0.82, 12]} />
            <meshStandardMaterial color={PALETTE.steelDark} roughness={0.8} metalness={0.4} />
          </mesh>
          {/* spoke marker so the rotation is visible */}
          <mesh position={[0.42 * -side, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <boxGeometry args={[0.06, 0.02, 0.62]} />
            <meshStandardMaterial color={PALETTE.catYellow} roughness={0.6} />
          </mesh>
        </group>
      ))}
      {/* track frame */}
      <mesh position={[0, 0.62, 0]}>
        <boxGeometry args={[0.55, 0.5, 3.6]} />
        <meshStandardMaterial color={PALETTE.steel} roughness={0.85} metalness={0.3} />
      </mesh>
    </group>
  );
}

function Cabin() {
  return (
    <group position={[-0.72, 1.52, -0.75]}>
      {/* frame */}
      <mesh castShadow>
        <boxGeometry args={[1.06, 1.6, 1.62]} />
        <meshStandardMaterial color={PALETTE.catYellow} roughness={0.5} metalness={0.2} />
      </mesh>
      {/* glazing — slightly inset so the frame reads as a cage */}
      <mesh position={[-0.02, 0.12, 0]}>
        <boxGeometry args={[1.1, 1.18, 1.5]} />
        <meshStandardMaterial
          color={PALETTE.glass}
          roughness={0.08}
          metalness={0.1}
          transparent
          opacity={0.55}
        />
      </mesh>
      {/* roof */}
      <mesh position={[0, 0.84, 0]} castShadow>
        <boxGeometry args={[1.12, 0.12, 1.68]} />
        <meshStandardMaterial color={PALETTE.steelDark} roughness={0.8} />
      </mesh>
      {/* work lights */}
      {[-0.35, 0.35].map((z) => (
        <mesh key={z} position={[-0.5, 0.72, z]}>
          <boxGeometry args={[0.14, 0.12, 0.2]} />
          <meshStandardMaterial
            color="#fff6d8"
            emissive="#ffe9a8"
            emissiveIntensity={1.4}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function Exhaust() {
  return (
    <mesh position={[0.86, 1.95, 0.55]} castShadow>
      <cylinderGeometry args={[0.1, 0.12, 0.62, 10]} />
      <meshStandardMaterial color={PALETTE.steelDark} roughness={0.7} metalness={0.6} />
    </mesh>
  );
}

function Handrail({ x }: { x: number }) {
  return (
    <group position={[x, 0.42, 0.35]}>
      <mesh>
        <boxGeometry args={[0.05, 0.05, 3.3]} />
        <meshStandardMaterial color={PALETTE.catYellowDark} roughness={0.7} metalness={0.4} />
      </mesh>
      {[-1.4, 0, 1.4].map((z) => (
        <mesh key={z} position={[0, -0.2, z]}>
          <boxGeometry args={[0.04, 0.4, 0.04]} />
          <meshStandardMaterial color={PALETTE.catYellowDark} roughness={0.7} metalness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

/** Curved shell built from an open-ended cylinder, plus side plates and teeth. */
function Bucket() {
  const shell = useMemo(
    () =>
      new THREE.CylinderGeometry(0.62, 0.62, 1.3, 14, 1, true, Math.PI * 0.08, Math.PI * 1.15),
    [],
  );

  return (
    <group position={[0, -0.28, -0.32]}>
      {/* the scoop */}
      <mesh geometry={shell} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
        <meshStandardMaterial
          color={PALETTE.steel}
          roughness={0.7}
          metalness={0.55}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* side plates */}
      {[-0.65, 0.65].map((x) => (
        <mesh key={x} position={[x, 0, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
          <circleGeometry args={[0.62, 14]} />
          <meshStandardMaterial
            color={PALETTE.steelDark}
            roughness={0.75}
            metalness={0.5}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      {/* cutting edge and teeth */}
      <mesh position={[0, -0.28, -0.52]} rotation={[0.35, 0, 0]} castShadow>
        <boxGeometry args={[1.3, 0.1, 0.34]} />
        <meshStandardMaterial color={PALETTE.steelLight} roughness={0.45} metalness={0.8} />
      </mesh>
      {[-0.48, -0.24, 0, 0.24, 0.48].map((x) => (
        <mesh key={x} position={[x, -0.36, -0.68]} rotation={[0.35, 0, 0]} castShadow>
          <boxGeometry args={[0.13, 0.08, 0.26]} />
          <meshStandardMaterial color="#8d949c" roughness={0.4} metalness={0.9} />
        </mesh>
      ))}
    </group>
  );
}
