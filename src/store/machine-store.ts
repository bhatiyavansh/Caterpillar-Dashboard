"use client";

import { create } from "zustand";
import {
  alerts as seedAlerts,
  inspectionSteps,
  operator as seedOperator,
  machineNotifications as seedNotifications,
  PRIMARY_MACHINE_ID,
  taskItems as seedTasks,
} from "@/lib/mock-data";
import type {
  Alert,
  HealthStatus,
  MachineMode,
  MachineNotification,
  Operator,
  SensorData,
  SimulationScenario,
  TaskItem,
} from "@/lib/types";
import { clamp } from "@/lib/utils";
import { getFleetSource } from "@/lib/api";

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
  /** Whether the operator restraint is buckled. Ground truth for the seatbelt alert. */
  seatbeltFastened: boolean;
  /** Epoch ms the belt was last seen unfastened, or null while it is fastened. Drives escalation. */
  seatbeltUnfastenedAt: number | null;
  simulationOpen: boolean;
  deviceSize: DeviceSizeKey;
  controlsOpen: boolean;
  inspectionResults: Record<string, "pass" | "issue" | "skip">;
  inspectionIndex: number;
  alerts: Alert[];
  tasks: TaskItem[];
  notifications: MachineNotification[];
  voiceState: VoiceState;
  /** The operator on the primary machine: live from the hub, else the local profile. */
  operator: Operator;
  /**
   * Sensor fields the hub is currently supplying. `tick()` leaves exactly
   * these alone, so an older source that omits a reading still has that one
   * gauge animating rather than frozen.
   */
  liveKeys: Partial<Record<keyof SensorData, true>>;
  /** HMI alert id -> hub alert id, so an acknowledgement reaches the whole site. */
  liveAlertIds: Record<string, string>;

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
    engineRpm?: number;
    batteryPct?: number;
    defLevelPct?: number;
    oilPressurePsi?: number;
    hydraulicPressurePsi?: number;
    engineLoadPct?: number;
  }) => void;
  /** Replace the alert list with the hub's, keyed so acknowledgements round-trip. */
  applyLiveAlerts: (alerts: Alert[], idMap: Record<string, string>) => void;
  applyLiveTasks: (tasks: TaskItem[]) => void;
  applyLiveOperator: (operator: Operator) => void;
  /** The hub's restraint state. Drives the same escalation clock the demo toggle does. */
  applyLiveSeatbelt: (fastened: boolean) => void;
  setBackendConnected: (v: boolean) => void;
  /** Presenter/demo toggle — the equivalent of the director's "unbuckle" scenario for this device. */
  setSeatbeltFastened: (v: boolean) => void;
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

/** How long the belt has to stay open before the alert escalates to critical. */
const SEATBELT_ESCALATE_S = 12;
/** Stable id, so escalating the same event updates one record rather than stacking duplicates. Exported so screens can find this one alert without matching on its title. */
export const SEATBELT_ALERT_ID = "ALR-SEATBELT";

/**
 * The seatbelt alert, derived fresh from the restraint state — never appended
 * to by hand, so it can only ever exist when the belt is actually open and
 * disappears the instant it is fastened. Mirrors the escalation the live
 * fleet source (`mock-source.ts`) applies to the same event on `/cab`.
 */
function seatbeltAlert(
  fastened: boolean,
  unfastenedAt: number | null,
  now: number,
  previous: Alert | undefined,
): Alert | null {
  if (fastened || unfastenedAt === null) return null;

  const heldS = (now - unfastenedAt) / 1000;
  const escalated = heldS > SEATBELT_ESCALATE_S;
  const severity: Alert["severity"] = escalated ? "critical" : "warning";

  return {
    id: SEATBELT_ALERT_ID,
    severity,
    machineId: PRIMARY_MACHINE_ID,
    machineName: "CAT 320",
    title: escalated ? "Seatbelt still unfastened" : "Seatbelt unfastened",
    description: escalated
      ? `The operator restraint has been open for ${Math.round(heldS)} seconds while the machine is running. Travel is locked.`
      : "The operator restraint is open while the engine is running.",
    recommendedAction: escalated
      ? "Stop the machine and fasten the belt to release travel."
      : "Fasten the seatbelt before moving.",
    timestamp: "Live",
    system: "Safety",
    // Re-arm acknowledgement on escalation, same as the fleet source: an
    // operator who dismissed the warning still has to see the critical.
    acknowledged: previous && previous.severity === severity ? previous.acknowledged : false,
  };
}

export const useMachineStore = create<MachineState>((set, get) => ({
  sensors: { ...baseSensors },
  scenario: "normal",
  mode: "operating",
  live: true,
  backendConnected: false,
  seatbeltFastened: true,
  seatbeltUnfastenedAt: null,
  simulationOpen: false,
  deviceSize: "1280x800",
  controlsOpen: false,
  inspectionResults: {},
  inspectionIndex: 0,
  alerts: seedAlerts,
  tasks: seedTasks,
  notifications: seedNotifications,
  voiceState: "idle",
  operator: seedOperator,
  liveKeys: {},
  liveAlertIds: {},

  tick: () => {
    const { sensors, scenario, mode, live, backendConnected, liveKeys, alerts, seatbeltFastened, seatbeltUnfastenedAt } = get();

    // Runs every tick regardless of the "live sensor drift" toggle — a
    // presenter turning that off to hold a reading steady should not also
    // silence a safety alert.
    //
    // While the hub is connected it raises the seatbelt alert itself — with the
    // site protocol attached and the simulator's own escalation — so deriving
    // a second one here would show the operator the same alarm twice.
    const now = Date.now();
    const previousSeatbeltAlert = alerts.find((a) => a.id === SEATBELT_ALERT_ID);
    const nextSeatbeltAlert = seatbeltAlert(seatbeltFastened, seatbeltUnfastenedAt, now, previousSeatbeltAlert);
    const seatbeltAlertChanged =
      Boolean(nextSeatbeltAlert) !== Boolean(previousSeatbeltAlert) ||
      (nextSeatbeltAlert && previousSeatbeltAlert && nextSeatbeltAlert.severity !== previousSeatbeltAlert.severity);
    if (!backendConnected && seatbeltAlertChanged) {
      set({
        alerts: nextSeatbeltAlert
          ? [nextSeatbeltAlert, ...alerts.filter((a) => a.id !== SEATBELT_ALERT_ID)]
          : alerts.filter((a) => a.id !== SEATBELT_ALERT_ID),
      });
    }

    if (!live) return;
    const t = targets[scenario];
    const loadFactor = mode === "heavy-load" ? 1.06 : mode === "idle" ? 0.9 : mode === "maintenance" ? 0.7 : 1;
    const burn = mode === "heavy-load" ? 0.09 : mode === "operating" ? 0.05 : mode === "idle" ? 0.015 : 0;

    // Fields the hub is supplying are driven by `applyLiveTelemetry` instead —
    // drifting them here as well would make the readout fight the real value.
    const isLive = (k: keyof SensorData) => backendConnected && liveKeys[k] === true;

    set({
      sensors: {
        ...sensors,
        engineTemperature: isLive("engineTemperature")
          ? sensors.engineTemperature
          : clamp(drift(sensors.engineTemperature, (t.engineTemperature ?? 82) * loadFactor, 0.06, 0.6), 40, 125),
        hydraulicTemperature: isLive("hydraulicTemperature")
          ? sensors.hydraulicTemperature
          : clamp(drift(sensors.hydraulicTemperature, (t.hydraulicTemperature ?? 78) * loadFactor, 0.06, 0.6), 30, 125),
        coolantTemperature: isLive("coolantTemperature")
          ? sensors.coolantTemperature
          : clamp(drift(sensors.coolantTemperature, (t.coolantTemperature ?? 84) * loadFactor, 0.06, 0.5), 40, 125),
        hydraulicPressure: isLive("hydraulicPressure")
          ? sensors.hydraulicPressure
          : clamp(drift(sensors.hydraulicPressure, (t.hydraulicPressure ?? 3200) * loadFactor, 0.08, 40), 0, 4200),
        rpm: isLive("rpm") ? sensors.rpm : clamp(drift(sensors.rpm, modeRpm[mode], 0.15, 60), 0, 2400),
        fuelLevel: isLive("fuelLevel")
          ? sensors.fuelLevel
          : clamp(Number((sensors.fuelLevel - burn).toFixed(2)), 0, 100),
        fuelLitres: isLive("fuelLitres")
          ? sensors.fuelLitres
          : clamp(Number((sensors.fuelLitres - burn * 6.2).toFixed(1)), 0, 640),
        battery: isLive("battery")
          ? sensors.battery
          : clamp(drift(sensors.battery, mode === "maintenance" ? 88 : 91, 0.05, 0.3), 0, 100),
        defLevel: isLive("defLevel")
          ? sensors.defLevel
          : clamp(Number((sensors.defLevel - burn * 0.12).toFixed(2)), 0, 100),
        oilPressure: isLive("oilPressure")
          ? sensors.oilPressure
          : clamp(drift(sensors.oilPressure, mode === "idle" ? 44 : 62, 0.1, 1.5), 0, 90),
        engineLoad: isLive("engineLoad")
          ? sensors.engineLoad
          : clamp(drift(sensors.engineLoad, mode === "heavy-load" ? 88 : mode === "idle" ? 12 : 58, 0.12, 4), 0, 100),
        machineSpeed: isLive("machineSpeed")
          ? sensors.machineSpeed
          : clamp(drift(sensors.machineSpeed, mode === "operating" ? 4.2 : mode === "heavy-load" ? 2.6 : 0, 0.18, 0.4), 0, 12),
        operatingHours: isLive("operatingHours")
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
    set((s) => {
      const next: Partial<SensorData> = {};
      if (patch.fuelPct !== undefined) {
        next.fuelLevel = clamp(patch.fuelPct, 0, 100);
        // Tank capacity is the same 640 L used to seed the mock model, so the
        // litres readout stays proportional to the real percent.
        next.fuelLitres = clamp(Number(((patch.fuelPct / 100) * 640).toFixed(1)), 0, 640);
      }
      if (patch.hydraulicTemperature !== undefined) {
        next.hydraulicTemperature = clamp(patch.hydraulicTemperature, 0, 200);
      }
      if (patch.coolantTemperature !== undefined) {
        next.coolantTemperature = clamp(patch.coolantTemperature, 0, 200);
        // There is no separate engine-block sensor on the wire; coolant is the
        // standard proxy for it.
        next.engineTemperature = clamp(patch.coolantTemperature, 0, 200);
      }
      if (patch.speedKmh !== undefined) next.machineSpeed = Math.max(0, patch.speedKmh);
      if (patch.engineHours !== undefined) next.operatingHours = patch.engineHours;
      if (patch.engineRpm !== undefined) next.rpm = clamp(patch.engineRpm, 0, 2400);
      if (patch.batteryPct !== undefined) next.battery = clamp(patch.batteryPct, 0, 100);
      if (patch.defLevelPct !== undefined) next.defLevel = clamp(patch.defLevelPct, 0, 100);
      if (patch.oilPressurePsi !== undefined) next.oilPressure = clamp(patch.oilPressurePsi, 0, 120);
      if (patch.hydraulicPressurePsi !== undefined) {
        next.hydraulicPressure = clamp(patch.hydraulicPressurePsi, 0, 5000);
      }
      if (patch.engineLoadPct !== undefined) next.engineLoad = clamp(patch.engineLoadPct, 0, 100);

      const liveKeys = { ...s.liveKeys };
      for (const k of Object.keys(next) as (keyof SensorData)[]) liveKeys[k] = true;
      return { sensors: { ...s.sensors, ...next }, liveKeys };
    }),

  applyLiveAlerts: (alerts, liveAlertIds) => set({ alerts, liveAlertIds }),
  applyLiveTasks: (tasks) => set({ tasks }),
  applyLiveOperator: (operator) => set({ operator }),
  applyLiveSeatbelt: (fastened) =>
    set((s) => ({
      seatbeltFastened: fastened,
      seatbeltUnfastenedAt: fastened ? null : (s.seatbeltUnfastenedAt ?? Date.now()),
    })),

  setBackendConnected: (backendConnected) =>
    set((s) => ({
      backendConnected,
      // Offline: every gauge goes back to the local model. The last known alerts
      // and tasks stay on screen under the OFFLINE badge rather than being
      // swapped for demo data the operator might mistake for the real thing.
      liveKeys: backendConnected ? s.liveKeys : {},
    })),

  setSeatbeltFastened: (seatbeltFastened) =>
    set((s) => ({
      seatbeltFastened,
      // Start the clock the moment it opens; don't restart it on a repeated
      // "unfastened" call, or the escalation timer would never reach 12s.
      seatbeltUnfastenedAt: seatbeltFastened ? null : (s.seatbeltUnfastenedAt ?? Date.now()),
    })),

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

  acknowledgeAlert: (id) => {
    const { backendConnected, liveAlertIds } = get();
    set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)) }));
    // Live: acknowledge on the hub too, so it clears on /cab, /command and the
    // twin as well — not just on this device.
    const hubId = liveAlertIds[id];
    if (backendConnected && hubId) getFleetSource().acknowledgeAlert(hubId);
  },

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
    set((s) => ({
      sensors: { ...baseSensors },
      scenario: "normal",
      mode: "operating",
      live: true,
      inspectionResults: {},
      inspectionIndex: 0,
      voiceState: "idle",
      seatbeltFastened: true,
      seatbeltUnfastenedAt: null,
      alerts: s.alerts.filter((a) => a.id !== SEATBELT_ALERT_ID),
    })),
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
