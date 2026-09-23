"use client";

/**
 * Haul road network.
 *
 * Each segment becomes a ribbon sampled against `terrainHeight`, so roads hug
 * the ground including the ramp down into the pit. Every ribbon is merged into
 * a single geometry — the whole network is three draw calls.
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ROADS, type RoadSegment } from "@/lib/twin/site";
import { terrainHeight } from "@/lib/twin/terrain";
import { PALETTE } from "./materials";

/** Lengthwise samples per metre of road. */
const SAMPLES_PER_METRE = 0.25;
const SURFACE_LIFT = 0.07;
const MARKING_LIFT = 0.13;

interface Ribbon {
  positions: number[];
  indices: number[];
  uvs: number[];
}

function segmentBasis(road: RoadSegment) {
  const dx = road.x2 - road.x1;
  const dz = road.z2 - road.z1;
  const length = Math.hypot(dx, dz);
  const dir = { x: dx / length, z: dz / length };
  // Perpendicular in the ground plane.
  const perp = { x: -dir.z, z: dir.x };
  return { length, dir, perp };
}

function buildRoadGeometry(): THREE.BufferGeometry {
  const ribbon: Ribbon = { positions: [], indices: [], uvs: [] };

  for (const road of ROADS) {
    const { length, dir, perp } = segmentBasis(road);
    const steps = Math.max(2, Math.ceil(length * SAMPLES_PER_METRE));
    const half = road.width / 2;
    const base = ribbon.positions.length / 3;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = road.x1 + dir.x * length * t;
      const cz = road.z1 + dir.z * length * t;

      for (const side of [-1, 1]) {
        const x = cx + perp.x * half * side;
        const z = cz + perp.z * half * side;
        ribbon.positions.push(x, terrainHeight(x, z) + SURFACE_LIFT, z);
        ribbon.uvs.push(side === -1 ? 0 : 1, t * length * 0.1);
      }
    }

    for (let i = 0; i < steps; i++) {
      const a = base + i * 2;
      ribbon.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(ribbon.positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(ribbon.uvs, 2));
  geo.setIndex(ribbon.indices);
  geo.computeVertexNormals();
  return geo;
}

/** Centre-line dashes, skipped on ramps where they would look wrong. */
function buildMarkingGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const dashLength = 3.2;
  const dashGap = 5.5;
  const dashHalfWidth = 0.18;

  for (const road of ROADS) {
    if (!road.markings) continue;
    const { length, dir, perp } = segmentBasis(road);
    const stride = dashLength + dashGap;
    const count = Math.floor(length / stride);

    for (let d = 0; d < count; d++) {
      const start = d * stride + dashGap / 2;
      const end = start + dashLength;
      const base = positions.length / 3;

      for (const along of [start, end]) {
        const cx = road.x1 + dir.x * along;
        const cz = road.z1 + dir.z * along;
        for (const side of [-1, 1]) {
          const x = cx + perp.x * dashHalfWidth * side;
          const z = cz + perp.z * dashHalfWidth * side;
          positions.push(x, terrainHeight(x, z) + MARKING_LIFT, z);
        }
      }
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Delineator posts down both shoulders of every marked road. */
function delineatorTransforms(): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();

  for (const road of ROADS) {
    if (!road.markings) continue;
    const { length, dir, perp } = segmentBasis(road);
    const offset = road.width / 2 + 1.4;
    const spacing = 16;
    const count = Math.floor(length / spacing);

    for (let i = 1; i < count; i++) {
      const along = i * spacing;
      const cx = road.x1 + dir.x * along;
      const cz = road.z1 + dir.z * along;
      for (const side of [-1, 1]) {
        const x = cx + perp.x * offset * side;
        const z = cz + perp.z * offset * side;
        dummy.position.set(x, terrainHeight(x, z) + 0.55, z);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        out.push(dummy.matrix.clone());
      }
    }
  }
  return out;
}

export function Roads() {
  const roadGeo = useMemo(buildRoadGeometry, []);
  const markingGeo = useMemo(buildMarkingGeometry, []);
  const posts = useMemo(delineatorTransforms, []);
  const postsRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = postsRef.current;
    if (!mesh) return;
    posts.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
  }, [posts]);

  return (
    <group>
      <mesh geometry={roadGeo} receiveShadow>
        <meshStandardMaterial color={PALETTE.road} roughness={0.92} metalness={0.02} />
      </mesh>

      <mesh geometry={markingGeo}>
        <meshStandardMaterial
          color="#e8e4d4"
          roughness={0.7}
          emissive="#3a3730"
          emissiveIntensity={0.35}
        />
      </mesh>

      <instancedMesh
        ref={postsRef}
        args={[undefined, undefined, posts.length]}
        castShadow
        frustumCulled={false}
      >
        <cylinderGeometry args={[0.07, 0.07, 1.1, 5]} />
        <meshStandardMaterial
          color={PALETTE.catYellow}
          roughness={0.6}
          emissive={PALETTE.catYellowDark}
          emissiveIntensity={0.25}
        />
      </instancedMesh>
    </group>
  );
}
