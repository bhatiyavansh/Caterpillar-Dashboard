"use client";

/**
 * Dust kicked up by moving machines.
 *
 * One fixed pool of particles shared by the whole fleet. Each frame, every
 * machine travelling faster than a walk emits a few puffs behind it, in
 * proportion to its speed; each puff rises, spreads and fades over a few
 * seconds. Wet ground suppresses it, which makes the weather visibly change
 * how the site behaves — not just how it is lit.
 */

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { headingVector } from "@/lib/twin/site";
import { terrainHeight } from "@/lib/twin/terrain";
import { useTwinStore } from "@/store/twinStore";

const POOL = 900;
const LIFE_S = 3.2;

const vertexShader = /* glsl */ `
  attribute float aAge;
  attribute float aSize;
  varying float vAlpha;
  void main() {
    float t = clamp(aAge / ${LIFE_S.toFixed(1)}, 0.0, 1.0);
    // Quick bloom, long fade.
    vAlpha = smoothstep(0.0, 0.08, t) * (1.0 - t) * step(0.0, aAge);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (1.0 + t * 2.5) * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.05, d);
    gl_FragColor = vec4(uColor, soft * vAlpha * uOpacity);
  }
`;

export function MachineDust() {
  const engine = useTwinStore((s) => s.engine);
  const cursor = useRef(0);
  const carry = useRef(new Map<string, number>());

  const { geometry, material, velocity } = useMemo(() => {
    const positions = new Float32Array(POOL * 3);
    const age = new Float32Array(POOL).fill(-1);
    const size = new Float32Array(POOL);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aAge", new THREE.BufferAttribute(age, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uColor: { value: new THREE.Color("#b9a27f") },
        uOpacity: { value: 0.5 },
      },
      transparent: true,
      depthWrite: false,
    });
    return { geometry: geo, material: mat, velocity: new Float32Array(POOL * 3) };
  }, []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const ageAttr = geometry.attributes.aAge as THREE.BufferAttribute;
    const sizeAttr = geometry.attributes.aSize as THREE.BufferAttribute;
    const p = pos.array as Float32Array;
    const age = ageAttr.array as Float32Array;
    const size = sizeAttr.array as Float32Array;

    const dryness = 1 - engine.wetness;
    material.uniforms.uOpacity.value = 0.5 * dryness + 0.05;

    // Emit.
    if (dryness > 0.1) {
      for (const t of engine.allTelemetry()) {
        const speed = Math.abs(t.speed);
        if (speed < 1.2) continue;
        const rate = speed * 3.2 * dryness; // puffs per second
        const owed = (carry.current.get(t.machineId) ?? 0) + rate * dt;
        const n = Math.floor(owed);
        carry.current.set(t.machineId, owed - n);

        const f = headingVector(t.heading);
        const back = t.speed >= 0 ? -1 : 1;
        for (let k = 0; k < n; k++) {
          const i = cursor.current;
          cursor.current = (i + 1) % POOL;
          const side = (Math.random() - 0.5) * 3;
          const x = t.x + f.x * back * 3.2 - f.z * side;
          const z = t.z + f.z * back * 3.2 + f.x * side;
          p[i * 3] = x;
          p[i * 3 + 1] = terrainHeight(x, z) + 0.4;
          p[i * 3 + 2] = z;
          velocity[i * 3] = f.x * back * 0.6 + (Math.random() - 0.5) * 0.8;
          velocity[i * 3 + 1] = 0.5 + Math.random() * 0.7;
          velocity[i * 3 + 2] = f.z * back * 0.6 + (Math.random() - 0.5) * 0.8;
          age[i] = 0;
          size[i] = 2.2 + Math.random() * 2.4;
        }
      }
    }

    // Advance.
    for (let i = 0; i < POOL; i++) {
      if (age[i] < 0) continue;
      age[i] += dt;
      if (age[i] > LIFE_S) {
        age[i] = -1;
        continue;
      }
      p[i * 3] += velocity[i * 3] * dt;
      p[i * 3 + 1] += velocity[i * 3 + 1] * dt;
      p[i * 3 + 2] += velocity[i * 3 + 2] * dt;
      // Air drag, and a light breeze drifting east.
      velocity[i * 3] = velocity[i * 3] * (1 - dt * 0.8) + dt * 0.35;
      velocity[i * 3 + 1] *= 1 - dt * 0.9;
      velocity[i * 3 + 2] *= 1 - dt * 0.8;
    }

    pos.needsUpdate = true;
    ageAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
  });

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
