"use client";

/**
 * Shared building blocks for the machine models.
 *
 * - One set of materials for the whole fleet (paint, steel, chrome, rubber,
 *   glass, lamps), so ten machines do not mean ten copies of every material.
 * - `Ram`: a hydraulic cylinder that stays pinned between two anchor points in
 *   different parts of a linkage and extends/retracts as the joints move —
 *   the single biggest thing that makes an excavator look mechanical.
 * - `useMachineMotion`: position/heading/attitude from telemetry, plus a steer
 *   angle derived from the yaw rate (the feed carries no steering channel) and
 *   distance travelled for wheel and track animation.
 * - Tyres with a tread texture, CAT decals, flashing beacons, work lights.
 */

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { MachineTelemetry } from "@/types/twin";
import { angleDelta, clamp } from "@/lib/twin/site";
import { PALETTE } from "./materials";

/* ------------------------------------------------------------------------ */
/*  Materials                                                               */
/* ------------------------------------------------------------------------ */

function std(params: THREE.MeshStandardMaterialParameters) {
  return new THREE.MeshStandardMaterial(params);
}

export const MAT = {
  paint: std({ color: PALETTE.catYellow, roughness: 0.42, metalness: 0.18 }),
  paintDark: std({ color: "#e0a800", roughness: 0.5, metalness: 0.2 }),
  /** Weathered paint for working surfaces (bucket backs, blade, body floor). */
  paintWorn: std({ color: "#c79a1a", roughness: 0.75, metalness: 0.15 }),
  black: std({ color: "#1b1d20", roughness: 0.6, metalness: 0.3 }),
  steel: std({ color: "#3a3f45", roughness: 0.55, metalness: 0.6 }),
  steelDark: std({ color: "#22262a", roughness: 0.7, metalness: 0.45 }),
  wear: std({ color: "#6c7178", roughness: 0.38, metalness: 0.85 }),
  chrome: std({ color: "#d9dde2", roughness: 0.16, metalness: 1 }),
  rubber: std({ color: "#161718", roughness: 0.92, metalness: 0 }),
  glass: std({
    color: "#23384a",
    roughness: 0.05,
    metalness: 0.6,
    transparent: true,
    opacity: 0.72,
  }),
  seat: std({ color: "#2a2c2f", roughness: 0.9 }),
  grille: std({ color: "#0f1113", roughness: 0.8, metalness: 0.4 }),
  lampWhite: std({ color: "#fff6dd", emissive: "#ffeec2", emissiveIntensity: 1.6, toneMapped: false }),
  lampRed: std({ color: "#ff3b30", emissive: "#ff2a1f", emissiveIntensity: 0.9, toneMapped: false }),
  dirt: std({ color: "#6d5a42", roughness: 1, metalness: 0 }),
  rock: std({ color: "#8a8176", roughness: 0.95, metalness: 0, flatShading: true }),
};

/* ------------------------------------------------------------------------ */
/*  Textures                                                                */
/* ------------------------------------------------------------------------ */

const texCache = new Map<string, THREE.Texture>();

function canvasTexture(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const hit = texCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  texCache.set(key, tex);
  return tex;
}

/** Off-road tyre tread: chevron lugs around the circumference. */
export function treadTexture(): THREE.Texture {
  const tex = canvasTexture("tread", 256, 64, (ctx) => {
    ctx.fillStyle = "#111213";
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = "#26282a";
    for (let i = 0; i < 16; i++) {
      const x = i * 16;
      // Chevron lug: two slanted bars meeting at the centre line.
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 9, 0);
      ctx.lineTo(x + 15, 30);
      ctx.lineTo(x + 6, 30);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + 6, 34);
      ctx.lineTo(x + 15, 34);
      ctx.lineTo(x + 9, 64);
      ctx.lineTo(x, 64);
      ctx.closePath();
      ctx.fill();
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(2, 1);
  return tex;
}

/** Track shoes with triple grousers. Plates repeat along `v`, so it scrolls in `offset.y`. */
export function shoeTexture(): THREE.Texture {
  const tex = canvasTexture("shoes", 64, 256, (ctx) => {
    ctx.fillStyle = "#17191b";
    ctx.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 8; i++) {
      const y = i * 32;
      ctx.fillStyle = "#2c3034";
      ctx.fillRect(0, y + 1, 64, 28);
      ctx.fillStyle = "#0b0c0d";
      ctx.fillRect(0, y + 29, 64, 3);
      ctx.fillStyle = "#454b51";
      for (const g of [5, 13, 21]) ctx.fillRect(2, y + g, 60, 3);
    }
  });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** A painted-on decal: black text, optionally with the CAT triangle under the A. */
export function decalTexture(text: string, opts: { color?: string; logo?: boolean } = {}): THREE.Texture {
  const color = opts.color ?? "#111111";
  return canvasTexture(`decal:${text}:${color}:${opts.logo}`, 512, 192, (ctx) => {
    ctx.clearRect(0, 0, 512, 192);
    ctx.fillStyle = color;
    ctx.font = "900 150px Arial Black, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 98, 500);
    if (opts.logo) {
      // The yellow triangle sits in the counter of the A.
      ctx.fillStyle = PALETTE.catYellow;
      ctx.beginPath();
      ctx.moveTo(256, 118);
      ctx.lineTo(236, 158);
      ctx.lineTo(276, 158);
      ctx.closePath();
      ctx.fill();
    }
  });
}

/* ------------------------------------------------------------------------ */
/*  Motion                                                                  */
/* ------------------------------------------------------------------------ */

export interface MachineMotion {
  root: React.RefObject<THREE.Group | null>;
  tilt: React.RefObject<THREE.Group | null>;
  /** Current steer angle, radians, positive = turning right. */
  steer: React.RefObject<number>;
  /** Metres travelled (signed). */
  travel: React.RefObject<number>;
}

/**
 * Applies position, heading and terrain attitude, and derives steering and
 * travel. `wheelbase` sets how much steer a given turn rate implies.
 */
export function useMachineMotion(telemetry: MachineTelemetry, wheelbase = 4): MachineMotion {
  const root = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const steer = useRef(0);
  const travel = useRef(0);
  const last = useRef<{ heading: number; x: number; z: number } | null>(null);

  useFrame((_, delta) => {
    const t = telemetry;
    const r = root.current;
    if (!r || !tilt.current) return;
    r.position.set(t.x, t.y, t.z);
    // Model forward is -Z; heading is clockwise from north.
    r.rotation.y = -t.heading;
    tilt.current.rotation.x = t.pitch;
    tilt.current.rotation.z = -t.roll;

    const dt = Math.max(delta, 1e-3);
    const prev = last.current;
    if (prev) {
      const yawRate = angleDelta(prev.heading, t.heading) / dt;
      const v = Math.abs(t.speed);
      const target = v > 0.25 ? clamp(Math.atan((yawRate * wheelbase) / Math.max(v, 0.8)), -0.62, 0.62) : steer.current;
      steer.current += (target - steer.current) * (1 - Math.exp(-5 * dt));
      travel.current += t.speed * dt;
    }
    last.current = { heading: t.heading, x: t.x, z: t.z };
  });

  return { root, tilt, steer, travel };
}

/* ------------------------------------------------------------------------ */
/*  Hydraulic ram                                                           */
/* ------------------------------------------------------------------------ */

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * A cylinder pinned between two anchors. Place `<Ram>` anywhere; give it refs to
 * two empty groups placed at the pin points inside the linkage. Each frame the
 * barrel stays on anchor A, the chrome rod reaches to anchor B, and the rod's
 * exposed length changes with the joint — exactly like the real thing.
 */
export function Ram({
  from,
  to,
  radius = 0.1,
}: {
  from: React.RefObject<THREE.Object3D | null>;
  to: React.RefObject<THREE.Object3D | null>;
  radius?: number;
}) {
  const group = useRef<THREE.Group>(null);
  const barrel = useRef<THREE.Mesh>(null);
  const rod = useRef<THREE.Mesh>(null);
  const rest = useRef(0);

  useFrame(() => {
    const g = group.current;
    if (!g || !from.current || !to.current || !barrel.current || !rod.current) return;
    from.current.getWorldPosition(_a);
    to.current.getWorldPosition(_b);
    const len = _a.distanceTo(_b);
    if (len < 1e-4) return;
    if (!rest.current) rest.current = len;

    // Place in the parent's space, pointing +Z from A to B.
    const parent = g.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      g.position.copy(parent.worldToLocal(_a.clone()));
    }
    g.lookAt(_b);

    const barrelLen = rest.current * 0.62;
    const rodLen = Math.max(len - barrelLen * 0.35, 0.05);
    barrel.current.scale.set(1, barrelLen, 1);
    barrel.current.position.set(0, 0, barrelLen / 2);
    rod.current.scale.set(1, rodLen, 1);
    rod.current.position.set(0, 0, len - rodLen / 2);
  });

  return (
    <group ref={group}>
      <mesh ref={barrel} rotation={[Math.PI / 2, 0, 0]} material={MAT.paintDark} castShadow>
        <cylinderGeometry args={[radius, radius, 1, 12]} />
      </mesh>
      <mesh ref={rod} rotation={[Math.PI / 2, 0, 0]} material={MAT.chrome}>
        <cylinderGeometry args={[radius * 0.55, radius * 0.55, 1, 10]} />
      </mesh>
    </group>
  );
}

/** A fixed-length member (push arm, link) stretched between two anchors. */
export function Strut({
  from,
  to,
  size = [0.16, 0.2],
  material = MAT.paint,
}: {
  from: React.RefObject<THREE.Object3D | null>;
  to: React.RefObject<THREE.Object3D | null>;
  size?: [number, number];
  material?: THREE.Material;
}) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const g = group.current;
    if (!g || !from.current || !to.current || !body.current) return;
    from.current.getWorldPosition(_a);
    to.current.getWorldPosition(_b);
    const len = _a.distanceTo(_b);
    const parent = g.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      g.position.copy(parent.worldToLocal(_a.clone()));
    }
    g.lookAt(_b);
    body.current.scale.set(1, 1, len);
    body.current.position.set(0, 0, len / 2);
  });
  return (
    <group ref={group}>
      <mesh ref={body} material={material} castShadow>
        <boxGeometry args={[size[0], size[1], 1]} />
      </mesh>
    </group>
  );
}

/** A straight run of track shoes between two (z, y) points in a track's plane. */
export function TrackRun({
  from,
  to,
  width,
  material,
}: {
  from: [number, number];
  to: [number, number];
  width: number;
  material: THREE.Material;
}) {
  const [z1, y1] = from;
  const [z2, y2] = to;
  const len = Math.hypot(z2 - z1, y2 - y1);
  const angle = Math.atan2(y2 - y1, z2 - z1);
  return (
    <mesh
      position={[0, (y1 + y2) / 2, (z1 + z2) / 2]}
      rotation={[-angle, 0, 0]}
      material={material}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[width, 0.1, len]} />
    </mesh>
  );
}

/** Own scrolling shoe material for one track. */
export function useShoeMaterial(repeat: number) {
  return useMemo(() => {
    const t = shoeTexture().clone();
    t.needsUpdate = true;
    t.repeat.set(1, repeat);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, metalness: 0.35 });
  }, [repeat]);
}

/** An invisible pin point for a `Ram` to attach to. */
export function Anchor({
  anchorRef,
  position,
}: {
  anchorRef: React.RefObject<THREE.Group | null>;
  position: [number, number, number];
}) {
  return <group ref={anchorRef} position={position} />;
}

/* ------------------------------------------------------------------------ */
/*  Tyres, lights, decals                                                   */
/* ------------------------------------------------------------------------ */

/**
 * An earthmover tyre on a yellow rim. The group spins about X; the caller
 * steers it by rotating its parent about Y.
 */
export function Tyre({
  radius,
  width,
  spinRef,
  side = 1,
}: {
  radius: number;
  width: number;
  spinRef?: (el: THREE.Group | null) => void;
  side?: 1 | -1;
}) {
  const tread = useMemo(() => {
    const t = treadTexture();
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, metalness: 0 });
  }, []);
  return (
    <group ref={spinRef}>
      {/* carcass with tread */}
      <mesh rotation={[0, 0, Math.PI / 2]} material={tread} castShadow receiveShadow>
        <cylinderGeometry args={[radius, radius, width, 28, 1, true]} />
      </mesh>
      {/* sidewalls, slightly domed */}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[(s * width) / 2, 0, 0]}
          rotation={[0, 0, (s * Math.PI) / 2]}
          material={MAT.rubber}
        >
          <cylinderGeometry args={[radius * 0.97, radius * 0.97, 0.06, 28]} />
        </mesh>
      ))}
      {/* rim and hub on the outer face */}
      <mesh position={[(side * width) / 2 + side * 0.02, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={MAT.paint}>
        <cylinderGeometry args={[radius * 0.55, radius * 0.58, 0.08, 20]} />
      </mesh>
      <mesh position={[(side * width) / 2 + side * 0.07, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={MAT.steelDark}>
        <cylinderGeometry args={[radius * 0.2, radius * 0.24, 0.1, 12]} />
      </mesh>
      {/* wheel nuts so rotation reads */}
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return (
          <mesh
            key={i}
            position={[(side * width) / 2 + side * 0.08, Math.sin(a) * radius * 0.38, Math.cos(a) * radius * 0.38]}
            material={MAT.steel}
          >
            <boxGeometry args={[0.06, 0.07, 0.07]} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Amber rotating beacon that flashes while the machine is working or moving. */
export function Beacon({
  telemetry,
  position,
  scale = 1,
}: {
  telemetry: MachineTelemetry;
  position: [number, number, number];
  scale?: number;
}) {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#ffae00",
        emissive: "#ff9d00",
        emissiveIntensity: 0.2,
        transparent: true,
        opacity: 0.9,
        toneMapped: false,
      }),
    [],
  );
  useFrame((state) => {
    const active = Math.abs(telemetry.speed) > 0.2 || telemetry.activity !== "idle";
    const flash = Math.sin(state.clock.elapsedTime * 9 + telemetry.x) > 0.2 ? 3.2 : 0.3;
    mat.emissiveIntensity = active ? flash : 0.25;
  });
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.03, 0]} material={MAT.black}>
        <cylinderGeometry args={[0.1, 0.11, 0.06, 12]} />
      </mesh>
      <mesh position={[0, 0.13, 0]} material={mat}>
        <cylinderGeometry args={[0.075, 0.085, 0.16, 12]} />
      </mesh>
    </group>
  );
}

/** Rear lamps that turn white when reversing. */
export function TailLamps({
  telemetry,
  positions,
}: {
  telemetry: MachineTelemetry;
  positions: [number, number, number][];
}) {
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#ff3b30", emissive: "#ff2a1f", emissiveIntensity: 0.8, toneMapped: false }),
    [],
  );
  useFrame(() => {
    const reversing = telemetry.speed < -0.15;
    mat.color.set(reversing ? "#ffffff" : "#ff3b30");
    mat.emissive.set(reversing ? "#fff3d6" : "#ff2a1f");
    mat.emissiveIntensity = reversing ? 2.2 : 0.8;
  });
  return (
    <group>
      {positions.map((p, i) => (
        <mesh key={i} position={p} material={mat}>
          <boxGeometry args={[0.22, 0.14, 0.05]} />
        </mesh>
      ))}
    </group>
  );
}

export function Lamp({ position, size = [0.2, 0.14, 0.08] }: { position: [number, number, number]; size?: [number, number, number] }) {
  return (
    <mesh position={position} material={MAT.lampWhite}>
      <boxGeometry args={size} />
    </mesh>
  );
}

/** A flat decal on a body panel. `rotation` orients the plane's front (+Z) outward. */
export function Decal({
  text,
  position,
  rotation = [0, 0, 0],
  width,
  logo = false,
  color,
}: {
  text: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  width: number;
  logo?: boolean;
  color?: string;
}) {
  const tex = useMemo(() => decalTexture(text, { logo, color }), [text, logo, color]);
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[width, width * 0.375]} />
      <meshStandardMaterial map={tex} transparent roughness={0.5} depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
    </mesh>
  );
}

/** Extrudes a side profile (u forward along -Z, v up) into a part `width` wide, centred on X. */
export function profileGeometry(points: [number, number][], width: number, bevel = 0.03): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  points.forEach(([u, v], i) => (i === 0 ? shape.moveTo(u, v) : shape.lineTo(u, v)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  // Shape X -> world -Z, extrusion (Z) -> world X.
  geo.rotateY(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}
