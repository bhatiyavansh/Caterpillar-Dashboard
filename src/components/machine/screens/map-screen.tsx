"use client";

import * as React from "react";
import { motion } from "motion/react";
import { Crosshair, Layers } from "lucide-react";
import { worksite } from "@/lib/mock-data";
import { cn, statusStyles } from "@/lib/utils";
import type { HealthStatus } from "@/lib/types";
import type { Machine } from "@/lib/api/contracts";
import { PRIMARY_MACHINE_ID } from "@/lib/api/seed";
import { useFleet } from "@/lib/hooks/use-site";
import { planToLatLon, planToMapPct } from "@/lib/hmi/site-plan";
import { ScreenPad, SectionTitle } from "../touch";

interface MapMachine {
  id: string;
  name: string;
  left: number;
  top: number;
  health: HealthStatus;
  self: boolean;
  lat: number;
  lon: number;
}

const HEALTH: Record<Machine["status"], HealthStatus> = {
  operating: "healthy",
  idle: "healthy",
  warning: "warning",
  critical: "critical",
  maintenance: "offline",
  offline: "offline",
};

/**
 * Every machine on site, where it actually is. Positions come from the fleet
 * source — live from the hub when connected, the simulated baseline otherwise —
 * so this map and `/command` always agree.
 */
function useMapMachines(): MapMachine[] {
  const { data: fleet } = useFleet();
  return React.useMemo(
    () =>
      fleet.map((m) => {
        const { left, top } = planToMapPct(m.position);
        const { lat, lon } = planToLatLon(m.position);
        return {
          id: m.id,
          name: `${m.model} · ${m.id}`,
          left,
          top,
          health: HEALTH[m.status] ?? "healthy",
          self: m.id === PRIMARY_MACHINE_ID,
          lat,
          lon,
        };
      }),
    [fleet],
  );
}

/** Site plan drawn entirely in SVG — no external map provider. */
export function MockMap({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const machines = useMapMachines();
  return (
    <div className="relative h-full w-full overflow-hidden rounded border border-white/10 bg-[#11161b]">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <defs>
          <pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse">
            <path d="M5 0 H0 V5" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.3" />
          </pattern>
        </defs>
        <rect width="100" height="100" fill="url(#grid)" />
        {/* site boundary */}
        <rect x="4" y="6" width="92" height="88" fill="none" stroke="#ffcd11" strokeWidth="0.6" strokeDasharray="3 2" />
        {/* work areas */}
        {worksite.workAreas.map((a) => (
          <g key={a.id}>
            <rect x={a.x} y={a.y} width={a.w} height={a.h} fill="rgba(74,168,255,0.10)" stroke="rgba(74,168,255,0.5)" strokeWidth="0.4" />
          </g>
        ))}
        {/* restricted zones */}
        {worksite.restrictedZones.map((z) => (
          <rect key={z.id} x={z.x} y={z.y} width={z.w} height={z.h} fill="rgba(255,77,79,0.14)" stroke="#ff4d4f" strokeWidth="0.5" />
        ))}
        {/* haul road */}
        <path d="M6 88 Q40 70 52 54 T94 22" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2.5" strokeLinecap="round" />
      </svg>

      {worksite.workAreas.map((a) => (
        <span
          key={a.id}
          className="absolute text-[11px] font-bold uppercase tracking-widest text-status-info/80"
          style={{ left: `${a.x + 1}%`, top: `${a.y + 1}%` }}
        >
          {a.label}
        </span>
      ))}
      {worksite.restrictedZones.map((z) => (
        <span
          key={z.id}
          className="absolute text-[11px] font-bold uppercase tracking-widest text-status-crit"
          style={{ left: `${z.x + 1}%`, top: `${z.y + 1}%` }}
        >
          {z.label}
        </span>
      ))}

      {machines.map((m) => {
        const s = statusStyles[m.health];
        const active = selected === m.id;
        return (
          <button
            key={m.id}
            onClick={() => onSelect(m.id)}
            aria-label={`${m.name}, ${s.label}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-500 ease-linear"
            style={{ left: `${m.left}%`, top: `${m.top}%` }}
          >
            {m.self ? (
              <motion.span
                className="absolute left-1/2 top-1/2 size-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cat-500"
                animate={{ scale: [1, 1.5], opacity: [0.7, 0] }}
                transition={{ duration: 2.4, repeat: Infinity }}
              />
            ) : null}
            <span
              className={cn(
                "relative flex min-h-12 items-center gap-2 rounded border-2 px-3 py-2 text-xs font-bold",
                m.self ? "border-cat-500 bg-cat-500 text-ink-950" : cn("bg-ink-900 text-zinc-100", s.border),
                active && "ring-2 ring-white/60",
              )}
            >
              <span className={cn("size-2.5 rounded-full", m.self ? "bg-ink-950" : s.dot)} />
              {m.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function MapScreen() {
  const [selected, setSelected] = React.useState<string | null>(null);
  const machines = useMapMachines();
  const machine = machines.find((m) => m.id === selected);

  return (
    <ScreenPad className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xl font-bold text-zinc-50">{worksite.name}</p>
          <p className="text-sm text-muted">
            {worksite.sector} · North bench · {machines.length} machines on site
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <span className="inline-flex items-center gap-2 rounded border border-white/12 bg-ink-900 px-3 py-2">
            <span className="size-2.5 rounded-full bg-cat-500" /> This machine
          </span>
          <span className="inline-flex items-center gap-2 rounded border border-white/12 bg-ink-900 px-3 py-2">
            <span className="size-2.5 rounded-sm bg-status-crit" /> Restricted
          </span>
          <span className="inline-flex items-center gap-2 rounded border border-white/12 bg-ink-900 px-3 py-2">
            <Layers className="size-4 text-status-info" /> Work area
          </span>
        </div>
      </div>

      <div className="min-h-[280px] flex-1">
        <MockMap selected={selected} onSelect={setSelected} />
      </div>

      <div className="rounded border border-white/10 bg-ink-900 p-4">
        <SectionTitle right={<Crosshair className="size-4 text-cat-500" />}>Selection</SectionTitle>
        {machine ? (
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="label-xs">Machine</p>
              <p className="text-lg font-bold text-zinc-100">{machine.name}</p>
            </div>
            <div>
              <p className="label-xs">Status</p>
              <p className={cn("text-lg font-bold", statusStyles[machine.health].text)}>
                {statusStyles[machine.health].label}
              </p>
            </div>
            <div>
              <p className="label-xs">Grid position</p>
              <p className="font-mono text-lg text-zinc-100">
                {machine.lat.toFixed(5)}° N · {machine.lon.toFixed(5)}° E
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Touch a machine marker to see its position and status.</p>
        )}
      </div>
    </ScreenPad>
  );
}
