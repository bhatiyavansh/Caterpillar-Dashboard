"use client";

/**
 * Renders what only exists in the physics world: loose material parcels
 * (tipped loads, bucket spills, pushed spoil) and the rock blocks of bench
 * face C. Two instanced meshes, two draw calls; transforms are copied from
 * the engine only when the physics layer reports that something moved.
 */

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useTwinStore } from "@/store/twinStore";
import { MATERIAL_CAP, PARCEL } from "@/lib/twin/physics/material";
import { PALETTE } from "./materials";

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const p = new THREE.Vector3();
const s = new THREE.Vector3();

function Material() {
  const engine = useTwinStore((st) => st.engine);
  const ref = useRef<THREE.InstancedMesh>(null);
  const seen = useRef(-1);
  const geometry = useMemo(() => {
    // A chunky, faceted rock: a box with its corners knocked in.
    const g = new THREE.IcosahedronGeometry(1, 0);
    g.scale(PARCEL.hx, PARCEL.hy * 1.1, PARCEL.hz);
    return g;
  }, []);

  useFrame(() => {
    const mesh = ref.current;
    const world = engine.physics;
    if (!mesh || !world) return;
    const mat = world.material;
    if (mat.version === seen.current) return;
    seen.current = mat.version;
    const t = mat.transforms;
    for (let i = 0; i < mat.count; i++) {
      const o = i * 8;
      p.set(t[o], t[o + 1], t[o + 2]);
      q.set(t[o + 3], t[o + 4], t[o + 5], t[o + 6]);
      s.setScalar(t[o + 7]);
      mesh.setMatrixAt(i, m4.compose(p, q, s));
    }
    mesh.count = mat.count;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  });

  return (
    <instancedMesh ref={ref} args={[geometry, undefined, MATERIAL_CAP]} count={0} castShadow receiveShadow frustumCulled={false}>
      <meshStandardMaterial color={PALETTE.dirtLight} roughness={1} flatShading />
    </instancedMesh>
  );
}

function FaceBlocks() {
  const engine = useTwinStore((st) => st.engine);
  const ref = useRef<THREE.InstancedMesh>(null);
  const seen = useRef(-1);
  const count = engine.physics?.face.count ?? 60;

  useFrame(() => {
    const mesh = ref.current;
    const world = engine.physics;
    if (!mesh || !world) return;
    const face = world.face;
    if (face.version === seen.current) return;
    seen.current = face.version;
    const t = face.transforms;
    const z = face.sizes;
    for (let i = 0; i < face.count; i++) {
      p.set(t[i * 7], t[i * 7 + 1], t[i * 7 + 2]);
      q.set(t[i * 7 + 3], t[i * 7 + 4], t[i * 7 + 5], t[i * 7 + 6]);
      s.set(z[i * 3] * 2, z[i * 3 + 1] * 2, z[i * 3 + 2] * 2);
      mesh.setMatrixAt(i, m4.compose(p, q, s));
    }
    mesh.count = face.count;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(count, 1)]} count={0} castShadow receiveShadow frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#6f6253" roughness={0.95} flatShading />
    </instancedMesh>
  );
}

export function PhysicsDebris() {
  // Re-mount once the world exists so FaceBlocks sizes its instance buffer.
  const ready = useTwinStore((st) => st.snapshot.physics !== null);
  return (
    <group key={ready ? "physics" : "pending"}>
      <Material />
      <FaceBlocks />
    </group>
  );
}
