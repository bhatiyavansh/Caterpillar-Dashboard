"use client";

import * as React from "react";
import { Activity, Radio } from "lucide-react";
import { PageHeader, RunSimulationButton } from "@/components/navigation/dashboard-shell";
import { SensorGauge } from "@/components/gauges/sensor-gauge";
import { CHART_COLORS, MultiLineChart } from "@/components/charts/charts";
import { MockMap } from "@/components/machine/screens/map-screen";
import { StatusIndicator } from "@/components/shared/status";
import { machines } from "@/lib/mock-data";
import { deriveAdvice } from "@/lib/advice";
import { cn, severityStyles } from "@/lib/utils";
import { lowReadingStatus, readingStatus, useMachineHealth, useMachineStore } from "@/store/machine-store";
import { useSensorHistory } from "@/store/use-sensor-history";

export default function LiveMonitoringPage() {
  const sensors = useMachineStore((s) => s.sensors);
  const mode = useMachineStore((s) => s.mode);
  const health = useMachineHealth();
  const [selected, setSelected] = React.useState<string | null>(null);
  const series = useSensorHistory(30);

  const advice = deriveAdvice(sensors);

  return (
    <div className="pb-10">
      <PageHeader
        title="Live monitoring"
        subtitle="Real-time telemetry from the connected machine and its worksite neighbours."
        actions={<RunSimulationButton size="md" />}
      />

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3 rounded border border-white/10 bg-ink-900 px-4 py-3">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Radio className="size-4 text-status-ok" aria-hidden />
            CAT 320 · CAT-320-014
          </span>
          <StatusIndicator status={health} size="sm" />
          <span className="rounded border border-white/10 px-2 py-1 text-[11px] uppercase tracking-widest text-muted">
            Mode: {mode.replace("-", " ")}
          </span>
          <span className="ml-auto inline-flex items-center gap-2 text-xs text-muted">
            <Activity className="size-3.5 text-status-ok" aria-hidden /> Streaming · 1.2 s interval
          </span>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Engine speed", value: sensors.rpm, min: 0, max: 2400, unit: "RPM", status: readingStatus(sensors.rpm, 2200, 2350) },
            { label: "Engine temp", value: sensors.engineTemperature, min: 40, max: 120, unit: "°C", status: readingStatus(sensors.engineTemperature, 92, 104) },
            { label: "Hydraulic pressure", value: sensors.hydraulicPressure, min: 0, max: 4000, unit: "PSI", status: readingStatus(sensors.hydraulicPressure, 3400, 3650) },
            { label: "Fuel", value: sensors.fuelLevel, min: 0, max: 100, unit: "%", status: lowReadingStatus(sensors.fuelLevel, 20, 10) },
          ].map((g) => (
            <div key={g.label} className="panel-raised flex justify-center p-3">
              <SensorGauge {...g} size={168} />
            </div>
          ))}
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
          <div className="panel-raised p-4">
            <p className="text-sm font-semibold text-zinc-100">Live telemetry</p>
            <p className="text-xs text-muted">Engine temperature against hydraulic pressure and engine speed.</p>
            <div className="mt-3">
              <MultiLineChart
                data={series}
                xKey="t"
                height={240}
                lines={[
                  { key: "temp", name: "Engine °C", color: CHART_COLORS.warn },
                  { key: "psi", name: "Hydraulic PSI", color: CHART_COLORS.info },
                  { key: "rpm", name: "Engine RPM", color: CHART_COLORS.cat },
                ]}
              />
            </div>
          </div>

          <div className="panel-raised p-4">
            <p className="text-sm font-semibold text-zinc-100">Worksite positions</p>
            <div className="mt-3 h-64">
              <MockMap selected={selected} onSelect={setSelected} />
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="panel-raised p-4">
            <p className="text-sm font-semibold text-zinc-100">Advisories</p>
            <ul className="mt-3 space-y-2">
              {advice.map((a) => (
                <li key={a.id} className={cn("rounded border px-3 py-2.5", severityStyles[a.severity].border)}>
                  <p className="text-sm text-zinc-100">{a.title}</p>
                  <p className="text-xs text-muted">{a.body}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel-raised p-4">
            <p className="text-sm font-semibold text-zinc-100">Other machines on site</p>
            <ul className="mt-3 space-y-2">
              {machines.slice(1).map((m) => (
                <li key={m.id} className="flex items-center gap-3 rounded bg-white/4 px-3 py-2.5">
                  <span className="text-sm font-medium text-zinc-100">{m.name}</span>
                  <span className="text-xs text-muted">{m.location}</span>
                  <span className="ml-auto font-mono text-xs text-zinc-300">{m.engineTemperature} °C</span>
                  <StatusIndicator status={m.health} size="sm" />
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
