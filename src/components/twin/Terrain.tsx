"use client";

/**
 * Displaced ground mesh.
 *
 * The vertices are pushed by the same `terrainHeight` the vehicle model samples
 * for pitch and roll, so what you see is exactly what the machine is driving on.
 * Surface type is baked into vertex colours — no textures, no extra draw calls.
 */

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { PIT, SITE_SIZE, projectRoads, smoothstep, zoneAt } from "@/lib/twin/site";
import { terrainHeight } from "@/lib/twin/terrain";
import { useTwinStore } from "@/store/twinStore";
import { PALETTE } from "./materials";

/** 150x150 quads across 260m — roughly 1.7m resolution. */
const SEGMENTS = 150;

export function Terrain() {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const engine = useTwinStore((s) => s.engine);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(SITE_SIZE, SITE_SIZE, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);

    const position = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(position.count * 3);

    const base = new THREE.Color(PALETTE.dirt);
    const light = new THREE.Color(PALETTE.dirtLight);
    const dark = new THREE.Color(PALETTE.dirtDark);
    const road = new THREE.Color(PALETTE.road);
    const scratch = new THREE.Color();

    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const h = terrainHeight(x, z);
      position.setY(i, h);

      // Height-driven shading: mounds catch light, cut faces sit in shadow.
      scratch.copy(base);
      if (h > 0.4) scratch.lerp(light, Math.min((h - 0.4) / 4.5, 0.75));
      if (h < -0.4) scratch.lerp(dark, Math.min((-h - 0.4) / 4.5, 0.8));

      // Excavated benches read cooler than undisturbed ground.
      const pitDist = Math.hypot((x - PIT.x) / PIT.rx, (z - PIT.z) / PIT.rz);
      if (pitDist < 1.2) scratch.lerp(dark, (1 - smoothstep(0.7, 1.18, pitDist)) * 0.45);

      // Running surfaces.
      const r = projectRoads(x, z);
      if (r.influence > 0.02) scratch.lerp(road, r.influence * 0.92);

      // A wash of the zone colour makes the layout legible from above.
      const zone = zoneAt(x, z);
      if (zone && r.influence < 0.4) {
        scratch.lerp(new THREE.Color(zone.color), zone.kind === "restricted" ? 0.16 : 0.09);
      }

      // Break up banding so large flat areas do not look like plastic.
      const grain = (Math.sin(x * 3.1 + z * 2.3) + Math.cos(x * 1.7 - z * 4.1)) * 0.012;
      scratch.offsetHSL(0, 0, grain);

      scratch.toArray(colors, i * 3);
    }

    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }, []);

  // Rain darkens and slicks the ground.
  useFrame(() => {
    const m = materialRef.current;
    if (!m) return;
    const wet = engine.wetness;
    const shade = 1 - wet * 0.42;
    m.color.setRGB(shade, shade, shade * (1 - wet * 0.04));
    m.roughness = 0.97 - wet * 0.55;
    m.metalness = wet * 0.18;
  });

  return (
    <mesh geometry={geometry} receiveShadow castShadow={false}>
      <meshStandardMaterial
        ref={materialRef}
        vertexColors
        roughness={0.97}
        metalness={0}
        dithering
      />
    </mesh>
  );
}
