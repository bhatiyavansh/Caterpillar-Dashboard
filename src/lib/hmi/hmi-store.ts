"use client";

/**
 * State the in-cab display owns on top of the 3D twin.
 *
 * The twin engine is the machine: position, speed, arm, workers, weather,
 * stability, hydraulics. It has no seatbelt, no idle accounting and no
 * operator camera, so those live here, along with the display's own alert
 * list. The test bench writes to this store and to the engine; the display
 * only ever reads.
 */
import { create } from "zustand";

export type AlertLevel = 1 | 2 | 3;
export type AlertSource = "machine" | "monitor" | "camera";

export interface HmiAlert {
  id: string;
  /** Dedupe key: one live alert per key. */
  key: string;
  level: AlertLevel;
  source: AlertSource;
  title: string;
  action: string;
  at: number;
  acked: boolean;
  resolved: boolean;
}

export type CameraCheck = "absent" | "drowsy" | "yawn" | "distracted" | "head_down" | "phone" | "extra_person";

export const CAMERA_CHECKS: { id: CameraCheck; label: string; level: AlertLevel; title: string; action: string }[] = [
  { id: "absent", label: "Operator in seat", level: 2, title: "Operator not detected", action: "Return to the seat before operating. Controls stay locked." },
  { id: "drowsy", label: "Eyes open", level: 3, title: "Drowsiness detected", action: "Eyes closed too long. Stop, lower the bucket and take a break." },
  { id: "yawn", label: "Alertness", level: 1, title: "Fatigue signs", action: "Repeated yawning. Plan a break in the next 15 minutes." },
  { id: "distracted", label: "Eyes on work area", level: 2, title: "Eyes off the work area", action: "Look at the work area while the machine is moving." },
  { id: "head_down", label: "Head up", level: 2, title: "Head down", action: "Keep your head up while operating." },
  { id: "phone", label: "No phone", level: 3, title: "Phone in use", action: "Put the phone away. Phone use while operating is prohibited." },
  { id: "extra_person", label: "One person in cab", level: 2, title: "Second person in view", action: "Passengers are not permitted in the cab." },
];

export type CameraStatus = "off" | "starting" | "loading" | "running" | "denied" | "unavailable" | "error";

interface HmiState {
  seatbelt: "fastened" | "unfastened";
  /** True while the display itself holds the e-stop for a seatbelt lockout. */
  interlock: boolean;
  ambientC: number;

  idleSeconds: number;
  idleStreak: number;
  harshEvents: number;
  beltOffSeconds: number;

  alerts: HmiAlert[];
  ackedMachineAlerts: string[];

  camera: {
    enabled: boolean;
    status: CameraStatus;
    detected: Partial<Record<CameraCheck, boolean>>;
    simulated: Partial<Record<CameraCheck, boolean>>;
    fps: number;
  };

  autoIncidents: number;

  setSeatbelt: (s: "fastened" | "unfastened") => void;
  setInterlock: (v: boolean) => void;
  setAmbient: (c: number) => void;
  addIdle: (s: number, streak: boolean) => void;
  resetIdleStreak: () => void;
  addHarsh: (n: number) => void;
  addBeltOff: (s: number) => void;
  raise: (a: Omit<HmiAlert, "id" | "at" | "acked" | "resolved">) => boolean;
  resolve: (key: string) => void;
  ack: (id: string) => void;
  ackMachineAlert: (id: string) => void;
  setCamera: (patch: Partial<HmiState["camera"]>) => void;
  setDetected: (d: Partial<Record<CameraCheck, boolean>>) => void;
  simulate: (check: CameraCheck, on: boolean) => void;
  countIncident: () => void;
  reset: () => void;
}

const INITIAL = {
  seatbelt: "fastened" as const,
  interlock: false,
  ambientC: 34,
  idleSeconds: 22 * 60,
  idleStreak: 0,
  harshEvents: 0,
  beltOffSeconds: 0,
  alerts: [] as HmiAlert[],
  ackedMachineAlerts: [] as string[],
  autoIncidents: 0,
};

let seq = 0;

export const useHmiStore = create<HmiState>()((set, get) => ({
  ...INITIAL,
  camera: { enabled: false, status: "off", detected: {}, simulated: {}, fps: 0 },

  setSeatbelt: (seatbelt) => set({ seatbelt }),
  setInterlock: (interlock) => set({ interlock }),
  setAmbient: (ambientC) => set({ ambientC }),
  addIdle: (s, streak) => set((st) => ({ idleSeconds: st.idleSeconds + s, idleStreak: streak ? st.idleStreak + s : st.idleStreak })),
  resetIdleStreak: () => set({ idleStreak: 0 }),
  addHarsh: (n) => set((st) => ({ harshEvents: st.harshEvents + n })),
  addBeltOff: (s) => set((st) => ({ beltOffSeconds: st.beltOffSeconds + s })),

  raise: (a) => {
    const live = get().alerts.find((x) => x.key === a.key && !x.resolved);
    if (live) return false;
    const alert: HmiAlert = { ...a, id: `hmi-${++seq}`, at: Date.now(), acked: false, resolved: false };
    set((st) => ({ alerts: [alert, ...st.alerts].slice(0, 40) }));
    return true;
  },
  resolve: (key) => set((st) => ({ alerts: st.alerts.map((a) => (a.key === key && !a.resolved ? { ...a, resolved: true } : a)) })),
  ack: (id) => set((st) => ({ alerts: st.alerts.map((a) => (a.id === id ? { ...a, acked: true } : a)) })),
  ackMachineAlert: (id) => set((st) => ({ ackedMachineAlerts: [...st.ackedMachineAlerts, id].slice(-60) })),

  setCamera: (patch) => set((st) => ({ camera: { ...st.camera, ...patch } })),
  setDetected: (detected) => set((st) => ({ camera: { ...st.camera, detected } })),
  simulate: (check, on) => set((st) => ({ camera: { ...st.camera, simulated: { ...st.camera.simulated, [check]: on } } })),
  countIncident: () => set((st) => ({ autoIncidents: st.autoIncidents + 1 })),

  reset: () =>
    set((st) => ({
      ...INITIAL,
      camera: { ...st.camera, simulated: {}, detected: {} },
    })),
}));

/** A camera check is active if the model sees it or the test bench is simulating it. */
export function cameraActive(cam: HmiState["camera"], id: CameraCheck): boolean {
  return Boolean(cam.simulated[id] || (cam.status === "running" && cam.detected[id]));
}
