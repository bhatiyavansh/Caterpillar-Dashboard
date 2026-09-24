"use client";

/**
 * Structures added with the physically simulated landsite: ramp guardrails,
 * the crusher plant, the perimeter fence and gate, and the settling pond.
 *
 * Every solid thing here is drawn from `SITE_COLLIDERS` — the list the
 * physics world builds its static colliders from — so a machine is stopped
 * by exactly the box you can see. The pond water is the one non-solid
 * element: the basin under it is terrain, so a machine that drives in sinks
 * to the bottom rather than floating.
 */

import { useMemo } from "react";
import * as THREE from "three";
import { CRUSHER, PERIMETER, POND, SITE_COLLIDERS, type StaticCollider } from "@/lib/twin/site";
import { terrainHeight } from "@/lib/twin/terrain";
import { PALETTE, hazardTexture } from "./materials";

function groundY(c: StaticCollider): number {
  return terrainHeight(c.x, c.z) + (c.lift ?? c.hy);
}

function byPrefix(prefix: string): StaticCollider[] {
  return SITE_COLLIDERS.filter((c) => c.id.startsWith(prefix));
}

/* ------------------------------------------------------------ guardrails */

function Guardrails() {
  const rails = useMemo(() => byPrefix("rail-"), []);
  return (
    <group>
      {rails.map((r) => {
        const len = r.hz * 2;
        const posts = Math.max(2, Math.round(len / 3));
        return (
          <group key={r.id}>
            {/* The rail follows the ramp grade: sample both ends. */}
            {Array.from({ length: posts }, (_, i) => {
              const z = r.z - r.hz + (i / (posts - 1)) * len;
              const y = terrainHeight(r.x, z);
              return (
                <group key={i}>
                  <mesh position={[r.x, y + 0.45, z]} castShadow>
                    <boxGeometry args={[0.14, 0.9, 0.14]} />
                    <meshStandardMaterial color={PALETTE.steelLight} roughness={0.5} metalness={0.7} />
                  </mesh>
                  {i < posts - 1 ? (
                    <RailBeam x={r.x} z1={z} z2={z + len / (posts - 1)} />
                  ) : null}
                </group>
              );
            })}
          </group>
        );
      })}
    </group>
  );
}

function RailBeam({ x, z1, z2 }: { x: number; z1: number; z2: number }) {
  const y1 = terrainHeight(x, z1) + 0.78;
  const y2 = terrainHeight(x, z2) + 0.78;
  const len = Math.hypot(z2 - z1, y2 - y1);
  const angle = Math.atan2(y2 - y1, z2 - z1);
  return (
    <mesh position={[x, (y1 + y2) / 2, (z1 + z2) / 2]} rotation={[-angle, 0, 0]} castShadow>
      <boxGeometry args={[0.1, 0.32, len]} />
      <meshStandardMaterial color="#c9ced4" roughness={0.35} metalness={0.8} />
    </mesh>
  );
}

/* --------------------------------------------------------------- crusher */

function Crusher() {
  const walls = useMemo(() => byPrefix("hopper-wall-"), []);
  const house = useMemo(() => byPrefix("crusher-house")[0], []);
  const hazard = useMemo(() => hazardTexture(PALETTE.catYellow), []);
  const baseY = terrainHeight(CRUSHER.x, CRUSHER.z);
  return (
    <group>
      {walls.map((w) => (
        <mesh key={w.id} position={[w.x, groundY(w), w.z]} castShadow receiveShadow>
          <boxGeometry args={[w.hx * 2, w.hy * 2, w.hz * 2]} />
          <meshStandardMaterial color="#8d8a84" roughness={0.95} />
        </mesh>
      ))}
      {/* Hazard band along the tipping edge of the hopper. */}
      <mesh position={[CRUSHER.x, baseY + 3.25, CRUSHER.z - 5]}>
        <boxGeometry args={[10.1, 0.18, 0.84]} />
        <meshStandardMaterial map={hazard} roughness={0.7} />
      </mesh>
      {house ? (
        <group>
          <mesh position={[house.x, groundY(house), house.z]} castShadow receiveShadow>
            <boxGeometry args={[house.hx * 2, house.hy * 2, house.hz * 2]} />
            <meshStandardMaterial color={PALETTE.catYellowDark} roughness={0.6} metalness={0.3} />
          </mesh>
          {/* Discharge conveyor, climbing away from the crusher house. */}
          <mesh
            position={[house.x + 9, groundY(house) + 2.6, house.z + 4]}
            rotation={[0, -0.35, 0.32]}
            castShadow
          >
            <boxGeometry args={[16, 0.35, 1.1]} />
            <meshStandardMaterial color={PALETTE.steel} roughness={0.7} metalness={0.5} />
          </mesh>
        </group>
      ) : null}
    </group>
  );
}

/* ------------------------------------------------------------ perimeter */

function Fence() {
  const segments = useMemo(() => byPrefix("fence-"), []);
  const gateY = terrainHeight(PERIMETER.fence, (PERIMETER.gate.z1 + PERIMETER.gate.z2) / 2);
  return (
    <group>
      {segments.map((f) => {
        const along = f.hx > f.hz ? "x" : "z";
        const len = (along === "x" ? f.hx : f.hz) * 2;
        const posts = Math.max(2, Math.round(len / 8));
        return (
          <group key={f.id}>
            {Array.from({ length: posts }, (_, i) => {
              const t = i / (posts - 1) - 0.5;
              const x = along === "x" ? f.x + t * len : f.x;
              const z = along === "z" ? f.z + t * len : f.z;
              return (
                <mesh key={i} position={[x, terrainHeight(x, z) + 1.1, z]}>
                  <cylinderGeometry args={[0.06, 0.06, 2.2, 6]} />
                  <meshStandardMaterial color="#7d848c" roughness={0.6} metalness={0.6} />
                </mesh>
              );
            })}
            {/* Mesh panels, one per span so the run follows the ground. */}
            {Array.from({ length: posts - 1 }, (_, i) => {
              const t = (i + 0.5) / (posts - 1) - 0.5;
              const x = along === "x" ? f.x + t * len : f.x;
              const z = along === "z" ? f.z + t * len : f.z;
              const span = len / (posts - 1);
              return (
                <mesh key={`p${i}`} position={[x, terrainHeight(x, z) + 1.1, z]}>
                  <boxGeometry args={[along === "x" ? span : 0.03, 2, along === "z" ? span : 0.03]} />
                  <meshStandardMaterial color="#9aa2aa" transparent opacity={0.28} roughness={0.8} depthWrite={false} />
                </mesh>
              );
            })}
          </group>
        );
      })}
      {/* Gate boom, raised: the haul road leaves site here. */}
      <mesh position={[PERIMETER.fence, gateY + 1.2, PERIMETER.gate.z1 - 0.6]}>
        <boxGeometry args={[0.6, 2.4, 0.6]} />
        <meshStandardMaterial color={PALETTE.steel} roughness={0.6} />
      </mesh>
      <mesh
        position={[PERIMETER.fence, gateY + 5.2, PERIMETER.gate.z1 + 0.2]}
        rotation={[Math.PI / 2.3, 0, 0]}
      >
        <boxGeometry args={[0.18, 0.18, 9]} />
        <meshStandardMaterial color={PALETTE.crit} roughness={0.5} />
      </mesh>
    </group>
  );
}

/* ---------------------------------------------------------------- pond */

function Pond() {
  const geometry = useMemo(() => new THREE.CircleGeometry(POND.r * 1.05, 48), []);
  return (
    <mesh geometry={geometry} position={[POND.x, -0.75, POND.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <meshStandardMaterial color="#3d5a5c" roughness={0.08} metalness={0.35} transparent opacity={0.82} />
    </mesh>
  );
}

export function SiteDetails() {
  return (
    <group>
      <Guardrails />
      <Crusher />
      <Fence />
      <Pond />
    </group>
  );
}
