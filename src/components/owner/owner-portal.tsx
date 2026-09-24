"use client";

/**
 * Owner and dealer portal.
 *
 * The audience here is not watching the site; they are deciding about it. So
 * the layout is editorial rather than operational: a written position at the
 * top, the money next, then the evidence, then the two decisions that are
 * actually waiting on them — what to service, and what is costing them.
 */
import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarClock, Download, IndianRupee, TrendingDown, TrendingUp } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Anomaly, MaintenanceItem, SeriesPoint } from "@/lib/api/contracts";
import { ALERT_SEVERITY } from "@/lib/status";
import { useAnomalies, useFleet, useMaintenance, useOwnerReport } from "@/lib/hooks/use-site";
import { KpiRail, type KpiItem } from "@/components/ui/data";
import { PageShell, Panel } from "@/components/ui/page";
import { Button } from "@/components/ui/primitives";
import { SeverityChip } from "@/components/ui/status";
import { EmptyPanel } from "@/components/ui/states";
import { cn } from "@/lib/utils";

const AXIS = {
  stroke: "rgba(255,255,255,0.18)",
  tick: { fill: "#9aa3ad", fontSize: 10 },
  tickLine: false,
  axisLine: false,
};

const TOOLTIP = {
  contentStyle: {
    background: "#14171c",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 6,
    fontSize: 12,
  },
  labelStyle: { color: "#9aa3ad", fontSize: 11 },
  itemStyle: { color: "#e9edf2" },
};

function inr(value: number): string {
  if (value >= 100_000) return `₹${(value / 100_000).toFixed(1)}L`;
  if (value >= 1_000) return `₹${(value / 1_000).toFixed(1)}k`;
  return `₹${value}`;
}

/* --------------------------------------------------------------- charts */

function ChartCard({
  title,
  meta,
  delta,
  children,
  className,
}: {
  title: string;
  meta: string;
  delta?: { value: string; good: boolean };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded border border-white/10 bg-ink-900", className)}>
      <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          <p className="truncate text-[11px] text-muted">{meta}</p>
        </div>
        {delta ? (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold",
              delta.good ? "bg-status-ok/12 text-status-ok" : "bg-status-warn/12 text-status-warn",
            )}
          >
            {delta.good ? <TrendingUp className="size-3" aria-hidden /> : <TrendingDown className="size-3" aria-hidden />}
            {delta.value}
          </span>
        ) : null}
      </div>
      <div className="p-2">{children}</div>
    </section>
  );
}

function UtilisationChart({ data }: { data: SeriesPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={168}>
      <AreaChart data={data} margin={{ top: 6, right: 8, left: -22, bottom: 0 }}>
        <defs>
          <linearGradient id="util" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffcd11" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#ffcd11" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey="label" {...AXIS} />
        <YAxis {...AXIS} domain={[0, 100]} unit="%" width={44} />
        <Tooltip {...TOOLTIP} formatter={(v) => [`${Number(v)}%`, "Utilisation"]} />
        <Area type="monotone" dataKey="value" stroke="#ffcd11" strokeWidth={2} fill="url(#util)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function FuelChart({ data }: { data: SeriesPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={168}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey="label" {...AXIS} />
        <YAxis {...AXIS} width={44} />
        <Tooltip {...TOOLTIP} cursor={{ fill: "rgba(255,255,255,0.04)" }} formatter={(v) => [`${Number(v)} L`, "Fuel"]} />
        <Bar dataKey="value" fill="#4aa8ff" radius={[2, 2, 0, 0]} maxBarSize={30} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function IdleCostChart({ data }: { data: SeriesPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={168}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey="label" {...AXIS} />
        <YAxis {...AXIS} width={50} tickFormatter={(v: number) => inr(Number(v))} />
        <Tooltip {...TOOLTIP} cursor={{ fill: "rgba(255,255,255,0.04)" }} formatter={(v) => [inr(Number(v)), "Idle cost"]} />
        <Bar dataKey="value" fill="#ffb020" radius={[2, 2, 0, 0]} maxBarSize={30} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function ProductivityChart({ data, carbon }: { data: SeriesPoint[]; carbon: SeriesPoint[] }) {
  const merged = data.map((d, i) => ({ label: d.label, productivity: d.value, carbon: carbon[i]?.value ?? 0 }));
  return (
    <ResponsiveContainer width="100%" height={168}>
      <LineChart data={merged} margin={{ top: 6, right: 8, left: -22, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey="label" {...AXIS} />
        <YAxis {...AXIS} width={44} />
        <Tooltip
          {...TOOLTIP}
          formatter={(v, name) =>
            name === "carbon" ? [`${Number(v)} t`, "Carbon"] : [`${Number(v)} m³`, "Volume moved"]
          }
        />
        <Line type="monotone" dataKey="productivity" stroke="#3ddc84" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="carbon" stroke="#9aa3ad" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ------------------------------------------------------------- sections */

function MaintenanceList({ items }: { items: MaintenanceItem[] }) {
  if (!items.length) {
    return <EmptyPanel tone="good" title="Nothing due" body="No machine has a service falling inside the next 30 days." />;
  }
  return (
    <ul className="divide-y divide-white/5">
      {items.map((m) => {
        const token = ALERT_SEVERITY[m.severity];
        const overdue = m.dueInHours < 0;
        return (
          <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className={cn("grid size-9 shrink-0 place-items-center rounded border", token.border, token.bg, token.text)}>
              <CalendarClock className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs font-bold text-zinc-100">{m.machineId}</span>
                <span className="truncate text-sm text-zinc-200">{m.title}</span>
              </div>
              <p className="truncate text-[11px] text-muted">
                {m.component} · component health {m.healthPct}%
                {m.workOrder ? ` · ${m.workOrder}` : ""}
              </p>
            </div>
            <span className={cn("shrink-0 text-right text-[11px] font-bold", overdue ? "text-status-crit" : token.text)}>
              {m.dueLabel}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function AnomalyCard({ anomaly }: { anomaly: Anomaly }) {
  const token = ALERT_SEVERITY[anomaly.severity];
  return (
    <article className={cn("flex flex-col overflow-hidden rounded border bg-ink-850", token.border)}>
      <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2">
        <SeverityChip severity={anomaly.severity} size="sm" soundKey={anomaly.id} />
        <span className="font-mono text-xs font-bold text-zinc-100">{anomaly.machineId}</span>
        <span className="ml-auto truncate text-[11px] text-muted">{anomaly.deviation}</span>
      </div>

      <div className="flex-1 space-y-2 px-3 py-2.5">
        <h3 className="text-sm font-semibold text-zinc-50">{anomaly.title}</h3>
        <p className="text-[11px] leading-relaxed text-zinc-300">{anomaly.explanation}</p>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-white/8 px-3 py-2">
        <span>
          <span className="label-xs block">Estimated cost</span>
          <span className="flex items-baseline font-mono text-lg font-bold tabular-nums text-cat-500">
            <IndianRupee className="size-3.5" aria-hidden />
            {anomaly.costInr.toLocaleString("en-IN")}
          </span>
        </span>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/command?machine=${anomaly.machineId}`}>
            Investigate
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        </Button>
      </div>
    </article>
  );
}

/* ----------------------------------------------------------------- page */

export function OwnerPortal() {
  const { data: report } = useOwnerReport();
  const { data: maintenance } = useMaintenance();
  const { data: anomalies } = useAnomalies();
  const { kpis } = useFleet();

  const { kpis: owner, series } = report;
  const wastedInr = anomalies.reduce((sum, a) => sum + a.costInr, 0);

  const rail: KpiItem[] = [
    { label: "Fleet cost", value: inr(owner.fleetCostInr), hint: "this week, all machines" },
    {
      label: "Idle cost",
      value: inr(owner.idleCostInr),
      status: "warning",
      hint: "engine on, no work done",
      emphasis: true,
    },
    { label: "Fuel", value: owner.fuelL.toLocaleString("en-IN"), unit: "L", hint: "this week" },
    { label: "Carbon", value: owner.carbonTonnes, unit: "tCO₂", hint: "diesel, scope 1" },
    { label: "Utilisation", value: owner.utilization, unit: "%", hint: "fleet average" },
    { label: "Productive hours", value: owner.productiveHours.toLocaleString("en-IN"), unit: "h", hint: "this week" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <KpiRail items={rail} className="shrink-0" />

      <PageShell>
        {/* The written position */}
        <section className="rounded border border-white/10 bg-ink-900">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
            <div>
              <p className="label-xs">Weekly fleet report</p>
              <h2 className="text-lg font-bold tracking-tight text-zinc-50">
                Utilisation held at {owner.utilization}%. Idle time is where the money went.
              </h2>
            </div>
            <Button variant="outline" size="sm">
              <Download className="size-3.5" aria-hidden />
              Export PDF
            </Button>
          </div>

          <div className="grid gap-5 px-5 py-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="space-y-3 text-sm leading-relaxed text-zinc-300">
              <p>
                The fleet ran at <strong className="text-zinc-50">{owner.utilization}% utilisation</strong> across{" "}
                {kpis?.fleetSize ?? 10} machines this week, moving{" "}
                <strong className="text-zinc-50">1,497 m³</strong> for{" "}
                <strong className="text-zinc-50">{owner.fuelL.toLocaleString("en-IN")} L</strong> of diesel. That is in
                line with the previous week on volume, and 4% worse on fuel per cubic metre.
              </p>
              <p>
                The gap is idle. <strong className="text-cat-500">{inr(owner.idleCostInr)}</strong> was spent with
                engines running and nothing being moved, concentrated on EXC002 and the truck rotation. On EXC002 the
                idle stretches line up exactly with the seatbelt reading unfastened — the operator is leaving the seat
                without shutting down. That is a coaching conversation, not a mechanical fault, and it is the single
                cheapest thing to fix on this site.
              </p>
              <p>
                Three services fall due inside the next five days, one of them already overdue on GRD001. Clearing the
                overdue circle bearing before it becomes a breakdown is worth roughly nine hours of avoided downtime.
              </p>
            </div>

            <dl className="space-y-2.5 rounded border border-white/10 bg-ink-850 p-4">
              <p className="label-xs">Where it went</p>
              {[
                { label: "Productive operation", value: 68, hex: "#3ddc84" },
                { label: "Idle, engine on", value: 19, hex: "#ffb020" },
                { label: "Queued and waiting", value: 9, hex: "#4aa8ff" },
                { label: "Service and downtime", value: 4, hex: "#6b7280" },
              ].map((row) => (
                <div key={row.label}>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-xs text-zinc-300">{row.label}</dt>
                    <dd className="font-mono text-xs font-bold tabular-nums text-zinc-100">{row.value}%</dd>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full" style={{ width: `${row.value}%`, background: row.hex }} />
                  </div>
                </div>
              ))}
              <p className="border-t border-white/10 pt-2.5 text-[11px] leading-relaxed text-muted">
                Recoverable this week if idle returns to its 30-day baseline:{" "}
                <strong className="text-cat-500">{inr(wastedInr)}</strong>.
              </p>
            </dl>
          </div>
        </section>

        {/* Evidence */}
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard title="Fleet utilisation" meta="Percentage of shift spent producing" delta={{ value: "+3 pts", good: true }}>
            <UtilisationChart data={series.utilization} />
          </ChartCard>
          <ChartCard title="Fuel consumption" meta="Litres burnt per day, whole fleet" delta={{ value: "+4%", good: false }}>
            <FuelChart data={series.fuel} />
          </ChartCard>
          <ChartCard title="Cost of idle time" meta="Engine running, no work produced" delta={{ value: "+12%", good: false }}>
            <IdleCostChart data={series.idleCost} />
          </ChartCard>
          <ChartCard title="Volume moved and carbon" meta="Cubic metres against tonnes of CO₂" delta={{ value: "+2%", good: true }}>
            <ProductivityChart data={series.productivity} carbon={series.carbon} />
          </ChartCard>
        </div>

        {/* Decisions */}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <Panel
            title="Maintenance due"
            meta={`${maintenance.filter((m) => m.dueInHours < 24).length} inside 24 hours`}
            actions={
              <Link href="/dashboard/maintenance" className="inline-flex items-center gap-1 text-[11px] font-semibold text-cat-500 hover:underline">
                Full schedule
                <ArrowUpRight className="size-3" aria-hidden />
              </Link>
            }
          >
            <MaintenanceList items={maintenance} />
          </Panel>

          <Panel
            title="Detected anomalies"
            meta={`${inr(wastedInr)} estimated impact`}
          >
            <div className="grid gap-3 p-3 sm:grid-cols-2">
              {anomalies.length ? (
                anomalies.map((a) => <AnomalyCard key={a.id} anomaly={a} />)
              ) : (
                <EmptyPanel
                  tone="good"
                  title="No anomalies this week"
                  body="Every machine operated inside its usual pattern for idle, load and fuel."
                  className="sm:col-span-2"
                />
              )}
            </div>
          </Panel>
        </div>
      </PageShell>
    </div>
  );
}
