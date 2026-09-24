"use client";

/**
 * Displaced ground mesh.
 *
 * The vertices come straight out of `buildHeightGrid` — the very array the
 * physics heightfield is built from — so what you see is exactly what the
 * machines are driving on, vertex for vertex. Surface type (road, windrow
 * gravel, loose spoil, wet clay…) is baked into vertex colours from
 * `surfaceAt`, the same classification the physics friction reads.
 *
 * Wheel and track wear is a painted overlay (see `useWearMap`): the collider
 * stays fixed. Rebuilding a heightfield collider to show ruts costs several
 * milliseconds per edit for a feature smaller than one grid cell, so the
 * ruts are deliberately cosmetic.
 */

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { SITE_SIZE, zoneAt } from "@/lib/twin/site";
import { buildHeightGrid, surfaceAt } from "@/lib/twin/terrain";
import { useTwinStore } from "@/store/twinStore";
import { PALETTE, SURFACE_COLORS } from "./materials";

function buildGeometry(): THREE.BufferGeometry {
  const grid = buildHeightGrid();
  const n = grid.segments + 1;
  const geo = new THREE.PlaneGeometry(SITE_SIZE, SITE_SIZE, grid.segments, grid.segments);
  geo.rotateX(-Math.PI / 2);

  const position = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const light = new THREE.Color(PALETTE.dirtLight);
  const dark = new THREE.Color(PALETTE.dirtDark);
  const surface = Object.fromEntries(
    Object.entries(SURFACE_COLORS).map(([k, v]) => [k, new THREE.Color(v)]),
  ) as Record<keyof typeof SURFACE_COLORS, THREE.Color>;
  const zoneTint = new THREE.Color();
  const scratch = new THREE.Color();
  const h = grid.heights;

  for (let i = 0; i < position.count; i++) {
    const ix = i % n;
    const iz = Math.floor(i / n);
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = h[i];
    position.setY(i, y);

    // Slope from the grid itself, so classification needs no extra samples.
    const hx = h[iz * n + Math.min(ix + 1, n - 1)] - h[iz * n + Math.max(ix - 1, 0)];
    const hz = h[Math.min(iz + 1, n - 1) * n + ix] - h[Math.max(iz - 1, 0) * n + ix];
    const slope = Math.atan(Math.hypot(hx, hz) / (2 * grid.cell));
    const kind = surfaceAt(x, z, slope);

    scratch.copy(surface[kind]);
    // Height-driven shading: raised ground catches light, cuts sit in shadow.
    if (kind !== "road") {
      if (y > 0.4) scratch.lerp(light, Math.min((y - 0.4) / 9, 0.45));
      if (y < -0.4) scratch.lerp(dark, Math.min((-y - 0.4) / 6, 0.5));
    }

    // A wash of the zone colour makes the layout legible from above.
    const zone = kind === "road" ? null : zoneAt(x, z);
    if (zone) {
      zoneTint.set(zone.color);
      scratch.lerp(zoneTint, zone.kind === "restricted" ? 0.14 : 0.07);
    }

    // Break up banding so large flat areas do not look like plastic.
    const grain = (Math.sin(x * 3.1 + z * 2.3) + Math.cos(x * 1.7 - z * 4.1)) * 0.012;
    scratch.offsetHSL(0, 0, grain);
    scratch.toArray(colors, i * 3);
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/* -------------------------------------------------------------- wear map */

const WEAR_RES = 512;

/**
 * Ruts and tyre tracks, painted into an alpha map where machines actually
 * drive. Cheap: a handful of canvas ellipses a few times a second.
 */
function useWearMap() {
  const engine = useTwinStore((s) => s.engine);
  const { canvas, ctx, texture } = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = WEAR_RES;
    canvas.height = WEAR_RES;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, WEAR_RES, WEAR_RES);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    return { canvas, ctx, texture };
  }, []);
  const acc = useRef(0);

  useEffect(() => () => texture.dispose(), [texture]);

  useFrame((_, delta) => {
    acc.current += delta;
    if (!ctx || acc.current < 0.2) return;
    acc.current = 0;
    const px = WEAR_RES / SITE_SIZE;
    let painted = false;
    for (const t of engine.allTelemetry()) {
      if (Math.abs(t.speed) < 0.3) continue;
      painted = true;
      const cx = (t.x + SITE_SIZE / 2) * px;
      // PlaneGeometry's v runs 1 -> 0 as z runs -half -> +half, and the
      // canvas is flipped on upload, so canvas rows follow +z directly.
      const cy = (t.z + SITE_SIZE / 2) * px;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t.heading);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(side * 1.4 * px, 0, 0.55 * px + 0.3, 1.6 * px, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    if (painted) texture.needsUpdate = true;
  });

  return { canvas, texture };
}

export function Terrain() {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const engine = useTwinStore((s) => s.engine);
  const geometry = useMemo(buildGeometry, []);
  const { texture: wear } = useWearMap();

  useEffect(() => () => geometry.dispose(), [geometry]);

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
    <group>
      <mesh geometry={geometry} receiveShadow castShadow={false} name="terrain">
        <meshStandardMaterial ref={materialRef} vertexColors roughness={0.97} metalness={0} dithering />
      </mesh>
      {/* Wear overlay: same vertices, dark where the alpha map has been painted. */}
      <mesh geometry={geometry} receiveShadow raycast={() => null}>
        <meshStandardMaterial
          color="#2a2118"
          alphaMap={wear}
          transparent
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-1}
          roughness={1}
        />
      </mesh>
    </group>
  );
}
