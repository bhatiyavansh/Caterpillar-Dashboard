"use client";

import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { motion } from "motion/react";
import type { MachineMode, SimulationScenario } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";
import { Slider, Switch } from "@/components/ui/overlays";
import { useMachineStore } from "@/store/machine-store";

const scenarios: SimulationScenario[] = ["normal", "warning", "critical"];
const modes: MachineMode[] = ["idle", "operating", "heavy-load", "maintenance"];

/**
 * Presenter controls. Hidden by default — this is a demo affordance, not part
 * of the product surface an operator would ever see.
 */
export function SimulationControls() {
  const { scenario, setScenario, mode, setMode, sensors, setSensor, live, setLive, reset } = useMachineStore();

  const sliders = [
    { key: "engineTemperature" as const, label: "Engine temperature", min: 40, max: 120, unit: "°C", step: 1 },
    { key: "fuelLevel" as const, label: "Fuel", min: 0, max: 100, unit: "%", step: 1 },
    { key: "hydraulicPressure" as const, label: "Hydraulic pressure", min: 0, max: 4000, unit: "PSI", step: 20 },
    { key: "rpm" as const, label: "Engine RPM", min: 0, max: 2400, unit: "RPM", step: 10 },
  ];

  return (
    <motion.aside
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      className="w-80 shrink-0 overflow-y-auto border-l border-white/10 bg-ink-900 p-4"
      aria-label="Simulation controls"
    >
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="size-4 text-cat-500" aria-hidden />
        <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-zinc-200">Simulation controls</h2>
      </div>
      <p className="mt-1 text-xs text-muted">Demo-only panel. Drives the shared mock machine state.</p>

      <div className="mt-5">
        <p className="label-xs">Scenario</p>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {scenarios.map((s) => (
            <button
              key={s}
              onClick={() => setScenario(s)}
              aria-pressed={scenario === s}
              className={cn(
                "h-10 rounded text-xs font-bold uppercase tracking-wider transition-colors",
                scenario === s
                  ? s === "normal"
                    ? "bg-status-ok text-ink-950"
                    : s === "warning"
                      ? "bg-status-warn text-ink-950"
                      : "bg-status-crit text-white"
                  : "bg-white/6 text-zinc-300 hover:bg-white/12",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <p className="label-xs">Machine state</p>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {modes.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={cn(
                "h-10 rounded text-xs font-bold uppercase tracking-wider transition-colors",
                mode === m ? "bg-cat-500 text-ink-950" : "bg-white/6 text-zinc-300 hover:bg-white/12",
              )}
            >
              {m.replace("-", " ")}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between rounded border border-white/10 bg-ink-850 px-3 py-2.5">
        <label htmlFor="live-toggle" className="text-xs font-semibold text-zinc-200">
          Live sensor drift
        </label>
        <Switch id="live-toggle" checked={live} onCheckedChange={setLive} />
      </div>

      <div className="mt-5 space-y-5">
        <p className="label-xs">Sensor overrides</p>
        {sliders.map((s) => (
          <div key={s.key}>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-zinc-300">{s.label}</span>
              <span className="font-mono text-xs font-semibold text-cat-500">
                {Math.round(sensors[s.key])} {s.unit}
              </span>
            </div>
            <Slider
              className="mt-2"
              min={s.min}
              max={s.max}
              step={s.step}
              value={[sensors[s.key]]}
              onValueChange={([v]) => setSensor(s.key, v)}
            />
          </div>
        ))}
      </div>

      <Button variant="outline" className="mt-6 w-full" onClick={reset}>
        <RotateCcw className="size-4" aria-hidden />
        Reset simulation
      </Button>
    </motion.aside>
  );
}
