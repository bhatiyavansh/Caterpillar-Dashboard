"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  BatteryCharging,
  Droplets,
  Flame,
  Gauge as GaugeIcon,
  MonitorPlay,
  Stethoscope,
  Thermometer,
  Timer,
  Waves,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/navigation/dashboard-shell";
import { MachineVisualization, type MachinePart, PART_INFO } from "@/components/machine/machine-visualization";
import { StatusIndicator } from "@/components/shared/status";
import { CHART_COLORS, MultiBarChart, TrendAreaChart } from "@/components/charts/charts";
import { Button, EmptyState } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/overlays";
import { Hint } from "@/components/ui/tooltip";
import {
  engineTempSeries,
  fuelSeries,
  hydraulicSeries,
  machineEvents,
  machines,
  operatingHoursSeries,
} from "@/lib/mock-data";
import { cn, formatNumber, severityStyles } from "@/lib/utils";
import { lowReadingStatus, readingStatus, useMachineHealth, useMachineStore } from "@/store/machine-store";
import * as React from "react";

export default function MachineDetailPage() {
  const params = useParams<{ id: string }>();
  const machine = machines.find((m) => m.id === params.id);
  const isPrimary = params.id === "CAT-320-014";

  const sensors = useMachineStore((s) => s.sensors);
  const liveHealth = useMachineHealth();
  const openSimulation = useMachineStore((s) => s.openSimulation);
  const [part, setPart] = React.useState<MachinePart | null>(null);

  if (!machine) {
    return (
      <div className="p-4">
        <EmptyState
          title="Machine not found"
          body="This asset is not registered to Northgate Quarry. It may have been transferred to another site."
          action={
            <Button variant="outline" asChild>
              <Link href="/dashboard/fleet">Back to fleet</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const health = isPrimary ? liveHealth : machine.health;
  const reading = {
    rpm: isPrimary ? sensors.rpm : 1720,
    engineTemp: isPrimary ? sensors.engineTemperature : machine.engineTemperature,
    hydraulic: isPrimary ? sensors.hydraulicPressure : machine.hydraulicPressure,
    fuel: isPrimary ? sensors.fuelLevel : machine.fuelLevel,
    def: isPrimary ? sensors.defLevel : 68,
    battery: isPrimary ? sensors.battery : 88,
    oil: isPrimary ? sensors.oilPressure : 58,
    coolant: isPrimary ? sensors.coolantTemperature : machine.engineTemperature + 2,
    hours: isPrimary ? sensors.operatingHours : machine.operatingHours,
  };

  const metrics = [
    { label: "Engine RPM", value: formatNumber(reading.rpm), unit: "RPM", icon: GaugeIcon, status: readingStatus(reading.rpm, 2200, 2350) },
    { label: "Engine temperature", value: reading.engineTemp.toFixed(0), unit: "°C", icon: Flame, status: readingStatus(reading.engineTemp, 92, 104) },
    { label: "Hydraulic pressure", value: formatNumber(reading.hydraulic), unit: "PSI", icon: Waves, status: readingStatus(reading.hydraulic, 3400, 3650) },
    { label: "Fuel", value: reading.fuel.toFixed(0), unit: "%", icon: Droplets, status: lowReadingStatus(reading.fuel, 20, 10) },
    { label: "DEF", value: reading.def.toFixed(0), unit: "%", icon: Droplets, status: lowReadingStatus(reading.def, 20, 10) },
    { label: "Battery", value: reading.battery.toFixed(0), unit: "%", icon: BatteryCharging, status: lowReadingStatus(reading.battery, 40, 20) },
    { label: "Oil pressure", value: reading.oil.toFixed(0), unit: "PSI", icon: GaugeIcon, status: lowReadingStatus(reading.oil, 30, 20) },
    { label: "Coolant temperature", value: reading.coolant.toFixed(0), unit: "°C", icon: Thermometer, status: readingStatus(reading.coolant, 94, 104) },
    { label: "Operating hours", value: formatNumber(reading.hours), unit: "h", icon: Timer, status: "healthy" as const },
  ];

  return (
    <div className="pb-10">
      <PageHeader
        title={`${machine.name} ${machine.type}`}
        subtitle={`${machine.id} · ${machine.model} · ${machine.location} · operator ${machine.operator}`}
        actions={
          <>
            <Button variant="ghost" asChild>
              <Link href="/dashboard/fleet">
                <ArrowLeft className="size-4" aria-hidden /> Fleet
              </Link>
            </Button>
            <StatusIndicator
              status={health}
              size="lg"
              label={health === "healthy" ? "OPERATIONAL" : health === "warning" ? "CAUTION" : "CRITICAL"}
            />
            <Button variant="primary" onClick={openSimulation}>
              <MonitorPlay className="size-4" aria-hidden /> Run Simulation
            </Button>
          </>
        }
      />

      <div className="space-y-4 p-4">
        <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <div className="panel-raised p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-100">Machine visualisation</p>
              <span className="text-xs text-muted">Select a subsystem</span>
            </div>
            <div className="mt-2 h-64">
              <MachineVisualization
                selected={part}
                onSelect={setPart}
                partStatus={{
                  engine: readingStatus(reading.engineTemp, 92, 104),
                  hydraulics: readingStatus(reading.hydraulic, 3400, 3650),
                }}
              />
            </div>
            <div className="mt-2 min-h-20 rounded border border-white/10 bg-ink-850 p-3">
              {part ? (
                <>
                  <p className="text-sm font-semibold text-cat-500">{PART_INFO[part].title}</p>
                  <p className="mt-1 text-xs text-muted">{PART_INFO[part].description}</p>
                  <div className="mt-2 flex flex-wrap gap-4 text-xs">
                    {PART_INFO[part].readings.map((r) => (
                      <span key={r.label}>
                        <span className="text-muted">{r.label}: </span>
                        <span className="font-mono text-zinc-100">{r.value}</span>
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted">
                  Click the engine house, hydraulic arm, undercarriage or cabin to inspect that system.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="panel-raised p-4">
              <p className="text-sm font-semibold text-zinc-100">Actions</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Button variant="primary" size="lg" asChild>
                  <Link href="/machine/assistant">Open Machine Assistant</Link>
                </Button>
                <Button variant="secondary" size="lg" onClick={openSimulation}>
                  <MonitorPlay className="size-4" aria-hidden /> Run Simulation
                </Button>
                <Button variant="secondary" size="lg" asChild>
                  <Link href="/dashboard/maintenance">
                    <Wrench className="size-4" aria-hidden /> Maintenance
                  </Link>
                </Button>
                <Button variant="secondary" size="lg" asChild>
                  <Link href="/dashboard/diagnostics">
                    <Stethoscope className="size-4" aria-hidden /> Diagnostics
                  </Link>
                </Button>
              </div>
              <div className="mt-3">
                <ConfirmDialog
                  trigger={
                    <Button variant="danger" size="lg" className="w-full">
                      Request immediate shutdown
                    </Button>
                  }
                  title="Request immediate shutdown?"
                  description="This sends a stop-work instruction to the operator's display. Use it only when the machine is unsafe to continue operating."
                  confirmLabel="Send request"
                  destructive
                  onConfirm={() => toast.success("Shutdown request sent to the operator display")}
                />
              </div>
            </div>

            <div className="panel-raised p-4">
              <p className="text-sm font-semibold text-zinc-100">Service position</p>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">Last service</dt>
                  <dd className="text-zinc-200">{machine.lastService}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Next service</dt>
                  <dd className="text-zinc-200">{machine.nextService}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Hours remaining</dt>
                  <dd className="font-mono text-cat-500">{machine.nextServiceHours} h</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Utilisation</dt>
                  <dd className="text-zinc-200">{machine.utilisation}%</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-muted">Live metrics</h2>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {metrics.map(({ label, value, unit, icon: Icon, status }) => (
              <Hint key={label} label={`${label} — ${status === "healthy" ? "within normal range" : "outside normal range"}`}>
                <div className={cn("panel-raised p-3", status !== "healthy" && "border-l-2 border-l-status-warn")}>
                  <div className="flex items-center justify-between">
                    <span className="label-xs">{label}</span>
                    <Icon className="size-4 text-muted" aria-hidden />
                  </div>
                  <p className="mt-2 font-mono text-2xl font-bold text-zinc-50">
                    {value}
                    <span className="ml-1 text-xs text-muted">{unit}</span>
                  </p>
                </div>
              </Hint>
            ))}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="panel-raised p-4">
            <p className="text-sm font-semibold text-zinc-100">Engine temperature · 24 h</p>
            <div className="mt-3">
              <TrendAreaChart data={engineTempSeries} dataKey="value" color={CHART_COLORS.warn} unit="°" />
            </div>
          </div>
          <div className="panel-raised p-4">
            <p className="text-sm font-semibold text-zinc-100">Fuel consumption · shift</p>
            <div className="mt-3">
              <TrendAreaChart data={fuelSeries} dataKey="litres" color={CHART_COLORS.cat} unit=" L" />
            </div>
          </div>
          <div className="panel-raised p-4">
            <p className="text-sm font-semibold text-zinc-100">Hydraulic pressure · 24 h</p>
            <div className="mt-3">
              <TrendAreaChart data={hydraulicSeries} dataKey="value" color={CHART_COLORS.info} />
            </div>
          </div>
          <div className="panel-raised p-4">
            <p className="text-sm font-semibold text-zinc-100">Operating hours · 7 days</p>
            <div className="mt-3">
              <MultiBarChart
                data={operatingHoursSeries}
                xKey="day"
                stacked
                bars={[
                  { key: "hours", name: "Operating", color: CHART_COLORS.cat },
                  { key: "idle", name: "Idle", color: CHART_COLORS.muted },
                ]}
              />
            </div>
          </div>
        </section>

        <section className="panel-raised p-4">
          <p className="text-sm font-semibold text-zinc-100">Recent events</p>
          <ol className="mt-3 space-y-2">
            {machineEvents.map((e) => (
              <li key={e.time + e.label} className="flex items-center gap-3 rounded bg-white/4 px-3 py-2.5">
                <span className="font-mono text-xs text-muted">{e.time}</span>
                <span className={cn("size-2 rounded-full", severityStyles[e.severity].dot)} />
                <span className="text-sm text-zinc-200">{e.label}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
