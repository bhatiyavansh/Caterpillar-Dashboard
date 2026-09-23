/**
 * Rendering-free stream store (zustand vanilla). React never touches it directly: components
 * read it through the hooks in `hooks.ts` (selector subscriptions), and render loops such as
 * R3F `useFrame` read `store.getState()` without subscribing at all.
 *
 * Immutability rule: an update replaces only what changed (one machine object, the events array),
 * so a `useMachine("EXC001")` subscriber re-renders only when EXC001 changes.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  Heartbeat,
  Hello,
  LiveEvent,
  LiveMachineState,
  LiveMessage,
  LiveWorkerState,
  MachineState,
  Snapshot,
  SourceInfo,
  WorkerState,
} from "./contracts.gen";

export type StreamStatus = "idle" | "connecting" | "live" | "stale" | "offline";

export type Machine = MachineState | LiveMachineState;
export type Worker = WorkerState | LiveWorkerState;

export interface StreamState {
  status: StreamStatus;
  epoch: string | null;
  lastSeq: number | null;
  lastRseq: number | null;
  contractVersion: string | null;
  sources: SourceInfo[];
  features: Record<string, string>;
  machines: Record<string, Machine>;
  workers: Record<string, Worker>;
  /** Oldest first, bounded to `maxEvents`. */
  events: LiveEvent[];
  activeAlerts: LiveEvent[];
  environment: Record<string, unknown>;
  eventsTruncated: boolean;
  lastMessageAt: number | null;
  reconnects: number;
  resyncs: number;
  /** Last ~200 hub_ts -> receive delays in ms (same-machine clocks; for /dev/stream). */
  latencyMs: number[];
}

export type StreamStore = StoreApi<StreamState>;

export const MAX_EVENTS = 500;
const MAX_LATENCY_SAMPLES = 200;

export function initialState(): StreamState {
  return {
    status: "idle",
    epoch: null,
    lastSeq: null,
    lastRseq: null,
    contractVersion: null,
    sources: [],
    features: {},
    machines: {},
    workers: {},
    events: [],
    activeAlerts: [],
    environment: {},
    eventsTruncated: false,
    lastMessageAt: null,
    reconnects: 0,
    resyncs: 0,
    latencyMs: [],
  };
}

export function createStreamStore(): StreamStore {
  return createStore<StreamState>()(() => initialState());
}

function byId<T>(list: T[], key: (x: T) => string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const x of list) out[key(x)] = x;
  return out;
}

/** Applies one hub message. Pure: returns the partial update (or null when nothing changed). */
export function reduce(s: StreamState, msg: LiveMessage, now: number): Partial<StreamState> | null {
  const base: Partial<StreamState> = { lastMessageAt: now, lastSeq: msg.seq };
  const hubTs = Date.parse(msg.hub_ts);
  if (!Number.isNaN(hubTs)) {
    const lat = s.latencyMs.length >= MAX_LATENCY_SAMPLES ? s.latencyMs.slice(1) : s.latencyMs.slice();
    lat.push(Math.max(0, now - hubTs));
    base.latencyMs = lat;
  }
  switch (msg.type) {
    case "hello": {
      const h = msg as Hello;
      if (s.epoch !== null && s.epoch !== h.epoch) {
        // hub restarted: everything we hold belongs to the old run
        return { ...initialState(), status: s.status, reconnects: s.reconnects, resyncs: s.resyncs,
          ...base, epoch: h.epoch, contractVersion: h.contract_version, sources: h.sources ?? [],
          features: h.features ?? {} };
      }
      return { ...base, epoch: h.epoch, contractVersion: h.contract_version, sources: h.sources ?? [],
        features: h.features ?? {} };
    }
    case "snapshot": {
      const snap = msg as Snapshot;
      return {
        ...base,
        machines: byId<Machine>(snap.machines ?? [], (m) => m.machine_id),
        workers: byId<Worker>(snap.workers ?? [], (w) => w.worker_id),
        activeAlerts: snap.active_alerts ?? [],
        environment: snap.environment ?? {},
        sources: snap.sources ?? [],
        eventsTruncated: snap.events_truncated,
        lastRseq: Math.max(s.lastRseq ?? 0, snap.rseq_at),
      };
    }
    case "machine_state": {
      const m = msg as LiveMachineState;
      return { ...base, machines: { ...s.machines, [m.machine_id]: m } };
    }
    case "worker_state": {
      const w = msg as LiveWorkerState;
      return { ...base, workers: { ...s.workers, [w.worker_id]: w } };
    }
    case "event": {
      const e = msg as LiveEvent;
      const events = s.events.length >= MAX_EVENTS ? s.events.slice(1) : s.events.slice();
      events.push(e);
      const update: Partial<StreamState> = { ...base, events, lastRseq: e.rseq };
      if (["medium", "high", "critical"].includes(e.severity)) {
        const key = `${e.event}|${e.machine_id ?? ""}`;
        update.activeAlerts = [...s.activeAlerts.filter((a) => `${a.event}|${a.machine_id ?? ""}` !== key), e];
      }
      if (e.event === "seatbelt_fastened") {
        update.activeAlerts = (update.activeAlerts ?? s.activeAlerts).filter(
          (a) => !(a.event === "seatbelt_unfastened" && a.machine_id === e.machine_id),
        );
      }
      return update;
    }
    case "utterance":
      return { ...base, lastRseq: msg.rseq };
    case "heartbeat": {
      const hb = msg as Heartbeat;
      return { ...base, sources: hb.sources ?? s.sources };
    }
    default:
      return base;
  }
}
