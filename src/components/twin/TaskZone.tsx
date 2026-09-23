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

const SEGMENTS = 72;

/** Ground-hugging ribbon following the zone ellipse. */
function buildBoundary(zone: SiteZone, width = 0.7): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);

    for (const inset of [-width / 2, width / 2]) {
      const rx = zone.rx + inset;
      const rz = zone.rz + inset;
      const x = zone.x + cos * rx;
      const z = zone.z + sin * rz;
      positions.push(x, terrainHeight(x, z) + 0.14, z);
    }

    if (i < SEGMENTS) {
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
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = zone.x + Math.cos(a) * zone.rx;
      const z = zone.z + Math.sin(a) * zone.rz;
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
        <mesh position={[0, 3.4, 0]} castShadow>
          <planeGeometry args={[4.0, 1.25]} />
          <meshStandardMaterial map={sign} side={THREE.DoubleSide} roughness={0.8} />
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
    const count = 18;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const x = zone.x + Math.cos(a) * zone.rx;
      const z = zone.z + Math.sin(a) * zone.rz;
      // Face outward from the ellipse centre.
      out.push({
        position: [x, terrainHeight(x, z) + 0.55, z],
        rotation: -Math.atan2(Math.sin(a) * zone.rx, Math.cos(a) * zone.rz) + Math.PI / 2,
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
