/**
 * Assistant client for POST /api/assistant (SSE). Framework-free; `fetch` is injectable for tests.
 * The server's `final` event is authoritative: render `final.text`, not the concatenated tokens
 * (the grounding check may replace an ungrounded draft with a data-only answer).
 */
import type { AssistantRequest, SseEventMap, SseEventName, SseFinal } from "../stream/contracts.gen";
import { SseParser } from "./sse";

export type AssistantEvent = { [K in SseEventName]: { name: K; data: SseEventMap[K] } }[SseEventName];

export interface StreamOptions {
  apiBase?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  onEvent?: (e: AssistantEvent) => void;
  /** Client-side guard slightly above the server's 20 s budget. */
  timeoutMs?: number;
}

export function assistantApiBase(): string {
  const env = typeof process !== "undefined" ? process.env?.NEXT_PUBLIC_COPILOT_API : undefined;
  return (env ?? "http://localhost:8000").replace(/\/$/, "");
}

export async function streamAssistant(req: AssistantRequest, opts: StreamOptions = {}): Promise<SseFinal> {
  const f = opts.fetchImpl ?? fetch;
  const base = opts.apiBase ?? assistantApiBase();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 25_000);
  opts.signal?.addEventListener("abort", () => ctrl.abort());
  try {
    const res = await f(`${base}/api/assistant`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(req),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw new Error(`assistant HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    let final: SseFinal | null = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const m of parser.feed(decoder.decode(value, { stream: true }))) {
        const evt = { name: m.event, data: JSON.parse(m.data) } as AssistantEvent;
        if (evt.name === "final") final = evt.data;
        opts.onEvent?.(evt);
      }
    }
    if (!final) throw new Error("assistant stream ended without a final event");
    return final;
  } finally {
    clearTimeout(timer);
  }
}

async function postAction(id: string, verb: "confirm" | "cancel", opts: StreamOptions = {}) {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${opts.apiBase ?? assistantApiBase()}/api/actions/${encodeURIComponent(id)}/${verb}`, {
    method: "POST",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.detail ?? `HTTP ${res.status}`), { status: res.status });
  return body as { action_id: string; status: string; summary: string };
}

export const confirmAction = (id: string, opts?: StreamOptions) => postAction(id, "confirm", opts);
export const cancelAction = (id: string, opts?: StreamOptions) => postAction(id, "cancel", opts);

/** Voice/typed shortcuts matched locally, never by the LLM (P2_SPEC §5.7). */
export const CONFIRM_RE = /^\s*(yes[, ]*)?(confirm|confirmed|go ahead|do it|file it|book it|yes)\s*[.!]?\s*$/i;
export const CANCEL_RE = /^\s*(no|cancel|stop|don'?t|never mind)\b.*$/i;
