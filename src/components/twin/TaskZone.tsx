"use client";

/**
 * Zone demarcation: a painted boundary on the ground, corner posts and a
 * signboard, so the site layout reads at a glance from any camera angle.
 */

import { useMemo } from "react";
import * as THREE from "three";
import { ZONES, type SiteZone } from "@/lib/twin/site";
import { terrainHeight } from "@/lib/twin/terrain";
import { PALETTE, hazardTexture, signTexture } from "./materials";

const SEGMENTS = 96;

/**
 * Point on a zone's boundary at fraction `f` of the way round, plus the outward
 * normal angle. Rectangles (the simulator's zones) and ellipses both supported.
 */
function perimeter(zone: SiteZone, f: number, inset = 0): { x: number; z: number; a: number } {
  if (zone.shape === "rect") {
    const w = 2 * (zone.rx + inset);
    const h = 2 * (zone.rz + inset);
    let d = (((f % 1) + 1) % 1) * 2 * (w + h);
    const x0 = zone.x - zone.rx - inset;
    const z0 = zone.z - zone.rz - inset;
    if (d < w) return { x: x0 + d, z: z0, a: -Math.PI / 2 };
    d -= w;
    if (d < h) return { x: x0 + w, z: z0 + d, a: 0 };
    d -= h;
    if (d < w) return { x: x0 + w - d, z: z0 + h, a: Math.PI / 2 };
    d -= w;
    return { x: x0, z: z0 + h - d, a: Math.PI };
  }
  const a = f * Math.PI * 2;
  return {
    x: zone.x + Math.cos(a) * (zone.rx + inset),
    z: zone.z + Math.sin(a) * (zone.rz + inset),
    a: Math.atan2(Math.sin(a) * zone.rx, Math.cos(a) * zone.rz),
  };
}

/** Ground-hugging ribbon following the zone ellipse. */
function buildBoundary(zone: SiteZone, width = 0.7): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  const segments = zone.shape === "rect" ? SEGMENTS * 3 : SEGMENTS;
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    for (const inset of [-width / 2, width / 2]) {
      const p = perimeter(zone, f, inset);
      positions.push(p.x, terrainHeight(p.x, p.z) + 0.14, p.z);
    }

    if (i < segments) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function ZoneMarker({ zone }: { zone: SiteZone }) {
  const boundary = useMemo(() => buildBoundary(zone), [zone]);
  const sign = useMemo(
    () => signTexture(zone.label, zone.sub, zone.color),
    [zone.label, zone.sub, zone.color],
  );

  // Corner posts at the cardinal points of the ellipse.
  const posts = useMemo(() => {
    const out: [number, number, number][] = [];
    const count = zone.shape === "rect" ? 16 : 8;
    for (let i = 0; i < count; i++) {
      const { x, z } = perimeter(zone, i / count);
      out.push([x, terrainHeight(x, z), z]);
    }
    return out;
  }, [zone]);

  // Signboard sits on the south edge, facing the haul road.
  const signX = zone.x;
  const signZ = zone.z + zone.rz + 1.5;
  const signY = terrainHeight(signX, signZ);

  return (
    <group>
      <mesh geometry={boundary}>
        <meshStandardMaterial
          color={zone.color}
          roughness={0.65}
          emissive={zone.color}
          emissiveIntensity={0.3}
          transparent
          opacity={0.75}
        />
      </mesh>

      {posts.map(([x, y, z], i) => (
        <mesh key={i} position={[x, y + 0.6, z]} castShadow>
          <cylinderGeometry args={[0.08, 0.08, 1.2, 6]} />
          <meshStandardMaterial
            color={zone.color}
            roughness={0.6}
            emissive={zone.color}
            emissiveIntensity={0.2}
          />
        </mesh>
      ))}

      {/* signboard */}
      <group position={[signX, signY, signZ]}>
        {[-1.5, 1.5].map((x) => (
          <mesh key={x} position={[x, 1.5, 0]} castShadow>
            <boxGeometry args={[0.14, 3.0, 0.14]} />
            <meshStandardMaterial color={PALETTE.steel} roughness={0.8} metalness={0.4} />
          </mesh>
        ))}
        {/* printed on both faces, so it reads correctly from either side */}
        <mesh position={[0, 3.4, 0.02]} castShadow>
          <planeGeometry args={[4.0, 1.25]} />
          <meshStandardMaterial map={sign} roughness={0.8} />
        </mesh>
        <mesh position={[0, 3.4, -0.02]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[4.0, 1.25]} />
          <meshStandardMaterial map={sign} roughness={0.8} />
        </mesh>
        <mesh position={[0, 3.4, 0]}>
          <boxGeometry args={[4.1, 1.35, 0.03]} />
          <meshStandardMaterial color="#101216" roughness={0.9} />
        </mesh>
      </group>
    </group>
  );
}

/** Hazard-striped barrier panels ringing the restricted zone. */
function RestrictedBarrier({ zone }: { zone: SiteZone }) {
  const texture = useMemo(() => {
    const t = hazardTexture(PALETTE.crit);
    t.repeat.set(3, 1);
    return t;
  }, []);

  const panels = useMemo(() => {
    const out: { position: [number, number, number]; rotation: number }[] = [];
    const count = 22;
    for (let i = 0; i < count; i++) {
      const p = perimeter(zone, i / count);
      // Face outward from the zone centre.
      out.push({
        position: [p.x, terrainHeight(p.x, p.z) + 0.55, p.z],
        rotation: -p.a + Math.PI / 2,
      });
    }
    return out;
  }, [zone]);

  return (
    <group>
      {panels.map((p, i) => (
        <mesh key={i} position={p.position} rotation={[0, p.rotation, 0]} castShadow>
          <boxGeometry args={[3.2, 1.1, 0.12]} />
          <meshStandardMaterial map={texture} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

export function TaskZones() {
  return (
    <group>
      {ZONES.map((zone) => (
        <group key={zone.id}>
          <ZoneMarker zone={zone} />
          {zone.kind === "restricted" ? <RestrictedBarrier zone={zone} /> : null}
        </group>
      ))}
    </group>
  );
}

export { ZoneMarker };
