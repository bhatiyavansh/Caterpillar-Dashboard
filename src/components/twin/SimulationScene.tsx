"use client";

/**
 * The 3D world.
 *
 * Composition only — every child reads telemetry and writes transforms. The
 * single `SimulationDriver` at the top advances the engine before anything else
 * reads it this frame.
 */

import { Suspense } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { AdaptiveDpr, Preload } from "@react-three/drei";
import { MACHINES, PRIMARY_MACHINE } from "@/lib/twin/simulation";
import { SimulationDriver } from "@/hooks/twin/useSimulation";
import { useTwinStore } from "@/store/twinStore";

import { Site } from "./Site";
import { Excavator } from "./Excavator";
import { Bulldozer } from "./Bulldozer";
import { Loader } from "./Loader";
import { Truck } from "./Truck";
import { WorkerCrew } from "./Worker";
import { SafetyBubble } from "./SafetyBubble";
import { PredictedPaths } from "./PredictedPath";
import { LabelProjector } from "./MachineLabel";
import { IncidentMarkers } from "./IncidentMarkers";
import { CameraController } from "./CameraController";
import { SiteLighting, Weather } from "./Weather";

const FLEET_IDS = MACHINES.map((m) => m.id);

function Fleet() {
  const engine = useTwinStore((s) => s.engine);
  // Only the safety level is subscribed, so this re-renders on level change.
  const safety = useTwinStore((s) => s.snapshot.proximity.level);

  return (
    <group>
      <Excavator telemetry={engine.telemetryOf("EXC001")} safety={safety} />
      <Bulldozer telemetry={engine.telemetryOf("DOZ001")} />
      <Loader telemetry={engine.telemetryOf("WHL001")} />
      <Truck telemetry={engine.telemetryOf("TRK001")} />
    </group>
  );
}

function SafetyLayer() {
  const engine = useTwinStore((s) => s.engine);
  const showBubble = useTwinStore((s) => s.showBubble);
  const showPaths = useTwinStore((s) => s.showPaths);

  return (
    <group>
      {showBubble ? <SafetyBubble telemetry={engine.telemetryOf(PRIMARY_MACHINE)} /> : null}
      {showPaths ? <PredictedPaths machineIds={FLEET_IDS} /> : null}
    </group>
  );
}

export function SimulationScene() {
  return (
    <Canvas
      // PCFSoftShadowMap was removed in three 0.186 — plain PCF is the default.
      shadows
      dpr={[1, 1.75]}
      gl={{
        antialias: true,
        powerPreference: "high-performance",
        alpha: false,
      }}
      camera={{ position: [-8, 28, 34], fov: 52, near: 0.5, far: 2400 }}
      // The in-cab frame CSS-scales the whole stage, and getBoundingClientRect
      // reports the post-transform size — which would feed a shrunken viewport
      // back into an unscaled box. offsetWidth/Height ignore transforms.
      resize={{ offsetSize: true }}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        scene.matrixWorldAutoUpdate = true;
      }}
    >
      {/* Must come first: advances the engine before anything reads telemetry. */}
      <SimulationDriver />

      <SiteLighting />

      <Suspense fallback={null}>
        <Weather />
        <Site />
        <Fleet />
        <WorkerCrew />
        <SafetyLayer />
        <IncidentMarkers />
        <LabelProjector />
        <Preload all />
      </Suspense>

      <CameraController />
      <AdaptiveDpr pixelated />
    </Canvas>
  );
}
