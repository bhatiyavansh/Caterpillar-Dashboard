"use client";

/**
 * AR maintenance: the technician's home.
 *
 * Every machine on site with its maintenance state, the ones that need someone
 * floated to the top, and any open breakdown pinned above the lot. Each card
 * opens that machine's page, which holds the full breakdown workspace and its
 * reports when there is one.
 */
import * as React from "react";
import Link from "next/link";
import { AlertOctagon, ArrowRight, BookOpen, CheckCircle2, Clock, Siren, TrendingDown, Wrench } from "lucide-react";
import { useFleet, useMaintenance } from "@/lib/hooks/use-site";
import { useFaultStore, useFaultView } from "@/lib/maintenance/fault-store";
import { useAssistantScope } from "@/components/assistant/assistant-provider";
import { phaseAtLeast, type FaultView } from "@/lib/maintenance/hydraulic-leak";
import type { Machine, MaintenanceItem } from "@/lib/api/contracts";
import { PageShell } from "@/components/ui/page";
import { Button } from "@/components/ui/primitives";
import { MachineStatusChip } from "@/components/ui/status";
import { breakdownHref, MAINTENANCE_HREF } from "./fault-watcher";
import { HEADLINE, mmss } from "./fault-workspace";
import { cn } from "@/lib/utils";

type Level = "breakdown" | "crit" | "warn" | "ok";

const RANK: Record<Level, number> = { breakdown: 0, crit: 1, warn: 2, ok: 3 };

interface Row {
  machine: Machine;
  items: MaintenanceItem[];
  worst: MaintenanceItem | null;
  level: Level;
  reasons: string[];
  fault: FaultView | null;
}

function assess(machine: Machine, items: MaintenanceItem[], fault: FaultView | null): Row {
  const mine = items.filter((i) => i.machineId === machine.id).sort((a, b) => a.healthPct - b.healthPct);
  const worst = mine[0] ?? null;
  const open = fault && fault.record.machineId === machine.id && fault.phase !== "closed" && fault.phase !== "monitoring" ? fault : null;
  const reasons: string[] = [];
  let level: Level = "ok";
  const raise = (l: Level, why: string) => {
    reasons.push(why);
    if (RANK[l] < RANK[level]) level = l;
  };

  if (open) raise(phaseAtLeast(open.phase, "detected") ? "breakdown" : "warn", HEADLINE[open.phase]);
  if (machine.status === "critical") raise("crit", "Machine reporting critical");
  else if (machine.status === "warning") raise("warn", "Machine reporting a warning");
  if (machine.alertIds.length) raise("warn", `${machine.alertIds.length} open alert${machine.alertIds.length > 1 ? "s" : ""}`);
  for (const i of mine) {
    if (i.dueInHours < 0) raise("crit", `${i.component} service overdue`);
    else if (i.severity === "critical") raise("crit", `${i.component} at ${Math.round(i.healthPct)}%`);
    else if (i.severity === "warning") raise("warn", `${i.component} due ${i.dueLabel}`);
  }
  return { machine, items: mine, worst, level, reasons, fault: open };
}

/* ------------------------------------------------------------ Breakdown */

function BreakdownBanner({ view }: { view: FaultView }) {
  const p = view.phase;
  const confirmed = phaseAtLeast(p, "detected");
  const resolved = p === "closed";
  const tone = resolved || p === "verified" ? "ok" : confirmed ? "crit" : "warn";
  const Icon = tone === "ok" ? CheckCircle2 : confirmed ? AlertOctagon : TrendingDown;

  return (
    <Link
      href={breakdownHref(view.record.machineId)}
      className={cn(
        "panel-raised group flex flex-wrap items-center gap-x-4 gap-y-3 border-l-4 px-4 py-3.5 transition-colors hover:bg-white/[0.03]",
        tone === "crit" ? "border-l-status-crit" : tone === "ok" ? "border-l-status-ok" : "border-l-status-warn",
      )}
    >
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded",
          tone === "crit" ? "bg-status-crit/15 text-status-crit" : tone === "ok" ? "bg-status-ok/15 text-status-ok" : "bg-status-warn/15 text-status-warn",
        )}
      >
        <Icon className={cn("size-5", tone === "crit" && "animate-pulse")} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="label-xs">
          {resolved ? "Last breakdown" : confirmed ? "Active breakdown" : "Early warning"} · {view.record.id}
        </p>
        <p className="mt-0.5 text-base font-bold leading-tight text-zinc-50">
          {view.record.machineId} · {HEADLINE[p]}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {resolved
            ? `Work order ${view.record.workOrder} closed. Breakdown and service reports are on file.`
            : confirmed
              ? "Diagnosis, suggested fix and the breakdown report are ready."
              : "Tank level trending down. No alarm yet."}
        </p>
      </div>
      {confirmed ? (
        <div className="shrink-0 rounded border border-white/10 bg-ink-850 px-3 py-1.5 text-right">
          <p className="label-xs flex items-center justify-end gap-1">
            <Clock className="size-3" aria-hidden /> {resolved ? "Downtime" : "Down for"}
          </p>
          <p className="font-mono text-lg font-bold tabular-nums text-zinc-50">
            {mmss((view.record.closedAt ?? view.now) - view.detectedAt)}
          </p>
        </div>
      ) : null}
      <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-cat-500">
        {resolved ? "View reports" : "Open full report"}
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}

/* ------------------------------------------------------------ Machine card */

const LEVEL_STYLE: Record<Level, { border: string; text: string; label: string }> = {
  breakdown: { border: "border-status-crit/60", text: "text-status-crit", label: "Breakdown" },
  crit: { border: "border-status-crit/40", text: "text-status-crit", label: "Needs attention" },
  warn: { border: "border-status-warn/40", text: "text-status-warn", label: "Check soon" },
  ok: { border: "border-white/10", text: "text-status-ok", label: "Healthy" },
};

function MachineCard({ row }: { row: Row }) {
  const { machine: m, worst, level, reasons, fault } = row;
  const style = LEVEL_STYLE[level];
  const health = worst ? Math.round(worst.healthPct) : null;

  return (
    <Link
      href={`${MAINTENANCE_HREF}/${m.id}`}
      className={cn(
        "group flex flex-col gap-3 rounded-xl border bg-ink-900 p-3.5 transition-colors hover:bg-white/[0.03]",
        style.border,
        level === "breakdown" && "bg-status-crit/[0.05] shadow-[0_0_0_1px_rgb(255_77_79/0.25)]",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm font-bold text-zinc-50">{m.id}</p>
          <p className="truncate text-[11px] text-muted">
            {m.model} · {m.kindLabel} · {m.zone}
          </p>
        </div>
        {level === "breakdown" ? (
          <span className="shrink-0 rounded-full bg-status-crit px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
            Breakdown
          </span>
        ) : (
          <MachineStatusChip status={m.status} size="sm" />
        )}
      </div>

      <div>
        <div className="flex items-baseline justify-between text-[11px]">
          <span className="text-muted">{worst ? worst.component : "Component health"}</span>
          <span className="font-mono text-zinc-300">{health !== null ? `${health}%` : "no data"}</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className={cn(
              "h-full rounded-full",
              health === null ? "bg-zinc-600" : health < 30 ? "bg-status-crit" : health < 60 ? "bg-status-warn" : "bg-status-ok",
            )}
            style={{ width: `${health ?? 0}%` }}
          />
        </div>
        {worst ? <p className="mt-1 text-[10px] text-muted">Service {worst.dueLabel}</p> : null}
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-white/[0.06] pt-2.5">
        <span className={cn("size-2 shrink-0 rounded-full", level === "ok" ? "bg-status-ok" : level === "warn" ? "bg-status-warn" : "bg-status-crit")} />
        <span className={cn("min-w-0 flex-1 truncate text-[11px] font-semibold", style.text)}>
          {reasons[0] ?? style.label}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-zinc-400 group-hover:text-cat-500">
          {fault ? "Report" : "Open"}
          <ArrowRight className="size-3.5" aria-hidden />
        </span>
      </div>
    </Link>
  );
}

/* --------------------------------------------------------------------- Hub */

export function MaintenanceHub() {
  const { data: machines } = useFleet();
  const { data: items } = useMaintenance();
  const fault = useFaultView();
  const trigger = useFaultStore((s) => s.trigger);
  const [filter, setFilter] = React.useState<"all" | "attention">("all");

  const rows = React.useMemo(
    () =>
      machines
        .map((m) => assess(m, items, fault))
        .sort((a, b) => RANK[a.level] - RANK[b.level] || a.machine.id.localeCompare(b.machine.id)),
    [machines, items, fault],
  );
  const attention = rows.filter((r) => r.level !== "ok");
  const shown = filter === "all" ? rows : attention;
  const breakdowns = rows.filter((r) => r.level === "breakdown").length;
  const dueSoon = items.filter((i) => i.dueInHours <= 50).length;

  useAssistantScope({
    surface: "ar",
    alert: breakdowns > 0,
    label: "AR maintenance",
    suggestions: ["Which machines need maintenance first?", "What do hydraulic warnings mean?", "How do I do a pre-start inspection?"],
  });

  const kpis = [
    { label: "Machines", value: machines.length, tone: "text-zinc-50" },
    { label: "Need attention", value: attention.length, tone: attention.length ? "text-status-warn" : "text-status-ok" },
    { label: "Open breakdowns", value: breakdowns, tone: breakdowns ? "text-status-crit" : "text-status-ok" },
    { label: "Service due ≤ 50 h", value: dueSoon, tone: dueSoon ? "text-cat-500" : "text-zinc-50" },
  ];

  return (
    <PageShell>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-xs">AR maintenance</p>
          <h1 className="text-lg font-bold tracking-tight text-zinc-50">Fleet maintenance</h1>
          <p className="text-xs text-muted">Every machine&apos;s condition, what is alerting, and the full report behind each breakdown.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`${MAINTENANCE_HREF}/procedures`}>
              <BookOpen className="size-3.5" aria-hidden />
              Routine procedures
            </Link>
          </Button>
          {!fault || fault.phase === "closed" ? (
            <Button variant="secondary" size="sm" onClick={trigger} title="Demo: start a hydraulic hose leak on EXC001">
              <Siren className="size-3.5" aria-hidden />
              Simulate breakdown
            </Button>
          ) : null}
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="panel px-4 py-3">
            <dt className="label-xs">{k.label}</dt>
            <dd className={cn("mt-1 font-mono text-2xl font-bold tabular-nums", k.tone)}>{k.value}</dd>
          </div>
        ))}
      </dl>

      {fault && fault.phase !== "monitoring" ? <BreakdownBanner view={fault} /> : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="label-xs flex items-center gap-1.5 !text-zinc-300">
            <Wrench className="size-3.5" aria-hidden /> Machine status
          </h2>
          <div className="flex rounded-full border border-white/10 p-0.5 text-[11px] font-semibold">
            {(
              [
                ["all", `All ${rows.length}`],
                ["attention", `Needs attention ${attention.length}`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                aria-pressed={filter === id}
                className={cn(
                  "rounded-full px-3 py-1 transition-colors",
                  filter === id ? "bg-cat-500 text-ink-950" : "text-zinc-400 hover:text-zinc-100",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {shown.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {shown.map((r) => (
              <MachineCard key={r.machine.id} row={r} />
            ))}
          </div>
        ) : (
          <p className="panel px-4 py-8 text-center text-sm text-muted">Nothing needs attention. Every machine is inside its limits.</p>
        )}
      </section>
    </PageShell>
  );
}
