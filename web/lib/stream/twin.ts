/**
 * Interop with Person A's 3D twin (src/lib/twin, src/types/twin.ts). Two directions:
 *
 *  - LiveTelemetryProvider: hub stream -> A's `MachineTelemetry[]` (drop-in for MockTelemetryProvider)
 *  - TwinPublisher:         A's SimulationEngine -> hub /ws/ingest (the twin as a data source),
 *                           and director `control` commands -> engine methods.
 *
 * Mapping constants mirror backend/copilot/adapters/twin_mapping.py.
 */
import type { MachineActivity, MachineTelemetry, TelemetryProvider } from "../../../src/types/twin";
import type { Machine, StreamStore } from "./store";
import { degToRad, siteToTwin } from "./geo";

/** Canonical (C) id -> twin id. Machines not listed keep their canonical id. [TEAM TO CONFIRM: A] */
export const TWIN_IDS: Record<string, string> = { DOZ001: "DZR001", WHL001: "LDR001" };

const ACTIVITY: Record<string, MachineActivity> = {
  dig: "digging",
  dump: "loading",
  swing_left: "swinging",
  swing_right: "swinging",
  travel_forward: "traveling",
  reverse: "traveling",
  push: "traveling",
  grade: "traveling",
  idle: "idle",
};

/**
 * Contract -> A's MachineTelemetry. Fields the contract does not carry are explicit:
 *  - engineRpm: NaN (render as "—"), never a made-up number
 *  - bucketAngle: 0 (neutral pose only; the contract has no bucket angle)
 *  - y: from `heightAt` (pass A's `terrainHeight`), else 0
 */
export function toTelemetry(m: Machine, heightAt?: (x: number, z: number) => number): MachineTelemetry {
  const { x, z } = siteToTwin(m.pos);
  const nearest = m.nearest_person_m ?? 99;
  return {
    machineId: TWIN_IDS[m.machine_id] ?? m.machine_id,
    x,
    y: heightAt ? heightAt(x, z) : 0,
    z,
    speed: m.intent === "reverse" ? -Math.abs(m.speed_mps ?? 0) : m.speed_mps ?? 0,
    heading: degToRad(m.heading_deg ?? 0),
    engineRpm: Number.NaN,
    fuel: m.fuel_level_pct ?? Number.NaN,
    boomAngle: degToRad(m.boom_angle_deg ?? 0),
    stickAngle: degToRad(m.stick_angle_deg ?? 0),
    bucketAngle: 0,
    swingAngle: degToRad(m.swing_angle_deg ?? 0),
    pitch: degToRad(m.pitch_deg ?? 0),
    roll: degToRad(m.roll_deg ?? 0),
    payload: m.payload_kg ?? 0,
    hydraulicTemperature: m.hydraulic_temp_c ?? Number.NaN,
    nearestPerson: nearest >= 99 ? Number.POSITIVE_INFINITY : nearest,
    tipOverMargin: m.tip_over_margin ?? Number.NaN,
    activity: ACTIVITY[m.intent ?? "idle"] ?? "idle",
  };
}

/**
 * Drop-in for A's MockTelemetryProvider. `id` is "live", which A's `TelemetrySource` union does not
 * include yet (snippet sent to A), hence `Omit<TelemetryProvider, "id">`.
 */
export class LiveTelemetryProvider implements Omit<TelemetryProvider, "id"> {
  readonly id = "live" as const;
  private listeners = new Set<(data: MachineTelemetry[]) => void>();
  private unsub: (() => void) | null = null;

  constructor(
    private readonly store: StreamStore,
    private readonly heightAt?: (x: number, z: number) => number,
  ) {}

  subscribe(callback: (data: MachineTelemetry[]) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  start(): void {
    if (this.unsub) return;
    this.unsub = this.store.subscribe((s, prev) => {
      if (s.machines === prev.machines) return;
      const frames = Object.values(s.machines).map((m) => toTelemetry(m, this.heightAt));
      this.listeners.forEach((cb) => cb(frames));
    });
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
  }
}

/* ------------------------------------------------------------------ TwinPublisher */

/** The subset of A's SimulationEngine the publisher uses (structural, so no import of A's code). */
export interface TwinEngineLike {
  snapshot(): unknown;
  forceWorkerApproach(): void;
  forceCollisionRisk(): void;
  forceTipOver(): void;
  forceHydraulicSpike(): void;
  setWeather(mode: "clear" | "rain" | "fog" | "heat"): void;
  resetSimulation(): void;
}

/** Director scenario (C's names) -> engine call. Anything else is acked with ok:false. */
export const TWIN_COMMANDS: Record<string, (e: TwinEngineLike) => void> = {
  worker_behind: (e) => e.forceWorkerApproach(),
  dozer_reversing: (e) => e.forceCollisionRisk(),
  heavy_lift: (e) => e.forceTipOver(),
  hydraulic_spike: (e) => e.forceHydraulicSpike(),
  rain: (e) => e.setWeather("rain"),
  reset: (e) => e.resetSimulation(),
};

export class TwinPublisher {
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private readonly engine: TwinEngineLike,
    private readonly url = "ws://localhost:8000/ws/ingest",
    private readonly hz = 5,
  ) {}

  start(): () => void {
    this.running = true;
    this.open();
    return () => this.stop();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    if (this.retry) clearTimeout(this.retry);
    this.ws?.close();
    this.ws = null;
  }

  private open(): void {
    if (!this.running) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "source_hello", source_id: "twin", kind: "twin",
        format: "twin_snapshot", accepts_control: true }));
      this.timer = setInterval(() => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "twin_snapshot", snapshot: this.engine.snapshot() }));
      }, 1000 / this.hz);
    };
    ws.onmessage = (ev) => {
      let msg: { type?: string; command_id?: string; command?: string };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type !== "control" || !msg.command_id) return;
      const run = msg.command ? TWIN_COMMANDS[msg.command] : undefined;
      if (run) run(this.engine);
      ws.send(JSON.stringify({ type: "control_ack", command_id: msg.command_id, ok: Boolean(run),
        error: run ? null : `twin does not support '${msg.command}'` }));
    };
    ws.onclose = () => {
      if (this.timer) clearInterval(this.timer);
      if (this.running) this.retry = setTimeout(() => this.open(), 2000);
    };
  }
}
