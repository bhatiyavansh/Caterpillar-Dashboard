"use client";

import { create } from "zustand";
import {
  alerts as seedAlerts,
  inspectionSteps,
  machineNotifications as seedNotifications,
  taskItems as seedTasks,
} from "@/lib/mock-data";
import type {
  Alert,
  HealthStatus,
  MachineMode,
  MachineNotification,
  SensorData,
  SimulationScenario,
  TaskItem,
} from "@/lib/types";
import { clamp } from "@/lib/utils";

export const DEVICE_SIZES = {
  "1280x800": { w: 1280, h: 800, label: '1280 × 800 · 10.1" primary' },
  "1024x600": { w: 1024, h: 600, label: '1024 × 600 · 7" compact' },
  "1280x720": { w: 1280, h: 720, label: "1280 × 720 · widescreen" },
  "1920x1080": { w: 1920, h: 1080, label: "1920 × 1080 · cab HD" },
} as const;

export type DeviceSizeKey = keyof typeof DEVICE_SIZES;

const baseSensors: SensorData = {
  engineTemperature: 82,
  fuelLevel: 67,
  fuelLitres: 420,
  hydraulicPressure: 3200,
  hydraulicTemperature: 78,
  rpm: 1850,
  battery: 91,
  defLevel: 74,
  oilPressure: 62,
  coolantTemperature: 84,
  operatingHours: 4218,
  machineSpeed: 4.2,
  engineLoad: 58,
};

const targets: Record<SimulationScenario, Partial<SensorData>> = {
  normal: { engineTemperature: 82, hydraulicTemperature: 78, hydraulicPressure: 3200, coolantTemperature: 84 },
  warning: { engineTemperature: 94, hydraulicTemperature: 92, hydraulicPressure: 3420, coolantTemperature: 95 },
  critical: { engineTemperature: 108, hydraulicTemperature: 104, hydraulicPressure: 3720, coolantTemperature: 106 },
};

const modeRpm: Record<MachineMode, number> = {
  idle: 900,
  operating: 1850,
  "heavy-load": 2150,
  maintenance: 0,
};

export type VoiceState = "idle" | "listening" | "thinking" | "responding";

interface MachineState {
  sensors: SensorData;
  scenario: SimulationScenario;
  mode: MachineMode;
  live: boolean;
  /**
   * True while the backend hub is actually streaming telemetry for the
   * primary machine. Distinct from `live`, which just pauses/resumes the
   * local drift model from the Controls panel. While this is true, `tick()`
   * stops drifting the fields the backend covers so the two sources cannot
   * fight each other; `applyLiveTelemetry` is what actually moves them.
   */
  backendConnected: boolean;
  simulationOpen: boolean;
  deviceSize: DeviceSizeKey;
  controlsOpen: boolean;
  inspectionResults: Record<string, "pass" | "issue" | "skip">;
  inspectionIndex: number;
  alerts: Alert[];
  tasks: TaskItem[];
  notifications: MachineNotification[];
  voiceState: VoiceState;

  tick: () => void;
  setScenario: (s: SimulationScenario) => void;
  setMode: (m: MachineMode) => void;
  setSensor: (key: keyof SensorData, value: number) => void;
  setLive: (v: boolean) => void;
  /**
   * Overlay real backend fields onto the sensor model. Only ever writes a
   * field the caller actually supplied — never invents a value — so a
   * partially-live backend still leaves the rest of the panel animating.
   */
  applyLiveTelemetry: (patch: {
    fuelPct?: number;
    hydraulicTemperature?: number;
    coolantTemperature?: number;
    speedKmh?: number;
    engineHours?: number;
  }) => void;
  setBackendConnected: (v: boolean) => void;
  openSimulation: () => void;
  closeSimulation: () => void;
  setDeviceSize: (k: DeviceSizeKey) => void;
  toggleControls: () => void;
  recordInspection: (id: string, result: "pass" | "issue" | "skip") => void;
  setInspectionIndex: (i: number) => void;
  resetInspection: () => void;
  acknowledgeAlert: (id: string) => void;
  cycleTask: (id: string) => void;
  markNotificationsRead: () => void;
  setVoiceState: (v: VoiceState) => void;
  reset: () => void;
}

function drift(current: number, target: number, rate: number, jitter: number) {
  const next = current + (target - current) * rate + (Math.random() - 0.5) * jitter;
  return Number(next.toFixed(1));
}

export const useMachineStore = create<MachineState>((set, get) => ({
  sensors: { ...baseSensors },
  scenario: "normal",
  mode: "operating",
  live: true,
  backendConnected: false,
  simulationOpen: false,
  deviceSize: "1280x800",
  controlsOpen: false,
  inspectionResults: {},
  inspectionIndex: 0,
  alerts: seedAlerts,
  tasks: seedTasks,
  notifications: seedNotifications,
  voiceState: "idle",

  tick: () => {
    const { sensors, scenario, mode, live, backendConnected } = get();
    if (!live) return;
    const t = targets[scenario];
    const loadFactor = mode === "heavy-load" ? 1.06 : mode === "idle" ? 0.9 : mode === "maintenance" ? 0.7 : 1;
    const burn = mode === "heavy-load" ? 0.09 : mode === "operating" ? 0.05 : mode === "idle" ? 0.015 : 0;

    // While the hub is streaming, these fields are driven by
    // `applyLiveTelemetry` instead — drifting them here as well would just
    // make the readout fight the real value every other frame.
    const liveDriven = backendConnected;

    set({
      sensors: {
        ...sensors,
        engineTemperature: liveDriven
          ? sensors.engineTemperature
          : clamp(drift(sensors.engineTemperature, (t.engineTemperature ?? 82) * loadFactor, 0.06, 0.6), 40, 125),
        hydraulicTemperature: liveDriven
          ? sensors.hydraulicTemperature
          : clamp(drift(sensors.hydraulicTemperature, (t.hydraulicTemperature ?? 78) * loadFactor, 0.06, 0.6), 30, 125),
        coolantTemperature: liveDriven
          ? sensors.coolantTemperature
          : clamp(drift(sensors.coolantTemperature, (t.coolantTemperature ?? 84) * loadFactor, 0.06, 0.5), 40, 125),
        hydraulicPressure: clamp(drift(sensors.hydraulicPressure, (t.hydraulicPressure ?? 3200) * loadFactor, 0.08, 40), 0, 4200),
        rpm: clamp(drift(sensors.rpm, modeRpm[mode], 0.15, 60), 0, 2400),
        fuelLevel: liveDriven
          ? sensors.fuelLevel
          : clamp(Number((sensors.fuelLevel - burn).toFixed(2)), 0, 100),
        fuelLitres: liveDriven
          ? sensors.fuelLitres
          : clamp(Number((sensors.fuelLitres - burn * 6.2).toFixed(1)), 0, 640),
        battery: clamp(drift(sensors.battery, mode === "maintenance" ? 88 : 91, 0.05, 0.3), 0, 100),
        defLevel: clamp(Number((sensors.defLevel - burn * 0.12).toFixed(2)), 0, 100),
        oilPressure: clamp(drift(sensors.oilPressure, mode === "idle" ? 44 : 62, 0.1, 1.5), 0, 90),
        engineLoad: clamp(drift(sensors.engineLoad, mode === "heavy-load" ? 88 : mode === "idle" ? 12 : 58, 0.12, 4), 0, 100),
        machineSpeed: liveDriven
          ? sensors.machineSpeed
          : clamp(drift(sensors.machineSpeed, mode === "operating" ? 4.2 : mode === "heavy-load" ? 2.6 : 0, 0.18, 0.4), 0, 12),
        operatingHours: liveDriven
          ? sensors.operatingHours
          : Number((sensors.operatingHours + (mode === "maintenance" ? 0 : 0.0006)).toFixed(4)),
      },
    });
  },

  setScenario: (scenario) => set({ scenario }),
  setMode: (mode) => set({ mode }),
  setSensor: (key, value) =>
    set((s) => ({ sensors: { ...s.sensors, [key]: value }, live: s.live })),
  setLive: (live) => set({ live }),

  applyLiveTelemetry: (patch) =>
    set((s) => ({
      sensors: {
        ...s.sensors,
        ...(patch.fuelPct !== undefined
          ? {
              fuelLevel: clamp(patch.fuelPct, 0, 100),
              // Tank capacity is the same 640 L used to seed the mock model,
              // so the litres readout stays proportional to the real percent.
              fuelLitres: clamp(Number(((patch.fuelPct / 100) * 640).toFixed(1)), 0, 640),
            }
          : null),
        ...(patch.hydraulicTemperature !== undefined
          ? { hydraulicTemperature: clamp(patch.hydraulicTemperature, 0, 200) }
          : null),
        ...(patch.coolantTemperature !== undefined
          ? {
              coolantTemperature: clamp(patch.coolantTemperature, 0, 200),
              // The backend has no separate engine-block sensor; coolant temp
              // is the closest real proxy, same trade-off the twin's liveFrame
              // mapping makes for inferred fields. Purely cosmetic.
              engineTemperature: clamp(patch.coolantTemperature, 0, 200),
            }
          : null),
        ...(patch.speedKmh !== undefined ? { machineSpeed: Math.max(0, patch.speedKmh) } : null),
        ...(patch.engineHours !== undefined ? { operatingHours: patch.engineHours } : null),
      },
    })),

  setBackendConnected: (backendConnected) => set({ backendConnected }),

  openSimulation: () => set({ simulationOpen: true }),
  closeSimulation: () => set({ simulationOpen: false, controlsOpen: false }),
  setDeviceSize: (deviceSize) => set({ deviceSize }),
  toggleControls: () => set((s) => ({ controlsOpen: !s.controlsOpen })),

  recordInspection: (id, result) =>
    set((s) => ({
      inspectionResults: { ...s.inspectionResults, [id]: result },
      inspectionIndex: Math.min(s.inspectionIndex + 1, inspectionSteps.length),
    })),
  setInspectionIndex: (inspectionIndex) => set({ inspectionIndex }),
  resetInspection: () => set({ inspectionResults: {}, inspectionIndex: 0 }),

  acknowledgeAlert: (id) =>
    set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)) })),

  cycleTask: (id) =>
    set((s) => ({
      tasks: s.tasks.map((task) => {
        if (task.id !== id) return task;
        const next: TaskItem["status"] =
          task.status === "pending" ? "in-progress" : task.status === "in-progress" ? "completed" : "pending";
        return { ...task, status: next };
      }),
    })),

  markNotificationsRead: () =>
    set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })),

  setVoiceState: (voiceState) => set({ voiceState }),

  reset: () =>
    set({
      sensors: { ...baseSensors },
      scenario: "normal",
      mode: "operating",
      live: true,
      inspectionResults: {},
      inspectionIndex: 0,
      voiceState: "idle",
    }),
}));

/** Derived health for a single reading against warn/crit thresholds. */
export function readingStatus(value: number, warn: number, crit: number): HealthStatus {
  if (value >= crit) return "critical";
  if (value >= warn) return "warning";
  return "healthy";
}

export function lowReadingStatus(value: number, warn: number, crit: number): HealthStatus {
  if (value <= crit) return "critical";
  if (value <= warn) return "warning";
  return "healthy";
}

/** Overall machine health derived from live sensors — shared by dashboard and machine UI. */
export function useMachineHealth(): HealthStatus {
  const s = useMachineStore((st) => st.sensors);
  const statuses: HealthStatus[] = [
    readingStatus(s.engineTemperature, 92, 104),
    readingStatus(s.hydraulicTemperature, 90, 100),
    readingStatus(s.coolantTemperature, 94, 104),
    readingStatus(s.hydraulicPressure, 3400, 3650),
    lowReadingStatus(s.fuelLevel, 20, 10),
  ];
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("warning")) return "warning";
  return "healthy";
}
