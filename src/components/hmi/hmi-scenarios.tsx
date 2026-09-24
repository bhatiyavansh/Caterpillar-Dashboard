"use client";

/**
 * Real-world scenarios: pick one of three hazards, watch it play out on the
 * live machine at 120 Hz, and see what would have happened without the
 * assist system.
 */
import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Pause, Play, RotateCcw, ShieldCheck, Skull, X } from "lucide-react";
import { getScenario, SCENARIO_IDS, type Actor, type ScenarioEvent } from "@/lib/scenarios/generate";
import { useScenarioPlayer } from "@/lib/scenarios/player";
import { cn } from "@/lib/utils";
import { Button, C, SheetTitle, glass } from "./hmi-ui";

const ACTOR_COLOR: Record<Actor, string> = {
  hazard: C.warn,
  system: C.accent,
  operator: C.cyan,
  outcome: C.crit,
};
const ACTOR_LABEL: Record<Actor, string> = { hazard: "Hazard", system: "CAT Assist", operator: "Operator", outcome: "Without assist" };

/* --------------------------------------------------------------- list */

export function ScenariosApp({ onClose }: { onClose: () => void }) {
  const start = useScenarioPlayer((s) => s.start);
  return (
    <div>
      <SheetTitle title="Real-world scenarios" detail="Three hazards that injure and kill operators and ground crew every year. Each plays on this machine from 120 Hz data." />
      <div className="grid grid-cols-3 gap-4">
        {SCENARIO_IDS.map((id, i) => {
          const s = getScenario(id);
          const firstAction = s.events.find((e) => e.actor === "system");
          return (
            <motion.article
              key={id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="flex flex-col rounded-2xl border border-white/6 bg-white/3 p-5"
            >
              <p className="text-[12px] font-medium tracking-[0.18em] text-[#FFC72C]">SCENARIO {i + 1}</p>
              <h3 className="mt-1 text-[22px] font-light leading-tight text-white">{s.title}</h3>
              <p className="mt-1 text-[13px] text-[#8E98A6]">{s.subtitle}</p>
              <div className="mt-4 grid grid-cols-2 gap-2 text-[12px]">
                <div className="rounded-xl bg-[#FFC72C]/8 px-3 py-2">
                  <p className="text-[#8E98A6]">Assist acts at</p>
                  <p className="text-[18px] font-light tabular-nums text-[#FFC72C]">{firstAction?.t.toFixed(1)} s</p>
                </div>
                <div className="rounded-xl bg-[#FF5A67]/10 px-3 py-2">
                  <p className="text-[#8E98A6]">Without assist</p>
                  <p className="text-[18px] font-light tabular-nums text-[#FF5A67]">{s.outcome.unassistedAt?.toFixed(1)} s</p>
                </div>
              </div>
              <p className="mt-3 text-[11px] tabular-nums text-[#566070]">
                {s.frames.length.toLocaleString()} frames · {s.fps} fps · {s.duration} s · {s.weather}, {s.ambientC}°C
              </p>
              <Button
                variant="primary"
                icon={Play}
                className="mt-3 w-full"
                onClick={(e) => {
                  start(id);
                  onClose();
                  e.currentTarget.blur();
                }}
              >
                Simulate
              </Button>
              <p className="mt-4 text-[13px] leading-relaxed text-[#C4CBD4]">{s.why}</p>
              <ul className="mt-4 space-y-1.5">
                {s.howItHelps.map((h) => (
                  <li key={h} className="flex gap-2 text-[13px] text-[#C4CBD4]">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-[#3DDC97]" />
                    {h}
                  </li>
                ))}
              </ul>
            </motion.article>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- playback */

function latestEvent(events: ScenarioEvent[], t: number): ScenarioEvent | null {
  let last: ScenarioEvent | null = null;
  for (const e of events) if (e.t <= t && e.actor !== "outcome") last = e;
  return last;
}

export function ScenarioHud() {
  const p = useScenarioPlayer();
  if (!p.id) return null;
  const s = getScenario(p.id);
  const ev = latestEvent(s.events, p.t);
  const pct = (x: number) => `${(x / s.duration) * 100}%`;
  const phaseColor = { normal: C.muted, hazard: C.warn, intervention: C.crit, recovered: C.ok }[p.phase];
  const f = p.frame;

  return (
    <>
      {/* Now-playing caption */}
      <AnimatePresence mode="wait">
        {ev && !p.done ? (
          <motion.div
            key={ev.title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={cn("absolute bottom-[206px] left-1/2 z-20 w-[620px] -translate-x-1/2 rounded-2xl px-5 py-3", glass)}
            style={{ boxShadow: `inset 3px 0 0 ${ACTOR_COLOR[ev.actor]}` }}
          >
            <p className="text-[11px] font-medium tracking-[0.18em]" style={{ color: ACTOR_COLOR[ev.actor] }}>
              {ACTOR_LABEL[ev.actor].toUpperCase()} · {ev.t.toFixed(1)} s
            </p>
            <p className="text-[17px] text-white">{ev.title}</p>
            <p className="text-[13px] text-[#AEB6C1]">{ev.detail}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Transport + timeline */}
      <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className={cn("absolute bottom-[104px] left-1/2 z-20 w-[900px] -translate-x-1/2 rounded-[22px] px-5 py-3.5", glass)}>
        <div className="flex items-center gap-4">
          <div className="min-w-0 w-[210px]">
            <p className="truncate text-[15px] text-white">{s.title}</p>
            <p className="flex items-center gap-1.5 text-[12px] capitalize" style={{ color: phaseColor }}>
              <span className="size-1.5 rounded-full" style={{ background: phaseColor }} />
              {p.phase}
              <span className="text-[#566070]">· 120 fps</span>
            </p>
          </div>

          <div className="relative h-10 flex-1">
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/8" />
            <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[#FFC72C]" style={{ width: pct(p.t) }} />
            {s.events.map((e, i) => (
              <span
                key={i}
                title={`${e.t.toFixed(1)} s · ${e.title}`}
                className={cn("absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full", e.actor === "outcome" ? "size-3 ring-2 ring-[#FF5A67] ring-offset-2 ring-offset-transparent" : "size-2.5")}
                style={{ left: pct(e.t), background: e.actor === "outcome" ? "transparent" : ACTOR_COLOR[e.actor] }}
              />
            ))}
            <input
              type="range"
              min={0}
              max={s.duration}
              step={1 / 120}
              value={p.t}
              onChange={(e) => p.seek(Number(e.target.value))}
              aria-label="Scenario timeline"
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            />
            <span className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#0d1016] bg-white shadow" style={{ left: pct(p.t) }} />
          </div>

          <span className="w-[92px] text-right text-[14px] tabular-nums text-[#C4CBD4]">
            {p.t.toFixed(1)} / {s.duration.toFixed(0)} s
          </span>
          <div className="flex items-center gap-1">
            <button onClick={p.toggle} aria-label={p.playing ? "Pause" : "Play"} className="grid size-10 place-items-center rounded-full bg-[#FFC72C] text-black">
              {p.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </button>
            <button onClick={() => p.setRate(p.rate === 1 ? 0.5 : p.rate === 0.5 ? 0.25 : 1)} aria-label="Playback speed" className="h-10 w-12 rounded-full bg-white/6 text-[13px] tabular-nums text-white hover:bg-white/10">
              {p.rate}×
            </button>
            <button onClick={p.restart} aria-label="Restart" className="grid size-10 place-items-center rounded-full bg-white/6 text-white hover:bg-white/10">
              <RotateCcw className="size-4" />
            </button>
            <button onClick={p.stop} aria-label="End scenario" className="grid size-10 place-items-center rounded-full bg-white/6 text-white hover:bg-white/10">
              <X className="size-4" />
            </button>
          </div>
        </div>
        {f ? (
          <div className="mt-2 flex gap-5 border-t border-white/6 pt-2 text-[12px] tabular-nums text-[#8E98A6]">
            <span>speed {(f.speed * 3.6).toFixed(1)} km/h</span>
            <span>slew {f.swingDeg.toFixed(0)}°</span>
            <span>person {f.personDist.toFixed(1)} m</span>
            <span>stability {f.tipMargin.toFixed(2)}×</span>
            <span>belt {f.seatbelt ? "on" : "OFF"}</span>
            <span>eyes {(f.eyesClosed * 100).toFixed(0)}%</span>
            <span className="ml-auto" style={{ color: C.crit }}>
              no-assist clearance {f.cfClearance.toFixed(2)}
            </span>
          </div>
        ) : null}
      </motion.div>

      {/* Outcome comparison */}
      <AnimatePresence>
        {p.done ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className={cn("absolute left-1/2 top-[90px] z-30 w-[720px] -translate-x-1/2 rounded-[28px] p-7", glass)}
          >
            <p className="text-[12px] tracking-[0.2em] text-[#8E98A6]">SCENARIO COMPLETE · {s.title.toUpperCase()}</p>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div className="rounded-2xl bg-[#3DDC97]/10 p-5">
                <p className="flex items-center gap-2 text-[14px] font-medium text-[#3DDC97]">
                  <ShieldCheck className="size-5" /> With CAT Assist
                </p>
                <p className="mt-2 text-[15px] leading-relaxed text-white">{s.outcome.assisted}</p>
              </div>
              <div className="rounded-2xl bg-[#FF5A67]/10 p-5">
                <p className="flex items-center gap-2 text-[14px] font-medium text-[#FF5A67]">
                  <Skull className="size-5" /> Without it · {s.outcome.unassistedAt?.toFixed(1)} s
                </p>
                <p className="mt-2 text-[15px] leading-relaxed text-white">{s.outcome.unassisted}</p>
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <Button variant="primary" icon={RotateCcw} onClick={p.restart}>
                Replay
              </Button>
              <Button onClick={p.stop}>Done</Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
