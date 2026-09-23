"use client";

import Link from "next/link";
import { PageHeader, RunSimulationButton } from "@/components/navigation/dashboard-shell";
import { MachineTable } from "@/components/dashboard/machine-card";
import { Button } from "@/components/ui/primitives";
import { machines } from "@/lib/mock-data";
import { useMachineHealth, useMachineStore } from "@/store/machine-store";
import { formatNumber } from "@/lib/utils";

export default function MachinesPage() {
  const liveHealth = useMachineHealth();
  const sensors = useMachineStore((s) => s.sensors);

  const list = machines.map((m) =>
    m.id === "CAT-320-014"
      ? {
          ...m,
          health: liveHealth,
          engineTemperature: Number(sensors.engineTemperature.toFixed(0)),
          hydraulicPressure: Math.round(sensors.hydraulicPressure),
          fuelLevel: Number(sensors.fuelLevel.toFixed(0)),
          operatingHours: Math.round(sensors.operatingHours),
        }
      : m,
  );

  const totalHours = list.reduce((a, m) => a + m.operatingHours, 0);
  const avgFuel = Math.round(list.reduce((a, m) => a + m.fuelLevel, 0) / list.length);

  return (
    <div className="pb-10">
      <PageHeader
        title="Machines"
        subtitle="Detailed register of every asset, its telemetry and its service position."
        actions={<RunSimulationButton size="md" />}
      />

      <div className="space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Registered machines", value: formatNumber(list.length) },
            { label: "Combined operating hours", value: formatNumber(totalHours) },
            { label: "Average fuel level", value: `${avgFuel}%` },
          ].map((s) => (
            <div key={s.label} className="panel-raised p-4">
              <p className="label-xs">{s.label}</p>
              <p className="font-mono text-3xl font-bold text-zinc-50">{s.value}</p>
            </div>
          ))}
        </div>

        <MachineTable machines={list} />

        <p className="text-xs text-muted">
          Select a machine to open its live monitoring page, or{" "}
          <Button variant="ghost" size="sm" asChild className="px-1">
            <Link href="/dashboard/machines/CAT-320-014">open CAT 320</Link>
          </Button>{" "}
          — the machine connected to the in-cab simulator.
        </p>
      </div>
    </div>
  );
}
