"use client";

/**
 * AR maintenance.
 *
 * Opened on a phone at the machine, so it is built thumb-first: one column, big
 * targets, one step visible at a time. The model viewer sits at the top and the
 * procedure below it, because the technician looks up at the machine and down
 * at the steps, not side to side.
 */
import * as React from "react";
import { motion } from "motion/react";
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Cuboid,
  Droplets,
  Gauge,
  RotateCcw,
  Smartphone,
  Wind,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

interface Hotspot {
  id: string;
  label: string;
  system: string;
  icon: LucideIcon;
  /** Position on the machine diagram, as percentages. */
  x: number;
  y: number;
  difficulty: string;
  duration: string;
  citation: string;
  steps: { title: string; detail: string; caution?: string }[];
}

const HOTSPOTS: Hotspot[] = [
  {
    id: "hydraulic-filter",
    label: "Hydraulic filter",
    system: "Hydraulic system",
    icon: Droplets,
    x: 58,
    y: 34,
    difficulty: "Routine",
    duration: "25 min",
    citation: "320 Operation and Maintenance Manual, p. 184",
    steps: [
      {
        title: "Shut the engine down",
        detail: "Park on level ground, lower the bucket to the ground, engine off, key removed.",
        caution: "Never work on the hydraulic system with the engine running.",
      },
      {
        title: "Release hydraulic pressure",
        detail:
          "Turn the key to ON without starting, then work the joysticks through their full travel to bleed residual pressure. Slowly loosen the tank filler cap to vent the reservoir.",
        caution: "Hydraulic oil can reach 90 °C. Let it cool for 30 minutes before opening the housing.",
      },
      {
        title: "Remove the filter element",
        detail:
          "Clean around the housing, remove the four M10 cap bolts, lift the cover with the spring retainer, and withdraw the element into a drain tray.",
      },
      {
        title: "Fit the replacement",
        detail:
          "Fit a new O-ring lightly coated in clean oil, seat the new element fully, and torque the cap bolts to 45 N·m in a cross pattern.",
      },
      {
        title: "Refill and check",
        detail:
          "Top up to the sight glass mid-mark, run the engine at low idle for two minutes, then re-check the level and inspect the housing for weeping.",
      },
    ],
  },
  {
    id: "air-filter",
    label: "Engine air filter",
    system: "Engine intake",
    icon: Wind,
    x: 44,
    y: 26,
    difficulty: "Routine",
    duration: "15 min",
    citation: "320 Operation and Maintenance Manual, p. 152",
    steps: [
      { title: "Open the service door", detail: "Release the two latches on the left-hand engine enclosure door." },
      {
        title: "Release the canister",
        detail: "Unclip the three spring clamps and withdraw the end cap. Do not knock the element against the housing.",
      },
      {
        title: "Withdraw the primary element",
        detail: "Pull the primary element straight out. Leave the safety element in place unless it is visibly dirty.",
        caution: "Never wash or reuse the element. Fit a new one.",
      },
      {
        title: "Inspect and refit",
        detail: "Wipe the housing with a damp cloth, check the new element seal, slide it home and reseat the end cap.",
      },
      {
        title: "Reset the indicator",
        detail: "Press the restriction indicator reset button and confirm it reads clear at high idle.",
      },
    ],
  },
  {
    id: "track-tension",
    label: "Track tension",
    system: "Undercarriage",
    icon: Gauge,
    x: 34,
    y: 72,
    difficulty: "Needs a grease gun",
    duration: "30 min",
    citation: "320 Operation and Maintenance Manual, p. 206",
    steps: [
      {
        title: "Position the machine",
        detail: "Travel forward one full track length and stop without braking, so the track settles naturally.",
      },
      {
        title: "Measure the sag",
        detail: "Lay a straight edge across the carrier rollers and measure the greatest sag. Target is 20 to 30 mm.",
      },
      {
        title: "Adjust the tension",
        detail:
          "To tighten, pump grease into the adjuster fitting. To loosen, back the relief valve out no more than one full turn.",
        caution: "Grease in the adjuster is under high pressure. Never loosen the fitting itself, only the relief valve.",
      },
      {
        title: "Re-measure and confirm",
        detail: "Travel another track length, re-measure, and repeat until the sag is inside the range on both sides.",
      },
    ],
  },
];

function MachineDiagram({
  selected,
  onSelect,
}: {
  selected: Hotspot;
  onSelect: (h: Hotspot) => void;
}) {
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded border border-white/10 bg-ink-950">
      {/* Where <model-viewer> mounts. The diagram keeps the page useful on a
          desktop and when the device has no AR support. */}
      <svg viewBox="0 0 100 75" className="size-full" role="img" aria-label="CAT 320 excavator, side view">
        <defs>
          <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffcd11" stopOpacity={0.9} />
            <stop offset="100%" stopColor="#e6b400" stopOpacity={0.7} />
          </linearGradient>
        </defs>

        {/* Ground */}
        <line x1="6" y1="68" x2="94" y2="68" stroke="rgba(255,255,255,0.12)" strokeWidth="0.6" />

        {/* Tracks */}
        <rect x="20" y="58" width="42" height="9" rx="4.5" fill="#23282f" stroke="#31373f" strokeWidth="0.6" />
        <circle cx="26" cy="62.5" r="2.6" fill="#14171c" stroke="#3a424c" strokeWidth="0.5" />
        <circle cx="56" cy="62.5" r="2.6" fill="#14171c" stroke="#3a424c" strokeWidth="0.5" />

        {/* House */}
        <rect x="26" y="40" width="34" height="17" rx="2" fill="url(#body)" />
        {/* Cab */}
        <rect x="27" y="30" width="15" height="12" rx="2" fill="#14171c" stroke="#ffcd11" strokeWidth="0.7" />
        <rect x="29" y="32" width="11" height="7" rx="1" fill="#4aa8ff" opacity="0.25" />
        {/* Counterweight */}
        <rect x="58" y="42" width="7" height="13" rx="1.5" fill="#23282f" />

        {/* Boom and stick */}
        <path d="M 52 42 L 74 24 L 80 28" fill="none" stroke="url(#body)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M 80 28 L 84 40" fill="none" stroke="url(#body)" strokeWidth="3.4" strokeLinecap="round" />
        <path d="M 84 40 L 88 46 L 82 48 Z" fill="#31373f" stroke="#ffcd11" strokeWidth="0.6" />

        {/* Hotspots */}
        {HOTSPOTS.map((h) => {
          const active = h.id === selected.id;
          return (
            <g
              key={h.id}
              transform={`translate(${h.x} ${(h.y / 100) * 75})`}
              role="button"
              tabIndex={0}
              aria-label={`${h.label}, ${h.system}`}
              onClick={() => onSelect(h)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(h);
                }
              }}
              className="cursor-pointer outline-none"
            >
              {active ? (
                <circle r="4.4" fill="none" stroke="#ffcd11" strokeWidth="0.6" opacity="0.7">
                  <animate attributeName="r" values="3.4;5.6;3.4" dur="1.8s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.8;0;0.8" dur="1.8s" repeatCount="indefinite" />
                </circle>
              ) : null}
              <circle
                r="2.6"
                fill={active ? "#ffcd11" : "#14171c"}
                stroke="#ffcd11"
                strokeWidth="0.7"
              />
              <text
                y="0.9"
                textAnchor="middle"
                fontSize="2.6"
                fontWeight="800"
                fill={active ? "#0a0b0d" : "#ffcd11"}
              >
                {HOTSPOTS.indexOf(h) + 1}
              </text>
            </g>
          );
        })}
      </svg>

      <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded bg-black/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-300">
        <Cuboid className="size-3" aria-hidden />
        CAT 320
      </span>
      <Button variant="primary" size="sm" className="absolute bottom-2 right-2">
        <Smartphone className="size-3.5" aria-hidden />
        View in your space
      </Button>
    </div>
  );
}

export function ArMaintenance() {
  const [selected, setSelected] = React.useState<Hotspot>(HOTSPOTS[0]);
  const [step, setStep] = React.useState(0);
  const [done, setDone] = React.useState<Set<string>>(new Set());

  const pick = (h: Hotspot) => {
    setSelected(h);
    setStep(0);
  };

  const current = selected.steps[step];
  const last = step === selected.steps.length - 1;
  const key = `${selected.id}-${step}`;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-4 lg:max-w-5xl">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="label-xs">AR maintenance</p>
            <h1 className="text-lg font-bold tracking-tight text-zinc-50">EXC001 · CAT 320</h1>
          </div>
          <span className="rounded border border-white/10 bg-ink-850 px-2.5 py-1.5 text-[11px] text-muted">
            Open on a phone at the machine
          </span>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <MachineDiagram selected={selected} onSelect={pick} />

            {/* Hotspot picker — big targets, gloves on */}
            <div className="grid gap-2 sm:grid-cols-3">
              {HOTSPOTS.map((h) => {
                const Icon = h.icon;
                const active = h.id === selected.id;
                return (
                  <button
                    key={h.id}
                    onClick={() => pick(h)}
                    aria-pressed={active}
                    className={cn(
                      "flex min-h-16 flex-col items-start gap-1 rounded border p-2.5 text-left transition-colors",
                      active
                        ? "border-cat-500 bg-cat-500/12"
                        : "border-white/12 bg-ink-850 hover:border-white/25",
                    )}
                  >
                    <Icon className={cn("size-4", active ? "text-cat-500" : "text-muted")} aria-hidden />
                    <span className={cn("text-xs font-bold leading-tight", active ? "text-cat-500" : "text-zinc-100")}>
                      {h.label}
                    </span>
                    <span className="text-[10px] text-muted">{h.duration}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Procedure */}
          <section className="flex flex-col overflow-hidden rounded border border-white/10 bg-ink-900">
            <div className="border-b border-white/10 px-4 py-3">
              <p className="label-xs">{selected.system}</p>
              <h2 className="text-base font-bold text-zinc-50">{selected.label}</h2>
              <p className="mt-0.5 text-[11px] text-muted">
                {selected.difficulty} · about {selected.duration} · {selected.steps.length} steps
              </p>
            </div>

            {/* Step rail */}
            <ol className="flex gap-1 border-b border-white/10 px-4 py-2.5" aria-label="Steps">
              {selected.steps.map((s, i) => (
                <li key={s.title} className="flex-1">
                  <button
                    onClick={() => setStep(i)}
                    aria-current={i === step ? "step" : undefined}
                    aria-label={`Step ${i + 1}: ${s.title}`}
                    className={cn(
                      "h-1.5 w-full rounded-full transition-colors",
                      i < step ? "bg-status-ok" : i === step ? "bg-cat-500" : "bg-white/12",
                    )}
                  />
                </li>
              ))}
            </ol>

            <motion.div
              key={key}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
              className="flex-1 space-y-3 px-4 py-4"
            >
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-cat-500 font-mono text-sm font-black text-ink-950">
                  {step + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-bold leading-tight text-zinc-50">{current.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-300">{current.detail}</p>
                </div>
              </div>

              {current.caution ? (
                <p className="flex items-start gap-2 rounded border border-status-warn/40 bg-status-warn/10 px-3 py-2 text-xs leading-relaxed text-status-warn">
                  <span className="font-black" aria-hidden>
                    !
                  </span>
                  <span>
                    <strong className="uppercase tracking-wider">Caution </strong>
                    {current.caution}
                  </span>
                </p>
              ) : null}
            </motion.div>

            <div className="border-t border-white/10 p-3">
              <p className="mb-2.5 flex items-center gap-1.5 text-[11px] text-muted">
                <BookOpen className="size-3.5 shrink-0" aria-hidden />
                {selected.citation}
              </p>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="touch"
                  className="flex-1"
                  disabled={step === 0}
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                >
                  <ChevronLeft className="size-5" aria-hidden />
                  Back
                </Button>

                {last ? (
                  <Button
                    variant="primary"
                    size="touch"
                    className="flex-1"
                    onClick={() => setDone((d) => new Set(d).add(selected.id))}
                  >
                    <Check className="size-5" aria-hidden />
                    {done.has(selected.id) ? "Signed off" : "Mark complete"}
                  </Button>
                ) : (
                  <Button variant="primary" size="touch" className="flex-1" onClick={() => setStep((s) => s + 1)}>
                    Next step
                    <ChevronRight className="size-5" aria-hidden />
                  </Button>
                )}
              </div>

              {done.has(selected.id) ? (
                <p className="mt-2 flex items-center justify-between gap-2 text-[11px] text-status-ok">
                  <span className="inline-flex items-center gap-1.5">
                    <Check className="size-3.5" aria-hidden />
                    Logged against EXC001 service history
                  </span>
                  <button
                    onClick={() => {
                      setDone((d) => {
                        const next = new Set(d);
                        next.delete(selected.id);
                        return next;
                      });
                      setStep(0);
                    }}
                    className="inline-flex items-center gap-1 text-muted hover:text-zinc-200"
                  >
                    <RotateCcw className="size-3" aria-hidden />
                    Redo
                  </button>
                </p>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
