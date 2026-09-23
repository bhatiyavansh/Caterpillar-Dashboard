"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Clock, Fuel, MapPin, Thermometer, Waves } from "lucide-react";
import type { Machine } from "@/lib/types";
import { cn, formatNumber, statusStyles } from "@/lib/utils";
import { MachineSilhouette } from "@/components/machine/machine-visualization";
import { StatusIndicator } from "@/components/shared/status";
import { Progress } from "@/components/ui/primitives";

export function MachineCard({ machine }: { machine: Machine }) {
  const s = statusStyles[machine.health];
  return (
    <motion.div whileHover={{ y: -3 }} className="h-full">
      <Link
        href={`/dashboard/machines/${machine.id}`}
        className={cn("panel-raised flex h-full flex-col border-l-4 p-4 transition-colors hover:border-white/20", s.border)}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-base font-bold text-zinc-50">{machine.name}</p>
            <p className="text-xs text-muted">{machine.type}</p>
          </div>
          <StatusIndicator status={machine.health} size="sm" />
        </div>

        <div className="my-3 h-16 text-zinc-600">
          <MachineSilhouette shape={machine.image} status={machine.health} />
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div className="flex items-center gap-1.5 text-muted">
            <MapPin className="size-3.5" aria-hidden />
            <span className="truncate">{machine.location}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted">
            <Clock className="size-3.5" aria-hidden />
            {formatNumber(machine.operatingHours)} h
          </div>
          <div className="flex items-center gap-1.5 text-muted">
            <Thermometer className="size-3.5" aria-hidden />
            {machine.engineTemperature} °C
          </div>
          <div className="flex items-center gap-1.5 text-muted">
            <Waves className="size-3.5" aria-hidden />
            {formatNumber(machine.hydraulicPressure)} PSI
          </div>
        </dl>

        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5 text-muted">
              <Fuel className="size-3.5" aria-hidden /> Fuel
            </span>
            <span className="font-mono font-semibold text-zinc-200">{machine.fuelLevel}%</span>
          </div>
          <Progress
            value={machine.fuelLevel}
            className="mt-1.5 h-1.5"
            barClassName={machine.fuelLevel < 20 ? "bg-status-crit" : "bg-cat-500"}
            label={`${machine.name} fuel level`}
          />
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-white/8 pt-3 text-[11px] text-muted">
          <span>Last service {machine.lastService}</span>
          <span>Next {machine.nextService}</span>
        </div>
      </Link>
    </motion.div>
  );
}

export function MachineTable({ machines }: { machines: Machine[] }) {
  return (
    <div className="panel-raised overflow-x-auto">
      <table className="w-full min-w-[980px] text-left text-sm">
        <caption className="sr-only">Fleet machines with live operating figures</caption>
        <thead>
          <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.12em] text-muted">
            {["Machine", "Type", "Location", "Hours", "Fuel", "Engine", "Hydraulic", "Health", "Next service"].map((h) => (
              <th key={h} scope="col" className="px-4 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {machines.map((m) => (
            <tr key={m.id} className="border-b border-white/6 transition-colors last:border-0 hover:bg-white/4">
              <td className="px-4 py-3">
                <Link href={`/dashboard/machines/${m.id}`} className="font-semibold text-zinc-100 hover:text-cat-500">
                  {m.name}
                </Link>
                <p className="text-[11px] text-muted">{m.id}</p>
              </td>
              <td className="px-4 py-3 text-zinc-300">
                {m.type}
                <p className="text-[11px] text-muted">{m.model}</p>
              </td>
              <td className="px-4 py-3 text-zinc-300">{m.location}</td>
              <td className="px-4 py-3 font-mono text-zinc-200">{formatNumber(m.operatingHours)}</td>
              <td className="px-4 py-3">
                <span className={cn("font-mono", m.fuelLevel < 20 ? "text-status-crit" : "text-zinc-200")}>
                  {m.fuelLevel}%
                </span>
              </td>
              <td className="px-4 py-3 font-mono text-zinc-200">{m.engineTemperature} °C</td>
              <td className="px-4 py-3 font-mono text-zinc-200">{formatNumber(m.hydraulicPressure)} PSI</td>
              <td className="px-4 py-3">
                <StatusIndicator status={m.health} size="sm" />
              </td>
              <td className="px-4 py-3 text-zinc-300">
                {m.nextService}
                <p className="text-[11px] text-muted">in {m.nextServiceHours} h</p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
