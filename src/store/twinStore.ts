/**
 * Store for the 3D digital twin.
 *
 * Deliberately split into two tiers:
 *
 *  - `engine` is the live simulation. It is mutated sixty times a second inside
 *    `useFrame` and is NOT reactive. 3D components read it directly and write
 *    straight to Object3D transforms, so the render loop never touches React.
 *
 *  - `snapshot` is an immutable copy refreshed at ~12 Hz for the HUD. Telemetry
 *    digits are unreadable at 60 Hz anyway, and this keeps the overlay from
 *    re-rendering on every frame.
 *
 * Both tiers read the same `MachineTelemetry`, which is the whole point: swap
 * the keyboard for a WebSocket and nothing below this file changes.
 */

import { create } from "zustand";
import type {
  Alert,
  CameraMode,
  MachineTelemetry,
  TelemetrySource,
  WeatherMode,
} from "@/types/twin";
import { SimulationEngine, PRIMARY_MACHINE, type UiSnapshot } from "@/lib/twin/simulation";
import { ARM_LIMITS, DEG } from "@/lib/twin/telemetry";
import { clamp, normalizeHeading } from "@/lib/twin/site";

/** One engine per browser session, preserved across Fast Refresh. */
let engineSingleton: SimulationEngine | null = null;

export function getEngine(): SimulationEngine {
  if (!engineSingleton) engineSingleton = new SimulationEngine();
  return engineSingleton;
}

export interface TwinState {
  engine: SimulationEngine;
  snapshot: UiSnapshot;

  /* View state — plain React state, changes rarely. */
  cameraMode: CameraMode;
  selectedMachine: string;
  directorOpen: boolean;
  helpOpen: boolean;
  showPaths: boolean;
  showBubble: boolean;
  /** Bumped to ask CameraController to re-frame. */
  cameraResetNonce: number;

  /* --- view actions --- */
  refresh: () => void;
  setCameraMode: (mode: CameraMode) => void;
  resetCamera: () => void;
  selectMachine: (id: string) => void;
  toggleDirector: () => void;
  toggleHelp: () => void;
  setShowPaths: (v: boolean) => void;
  setShowBubble: (v: boolean) => void;

  /* --- simulation actions (spec §9) --- */
  moveMachine: (id: string, dx: number, dz: number) => void;
  rotateMachine: (id: string, delta: number) => void;
  updateBoom: (delta: number) => void;
  updateStick: (delta: number) => void;
  updateBucket: (delta: number) => void;
  updateSwing: (delta: number) => void;
  updateTelemetry: (id: string, patch: Partial<MachineTelemetry>) => void;
  triggerAlert: (alert: Omit<Alert, "createdAt">) => void;
  resetSimulation: () => void;

  /* --- machine + environment commands --- */
  resetMachine: () => void;
  toggleEmergencyStop: () => void;
  setWeather: (mode: WeatherMode) => void;
  setPaused: (paused: boolean) => void;
  /**
   * `auto` marks a switch made by the live-link probe rather than the operator.
   * An operator choice locks the source so the probe never overrides it.
   */
  setSource: (source: TelemetrySource, opts?: { auto?: boolean }) => void;
  /** True once the operator has picked a source by hand. */
  sourceLocked: boolean;
  /**
   * Releases the operator's source choice so the live-link probe may attach
   * again. Without this a single locked switch — a training session, say —
   * would disable auto-connect for the rest of the browser session.
   */
  releaseSourceLock: () => void;

  /* --- director hazards --- */
  forceWorkerApproach: () => void;
  forceCollisionRisk: () => void;
  forceTipOver: () => void;
  forceHydraulicSpike: () => void;
  forceLowFuel: () => void;
  forceEngineWarning: () => void;

  /* --- recorded incident replay --- */
  startReplay: (incidentId: string) => void;
  stopReplay: () => void;
  showIncidents: boolean;
  setShowIncidents: (v: boolean) => void;
}

export const useTwinStore = create<TwinState>()((set, get) => {
  const engine = getEngine();

  return {
    engine,
    snapshot: engine.snapshot(),

    cameraMode: "follow",
    selectedMachine: PRIMARY_MACHINE,
    directorOpen: false,
    helpOpen: false,
    showPaths: true,
    showBubble: true,
    cameraResetNonce: 0,

    /** Called by the frame driver on a throttle; the only path that re-renders the HUD. */
    refresh: () => set({ snapshot: get().engine.snapshot() }),

    setCameraMode: (cameraMode) => set({ cameraMode }),
    resetCamera: () => set((s) => ({ cameraResetNonce: s.cameraResetNonce + 1 })),
    selectMachine: (selectedMachine) => set({ selectedMachine }),
    toggleDirector: () => set((s) => ({ directorOpen: !s.directorOpen })),
    toggleHelp: () => set((s) => ({ helpOpen: !s.helpOpen })),
    setShowPaths: (showPaths) => set({ showPaths }),
    setShowBubble: (showBubble) => set({ showBubble }),

    /* ------------------------------------------------------------------ */
    /*  Direct telemetry mutators.                                         */
    /*  These are what a WebSocket message handler would call.             */
    /* ------------------------------------------------------------------ */

    moveMachine: (id, dx, dz) => {
      const t = get().engine.telemetryOrPrimary(id);
      t.x += dx;
      t.z += dz;
    },

    rotateMachine: (id, delta) => {
      const t = get().engine.telemetryOrPrimary(id);
      t.heading = normalizeHeading(t.heading + delta);
    },

    updateBoom: (delta) => {
      const t = get().engine.primary;
      t.boomAngle = clamp(t.boomAngle + delta, ARM_LIMITS.boom.min, ARM_LIMITS.boom.max);
    },

    updateStick: (delta) => {
      const t = get().engine.primary;
      t.stickAngle = clamp(t.stickAngle + delta, ARM_LIMITS.stick.min, ARM_LIMITS.stick.max);
    },

    updateBucket: (delta) => {
      const t = get().engine.primary;
      t.bucketAngle = clamp(
        t.bucketAngle + delta,
        ARM_LIMITS.bucket.min,
        ARM_LIMITS.bucket.max,
      );
    },

    updateSwing: (delta) => {
      const t = get().engine.primary;
      t.swingAngle += delta;
    },

    updateTelemetry: (id, patch) => {
      const engine = get().engine;
      if (!engine.allTelemetry().some((t) => t.machineId === id)) return;
      Object.assign(engine.telemetryOf(id), patch, { machineId: id });
    },

    triggerAlert: (alert) => {
      get().engine.injectAlert(alert);
      get().refresh();
    },

    resetSimulation: () => {
      get().engine.resetSimulation();
      set({ cameraMode: "follow", selectedMachine: PRIMARY_MACHINE });
      get().refresh();
    },

    /* ------------------------------------------------------------------ */

    resetMachine: () => {
      get().engine.resetMachine();
      get().refresh();
    },

    toggleEmergencyStop: () => {
      get().engine.toggleEmergencyStop();
      get().refresh();
    },

    setWeather: (mode) => {
      get().engine.setWeather(mode);
      get().refresh();
    },

    setPaused: (paused) => {
      get().engine.setPaused(paused);
      get().refresh();
    },

    sourceLocked: false,

    releaseSourceLock: () => set({ sourceLocked: false }),

    setSource: (source, opts) => {
      get().engine.setSource(source);
      if (!opts?.auto) set({ sourceLocked: true });
      get().refresh();
    },

    forceWorkerApproach: () => {
      get().engine.forceWorkerApproach();
      get().refresh();
    },
    forceCollisionRisk: () => {
      get().engine.forceCollisionRisk();
      get().refresh();
    },
    forceTipOver: () => {
      get().engine.forceTipOver();
      get().refresh();
    },
    forceHydraulicSpike: () => {
      get().engine.forceHydraulicSpike();
      get().refresh();
    },
    forceLowFuel: () => {
      get().engine.forceLowFuel();
      get().refresh();
    },
    forceEngineWarning: () => {
      get().engine.forceEngineWarning();
      get().refresh();
    },

    showIncidents: false,
    setShowIncidents: (showIncidents) => set({ showIncidents }),

    startReplay: (incidentId) => {
      const engine = get().engine;
      engine.startReplay(incidentId);
      // Follow whichever machine the track is being shown through.
      const shownOn = engine.selectedForReplay;
      set({
        selectedMachine: shownOn ?? get().selectedMachine,
        cameraMode: "follow",
        cameraResetNonce: get().cameraResetNonce + 1,
      });
      get().refresh();
    },

    stopReplay: () => {
      get().engine.stopReplay();
      get().refresh();
    },
  };
});

/** Degrees helper for the HUD, kept here so panels do not import lib internals. */
export const toDeg = (rad: number) => rad / DEG;
