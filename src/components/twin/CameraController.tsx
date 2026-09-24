"use client";

/**
 * Cinematic camera with four modes.
 *
 * FOLLOW    rides behind EXC001, but the operator keeps full orbit and zoom
 * TOP DOWN  the whole site, plan view
 * SITE      three-quarter vantage framing every machine
 * DRIVER    locked to the cab, looking out over the boom
 *
 * Following works by translating the camera and the orbit target by the same
 * delta each frame. OrbitControls recomputes its offset from the target inside
 * `update()`, so moving both together preserves whatever angle and distance the
 * user has dialled in — the camera follows without stealing the mouse.
 */

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { MACHINES } from "@/lib/twin/simulation";
import { useTwinStore } from "@/store/twinStore";

/** Structural type — avoids depending on three-stdlib's exported types. */
interface Controls {
  target: THREE.Vector3;
  enabled: boolean;
  enableRotate: boolean;
  enablePan: boolean;
  minDistance: number;
  maxDistance: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  update: () => void;
}

const UP = new THREE.Vector3(0, 1, 0);
/** Seconds a mode transition takes. */
const TRANSITION = 1.15;

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function CameraController() {
  const engine = useTwinStore((s) => s.engine);
  const mode = useTwinStore((s) => s.cameraMode);
  const resetNonce = useTwinStore((s) => s.cameraResetNonce);
  // Follow whatever machine is selected, not always EXC001 — otherwise an
  // incident replay on another machine happens off-screen.
  const subjectId = useTwinStore((s) => s.selectedMachine);

  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as unknown as Controls | null;

  const lastTarget = useRef(new THREE.Vector3());
  const transition = useRef(1);
  const fromPosition = useRef(new THREE.Vector3());
  const fromTarget = useRef(new THREE.Vector3());

  const scratch = useMemo(
    () => ({
      target: new THREE.Vector3(),
      position: new THREE.Vector3(),
      delta: new THREE.Vector3(),
      eye: new THREE.Vector3(),
      look: new THREE.Vector3(),
    }),
    [],
  );

  /** Where the camera and its target belong for a given mode. */
  const desiredPose = (
    outPosition: THREE.Vector3,
    outTarget: THREE.Vector3,
  ): void => {
    const p = engine.telemetryOrPrimary(subjectId);

    switch (mode) {
      case "top": {
        outTarget.set(0, 0, -6);
        outPosition.set(0, 235, 0.6);
        return;
      }
      case "site": {
        // Frame the centroid of the fleet from a three-quarter vantage.
        const machines = engine.allTelemetry();
        outTarget.set(0, 0, 0);
        for (const m of machines) outTarget.add(scratch.delta.set(m.x, m.y, m.z));
        outTarget.divideScalar(machines.length);
        outPosition.set(outTarget.x + 96, 74, outTarget.z + 118);
        return;
      }
      case "driver": {
        cabPose(p, outPosition, outTarget);
        return;
      }
      default: {
        // Behind and above the machine, looking down the boom.
        outTarget.set(p.x, p.y + 2.4, p.z);
        const back = new THREE.Vector3(0, 13, 25).applyAxisAngle(UP, -p.heading);
        outPosition.copy(outTarget).add(back);
        return;
      }
    }
  };

  /** Eye point and look-at for the cab, accounting for swing. */
  const cabPose = (
    p: { x: number; y: number; z: number; heading: number; swingAngle: number },
    outPosition: THREE.Vector3,
    outTarget: THREE.Vector3,
  ): void => {
    // Cab eye point in house space.
    outPosition.set(-0.72, 2.45, -1.35);
    outPosition.applyAxisAngle(UP, -p.swingAngle);
    outPosition.y += 1.14;
    outPosition.applyAxisAngle(UP, -p.heading);
    outPosition.add(scratch.delta.set(p.x, p.y, p.z));

    // Look forward along the house, angled slightly down over the boom.
    outTarget.set(0, -2.2, -26);
    outTarget.applyAxisAngle(UP, -p.swingAngle);
    outTarget.applyAxisAngle(UP, -p.heading);
    outTarget.add(outPosition);
  };

  // Start a transition whenever the mode changes or a reset is requested.
  useEffect(() => {
    transition.current = 0;
    fromPosition.current.copy(camera.position);
    fromTarget.current.copy(controls ? controls.target : lastTarget.current);
  }, [mode, resetNonce, subjectId, camera, controls]);

  // Mode-appropriate orbit limits.
  useEffect(() => {
    if (!controls) return;
    controls.enabled = mode !== "driver";
    controls.enableRotate = mode !== "driver";
    controls.enablePan = mode === "top" || mode === "site";
    controls.minDistance = mode === "top" ? 40 : 8;
    controls.maxDistance = mode === "top" ? 420 : 240;
    controls.maxPolarAngle = Math.PI * 0.495;
  }, [controls, mode]);

  useFrame((_, delta) => {
    const { target, position, delta: diff } = scratch;
    desiredPose(position, target);

    // --- driver view is rigidly attached, no orbiting ------------------
    if (mode === "driver") {
      if (transition.current < 1) {
        transition.current = Math.min(1, transition.current + delta / TRANSITION);
        const k = easeInOut(transition.current);
        camera.position.lerpVectors(fromPosition.current, position, k);
      } else {
        camera.position.copy(position);
      }
      camera.lookAt(target);
      if (controls) controls.target.copy(target);
      lastTarget.current.copy(target);
      return;
    }

    // --- settling into a new mode --------------------------------------
    if (transition.current < 1) {
      transition.current = Math.min(1, transition.current + delta / TRANSITION);
      const k = easeInOut(transition.current);

      camera.position.lerpVectors(fromPosition.current, position, k);
      if (controls) {
        controls.target.lerpVectors(fromTarget.current, target, k);
        lastTarget.current.copy(controls.target);
      }
      return;
    }

    // --- settled: follow the subject, keep the user's orbit ------------
    if (!controls) return;

    if (mode === "follow" || mode === "site") {
      // Site view eases toward the fleet centroid; follow tracks exactly.
      const lerp = mode === "site" ? 1 - Math.exp(-0.9 * delta) : 1;
      diff.copy(target).sub(lastTarget.current).multiplyScalar(lerp);

      // Move camera and target together so the orbit offset is unchanged.
      camera.position.add(diff);
      controls.target.add(diff);
      lastTarget.current.copy(controls.target);
    } else {
      lastTarget.current.copy(controls.target);
    }
  });

  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.08}
      zoomSpeed={0.9}
      rotateSpeed={0.55}
      panSpeed={0.8}
      minDistance={8}
      maxDistance={240}
      maxPolarAngle={Math.PI * 0.495}
      target={[0, 0, -10]}
    />
  );
}

/** Machine ids in the order the camera cycles through them. */
export const CAMERA_TARGETS = MACHINES.map((m) => m.id);
