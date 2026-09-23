"use client";

import { BatteryCharging, Cog, Droplets, Flame, Shield, Snowflake, Waves, Wrench } from "lucide-react";
import type { HealthStatus } from "@/lib/types";
import { cn, formatNumber, statusStyles } from "@/lib/utils";
import { lowReadingStatus, readingStatus, useMachineStore } from "@/store/machine-store";
import { ScreenPad, SectionTitle } from "../touch";

export function StatusScreen() {
  const s = useMachineStore((st) => st.sensors);
  const mode = useMachineStore((st) => st.mode);

  const rows: { icon: React.ElementType; label: string; value: string; status: HealthStatus; note: string }[] = [
    {
      icon: Flame,
      label: "Engine",
      value: `${formatNumber(s.rpm)} RPM`,
      status: readingStatus(s.engineTemperature, 92, 104),
      note: `${s.engineTemperature.toFixed(0)} °C · ${s.engineLoad.toFixed(0)}% load`,
    },
    {
      icon: Waves,
      label: "Hydraulics",
      value: `${formatNumber(s.hydraulicPressure)} PSI`,
      status: readingStatus(s.hydraulicTemperature, 90, 100),
      note: `${s.hydraulicTemperature.toFixed(0)} °C oil temperature`,
    },
    {
      icon: Cog,
      label: "Transmission",
      value: `${s.machineSpeed.toFixed(1)} km/h`,
      status: "healthy",
      note: "Travel motors 71 °C",
    },
    {
      icon: BatteryCharging,
      label: "Battery",
      value: `${s.battery.toFixed(0)} %`,
      status: lowReadingStatus(s.battery, 40, 20),
      note: "27.8 V · alternator 94 A",
    },
    {
      icon: Snowflake,
      label: "Cooling",
      value: `${s.coolantTemperature.toFixed(0)} °C`,
      status: readingStatus(s.coolantTemperature, 94, 104),
      note: "Fan 2,240 RPM",
    },
    {
      icon: Droplets,
      label: "Fuel",
      value: `${s.fuelLevel.toFixed(0)} %`,
      status: lowReadingStatus(s.fuelLevel, 20, 10),
      note: `${s.fuelLitres.toFixed(0)} L remaining`,
    },
    {
      icon: Droplets,
      label: "DEF",
      value: `${s.defLevel.toFixed(0)} %`,
      status: lowReadingStatus(s.defLevel, 20, 10),
      note: "Dosing normal",
    },
    {
      icon: Shield,
      label: "Safety systems",
      value: "Active",
      status: "healthy",
      note: "4 / 4 cameras · radar online",
    },
  ];

  return (
    <ScreenPad className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-white/10 bg-ink-900 px-4 py-3">
        <div className="flex items-center gap-3">
          <Wrench className="size-5 text-cat-500" aria-hidden />
          <span className="text-sm font-bold uppercase tracking-[0.16em] text-zinc-200">Machine mode</span>
        </div>
        <span className="rounded bg-cat-500 px-4 py-2 text-sm font-black uppercase tracking-[0.14em] text-ink-950">
          {mode.replace("-", " ")}
        </span>
      </div>

      <SectionTitle>Systems</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map(({ icon: Icon, label, value, status, note }) => {
          const st = statusStyles[status];
          return (
            <div key={label} className={cn("rounded border-2 bg-ink-900 p-4", st.border)}>
              <div className="flex items-center justify-between">
                <Icon className={cn("size-7", st.text)} aria-hidden />
                <span className={cn("text-xs font-black uppercase tracking-[0.14em]", st.text)}>{st.label}</span>
              </div>
              <p className="mt-3 text-sm font-bold uppercase tracking-[0.16em] text-muted">{label}</p>
              <p className="font-mono text-3xl font-bold text-zinc-50">{value}</p>
              <p className="mt-1 text-xs text-muted">{note}</p>
            </div>
          );
        })}
      </div>
    </ScreenPad>
  );
}
