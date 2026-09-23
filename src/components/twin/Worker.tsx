"use client";

/**
 * Site crew.
 *
 * Each figure walks its route, and any worker inside the excavator's sensor
 * ring gets a floating marker plus a ground pulse in the matching level colour.
 * All of it is driven imperatively from engine state — no React re-renders.
 */

import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { SiteWorker } from "@/types/twin";
import { terrainHeight } from "@/lib/twin/terrain";
import { PROXIMITY, proximityLevel } from "@/lib/twin/proximity";
import { useTwinStore } from "@/store/twinStore";
import { PALETTE } from "./materials";

export function Worker({ worker }: { worker: SiteWorker }) {
  const root = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Mesh>(null);
  const legR = useRef<THREE.Mesh>(null);
  const armL = useRef<THREE.Mesh>(null);
  const armR = useRef<THREE.Mesh>(null);
  const marker = useRef<THREE.Group>(null);
  const markerMat = useRef<THREE.MeshStandardMaterial>(null);
  const ring = useRef<THREE.Mesh>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);

  const engine = useTwinStore((s) => s.engine);

  useFrame((state) => {
    const g = root.current;
    if (!g) return;

    g.position.set(worker.x, terrainHeight(worker.x, worker.z), worker.z);
    g.rotation.y = -worker.heading;

    // Gait: legs and arms counter-swing, amplitude drops when standing still.
    const walking = worker.state === "walking";
    const swing = walking ? Math.sin(worker.phase) * 0.6 : 0;
    if (legL.current) legL.current.rotation.x = swing;
    if (legR.current) legR.current.rotation.x = -swing;
    if (armL.current) armL.current.rotation.x = -swing * 0.7;
    if (armR.current) armR.current.rotation.x = swing * 0.7;

    // A worker who is "working" leans into the task.
    g.rotation.x = worker.state === "working" ? Math.sin(worker.phase * 0.5) * 0.1 + 0.12 : 0;

    // --- proximity highlight -------------------------------------------
    const p = engine.primary;
    const distance = Math.hypot(worker.x - p.x, worker.z - p.z);
    const inRange = distance <= PROXIMITY.warning;

    if (marker.current) marker.current.visible = inRange;
    if (ring.current) ring.current.visible = inRange;

    if (inRange) {
      const level = proximityLevel(distance);
      const colour = level === "critical" ? PALETTE.crit : PALETTE.warn;
      const t = state.clock.elapsedTime;

      if (markerMat.current) {
        markerMat.current.color.set(colour);
        markerMat.current.emissive.set(colour);
        markerMat.current.emissiveIntensity = 1.6 + Math.sin(t * 7) * 0.8;
      }
      if (marker.current) {
        marker.current.position.y = 2.75 + Math.sin(t * 3) * 0.12;
        marker.current.rotation.y = t * 1.6;
      }
      if (ring.current && ringMat.current) {
        // Pulse outward, faster and more urgent when critical.
        const speed = level === "critical" ? 2.4 : 1.4;
        const phase = (t * speed) % 1;
        const scale = 0.9 + phase * 2.2;
        ring.current.scale.set(scale, scale, scale);
        ringMat.current.color.set(colour);
        ringMat.current.opacity = (1 - phase) * 0.75;
      }
    }
  });

  return (
    <group ref={root}>
      {/* hi-vis vest / torso */}
      <mesh position={[0, 1.15, 0]} castShadow>
        <boxGeometry args={[0.44, 0.6, 0.26]} />
        <meshStandardMaterial
          color={PALETTE.vest}
          roughness={0.6}
          emissive={PALETTE.vest}
          emissiveIntensity={0.25}
        />
      </mesh>
      {/* lower torso */}
      <mesh position={[0, 0.78, 0]} castShadow>
        <boxGeometry args={[0.38, 0.3, 0.22]} />
        <meshStandardMaterial color="#2f3a4a" roughness={0.9} />
      </mesh>
      {/* head */}
      <mesh position={[0, 1.62, 0]} castShadow>
        <sphereGeometry args={[0.13, 10, 8]} />
        <meshStandardMaterial color="#c7a186" roughness={0.9} />
      </mesh>
      {/* hard hat */}
      <mesh position={[0, 1.72, 0]} castShadow>
        <sphereGeometry args={[0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={PALETTE.worker} roughness={0.5} />
      </mesh>

      {/* arms */}
      <mesh ref={armL} position={[-0.3, 1.32, 0]} castShadow>
        <boxGeometry args={[0.12, 0.62, 0.14]} />
        <meshStandardMaterial color={PALETTE.vest} roughness={0.7} />
      </mesh>
      <mesh ref={armR} position={[0.3, 1.32, 0]} castShadow>
        <boxGeometry args={[0.12, 0.62, 0.14]} />
        <meshStandardMaterial color={PALETTE.vest} roughness={0.7} />
      </mesh>

      {/* legs */}
      <mesh ref={legL} position={[-0.12, 0.62, 0]} castShadow>
        <boxGeometry args={[0.15, 0.7, 0.16]} />
        <meshStandardMaterial color="#2f3a4a" roughness={0.9} />
      </mesh>
      <mesh ref={legR} position={[0.12, 0.62, 0]} castShadow>
        <boxGeometry args={[0.15, 0.7, 0.16]} />
        <meshStandardMaterial color="#2f3a4a" roughness={0.9} />
      </mesh>

      {/* --- hazard marker above the head --- */}
      <group ref={marker} position={[0, 2.75, 0]} visible={false}>
        <mesh rotation={[Math.PI, 0, 0]} castShadow>
          <coneGeometry args={[0.28, 0.5, 4]} />
          <meshStandardMaterial ref={markerMat} toneMapped={false} />
        </mesh>
      </group>

      {/* --- ground pulse --- */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]} visible={false}>
        <ringGeometry args={[0.7, 0.92, 24]} />
        <meshBasicMaterial
          ref={ringMat}
          transparent
          opacity={0.6}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/** Renders the whole crew from live engine state. */
export function WorkerCrew() {
  const engine = useTwinStore((s) => s.engine);
  const workers = engine.liveWorkers();

  return (
    <group>
      {workers.map((w) => (
        <Worker key={w.id} worker={w} />
      ))}
    </group>
  );
}
