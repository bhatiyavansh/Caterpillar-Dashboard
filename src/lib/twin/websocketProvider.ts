/**
 * Live telemetry for the twin, off the one shared hub connection.
 *
 * This is the class the whole `TelemetryProvider` seam was built for: it
 * implements exactly the same interface as `MockTelemetryProvider`, so the
 * engine and every 3D component are unchanged whether frames come from the
 * keyboard, the mock generator, or the hub.
 *
 * It used to open its own socket straight to the simulator on :8100. It no
 * longer does. Frames straight off the simulator are unenriched — no protocol
 * attachment, no epoch/rseq, and none of the hub-originated events (webcam CV,
 * confirmed actions, incidents) — so the twin and the command centre were
 * showing two different realities from two different sockets. It now subscribes
 * to the shared `web/lib/stream` store: the twin still renders entirely on its
 * own, but the data underneath it is the same data every other surface sees.
 *
 * It stays deliberately forgiving. A demo must not die because a backend is
 * restarting; the shared client handles reconnection and this reports link
 * state for the HUD and never throws at callers.
 */

import {
  acquireStream,
  getStreamStore,
  type Machine as HubMachine,
  type StreamState,
  type StreamStatus,
  type Worker as HubWorker,
} from "@web/lib/stream";
import type { MachineTelemetry, SiteWorker, TelemetryProvider } from "@/types/twin";
import {
  toTelemetry,
  toWorker,
  type LiveEvent,
  type LiveMachineState,
  type LiveWorkerState,
} from "./liveFrame";

export type LinkStatus =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "unavailable";

export interface WebSocketProviderOptions {
  /** Accepted for compatibility; the shared client owns the endpoint. */
  url?: string;
  /** Called whenever the link state changes, for the connection badge. */
  onStatus?: (status: LinkStatus, detail: string) => void;
  /** Worker positions arrive on the same stream but are not machine telemetry. */
  onWorkers?: (workers: SiteWorker[]) => void;
  /** Safety and anomaly events, for the twin's event feed. */
  onEvent?: (event: LiveEvent) => void;
  /** Site conditions, carried on the hub snapshot. */
  onEnvironment?: (env: LiveEnvironment) => void;
}

export interface LiveEnvironment {
  weather: string;
  ground: string;
  visibility_m: number;
  temperature_c: number;
}

/**
 * The hub contract marks a few fields optional that `liveFrame` requires
 * outright. Normalise rather than cast, so a contract change shows up as a type
 * error here instead of as undefined at runtime.
 */
function asLiveMachine(m: HubMachine): LiveMachineState {
  return { ...m, task_id: m.task_id ?? null, zone: m.zone ?? null } as LiveMachineState;
}

function asLiveWorker(w: HubWorker): LiveWorkerState {
  return { type: "worker_state", worker_id: w.worker_id, pos: w.pos, zone: w.zone ?? null };
}

function readEnvironment(env: Record<string, unknown>): LiveEnvironment | null {
  const weather = typeof env.weather === "string" ? env.weather : null;
  if (weather === null) return null;
  return {
    weather,
    ground: typeof env.ground === "string" ? env.ground : "dry",
    visibility_m: typeof env.visibility_m === "number" ? env.visibility_m : 0,
    temperature_c: typeof env.temperature_c === "number" ? env.temperature_c : 0,
  };
}

function linkState(s: StreamState): { status: LinkStatus; detail: string } {
  const map: Record<StreamStatus, { status: LinkStatus; detail: string }> = {
    idle: { status: "idle", detail: "Not connected" },
    connecting: {
      status: s.reconnects > 0 ? "reconnecting" : "connecting",
      detail: s.reconnects > 0 ? `Reconnecting (attempt ${s.reconnects})` : "Connecting to the hub",
    },
    live: { status: "live", detail: "Connected" },
    stale: { status: "unavailable", detail: "Hub connected but the source has gone quiet" },
    offline: { status: "unavailable", detail: "Hub unreachable" },
  };
  return map[s.status] ?? { status: "idle", detail: "Not connected" };
}

export class WebSocketTelemetryProvider implements TelemetryProvider {
  readonly id = "websocket" as const;

  private listeners = new Set<(data: MachineTelemetry[]) => void>();
  private stopped = true;
  private release: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;

  /** Latest frame per machine, flushed to listeners on a timer. */
  private machineBuffer = new Map<string, MachineTelemetry>();
  private workerBuffer = new Map<string, SiteWorker>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  private _status: LinkStatus = "idle";
  private lastMessageAt = 0;
  private lastEventRseq = 0;
  private lastWeather: string | null = null;

  constructor(private readonly options: WebSocketProviderOptions = {}) {}

  get status(): LinkStatus {
    return this._status;
  }

  /** Seconds since the last message, or null if nothing has arrived. */
  get staleness(): number | null {
    return this.lastMessageAt === 0 ? null : (Date.now() - this.lastMessageAt) / 1000;
  }

  subscribe(callback: (data: MachineTelemetry[]) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    if (typeof window === "undefined") return;

    this.release = acquireStream();
    const store = getStreamStore();
    this.unsubscribe = store.subscribe((s) => this.absorb(s));
    this.absorb(store.getState());

    // Machines arrive as individual messages at 1 Hz; batch them so the engine
    // sees one coherent set rather than nine separate updates.
    this.flushTimer = setInterval(() => this.flush(), 200);
  }

  stop(): void {
    this.stopped = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    this.unsubscribe?.();
    this.release?.();
    this.unsubscribe = this.release = null;
    this.machineBuffer.clear();
    this.workerBuffer.clear();
    this.lastEventRseq = 0;
    this.lastWeather = null;
    this.setStatus("idle", "Disconnected");
  }

  /* ------------------------------------------------------------------ */

  /** One store snapshot -> everything the twin needs from it. */
  private absorb(s: StreamState): void {
    if (this.stopped) return;

    const link = linkState(s);
    this.setStatus(link.status, link.detail);
    if (s.lastMessageAt !== null) this.lastMessageAt = s.lastMessageAt;

    for (const m of Object.values(s.machines)) {
      this.machineBuffer.set(m.machine_id, toTelemetry(asLiveMachine(m)));
    }

    if (this.options.onWorkers) {
      let changed = false;
      for (const w of Object.values(s.workers)) {
        const previous = this.workerBuffer.get(w.worker_id);
        this.workerBuffer.set(w.worker_id, toWorker(asLiveWorker(w), previous));
        changed = true;
      }
      if (changed) this.options.onWorkers([...this.workerBuffer.values()]);
    }

    if (this.options.onEvent) {
      // rseq is contiguous per epoch over reliable messages, so it is the cheapest
      // "have I seen this already" check there is.
      for (const e of s.events) {
        if (e.rseq <= this.lastEventRseq) continue;
        this.lastEventRseq = e.rseq;
        this.options.onEvent(e as unknown as LiveEvent);
      }
    }

    if (this.options.onEnvironment) {
      const env = readEnvironment(s.environment);
      if (env && env.weather !== this.lastWeather) {
        this.lastWeather = env.weather;
        this.options.onEnvironment(env);
      }
    }
  }

  private flush(): void {
    if (this.machineBuffer.size === 0 || this.listeners.size === 0) return;
    const frame = [...this.machineBuffer.values()];
    for (const l of this.listeners) l(frame);
  }

  private setStatus(status: LinkStatus, detail: string): void {
    if (this._status === status) return;
    this._status = status;
    this.options.onStatus?.(status, detail);
  }
}
