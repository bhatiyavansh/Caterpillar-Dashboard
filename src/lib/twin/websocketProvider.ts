/**
 * Live telemetry over WebSocket.
 *
 * This is the class the whole `TelemetryProvider` seam was built for: it
 * implements exactly the same interface as `MockTelemetryProvider`, so the
 * engine and every 3D component are unchanged whether frames come from the
 * keyboard, the mock generator, or the Python simulator on :8100.
 *
 * It is deliberately forgiving. A demo must not die because a backend is
 * restarting, so the socket reconnects with backoff, reports its state for the
 * HUD, and never throws at callers.
 */

import type { MachineTelemetry, SiteWorker, TelemetryProvider } from "@/types/twin";
import {
  DEFAULT_WS_URL,
  isEvent,
  isMachineState,
  isWorkerState,
  toTelemetry,
  toWorker,
  type LiveEvent,
  type LiveMessage,
} from "./liveFrame";

export type LinkStatus =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "unavailable";

export interface WebSocketProviderOptions {
  url?: string;
  /** Called whenever the link state changes, for the connection badge. */
  onStatus?: (status: LinkStatus, detail: string) => void;
  /** Worker positions arrive on the same socket but are not machine telemetry. */
  onWorkers?: (workers: SiteWorker[]) => void;
  /** Safety and anomaly events, for the twin's event feed. */
  onEvent?: (event: LiveEvent) => void;
  /**
   * Site conditions. These are not on the socket — the stream carries only
   * machine and worker state — so they are polled from `/state` instead.
   */
  onEnvironment?: (env: LiveEnvironment) => void;
}

export interface LiveEnvironment {
  weather: string;
  ground: string;
  visibility_m: number;
  temperature_c: number;
}

/** Backoff schedule, in ms. Caps out so a long outage still retries steadily. */
const BACKOFF = [500, 1000, 2000, 4000, 8000, 15000];

export class WebSocketTelemetryProvider implements TelemetryProvider {
  readonly id = "websocket" as const;

  private listeners = new Set<(data: MachineTelemetry[]) => void>();
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = true;

  /** Latest frame per machine, flushed to listeners on a timer. */
  private machineBuffer = new Map<string, MachineTelemetry>();
  private workerBuffer = new Map<string, SiteWorker>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  private _status: LinkStatus = "idle";
  private lastMessageAt = 0;
  private envTimer: ReturnType<typeof setInterval> | null = null;

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
    this.attempt = 0;
    this.connect();

    // Machines arrive as individual messages at 1 Hz; batch them so the engine
    // sees one coherent set rather than nine separate updates.
    this.flushTimer = setInterval(() => this.flush(), 200);

    // Weather changes on a human timescale, so a slow poll is plenty.
    if (this.options.onEnvironment) {
      void this.pollEnvironment();
      this.envTimer = setInterval(() => void this.pollEnvironment(), 4000);
    }
  }

  /** Derives the REST origin from the socket URL so both track one simulator. */
  private stateUrl(): string {
    const raw = this.options.url ?? DEFAULT_WS_URL;
    try {
      const url = new URL(raw);
      url.protocol = url.protocol === "wss:" ? "https:" : "http:";
      url.pathname = "/state";
      return url.toString();
    } catch {
      return "http://localhost:8100/state";
    }
  }

  private async pollEnvironment(): Promise<void> {
    if (this.stopped || !this.options.onEnvironment) return;
    try {
      const response = await fetch(this.stateUrl(), { cache: "no-store" });
      if (!response.ok) return;
      const state = (await response.json()) as { environment?: LiveEnvironment };
      if (state.environment) this.options.onEnvironment(state.environment);
    } catch {
      // The socket already reports link health; a failed poll is not news.
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.envTimer) clearInterval(this.envTimer);
    this.retry = null;
    this.flushTimer = null;
    this.envTimer = null;

    const socket = this.socket;
    this.socket = null;
    if (socket) {
      // Drop handlers first so closing does not schedule a reconnect.
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        /* already gone */
      }
    }

    this.machineBuffer.clear();
    this.workerBuffer.clear();
    this.setStatus("idle", "Disconnected");
  }

  /* ------------------------------------------------------------------ */

  private setStatus(status: LinkStatus, detail: string): void {
    if (this._status === status) return;
    this._status = status;
    this.options.onStatus?.(status, detail);
  }

  private connect(): void {
    if (this.stopped) return;
    const url = this.options.url ?? DEFAULT_WS_URL;

    this.setStatus(
      this.attempt === 0 ? "connecting" : "reconnecting",
      this.attempt === 0 ? `Connecting to ${url}` : `Reconnecting (attempt ${this.attempt})`,
    );

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      // Bad URL or blocked scheme — retrying will not help much, but the demo
      // should still recover if the user fixes it.
      this.scheduleRetry(`Could not open ${url}`);
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.setStatus("live", "Connected");
    };

    socket.onmessage = (ev) => {
      this.lastMessageAt = Date.now();
      this.handle(ev.data);
    };

    socket.onerror = () => {
      // `onclose` always follows, so recovery is handled in one place.
    };

    socket.onclose = () => {
      if (this.stopped) return;
      this.socket = null;
      this.scheduleRetry("Simulator not reachable");
    };
  }

  private scheduleRetry(detail: string): void {
    if (this.stopped) return;
    const delay = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)];
    this.attempt++;
    this.setStatus(this.attempt > 3 ? "unavailable" : "reconnecting", detail);
    this.retry = setTimeout(() => this.connect(), delay);
  }

  private handle(raw: unknown): void {
    if (typeof raw !== "string") return;

    let message: LiveMessage;
    try {
      message = JSON.parse(raw) as LiveMessage;
    } catch {
      return; // A malformed frame is not worth taking the stream down for.
    }

    try {
      if (isMachineState(message)) {
        this.machineBuffer.set(message.machine_id, toTelemetry(message));
      } else if (isWorkerState(message)) {
        const previous = this.workerBuffer.get(message.worker_id);
        this.workerBuffer.set(message.worker_id, toWorker(message, previous));
      } else if (isEvent(message)) {
        this.options.onEvent?.(message);
      }
    } catch {
      // A single unmappable message must not break the link.
    }
  }

  private flush(): void {
    if (this.machineBuffer.size > 0) {
      const frames = Array.from(this.machineBuffer.values());
      this.listeners.forEach((cb) => cb(frames));
    }
    if (this.workerBuffer.size > 0 && this.options.onWorkers) {
      this.options.onWorkers(Array.from(this.workerBuffer.values()));
    }
  }
}
