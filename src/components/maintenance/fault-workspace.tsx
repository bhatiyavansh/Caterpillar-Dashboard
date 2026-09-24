"use client";

/**
 * The breakdown workspace on the Maintenance page.
 *
 * One screen answers the technician's three questions in order: what broke and
 * where (machine view, diagnosis, telemetry), what to do about it (the
 * suggested fix), and what goes on record (the reports). It only appears while
 * a breakdown is open; the rest of Maintenance sits underneath unchanged.
 */
import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  AlertOctagon,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock,
  FastForward,
  MapPin,
  TrendingDown,
  X,
} from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  DETECT_S,
  DIAGNOSIS,
  FEATURES,
  MACHINE,
  PARTS,
  PROCEDURE,
  RUPTURE_S,
  SAFE_S,
  phaseAtLeast,
  type FaultView,
  type PartId,
  type Phase,
  type StepId,
} from "@/lib/maintenance/hydraulic-leak";
import { useFaultStore } from "@/lib/maintenance/fault-store";
import { MachineView, type HoseState } from "./machine-view";
import { FaultProcedure } from "./fault-procedure";
import { FaultReports } from "./fault-reports";
import { Button } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/overlays";
import { CHART_COLORS } from "@/components/charts/charts";
import { cn } from "@/lib/utils";

export const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/* ------------------------------------------------------------------ Header */

export const HEADLINE: Record<Phase, string> = {
  monitoring: "Watching hydraulic trend",
  degrading: "Hydraulic health trending down",
  detected: "Hydraulic leak: stopping machine",
  safed: "Hydraulic leak: machine safed, awaiting technician",
  dispatched: "Technician en route",
  repairing: "Repair in progress",
  verifying: "Test cycle running",
  verified: "Repair verified",
  closed: "Resolved",
};

function Stepper({ view }: { view: FaultView }) {
  const report = useFaultStore((s) => s.reports.breakdown.status);
  const p = view.phase;
  const steps: { label: string; done: boolean; active: boolean }[] = [
    { label: "Detected", done: phaseAtLeast(p, "detected"), active: false },
    { label: "Safed", done: phaseAtLeast(p, "safed"), active: p === "detected" },
    { label: "Report", done: report === "ready", active: report === "running" },
    { label: "Dispatched", done: phaseAtLeast(p, "dispatched"), active: p === "safed" },
    { label: "Repair", done: phaseAtLeast(p, "verifying"), active: p === "dispatched" || p === "repairing" },
    { label: "Verified", done: phaseAtLeast(p, "verified"), active: p === "verifying" },
    { label: "Closed", done: p === "closed", active: p === "verified" },
  ];
  return (
    <ol className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none]">
      {steps.map((s, i) => (
        <li key={s.label} className="flex shrink-0 items-center gap-1">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
              s.done
                ? "bg-status-ok/12 text-status-ok"
                : s.active
                  ? "bg-cat-500/15 text-cat-500 ring-1 ring-cat-500/40"
                  : "bg-white/[0.04] text-zinc-500",
            )}
          >
            {s.done ? <CheckCircle2 className="size-3.5" aria-hidden /> : <CircleDot className="size-3.5" aria-hidden />}
            {s.label}
          </span>
          {i < steps.length - 1 ? <span className="h-px w-3 bg-white/15" aria-hidden /> : null}
        </li>
      ))}
    </ol>
  );
}

function FaultHeader({ view }: { view: FaultView }) {
  const { reset, skipToFailure } = useFaultStore();
  const p = view.phase;
  const confirmed = phaseAtLeast(p, "detected");
  const tone = p === "closed" || p === "verified" ? "ok" : confirmed ? "crit" : "warn";
  const downFrom = view.detectedAt;
  const downTo = view.record.closedAt ?? view.now;

  return (
    <section
      className={cn(
        "panel-raised overflow-hidden border-l-4",
        tone === "crit" ? "border-l-status-crit" : tone === "ok" ? "border-l-status-ok" : "border-l-status-warn",
      )}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-3.5">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded",
            tone === "crit" ? "bg-status-crit/15 text-status-crit" : tone === "ok" ? "bg-status-ok/15 text-status-ok" : "bg-status-warn/15 text-status-warn",
          )}
        >
          {tone === "ok" ? <CheckCircle2 className="size-5" aria-hidden /> : confirmed ? <AlertOctagon className="size-5" aria-hidden /> : <TrendingDown className="size-5" aria-hidden />}
        </span>

        <div className="min-w-0 flex-1">
          <p className="label-xs">
            {p === "closed" ? "Resolved breakdown" : confirmed ? "Active breakdown" : "Early warning"} · {view.record.id}
          </p>
          <h2 className="mt-0.5 text-base font-bold leading-tight text-zinc-50 sm:text-lg">
            {MACHINE.label} · {HEADLINE[p]}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" aria-hidden />
              {MACHINE.zone}
            </span>
            <span>Operator {MACHINE.operator}</span>
            {confirmed ? <span>Detected {clock(view.detectedAt)}</span> : null}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {confirmed ? (
            <div className="rounded border border-white/10 bg-ink-850 px-3 py-1.5 text-right">
              <p className="label-xs flex items-center justify-end gap-1">
                <Clock className="size-3" aria-hidden /> {p === "closed" ? "Downtime" : "Down for"}
              </p>
              <p className="font-mono text-lg font-bold tabular-nums text-zinc-50">{mmss(downTo - downFrom)}</p>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={skipToFailure} title="Demo: jump to just before the hose splits">
              <FastForward className="size-3.5" aria-hidden />
              Skip ahead
            </Button>
          )}
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="icon" aria-label={p === "closed" ? "Archive breakdown" : "Cancel simulated breakdown"}>
                <X className="size-4" aria-hidden />
              </Button>
            }
            title={p === "closed" ? "Archive this breakdown?" : "Cancel the simulated breakdown?"}
            description="Clears the breakdown from every screen. The simulation can be started again from Demo control or this page."
            confirmLabel={p === "closed" ? "Archive" : "Cancel breakdown"}
            onConfirm={reset}
          />
        </div>
      </div>
      {confirmed ? (
        <div className="border-t border-white/[0.07] px-4 py-2">
          <Stepper view={view} />
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------ Machine view */

function hoseState(view: FaultView): HoseState {
  const s = view.record.steps;
  if (s.install !== undefined) return "replaced";
  if (s.remove !== undefined) return "removed";
  if (!phaseAtLeast(view.phase, "detected")) return "ok";
  return view.current.engineOn && view.tNow >= RUPTURE_S ? "leaking" : "failed";
}

function partStatus(id: PartId, view: FaultView): { label: string; tone: "ok" | "warn" | "crit" } {
  const confirmed = phaseAtLeast(view.phase, "detected");
  if (id === "hose_h3" && confirmed) {
    const h = hoseState(view);
    if (h === "replaced") return { label: "New hose fitted", tone: "ok" };
    if (h === "removed") return { label: "Removed · ports capped", tone: "warn" };
    return { label: "Failed · replace", tone: "crit" };
  }
  if (id === "tank") {
    const l = view.current.level;
    return l < 88 ? { label: `Low · ${l.toFixed(1)}%`, tone: "warn" } : { label: `${l.toFixed(1)}%`, tone: "ok" };
  }
  if (id === "boom_cyl" && confirmed && hoseState(view) !== "replaced") return { label: "Check head-end port", tone: "warn" };
  return { label: "Normal", tone: "ok" };
}

function MachinePanel({ view, focused }: { view: FaultView; focused: StepId | null }) {
  const confirmed = phaseAtLeast(view.phase, "detected");
  const [picked, setSelected] = React.useState<PartId | null>(null);
  // Once the fault is known, open on the failed hose until someone picks.
  const selected = picked ?? (confirmed ? "hose_h3" : null);

  const step = PROCEDURE.find((s) => s.id === (focused ?? view.nextStep));
  const highlight: PartId[] =
    step && phaseAtLeast(view.phase, "repairing") ? step.parts : confirmed && view.phase !== "closed" ? ["hose_h3", "boom_cyl"] : [];
  const info = selected ? PARTS[selected] : null;
  const status = selected ? partStatus(selected, view) : null;

  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
        <h2 className="label-xs !text-zinc-300">Machine view</h2>
        <span className="text-[10px] text-muted">Hydraulic schematic · live · 3D model slot</span>
      </div>
      <div className="px-3 pt-2">
        <MachineView
          level={view.current.level}
          pressure={view.current.pressure}
          engineOn={view.current.engineOn}
          hose={hoseState(view)}
          spill={confirmed && view.record.steps.refill === undefined}
          highlight={highlight}
          selected={selected}
          onSelect={setSelected}
        />
      </div>
      <div className="flex min-h-16 items-start gap-3 border-t border-white/10 px-4 py-2.5">
        {info && status ? (
          <>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-zinc-100">
                {info.name} <span className="font-mono text-[10px] font-normal text-muted">{info.ref}</span>
              </p>
              <p className="text-xs text-muted">{info.role}</p>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                status.tone === "crit" ? "bg-status-crit/15 text-status-crit" : status.tone === "warn" ? "bg-status-warn/15 text-status-warn" : "bg-status-ok/12 text-status-ok",
              )}
            >
              {status.label}
            </span>
          </>
        ) : (
          <p className="text-xs text-muted">Select a component for its details.</p>
        )}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- Diagnosis */

function DiagnosisPanel({ view }: { view: FaultView }) {
  const confirmed = phaseAtLeast(view.phase, "detected");
  const [open, setOpen] = React.useState<string | null>(DIAGNOSIS[0].cause.id);

  const signals = [
    { label: "Pressure drop", value: `${FEATURES.pressureDropPct.toFixed(0)}%` },
    { label: "Tank level", value: `${FEATURES.levelRate.toFixed(1)} %/min` },
    { label: "Oil temp", value: `+${FEATURES.tempRate.toFixed(1)} °C/min` },
    { label: "Boom drift", value: `${FEATURES.drift.toFixed(0)} mm/min` },
  ];

  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
        <h2 className="label-xs !text-zinc-300">Diagnosis</h2>
        <span className="text-[10px] text-muted">Rules over live telemetry</span>
      </div>

      {!confirmed ? (
        <div className="space-y-2 px-4 py-4 text-xs text-zinc-300">
          <p>
            The tank level is falling on a slow trend with no alarm yet. Diagnosis runs when the detection rule confirms a fault: tank level
            falling fast <em>and</em> pressure below 85 % of normal.
          </p>
          <p className="font-mono text-muted">
            Level now {view.current.level.toFixed(1)}% · pressure {Math.round(view.current.pressure).toLocaleString()} psi
          </p>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-px border-b border-white/10 bg-white/[0.06] sm:grid-cols-4">
            {signals.map((s) => (
              <div key={s.label} className="bg-ink-900 px-3 py-2">
                <dt className="label-xs">{s.label}</dt>
                <dd className="font-mono text-sm font-bold tabular-nums text-zinc-50">{s.value}</dd>
              </div>
            ))}
          </dl>
          <ul className="divide-y divide-white/5">
            {DIAGNOSIS.map((d, i) => {
              const pct = Math.round(d.probability * 100);
              const isOpen = open === d.cause.id;
              return (
                <li key={d.cause.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : d.cause.id)}
                    aria-expanded={isOpen}
                    className="w-full px-4 py-2.5 text-left hover:bg-white/[0.03]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-4 shrink-0 font-mono text-[11px] text-muted">{i + 1}</span>
                      <span className={cn("min-w-0 flex-1 truncate text-sm", i === 0 ? "font-bold text-zinc-50" : "text-zinc-300")}>
                        {d.cause.title}
                      </span>
                      <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted">
                        {d.cause.kind}
                      </span>
                      <span className={cn("w-10 shrink-0 text-right font-mono text-sm font-bold tabular-nums", i === 0 ? "text-status-crit" : "text-zinc-400")}>
                        {pct}%
                      </span>
                      <ChevronDown className={cn("size-3.5 shrink-0 text-muted transition-transform", isOpen && "rotate-180")} aria-hidden />
                    </div>
                    <div className="ml-6 mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <div className={cn("h-full rounded-full", i === 0 ? "bg-status-crit" : "bg-zinc-500")} style={{ width: `${pct}%` }} />
                    </div>
                  </button>
                  {isOpen ? (
                    <div className="space-y-1.5 px-4 pb-3 pl-10">
                      <ul className="space-y-1">
                        {d.evidence.map((e) => (
                          <li key={e.label} className="flex items-center gap-2 text-[11px]">
                            <span className={cn("w-3 shrink-0 font-bold", e.matched ? "text-status-ok" : "text-status-crit")}>
                              {e.matched ? "✓" : "✗"}
                            </span>
                            <span className={e.matched ? "text-zinc-300" : "text-zinc-500"}>{e.label}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="text-[11px] text-muted">
                        <span className="font-semibold text-zinc-400">To confirm at the machine:</span> {d.cause.confirm}
                      </p>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- Telemetry */

const TRENDS = [
  { key: "pressure", label: "Pump pressure", unit: "psi", color: CHART_COLORS.cat, fmt: (v: number) => Math.round(v).toLocaleString() },
  { key: "level", label: "Tank level", unit: "%", color: CHART_COLORS.info, fmt: (v: number) => v.toFixed(1) },
  { key: "temp", label: "Oil temperature", unit: "°C", color: CHART_COLORS.warn, fmt: (v: number) => v.toFixed(1) },
  { key: "drift", label: "Boom drift", unit: "mm/min", color: CHART_COLORS.crit, fmt: (v: number) => v.toFixed(1) },
] as const;

function TelemetryPanel({ view }: { view: FaultView }) {
  const confirmed = phaseAtLeast(view.phase, "detected");
  const verifyS = view.record.verifyStartedAt !== undefined ? (view.record.verifyStartedAt - view.record.startedAt) / 1000 : null;
  const marks = [
    confirmed ? { x: DETECT_S, label: "Detected", color: CHART_COLORS.crit } : null,
    view.tNow >= SAFE_S ? { x: SAFE_S, label: "Safed", color: CHART_COLORS.ok } : null,
    verifyS !== null ? { x: verifyS, label: "Restart", color: CHART_COLORS.info } : null,
  ].filter((m): m is { x: number; label: string; color: string } => m !== null);

  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
        <h2 className="label-xs flex items-center gap-1.5 !text-zinc-300">
          <Activity className="size-3.5" aria-hidden /> Telemetry
        </h2>
        <span className="text-[10px] text-muted">Seconds relative to the first sign of trouble</span>
      </div>
      <div className="grid gap-px bg-white/[0.06] sm:grid-cols-2 xl:grid-cols-4">
        {TRENDS.map((tr) => (
          <div key={tr.key} className="bg-ink-900 px-3 pb-1 pt-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="label-xs">{tr.label}</span>
              <span className="font-mono text-sm font-bold tabular-nums text-zinc-50">
                {tr.fmt(view.current[tr.key])} <span className="text-[10px] font-normal text-muted">{tr.unit}</span>
              </span>
            </div>
            <ResponsiveContainer width="100%" height={110}>
              <LineChart data={view.series} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}s`}
                  stroke="rgba(255,255,255,0.2)"
                  tick={{ fill: "#6b7280", fontSize: 9 }}
                  tickLine={false}
                />
                <YAxis stroke="rgba(255,255,255,0.2)" tick={{ fill: "#6b7280", fontSize: 9 }} tickLine={false} width={42} domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={{ background: "#14171c", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 6, fontSize: 11 }}
                  labelFormatter={(v) => `t ${Number(v) > 0 ? "+" : ""}${Math.round(Number(v))} s`}
                  formatter={(v) => [`${tr.fmt(Number(v))} ${tr.unit}`, tr.label]}
                />
                {marks.map((m) => (
                  <ReferenceLine key={m.label} x={m.x} stroke={m.color} strokeDasharray="3 3" />
                ))}
                <Line type="monotone" dataKey={tr.key} stroke={tr.color} strokeWidth={1.75} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
      {marks.length ? (
        <div className="flex flex-wrap gap-3 border-t border-white/10 px-4 py-1.5 text-[10px] text-muted">
          {marks.map((m) => (
            <span key={m.label} className="inline-flex items-center gap-1.5">
              <span className="h-px w-3 border-t border-dashed" style={{ borderColor: m.color }} />
              {m.label}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/* ---------------------------------------------------------------- Event log */

function EventLog({ view }: { view: FaultView }) {
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-white/10 px-4 py-2.5">
        <h2 className="label-xs !text-zinc-300">Event log</h2>
      </div>
      <ol className="max-h-80 overflow-y-auto">
        <AnimatePresence initial={false}>
          {view.events.map((e) => (
            <motion.li
              key={`${e.label}-${e.at}`}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-3 border-b border-white/5 px-4 py-2 last:border-0"
            >
              <span
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  e.tone === "crit" ? "bg-status-crit" : e.tone === "warn" ? "bg-status-warn" : e.tone === "ok" ? "bg-status-ok" : "bg-status-info",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-zinc-100">{e.label}</p>
                {e.detail ? <p className="text-[11px] text-muted">{e.detail}</p> : null}
              </div>
              <span className="shrink-0 font-mono text-[10px] text-muted">{clock(e.at)}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </section>
  );
}

/* --------------------------------------------------------------- Workspace */

export function FaultWorkspace({ view }: { view: FaultView }) {
  const [focused, setFocused] = React.useState<StepId | null>(null);

  return (
    <div className="space-y-4" id="breakdown">
      <FaultHeader view={view} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <MachinePanel view={view} focused={focused} />
        <DiagnosisPanel view={view} />
      </div>
      <TelemetryPanel view={view} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <FaultProcedure view={view} focused={focused} onFocus={setFocused} />
        <div className="space-y-4">
          <FaultReports view={view} />
          <EventLog view={view} />
        </div>
      </div>
    </div>
  );
}
