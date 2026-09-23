"use client";

/**
 * Live telemetry readout for the selected machine.
 *
 * Every value here is a direct read of `MachineTelemetry` — nothing is computed
 * twice. Numbers are tabular so the digits do not jitter as they change.
 */

import type { MachineTelemetry } from "@/types/twin";
import { MACHINES } from "@/lib/twin/simulation";
import { bearingLabel, toBearing, toKmh, tipOverLevel } from "@/lib/twin/telemetry";
import { toDeg, useTwinStore } from "@/store/twinStore";

function Readout({
  label,
  value,
  unit,
  tone = "default",
  wide,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: "default" | "ok" | "warn" | "crit" | "accent";
  wide?: boolean;
}) {
  const toneClass = {
    default: "text-zinc-100",
    ok: "text-status-ok",
    warn: "text-status-warn",
    crit: "text-status-crit",
    accent: "text-cat-500",
  }[tone];

  return (
    <div className={wide ? "col-span-2" : ""}>
      <div className="label-xs leading-none">{label}</div>
      <div className={`mt-1 font-mono text-lg font-bold leading-none tabular-nums ${toneClass}`}>
        {value}
        {unit ? <span className="ml-1 text-xs font-normal text-zinc-500">{unit}</span> : null}
      </div>
    </div>
  );
}

/** Horizontal bar with a warning threshold marker. */
function Bar({
  value,
  max,
  tone,
}: {
  value: number;
  max: number;
  tone: "ok" | "warn" | "crit" | "accent";
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const fill = {
    ok: "bg-status-ok",
    warn: "bg-status-warn",
    crit: "bg-status-crit",
    accent: "bg-cat-500",
  }[tone];

  return (
    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
      <div className={`h-full rounded-full transition-[width] duration-200 ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Tip-over margin gauge: a 180° arc with a swinging needle. */
function TipOverGauge({ margin }: { margin: number }) {
  const level = tipOverLevel(margin);
  // Map 0.6 .. 2.4 onto the arc.
  const frac = Math.max(0, Math.min(1, (margin - 0.6) / 1.8));
  const angle = -90 + frac * 180;

  const tone = {
    safe: { stroke: "#3ddc84", text: "text-status-ok", label: "SAFE" },
    warning: { stroke: "#ffb020", text: "text-status-warn", label: "WARNING" },
    critical: { stroke: "#ff3b30", text: "text-status-crit", label: "CRITICAL" },
  }[level];

  return (
    <div className="col-span-2 border-t border-white/10 pt-3">
      <div className="flex items-center justify-between">
        <span className="label-xs">Tip-over margin</span>
        <span className={`text-[11px] font-bold tracking-wider ${tone.text}`}>{tone.label}</span>
      </div>

      <div className="mt-1 flex items-end gap-3">
        <svg viewBox="0 0 100 56" className="h-14 w-24 shrink-0" aria-hidden>
          {/* danger -> safe sweep */}
          <path d="M 8 50 A 42 42 0 0 1 36 10" fill="none" stroke="#ff3b30" strokeWidth="6" opacity="0.5" />
          <path d="M 36 10 A 42 42 0 0 1 64 10" fill="none" stroke="#ffb020" strokeWidth="6" opacity="0.5" />
          <path d="M 64 10 A 42 42 0 0 1 92 50" fill="none" stroke="#3ddc84" strokeWidth="6" opacity="0.5" />
          <line
            x1="50"
            y1="50"
            x2="50"
            y2="16"
            stroke={tone.stroke}
            strokeWidth="3"
            strokeLinecap="round"
            transform={`rotate(${angle} 50 50)`}
            style={{ transition: "transform 180ms ease-out" }}
          />
          <circle cx="50" cy="50" r="3.5" fill={tone.stroke} />
        </svg>

        <div className="pb-1">
          <div className={`font-mono text-2xl font-bold leading-none tabular-nums ${tone.text}`}>
            {margin.toFixed(2)}
          </div>
          <div className="mt-1 text-[10px] text-zinc-500">demo estimate, not certified</div>
        </div>
      </div>
    </div>
  );
}

export function TelemetryPanel() {
  const selectedId = useTwinStore((s) => s.selectedMachine);
  const telemetry = useTwinStore((s) =>
    s.snapshot.machines.find((m) => m.machineId === selectedId),
  );

  if (!telemetry) return null;
  const descriptor = MACHINES.find((m) => m.id === telemetry.machineId);
  const t: MachineTelemetry = telemetry;

  const hotOil = t.hydraulicTemperature > 92;
  const lowFuel = t.fuel < 15;
  const stopped = t.activity === "emergency_stop";

  return (
    <section
      aria-label={`Telemetry for ${t.machineId}`}
      className="panel-raised pointer-events-auto w-[268px] p-3.5"
    >
      <header className="flex items-start justify-between border-b border-white/10 pb-2.5">
        <div>
          <div className="label-xs leading-none">Machine</div>
          <div className="mt-1 font-mono text-xl font-bold leading-none text-cat-500">
            {t.machineId}
          </div>
          <div className="mt-1 text-[11px] text-zinc-400">{descriptor?.model}</div>
        </div>
        <div className="text-right">
          <div className="label-xs leading-none">Status</div>
          <div
            className={`mt-1 text-[11px] font-bold uppercase tracking-wider ${
              stopped ? "text-status-crit" : "text-status-ok"
            }`}
          >
            <span className="mr-1">●</span>
            {stopped ? "E-STOP" : "OPERATIONAL"}
          </div>
          <div className="mt-1 text-[11px] font-bold uppercase tracking-wider text-zinc-300">
            {t.activity.replace("_", " ")}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 pt-3">
        <Readout label="Speed" value={Math.abs(toKmh(t.speed)).toFixed(1)} unit="km/h" />
        <Readout
          label="Heading"
          value={`${toBearing(t.heading)}°`}
          unit={bearingLabel(t.heading)}
        />

        <Readout label="Engine" value={Math.round(t.engineRpm).toLocaleString()} unit="rpm" />
        <div>
          <Readout
            label="Fuel"
            value={t.fuel.toFixed(0)}
            unit="%"
            tone={lowFuel ? "crit" : "default"}
          />
          <Bar value={t.fuel} max={100} tone={lowFuel ? "crit" : "accent"} />
        </div>

        <div>
          <Readout
            label="Hydraulic"
            value={t.hydraulicTemperature.toFixed(0)}
            unit="°C"
            tone={hotOil ? "crit" : t.hydraulicTemperature > 85 ? "warn" : "default"}
          />
          <Bar
            value={t.hydraulicTemperature}
            max={120}
            tone={hotOil ? "crit" : t.hydraulicTemperature > 85 ? "warn" : "ok"}
          />
        </div>
        <div>
          <Readout label="Payload" value={Math.round(t.payload).toLocaleString()} unit="kg" />
          <Bar value={t.payload} max={2400} tone="accent" />
        </div>

        <div className="col-span-2 grid grid-cols-3 gap-x-3 border-t border-white/10 pt-3">
          <Readout label="Boom" value={`${toDeg(t.boomAngle).toFixed(0)}°`} tone="accent" />
          <Readout label="Stick" value={`${toDeg(t.stickAngle).toFixed(0)}°`} tone="accent" />
          <Readout label="Bucket" value={`${toDeg(t.bucketAngle).toFixed(0)}°`} tone="accent" />
        </div>

        <div className="col-span-2 grid grid-cols-3 gap-x-3">
          <Readout label="Swing" value={`${toBearing(t.swingAngle)}°`} />
          <Readout label="Pitch" value={`${toDeg(t.pitch).toFixed(1)}°`} />
          <Readout label="Roll" value={`${toDeg(t.roll).toFixed(1)}°`} />
        </div>

        <TipOverGauge margin={t.tipOverMargin} />

        <div className="col-span-2 border-t border-white/10 pt-3">
          <Readout
            label="Nearest worker"
            value={Number.isFinite(t.nearestPerson) ? t.nearestPerson.toFixed(1) : "--"}
            unit="m"
            tone={
              t.nearestPerson <= 6 ? "crit" : t.nearestPerson <= 10 ? "warn" : "ok"
            }
          />
        </div>
      </div>
    </section>
  );
}
