"use client";

import * as React from "react";
import { BatteryCharging, Cog, Droplets, Flame, Shield, Snowflake, Waves } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader, RunSimulationButton } from "@/components/navigation/dashboard-shell";
import { StatusIndicator } from "@/components/shared/status";
import { CHART_COLORS, TrendAreaChart } from "@/components/charts/charts";
import { EmptyState } from "@/components/ui/primitives";
import { diagnosticSystems } from "@/lib/mock-data";
import type { HealthStatus } from "@/lib/types";
import { cn, statusStyles } from "@/lib/utils";
import { readingStatus, useMachineStore } from "@/store/machine-store";

const icons: Record<string, LucideIcon> = {
  engine: Flame,
  hydraulics: Waves,
  transmission: Cog,
  electrical: BatteryCharging,
  cooling: Snowflake,
  fuel: Droplets,
  safety: Shield,
};

export default function DiagnosticsPage() {
  const sensors = useMachineStore((s) => s.sensors);
  const [activeId, setActiveId] = React.useState("hydraulics");

  // Live sensor values override the seeded status for the two systems the
  // simulator drives, so a cab warning shows up here straight away.
  const liveStatus: Record<string, HealthStatus> = {
    hydraulics: readingStatus(sensors.hydraulicTemperature, 90, 100),
    cooling: readingStatus(sensors.coolantTemperature, 94, 104),
    engine: readingStatus(sensors.engineTemperature, 92, 104),
  };

  const systems = diagnosticSystems.map((s) => ({ ...s, status: liveStatus[s.id] ?? s.status }));
  const active = systems.find((s) => s.id === activeId) ?? systems[0];

  return (
    <div className="pb-10">
      <PageHeader
        title="Diagnostics"
        subtitle="CAT 320 · CAT-320-014 — subsystem health, sensor values and fault codes."
        actions={<RunSimulationButton size="md" />}
      />

      <div className="grid gap-4 p-4 xl:grid-cols-[320px_1fr]">
        <nav aria-label="Systems" className="space-y-2">
          {systems.map((s) => {
            const Icon = icons[s.id] ?? Cog;
            const st = statusStyles[s.status];
            const selected = s.id === active.id;
            return (
              <button
                key={s.id}
                onClick={() => setActiveId(s.id)}
                aria-current={selected ? "true" : undefined}
                className={cn(
                  "panel-raised flex w-full items-center gap-3 border-l-4 p-3 text-left transition-colors",
                  st.border.replace("border-", "border-l-"),
                  selected ? "bg-ink-800" : "hover:bg-ink-800/60",
                )}
              >
                <Icon className={cn("size-5", st.text)} aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-semibold uppercase tracking-wider text-zinc-100">{s.name}</p>
                  <p className={cn("text-[11px] font-bold uppercase tracking-widest", st.text)}>{st.label}</p>
                </div>
                {s.codes.length > 0 ? (
                  <span className="ml-auto rounded bg-white/10 px-2 py-0.5 font-mono text-[11px] text-zinc-300">
                    {s.codes.length}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="space-y-4">
          <div className="panel-raised p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-bold text-zinc-50">{active.name}</h2>
              <StatusIndicator status={active.status} />
            </div>
            <p className="mt-2 text-sm text-muted">{active.summary}</p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {active.sensors.map((s) => (
                <div key={s.label} className={cn("rounded border p-3", statusStyles[s.status].border)}>
                  <p className="label-xs">{s.label}</p>
                  <p className="mt-1 font-mono text-xl font-bold text-zinc-50">{s.value}</p>
                  <p className={cn("text-[11px] font-bold uppercase tracking-widest", statusStyles[s.status].text)}>
                    {statusStyles[s.status].label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="panel-raised p-4">
            <p className="text-sm font-semibold text-zinc-100">Historical trend · 24 h</p>
            <div className="mt-3">
              <TrendAreaChart
                data={active.history}
                dataKey="value"
                color={active.status === "healthy" ? CHART_COLORS.ok : CHART_COLORS.warn}
                height={220}
              />
            </div>
          </div>

          <div className="panel-raised p-4">
            <p className="text-sm font-semibold text-zinc-100">Fault codes</p>
            {active.codes.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  title="No active fault codes"
                  body={`The ${active.name.toLowerCase()} system has not logged a diagnostic code in the last 30 days.`}
                />
              </div>
            ) : (
              <ul className="mt-3 space-y-3">
                {active.codes.map((c) => (
                  <li key={c.code} className={cn("rounded border p-4", statusStyles[c.severity === "info" ? "healthy" : c.severity].border)}>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="rounded bg-cat-500 px-2 py-1 font-mono text-sm font-bold text-ink-950">
                        {c.code}
                      </span>
                      <span className="text-sm font-semibold text-zinc-100">{c.description}</span>
                      <span className="ml-auto text-xs text-muted">
                        {c.occurrences} occurrences · first seen {c.firstSeen}
                      </span>
                    </div>
                    <div className="mt-3">
                      <p className="label-xs">Recommended checks</p>
                      <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-sm text-zinc-300">
                        {c.recommendedChecks.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ol>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
