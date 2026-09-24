"use client";

/**
 * Right rail of the command centre. Answers, in order: what is this machine,
 * who is on it, what is it doing, is it safe, and what has it been shouting
 * about.
 */
import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, MousePointerSquareDashed } from "lucide-react";
import type { Machine, SiteAlert } from "@/lib/api/contracts";
import { LIMITS, MACHINE_STATUS, PROXIMITY, thresholdStatus } from "@/lib/status";
import { MeterRow, Readout, SectionHeader } from "@/components/ui/data";
import { MachineStatusChip } from "@/components/ui/status";
import { EmptyPanel } from "@/components/ui/states";
import { AlertCard } from "@/components/alerts/alert-card";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export function MachineInspector({
  machine,
  alerts,
  onAcknowledge,
  className,
}: {
  machine: Machine | null;
  alerts: SiteAlert[];
  onAcknowledge: (id: string) => void;
  className?: string;
}) {
  if (!machine) {
    return (
      <section className={cn("flex min-h-0 flex-col border-l border-white/10 bg-ink-900", className)}>
        <SectionHeader title="Inspector" />
        <EmptyPanel
          icon={<MousePointerSquareDashed className="size-5" aria-hidden />}
          title="No machine selected"
          body="Pick a machine from the fleet list or the site view to see its operator, live vitals and open alerts."
          className="flex-1"
        />
      </section>
    );
  }

  const token = MACHINE_STATUS[machine.status];
  const fuelStatus = thresholdStatus(machine.fuel, LIMITS.fuel);
  const tempStatus = thresholdStatus(machine.hydraulicTemperature, LIMITS.hydraulicTemperature);
  const tipStatus = thresholdStatus(machine.tipOverMargin, LIMITS.tipOverMargin);
  const loadStatus = thresholdStatus(machine.load, LIMITS.load);
  const proximity = PROXIMITY[machine.proximity.level];
  const machineAlerts = alerts.filter((a) => a.machineId === machine.id);

  return (
    <section
      className={cn("flex min-h-0 flex-col border-l border-white/10 bg-ink-900", className)}
      aria-label={`Inspector for ${machine.id}`}
    >
      <SectionHeader
        title="Inspector"
        actions={
          <Link
            href={`/dashboard/machines/${machine.id}`}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-cat-500 hover:underline"
          >
            Full record
            <ArrowUpRight className="size-3" aria-hidden />
          </Link>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Identity */}
        <div className={cn("border-b border-white/10 px-4 py-3.5", token.bg)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-mono text-2xl font-bold leading-none text-zinc-50">{machine.id}</p>
              <p className="mt-1 truncate text-xs text-muted">
                {machine.model} · {machine.kindLabel} · {machine.zone}
              </p>
            </div>
            <MachineStatusChip status={machine.status} soundKey={machine.id} />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">{token.description}</p>
        </div>

        {/* Assignment */}
        <dl className="border-b border-white/10 px-4 py-3">
          <Readout label="Operator" value={machine.operator?.name ?? "Unassigned"} hint={machine.operator?.id} />
          <Readout label="Current task" value={machine.taskLabel ?? "None"} />
          {machine.taskLabel ? (
            <MeterRow
              label="Task progress"
              value={machine.taskProgress}
              status="operating"
              className="mt-1.5"
            />
          ) : null}
        </dl>

        {/* Machine health */}
        <div className="border-b border-white/10 px-4 py-3.5">
          <p className="label-xs mb-2.5">Machine health</p>
          <div className="space-y-2.5">
            <MeterRow label="Fuel" value={machine.fuel} status={fuelStatus} valueLabel={`${Math.round(machine.fuel)}%`} />
            <MeterRow
              label="Hydraulic temp"
              value={((machine.hydraulicTemperature - 40) / (120 - 40)) * 100}
              status={tempStatus}
              valueLabel={`${Math.round(machine.hydraulicTemperature)}°C`}
            />
            <Readout
              label="Tip-over margin"
              value={machine.tipOverMargin.toFixed(2)}
              status={tipStatus}
              hint={tipStatus !== "operating" ? "near limit" : undefined}
            />
          </div>
        </div>

        {/* Live telemetry */}
        <div className="border-b border-white/10 px-4 py-3.5">
          <p className="label-xs mb-1.5">Live telemetry</p>
          <dl className="divide-y divide-white/5">
            <Readout label="Load" value={machine.load} unit="%" status={loadStatus} hint={`${machine.payloadKg.toLocaleString("en-IN")} kg`} />
            <Readout label="Speed" value={Math.abs(machine.speedKmh).toFixed(1)} unit="km/h" hint={machine.speedKmh < -0.2 ? "reversing" : undefined} />
            <Readout label="Engine hours" value={machine.engineHours.toFixed(1)} unit="h" />
            <Readout label="Idle this shift" value={machine.idleMinutes.toFixed(0)} unit="min" status={thresholdStatus(machine.idleMinutes, { warn: 60, crit: 90 })} />
            <Readout label="Load cycles" value={machine.loadCycles} />
            <Readout
              label="Seatbelt"
              value={machine.seatbelt === "fastened" ? "Fastened" : machine.seatbelt === "unfastened" ? "Unfastened" : "Not fitted"}
              status={machine.seatbelt === "unfastened" ? "critical" : "operating"}
            />
          </dl>
        </div>

        {/* Proximity */}
        <div className="border-b border-white/10 px-4 py-3.5">
          <p className="label-xs mb-2.5">Safety envelope</p>
          <div className={cn("flex items-center gap-3 rounded border px-3 py-2", proximity.border, proximity.bg)}>
            <span className={cn("font-mono text-xl font-bold tabular-nums", proximity.text)}>
              {machine.proximity.nearestPersonM !== null ? `${machine.proximity.nearestPersonM.toFixed(1)}m` : "—"}
            </span>
            <span className="min-w-0">
              <span className={cn("block text-xs font-bold uppercase tracking-wider", proximity.text)}>
                {proximity.label}
              </span>
              <span className="block truncate text-[11px] text-muted">{proximity.description}</span>
            </span>
          </div>
        </div>

        {/* Alerts */}
        <div className="px-4 py-3.5">
          <p className="label-xs mb-2.5">Recent alerts</p>
          {machineAlerts.length ? (
            <div className="space-y-2">
              {machineAlerts.map((a) => (
                <AlertCard key={a.id} alert={a} onAcknowledge={onAcknowledge} compact />
              ))}
            </div>
          ) : (
            <EmptyPanel
              tone="good"
              title="No open alerts"
              body={`${machine.id} is inside every safety and health limit.`}
              className="!py-6"
            />
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-white/10 p-2.5">
        <Button variant="secondary" size="sm" className="w-full" asChild>
          <Link href={`/cab?machine=${machine.id}`}>Open the operator view</Link>
        </Button>
      </div>
    </section>
  );
}
