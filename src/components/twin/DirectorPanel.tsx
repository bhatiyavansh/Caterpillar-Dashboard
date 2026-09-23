"use client";

/**
 * Demo director panel — Ctrl+D.
 *
 * Every hazard in here drives the same code path the organic simulation uses,
 * so a forced event is indistinguishable from one that happened on its own.
 * That is what makes a live demo reliable.
 */

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { WeatherMode } from "@/types/twin";
import { useTwinStore } from "@/store/twinStore";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-white/10 px-3 py-2.5 first:border-t-0">
      <h3 className="label-xs mb-2">{title}</h3>
      <div className="grid grid-cols-2 gap-1.5">{children}</div>
    </section>
  );
}

function Action({
  label,
  onClick,
  tone = "default",
  wide,
  active,
}: {
  label: string;
  onClick: () => void;
  tone?: "default" | "warn" | "crit" | "accent";
  wide?: boolean;
  active?: boolean;
}) {
  const toneClass = {
    default: "border-white/12 text-zinc-200 hover:border-white/30 hover:bg-white/5",
    warn: "border-status-warn/35 text-status-warn hover:border-status-warn/70 hover:bg-status-warn/10",
    crit: "border-status-crit/35 text-status-crit hover:border-status-crit/70 hover:bg-status-crit/10",
    accent: "border-cat-500/40 text-cat-500 hover:border-cat-500/80 hover:bg-cat-500/10",
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded border px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider transition ${toneClass} ${
        wide ? "col-span-2" : ""
      } ${active ? "bg-white/10 ring-1 ring-inset ring-current" : ""}`}
    >
      {label}
    </button>
  );
}

const WEATHER: { mode: WeatherMode; label: string }[] = [
  { mode: "clear", label: "Clear" },
  { mode: "rain", label: "Rain" },
  { mode: "fog", label: "Fog" },
  { mode: "heat", label: "Heat" },
];

export function DirectorPanel() {
  const open = useTwinStore((s) => s.directorOpen);
  const toggle = useTwinStore((s) => s.toggleDirector);

  const weather = useTwinStore((s) => s.snapshot.weather);
  const paused = useTwinStore((s) => s.snapshot.paused);
  const source = useTwinStore((s) => s.snapshot.source);

  const store = useTwinStore.getState();

  // Escape closes the panel; the drive keys stay live underneath.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, toggle]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 40 }}
          transition={{ type: "spring", stiffness: 380, damping: 34 }}
          aria-label="Simulation director"
          className="panel-raised pointer-events-auto w-[272px] overflow-hidden"
        >
          <header className="flex items-center justify-between bg-cat-500/10 px-3 py-2">
            <div>
              <div className="text-[11px] font-bold tracking-[0.18em] text-cat-500">
                SIMULATION DIRECTOR
              </div>
              <div className="text-[10px] text-zinc-500">Ctrl + D to toggle</div>
            </div>
            <button
              type="button"
              onClick={toggle}
              className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-white/40 hover:text-zinc-200"
            >
              ESC
            </button>
          </header>

          <div className="max-h-[70vh] overflow-y-auto">
            <Section title="Vehicle">
              <Action label="Reset vehicle" onClick={store.resetMachine} tone="accent" wide />
            </Section>

            <Section title="Hazards">
              <Action
                label="Worker enters zone"
                onClick={store.forceWorkerApproach}
                tone="warn"
                wide
              />
              <Action
                label="Force collision risk"
                onClick={store.forceCollisionRisk}
                tone="crit"
                wide
              />
              <Action
                label="Force tip-over warning"
                onClick={store.forceTipOver}
                tone="crit"
                wide
              />
            </Section>

            <Section title="Machine">
              <Action
                label="Hydraulic spike"
                onClick={store.forceHydraulicSpike}
                tone="warn"
                wide
              />
              <Action label="Low fuel" onClick={store.forceLowFuel} tone="warn" />
              <Action label="Engine fault" onClick={store.forceEngineWarning} tone="warn" />
            </Section>

            <Section title="Environment">
              {WEATHER.map((w) => (
                <Action
                  key={w.mode}
                  label={w.label}
                  onClick={() => store.setWeather(w.mode)}
                  active={weather === w.mode}
                  tone={w.mode === "clear" ? "default" : "accent"}
                />
              ))}
            </Section>

            <Section title="Telemetry source">
              <Action
                label="Keyboard"
                onClick={() => store.setSource("keyboard")}
                active={source === "keyboard"}
                tone="accent"
              />
              <Action
                label="Mock IoT"
                onClick={() => store.setSource("mock_iot")}
                active={source === "mock_iot"}
                tone="accent"
              />
            </Section>

            <Section title="Simulation">
              <Action
                label={paused ? "Resume" : "Pause"}
                onClick={() => store.setPaused(!paused)}
                active={paused}
              />
              <Action label="Reset all" onClick={store.resetSimulation} tone="crit" />
            </Section>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
