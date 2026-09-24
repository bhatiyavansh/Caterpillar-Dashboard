"use client";

/**
 * X-ray rendering for the machine rigs.
 *
 * Nothing here is a second model. The rig components tag their existing
 * meshes with `userData.part = <component id>` (by wrapping them in a group),
 * and `useXray` swaps materials on those same meshes while an X-ray is open:
 * body panels become a translucent fresnel shell, the flagged assembly turns
 * opaque and lit, and the internal assemblies — pump, hydraulic lines, engine
 * block, drawn with `InternalBox` / `InternalTube` and hidden otherwise —
 * appear inside. Closing the X-ray puts every original material back.
 *
 * Clicks are handled once per machine (`useXray().handlers`): the part under
 * the pointer is found by walking up from the hit mesh to the nearest
 * `userData.part`. In X-ray mode internal parts win over the shell in front
 * of them, so you can click the pump through the house.
 */

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useTwinStore } from "@/store/twinStore";

/* ------------------------------------------------------------ materials */

const GHOST = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  uniforms: { color: { value: new THREE.Color("#62d0ff") } },
  vertexShader: /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vNormal = normalize(normalMatrix * normal);
      vView = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.2);
      gl_FragColor = vec4(color, 0.05 + rim * 0.5);
    }
  `,
});

const HIGHLIGHT = new THREE.MeshStandardMaterial({
  color: "#ffb020",
  emissive: "#ff8a1f",
  emissiveIntensity: 0.9,
  roughness: 0.4,
  metalness: 0.3,
  toneMapped: false,
});

const INTERNAL = new THREE.MeshStandardMaterial({ color: "#9fb4c6", roughness: 0.45, metalness: 0.6 });

/** Components that light up together: a hydraulic fault shows the whole circuit. */
const RELATED: Record<string, string[]> = {
  hydraulic_pump: ["hydraulic_pump", "hydraulic_lines"],
  hydraulic_lines: ["hydraulic_lines", "hydraulic_pump"],
  boom_ram: ["boom_ram", "hydraulic_lines"],
  stick_ram: ["stick_ram", "hydraulic_lines"],
  bucket_ram: ["bucket_ram", "hydraulic_lines"],
};

/* -------------------------------------------------------- internal parts */

/** An internal assembly: only drawn in X-ray mode. */
export function InternalBox({
  part,
  position,
  size,
}: {
  part: string;
  position: [number, number, number];
  size: [number, number, number];
}) {
  return (
    <mesh position={position} userData={{ part, internal: true }} visible={false} material={INTERNAL}>
      <boxGeometry args={size} />
    </mesh>
  );
}

/** A hydraulic line or cable run between two points, only drawn in X-ray mode. */
export function InternalTube({
  part,
  from,
  to,
  radius = 0.05,
}: {
  part: string;
  from: [number, number, number];
  to: [number, number, number];
  radius?: number;
}) {
  const { position, quaternion, length } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return { position: a.add(b).multiplyScalar(0.5), quaternion: q, length: dir.length() };
  }, [from, to]);
  return (
    <mesh position={position} quaternion={quaternion} userData={{ part, internal: true }} visible={false} material={INTERNAL}>
      <cylinderGeometry args={[radius, radius, length, 8]} />
    </mesh>
  );
}

/* ------------------------------------------------------------- the hook */

function partOf(obj: THREE.Object3D | null, root: THREE.Object3D | null): { part: string | null; internal: boolean } {
  let o: THREE.Object3D | null = obj;
  while (o) {
    const ud = o.userData as { part?: string; internal?: boolean };
    if (ud.part) return { part: ud.part, internal: Boolean(ud.internal) };
    if (o === root) break;
    o = o.parent;
  }
  return { part: null, internal: false };
}

/**
 * Wires a machine rig for X-ray: material swap while an X-ray is open on this
 * machine, and click-to-inspect. Spread `handlers` onto the rig's root group.
 */
export function useXray(machineId: string, root: React.RefObject<THREE.Group | null>) {
  const xray = useTwinStore((s) => s.xray);
  const active = xray?.shownOn === machineId;
  const componentId = active ? xray?.componentId ?? null : null;
  const saved = useRef(new Map<THREE.Mesh, THREE.Material | THREE.Material[]>());

  useEffect(() => {
    const group = root.current;
    if (!group) return;
    const store = saved.current;
    if (!active) {
      for (const [mesh, mat] of store) mesh.material = mat;
      store.clear();
      group.traverse((o) => {
        if ((o.userData as { internal?: boolean }).internal) o.visible = false;
      });
      return;
    }
    const lit = new Set(componentId ? RELATED[componentId] ?? [componentId] : []);
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const { part, internal } = partOf(mesh, group);
      if (!store.has(mesh)) store.set(mesh, mesh.material);
      if (internal) {
        mesh.visible = true;
        mesh.material = part && lit.has(part) ? HIGHLIGHT : INTERNAL;
        return;
      }
      mesh.material = part && lit.has(part) ? HIGHLIGHT : GHOST;
    });
  }, [active, componentId, root]);

  // Plain functions: they read `root.current` at click time, which the React
  // Compiler won't let a memoised object do — and the rigs rarely re-render.
  const handlers = {
      onClick: (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        const group = root.current;
        const store = useTwinStore.getState();
        const open = store.xray?.shownOn === machineId;
        // Internal assemblies are clickable through the translucent shell.
        const hits = e.intersections.filter((h) => h.object.visible);
        const inside = open ? hits.find((h) => partOf(h.object, group).internal) : undefined;
        const { part } = partOf((inside ?? hits[0] ?? e).object, group);
        if (!open) store.openXray(machineId, part);
        else store.selectComponent(part);
      },
      onPointerOver: (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
      },
      onPointerOut: () => {
        document.body.style.cursor = "";
      },
  };

  return { active, handlers };
}
