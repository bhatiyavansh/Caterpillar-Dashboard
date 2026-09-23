"use client";

/**
 * Environment: sky, lighting, fog and precipitation.
 *
 * The engine holds `weather` plus two eased ramps (`wetness`, `fogAmount`), so
 * switching conditions blends rather than snapping. Rain is drawn as line
 * segments — far more convincing than round points, and just as cheap.
 */

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import type { WeatherMode } from "@/types/twin";
import { SITE_HALF } from "@/lib/twin/site";
import { terrainHeight } from "@/lib/twin/terrain";
import { useTwinStore } from "@/store/twinStore";

const RAIN_DROPS = 1600;
const RAIN_AREA = 130;
const RAIN_HEIGHT = 62;
const DUST_COUNT = 260;

/** Per-mode look. `fogColor` also tints the horizon through the fog. */
const LOOKS: Record<
  WeatherMode,
  { fogColor: string; sun: number; ambient: number; turbidity: number; rayleigh: number }
> = {
  clear: { fogColor: "#b9c6d4", sun: 2.5, ambient: 0.55, turbidity: 4, rayleigh: 1.2 },
  rain: { fogColor: "#4a5259", sun: 0.75, ambient: 0.4, turbidity: 12, rayleigh: 0.6 },
  fog: { fogColor: "#9aa3aa", sun: 1.0, ambient: 0.75, turbidity: 16, rayleigh: 0.35 },
  heat: { fogColor: "#d8c39a", sun: 3.2, ambient: 0.62, turbidity: 8, rayleigh: 2.4 },
};

export function SiteLighting() {
  const weather = useTwinStore((s) => s.snapshot.weather);
  const sun = useRef<THREE.DirectionalLight>(null);
  const ambient = useRef<THREE.AmbientLight>(null);
  const look = LOOKS[weather];

  // Ease intensity so a weather change does not flash the scene.
  useFrame((_, delta) => {
    const k = 1 - Math.exp(-2.2 * delta);
    if (sun.current) {
      sun.current.intensity += (look.sun - sun.current.intensity) * k;
    }
    if (ambient.current) {
      ambient.current.intensity += (look.ambient - ambient.current.intensity) * k;
    }
  });

  return (
    <>
      <ambientLight ref={ambient} intensity={0.55} color="#c8d4e0" />
      <hemisphereLight args={["#b4c8dc", "#5a4a34", 0.55]} />
      <directionalLight
        ref={sun}
        position={[72, 96, 48]}
        intensity={2.5}
        color="#fff1d6"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0008}
        shadow-normalBias={0.04}
        // Tight ortho box keeps shadow texels dense across the working area.
        shadow-camera-left={-120}
        shadow-camera-right={120}
        shadow-camera-top={120}
        shadow-camera-bottom={-120}
        shadow-camera-near={1}
        shadow-camera-far={320}
      />
      {/* cool fill from the opposite side so shadowed faces keep their shape */}
      <directionalLight position={[-60, 40, -70]} intensity={0.35} color="#8fb4d8" />
    </>
  );
}

function Rain() {
  const engine = useTwinStore((s) => s.engine);
  const lines = useRef<THREE.LineSegments>(null);
  const material = useRef<THREE.LineBasicMaterial>(null);
  const { camera } = useThree();

  // Each drop is two vertices: a head and a tail.
  const { geometry, velocities } = useMemo(() => {
    const positions = new Float32Array(RAIN_DROPS * 2 * 3);
    const vel = new Float32Array(RAIN_DROPS);

    for (let i = 0; i < RAIN_DROPS; i++) {
      const x = (Math.random() - 0.5) * RAIN_AREA;
      const y = Math.random() * RAIN_HEIGHT;
      const z = (Math.random() - 0.5) * RAIN_AREA;
      const len = 0.6 + Math.random() * 0.7;

      positions[i * 6 + 0] = x;
      positions[i * 6 + 1] = y;
      positions[i * 6 + 2] = z;
      positions[i * 6 + 3] = x;
      positions[i * 6 + 4] = y - len;
      positions[i * 6 + 5] = z;

      vel[i] = 26 + Math.random() * 16;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    // Never cull: the drops are re-centred on the camera every frame.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return { geometry: geo, velocities: vel };
  }, []);

  useFrame((_, delta) => {
    const group = lines.current;
    if (!group) return;

    const wetness = engine.wetness;
    group.visible = wetness > 0.02;
    if (material.current) material.current.opacity = wetness * 0.42;
    if (!group.visible) return;

    // Follow the camera so the field always surrounds the view.
    group.position.set(camera.position.x, 0, camera.position.z);

    const attr = geometry.attributes.position as THREE.BufferAttribute;
    const array = attr.array as Float32Array;
    const dt = Math.min(delta, 0.05);

    for (let i = 0; i < RAIN_DROPS; i++) {
      const drop = i * 6;
      const fall = velocities[i] * dt;
      // Slight slant so it does not read as a static curtain.
      const drift = fall * 0.12;

      array[drop + 1] -= fall;
      array[drop + 4] -= fall;
      array[drop + 0] += drift;
      array[drop + 3] += drift;

      if (array[drop + 4] < 0) {
        const x = (Math.random() - 0.5) * RAIN_AREA;
        const z = (Math.random() - 0.5) * RAIN_AREA;
        const len = 0.6 + Math.random() * 0.7;
        array[drop + 0] = x;
        array[drop + 1] = RAIN_HEIGHT;
        array[drop + 2] = z;
        array[drop + 3] = x;
        array[drop + 4] = RAIN_HEIGHT - len;
        array[drop + 5] = z;
      }
    }
    attr.needsUpdate = true;
  });

  return (
    <lineSegments ref={lines} geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial
        ref={material}
        color="#c9d8e6"
        transparent
        opacity={0}
        depthWrite={false}
        toneMapped={false}
      />
    </lineSegments>
  );
}

/** Haze drifting off the working areas. Always present, heavier in the dry heat. */
function Dust() {
  const engine = useTwinStore((s) => s.engine);
  const points = useRef<THREE.Points>(null);
  const material = useRef<THREE.PointsMaterial>(null);

  const { geometry, drift } = useMemo(() => {
    const positions = new Float32Array(DUST_COUNT * 3);
    const vel = new Float32Array(DUST_COUNT * 2);

    for (let i = 0; i < DUST_COUNT; i++) {
      const x = (Math.random() - 0.5) * SITE_HALF * 1.7;
      const z = (Math.random() - 0.5) * SITE_HALF * 1.7;
      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = terrainHeight(x, z) + 0.4 + Math.random() * 3.5;
      positions[i * 3 + 2] = z;
      vel[i * 2 + 0] = (Math.random() - 0.3) * 1.4;
      vel[i * 2 + 1] = (Math.random() - 0.5) * 0.9;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return { geometry: geo, drift: vel };
  }, []);

  useFrame((_, delta) => {
    const attr = geometry.attributes.position as THREE.BufferAttribute;
    const array = attr.array as Float32Array;
    const dt = Math.min(delta, 0.05);
    const limit = SITE_HALF * 0.85;

    for (let i = 0; i < DUST_COUNT; i++) {
      array[i * 3 + 0] += drift[i * 2 + 0] * dt;
      array[i * 3 + 2] += drift[i * 2 + 1] * dt;
      if (array[i * 3 + 0] > limit) array[i * 3 + 0] = -limit;
      if (array[i * 3 + 0] < -limit) array[i * 3 + 0] = limit;
      if (array[i * 3 + 2] > limit) array[i * 3 + 2] = -limit;
      if (array[i * 3 + 2] < -limit) array[i * 3 + 2] = limit;
    }
    attr.needsUpdate = true;

    // Rain knocks the dust down; heat lifts it.
    if (material.current) {
      const base = engine.weather === "heat" ? 0.34 : 0.16;
      material.current.opacity = base * (1 - engine.wetness);
    }
  });

  return (
    <points ref={points} geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        ref={material}
        color="#c9b391"
        size={0.55}
        sizeAttenuation
        transparent
        opacity={0.16}
        depthWrite={false}
      />
    </points>
  );
}

export function Weather() {
  const engine = useTwinStore((s) => s.engine);
  const weather = useTwinStore((s) => s.snapshot.weather);
  const { scene } = useThree();
  const look = LOOKS[weather];

  const fog = useMemo(() => new THREE.FogExp2(look.fogColor, 0.0016), []);
  const target = useMemo(() => new THREE.Color(look.fogColor), []);

  useEffect(() => {
    scene.fog = fog;
    scene.background = null;
    return () => {
      scene.fog = null;
    };
  }, [scene, fog]);

  useFrame((_, delta) => {
    const k = 1 - Math.exp(-2 * delta);
    target.set(LOOKS[engine.weather].fogColor);
    fog.color.lerp(target, k);

    // Fog thickens with the eased ramp, so visibility closes in smoothly.
    const density = 0.0016 + engine.fogAmount * 0.018 + engine.wetness * 0.004;
    fog.density += (density - fog.density) * k;
  });

  // Sun elevation matches the directional light so shadows agree with the sky.
  return (
    <>
      <Sky
        distance={4000}
        sunPosition={[72, 96, 48]}
        turbidity={look.turbidity}
        rayleigh={look.rayleigh}
        mieCoefficient={0.006}
        mieDirectionalG={0.8}
      />
      <Rain />
      <Dust />
    </>
  );
}
