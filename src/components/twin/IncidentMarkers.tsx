"use client";

/**
 * The 150 recorded incidents from `incidents.csv`, plotted where they actually
 * happened.
 *
 * One instanced mesh with per-instance colour, so the whole safety history is a
 * single draw call. Positions come pre-converted into the twin's world frame by
 * the dataset build step.
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { dataset, type IncidentSeverity } from "@/lib/data/dataset";
import { terrainHeight } from "@/lib/twin/terrain";
import { useTwinStore } from "@/store/twinStore";
import { PALETTE } from "./materials";

const SEVERITY_COLOR: Record<IncidentSeverity, string> = {
  medium: PALETTE.warn,
  high: PALETTE.worker,
  critical: PALETTE.crit,
};

const SEVERITY_HEIGHT: Record<IncidentSeverity, number> = {
  medium: 1.6,
  high: 2.4,
  critical: 3.4,
};

export function IncidentMarkers() {
  const visible = useTwinStore((s) => s.showIncidents);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);

  const incidents = dataset.incidents;

  const { matrices, colors } = useMemo(() => {
    const dummy = new THREE.Object3D();
    const out: THREE.Matrix4[] = [];
    const cols = new Float32Array(incidents.length * 3);
    const c = new THREE.Color();

    incidents.forEach((inc, i) => {
      const height = SEVERITY_HEIGHT[inc.severity] ?? 2;
      const ground = terrainHeight(inc.worldX, inc.worldZ);
      dummy.position.set(inc.worldX, ground + height / 2, inc.worldZ);
      dummy.scale.set(1, height, 1);
      dummy.updateMatrix();
      out.push(dummy.matrix.clone());

      c.set(SEVERITY_COLOR[inc.severity] ?? PALETTE.warn);
      c.toArray(cols, i * 3);
    });

    return { matrices: out, colors: cols };
  }, [incidents]);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    matrices.forEach((mat, i) => m.setMatrixAt(i, mat));
    m.instanceMatrix.needsUpdate = true;

    m.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    m.instanceColor.needsUpdate = true;
    // three decides whether to compile the instance-colour path when the shader
    // is built. Attaching the attribute afterwards needs an explicit recompile,
    // otherwise the shader samples uninitialised memory.
    const material = m.material as THREE.Material;
    material.needsUpdate = true;
  }, [matrices, colors, visible]);

  // Gentle breathing so the layer reads as data, not scenery.
  useFrame((state) => {
    if (material.current && visible) {
      material.current.opacity = 0.3 + Math.sin(state.clock.elapsedTime * 1.6) * 0.07;
    }
  });

  if (!visible) return null;

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, incidents.length]}
      frustumCulled={false}
    >
      {/* unit-height column, scaled per instance by severity */}
      <cylinderGeometry args={[0.55, 0.12, 1, 6, 1, true]} />
      <meshBasicMaterial
        ref={material}
        transparent
        opacity={0.34}
        depthWrite={false}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </instancedMesh>
  );
}
