"use client";

/**
 * Shared transform plumbing for every machine.
 *
 * Keeps the telemetry -> transform mapping in exactly one place, so all four
 * machines sit on the terrain and lean on slopes identically.
 */

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { MachineTelemetry } from "@/types/twin";
import { useTwinStore } from "@/store/twinStore";
import { trackTexture } from "./materials";

export interface Chassis {
  root: React.RefObject<THREE.Group | null>;
  tilt: React.RefObject<THREE.Group | null>;
}

/** Applies position, heading and terrain attitude every frame. */
export function useChassis(telemetry: MachineTelemetry): Chassis {
  const root = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);

  useFrame(() => {
    const t = telemetry;
    if (!root.current || !tilt.current) return;
    root.current.position.set(t.x, t.y, t.z);
    // Model forward is -Z; heading is clockwise from north.
    root.current.rotation.y = -t.heading;
    tilt.current.rotation.x = t.pitch;
    tilt.current.rotation.z = -t.roll;
  });

  return { root, tilt };
}

/**
 * A private scrolling track texture plus a registry of wheels/sprockets that
 * should spin with ground speed.
 */
export function useRunningGear(telemetry: MachineTelemetry, scrollScale = 0.32) {
  const engine = useTwinStore((s) => s.engine);
  const wheels = useRef<THREE.Object3D[]>([]);

  const texture = useMemo(() => {
    const t = trackTexture().clone();
    t.needsUpdate = true;
    return t;
  }, []);

  const register = (el: THREE.Object3D | null) => {
    if (el && !wheels.current.includes(el)) wheels.current.push(el);
  };

  useFrame(() => {
    const travel = engine.modelOf(telemetry.machineId).trackTravel;
    texture.offset.x = -travel * scrollScale;
    for (const w of wheels.current) w.rotation.x = travel * 1.6;
  });

  return { texture, register };
}
