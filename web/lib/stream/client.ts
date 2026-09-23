/**
 * Reconnecting client for the hub's /ws/live. Framework-free; the WebSocket constructor and the
 * clock are injectable so the behaviour is unit-tested under Node without a server.
 *
 *  - exponential backoff with jitter (0.5 s -> 8 s)
 *  - keeps `epoch` + `lastRseq` across reconnects and resumes with `?since_rseq=&epoch=`
 *  - an rseq gap (or a heartbeat announcing rseq we never saw) closes the socket and resyncs
 *  - status: connecting | live | stale (no frame for `staleAfterMs`) | offline (stopped)
 */
import type { Heartbeat, LiveMessage } from "./contracts.gen";
import { createStreamStore, reduce, type StreamStore } from "./store";

type WSLike = {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(code?: number, reason?: string): void;
};
export type WebSocketCtor = new (url: string) => WSLike;

export interface StreamClientOptions {
  url?: string;
  store?: StreamStore;
  WebSocketImpl?: WebSocketCtor;
  surface?: string;
  staleAfterMs?: number;
  backoffMinMs?: number;
  backoffMaxMs?: number;
  now?: () => number;
  random?: () => number;
}

export const CLOSE_RESYNC = 4000;

export function defaultWsUrl(): string {
  const env = typeof process !== "undefined" ? process.env?.NEXT_PUBLIC_COPILOT_WS : undefined;
  if (env) return env;
  const api = typeof process !== "undefined" ? process.env?.NEXT_PUBLIC_COPILOT_API : undefined;
  if (api) return api.replace(/^http/, "ws").replace(/\/$/, "") + "/ws/live";
  return "ws://localhost:8000/ws/live";
}

export class StreamClient {
  readonly store: StreamStore;
  private readonly url: string;
  private readonly WS: WebSocketCtor;
  private readonly opts: Required<Pick<StreamClientOptions, "staleAfterMs" | "backoffMinMs" | "backoffMaxMs">>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly surface?: string;
  private ws: WSLike | null = null;
  private running = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private resyncing = false;

  constructor(options: StreamClientOptions = {}) {
    this.store = options.store ?? createStreamStore();
    this.url = options.url ?? defaultWsUrl();
    const ctor = options.WebSocketImpl ?? (globalThis as unknown as { WebSocket?: WebSocketCtor }).WebSocket;
    if (!ctor) throw new Error("No WebSocket implementation available");
    this.WS = ctor;
    this.opts = {
      staleAfterMs: options.staleAfterMs ?? 12_000,
      backoffMinMs: options.backoffMinMs ?? 500,
      backoffMaxMs: options.backoffMaxMs ?? 8_000,
    };
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    this.surface = options.surface;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
    this.staleTimer = setInterval(() => this.checkStale(), Math.min(1000, this.opts.staleAfterMs / 2));
  }

  stop(): void {
    this.running = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.reconnectTimer = null;
    this.staleTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) ws.close(1000, "client stopped");
    this.store.setState({ status: "offline" });
  }

  /** The URL for the next connection, including resume parameters. */
  connectUrl(): string {
    const { epoch, lastRseq } = this.store.getState();
    const params: string[] = [];
    if (epoch && lastRseq !== null) params.push(`since_rseq=${lastRseq}`, `epoch=${encodeURIComponent(epoch)}`);
    if (this.surface) params.push(`surface=${encodeURIComponent(this.surface)}`);
    return params.length ? `${this.url}${this.url.includes("?") ? "&" : "?"}${params.join("&")}` : this.url;
  }

  private connect(): void {
    if (!this.running) return;
    this.store.setState({ status: "connecting" });
    let ws: WSLike;
    try {
      ws = new this.WS(this.connectUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onmessage = (ev) => this.onMessage(ws, ev.data);
    ws.onclose = () => this.onClose(ws);
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private onMessage(ws: WSLike, data: unknown): void {
    if (ws !== this.ws || typeof data !== "string") return;
    let msg: LiveMessage;
    try {
      msg = JSON.parse(data) as LiveMessage;
    } catch {
      return;
    }
    const state = this.store.getState();
    if (msg.type === "hello") {
      this.attempt = 0;
      if (state.epoch !== null && state.epoch !== msg.epoch) this.store.setState({ lastRseq: null });
    }
    const rseq = (msg as { rseq?: number }).rseq;
    const sameEpoch = state.epoch !== null && state.epoch === msg.epoch;
    if (rseq !== undefined && sameEpoch && state.lastRseq !== null) {
      if (rseq <= state.lastRseq) return; // duplicate after a resume
      if (rseq > state.lastRseq + 1) return this.resync(ws);
    }
    if (msg.type === "heartbeat" && sameEpoch && state.lastRseq !== null) {
      if ((msg as Heartbeat).last_rseq > state.lastRseq) return this.resync(ws);
    }
    const update = reduce(this.store.getState(), msg, this.now());
    if (update) this.store.setState({ ...update, status: "live" });
  }

  private resync(ws: WSLike): void {
    if (this.resyncing) return;
    this.resyncing = true;
    this.store.setState((s) => ({ resyncs: s.resyncs + 1 }));
    ws.close(CLOSE_RESYNC, "rseq gap");
  }

  private onClose(ws: WSLike): void {
    if (ws !== this.ws) return;
    this.ws = null;
    if (!this.running) return;
    this.store.setState((s) => ({ status: "connecting", reconnects: s.reconnects + 1 }));
    if (this.resyncing) {
      this.resyncing = false;
      this.connect(); // resume immediately with since_rseq
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    const base = Math.min(this.opts.backoffMaxMs, this.opts.backoffMinMs * 2 ** this.attempt);
    this.attempt += 1;
    const delay = base * (0.8 + 0.4 * this.random());
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  /** Exposed for tests. */
  nextBackoffMs(): number {
    return Math.min(this.opts.backoffMaxMs, this.opts.backoffMinMs * 2 ** this.attempt);
  }

  private checkStale(): void {
    const s = this.store.getState();
    if (s.status === "live" && s.lastMessageAt !== null && this.now() - s.lastMessageAt > this.opts.staleAfterMs) {
      this.store.setState({ status: "stale" });
    }
  }
}
