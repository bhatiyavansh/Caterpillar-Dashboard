"use client";

/**
 * /dev/stream — Person B's developer view of the hub stream (not part of the product surface).
 * Shows connection state, envelope counters, sources, every machine, the event log and the
 * director, all read through web/lib/stream.
 */
import { useState } from "react";
import {
  apiBase,
  useEvents,
  useMachines,
  useSources,
  useStreamMeta,
  useStreamStore,
  useWorkers,
} from "@web/lib/stream";

const SCENARIOS = [
  "start_shift", "rain", "unbuckle", "buckle", "worker_behind", "fatigue", "dozer_reversing",
  "heavy_lift", "hydraulic_spike", "idle_anomaly", "loader_queue", "reset",
];

const SEVERITY_CLASS: Record<string, string> = {
  critical: "text-status-crit",
  high: "text-status-crit",
  medium: "text-status-warn",
  low: "text-status-info",
  info: "text-muted",
};

function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
}

export default function DevStreamPage() {
  const meta = useStreamMeta();
  const sources = useSources();
  const machines = useMachines();
  const workers = useWorkers();
  const events = useEvents({ limit: 40 });
  const latency = useStreamStore((s) => s.latencyMs);
  const [director, setDirector] = useState<string>("");

  async function fire(name: string) {
    setDirector(`${name}: sending…`);
    try {
      const r = await fetch(`${apiBase()}/api/director/${name}`, { method: "POST" });
      const body = await r.json();
      setDirector(`${name}: HTTP ${r.status} ${r.ok ? `routed to ${body.routed_to}` : JSON.stringify(body.detail)}`);
    } catch (err) {
      setDirector(`${name}: ${String(err)}`);
    }
  }

  const p50 = percentile(latency, 0.5);
  const p95 = percentile(latency, 0.95);

  return (
    <main className="h-full overflow-y-auto bg-ink-950 p-6 font-mono text-xs text-zinc-200">
      <header className="mb-4 flex flex-wrap items-center gap-4">
        <h1 className="text-sm font-bold uppercase tracking-[0.2em] text-cat-500">/dev/stream</h1>
        <span data-testid="status" className={meta.status === "live" ? "text-status-ok" : "text-status-warn"}>
          {meta.status}
        </span>
        <span>epoch {meta.epoch ?? "—"}</span>
        <span>seq {meta.lastSeq ?? "—"}</span>
        <span>rseq {meta.lastRseq ?? "—"}</span>
        <span>contract {meta.contractVersion ?? "—"}</span>
        <span>reconnects {meta.reconnects}</span>
        <span>resyncs {meta.resyncs}</span>
        <span>
          fan-out p50 {p50?.toFixed(1) ?? "—"} ms · p95 {p95?.toFixed(1) ?? "—"} ms
        </span>
        {meta.eventsTruncated ? <span className="text-status-warn">events truncated (see /api/events)</span> : null}
      </header>

      <section className="mb-4 flex flex-wrap gap-2">
        {sources.map((s) => (
          <span
            key={s.source_id}
            data-testid="source"
            className={`rounded border px-2 py-1 ${s.active ? "border-cat-500 text-cat-500" : "border-white/15 text-muted"}`}
          >
            {s.source_id} · {s.kind} · {s.provenance} · {s.connected ? "connected" : "disconnected"}
            {s.active ? " · ACTIVE" : ""}
          </span>
        ))}
        {sources.length === 0 ? <span className="text-muted">no sources</span> : null}
      </section>

      <section className="mb-4">
        <div className="mb-2 flex flex-wrap gap-2">
          {SCENARIOS.map((n) => (
            <button key={n} onClick={() => fire(n)} className="rounded border border-white/15 px-2 py-1 hover:border-cat-500">
              {n}
            </button>
          ))}
        </div>
        <div className="text-muted">{director}</div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <section>
          <h2 className="label-xs mb-2">machines ({machines.length}) · workers ({workers.length})</h2>
          <table className="w-full min-w-[640px] border-collapse">
            <thead className="text-left text-muted">
              <tr>
                {["id", "model", "status", "intent", "x", "y", "hdg", "m/s", "fuel %", "belt", "bubble", "tip", "hyd °C", "task", "ts"].map((h) => (
                  <th key={h} className="border-b border-white/10 px-1 py-1 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {machines.map((m) => (
                <tr key={m.machine_id} data-testid="machine-row" className="border-b border-white/5">
                  <td className="px-1 text-cat-500">{m.machine_id}</td>
                  <td className="px-1">{m.model}</td>
                  <td className="px-1">{m.status}</td>
                  <td className="px-1">{m.intent}</td>
                  <td className="px-1">{m.pos.x.toFixed(1)}</td>
                  <td className="px-1">{m.pos.y.toFixed(1)}</td>
                  <td className="px-1">{m.heading_deg?.toFixed(0)}</td>
                  <td className="px-1">{m.speed_mps?.toFixed(1)}</td>
                  <td className="px-1">{m.fuel_level_pct?.toFixed(1)}</td>
                  <td className={`px-1 ${m.seatbelt === "unfastened" ? "text-status-crit" : ""}`}>{m.seatbelt ?? "—"}</td>
                  <td className="px-1">{m.bubble}</td>
                  <td className="px-1">{m.tip_over_margin?.toFixed(2)}</td>
                  <td className="px-1">{m.hydraulic_temp_c?.toFixed(1)}</td>
                  <td className="px-1">{m.task_id ?? "—"}</td>
                  <td className="px-1 text-muted">{m.ts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="label-xs mb-2">events (newest first)</h2>
          <ul className="space-y-1">
            {events.map((e) => (
              <li key={`${e.epoch}-${e.rseq}`} data-testid="event-row" className="border-b border-white/5 pb-1">
                <span className="text-muted">#{e.rseq} </span>
                <span className={SEVERITY_CLASS[e.severity] ?? ""}>{e.event}</span>
                <span className="text-muted"> {e.machine_id ?? "site"} · {e.source}{e.stale ? " · stale" : ""}</span>
                <div className="text-zinc-400">{e.message}</div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
