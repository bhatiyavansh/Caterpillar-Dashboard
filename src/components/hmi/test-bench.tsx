"use client";

/**
 * Test bench: every line of the brief, with the controls to simulate it and a
 * live readout of what the display detected.
 *
 * Every control drives the real systems — the 3D twin engine and its physics
 * world (workers, weather, stability, hydraulics, fuel, physical scenarios)
 * or the display's own state (seatbelt, idle and harsh counters, camera
 * checks) — so what you see on the display is the product reacting, not a
 * canned animation.
 *
 * Grouped into four tabs so the bench fits beside the display without a long
 * scroll; the reset and lamp-test actions stay pinned at the bottom.
 */
import * as React from "react";
import {
  Armchair,
  Atom,
  Camera,
  Clapperboard,
  CloudRain,
  Cloudy,
  Flame,
  Footprints,
  Fuel,
  GraduationCap,
  Keyboard,
  Lightbulb,
  Mountain,
  NotebookPen,
  Play,
  RotateCcw,
  ShieldAlert,
  Square,
  Sun,
  ThermometerSun,
  Timer,
  Truck,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useIncidents } from "@/lib/hooks/use-site";
import { useTwinStore } from "@/store/twinStore";
import { CAMERA_CHECKS, cameraActive, useHmiStore } from "@/lib/hmi/hmi-store";
import { useLiveMachine, type Side } from "@/lib/hmi/use-machine";
import type { WeatherMode } from "@/types/twin";
import { cn } from "@/lib/utils";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/overlays";
import type { VehicleDisplayHandle } from "./vehicle-display";
import { getScenario, SCENARIO_IDS } from "@/lib/scenarios/generate";
import { useScenarioPlayer } from "@/lib/scenarios/player";

/* ------------------------------------------------------------ building blocks */

function Section({
  title,
  icon: Icon,
  status,
  children,
}: {
  title: string;
  icon: LucideIcon;
  status?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
      <header className="mb-3 flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-cat-500/12 text-cat-500">
          <Icon className="size-4" aria-hidden />
        </span>
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        <span className="ml-auto text-right text-[11px]">{status}</span>
      </header>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function Btn({
  children,
  icon: Icon,
  active,
  tone,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: LucideIcon;
  active?: boolean;
  tone?: "danger";
}) {
  return (
    <button
      {...props}
      aria-pressed={active}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold transition-all active:scale-[0.97] disabled:opacity-50",
        active
          ? tone === "danger"
            ? "bg-status-crit text-white shadow-[0_6px_18px_-8px_rgba(255,77,79,0.8)]"
            : "bg-cat-500 text-ink-950 shadow-[0_6px_18px_-8px_rgba(255,205,17,0.7)]"
          : tone === "danger"
            ? "bg-status-crit/12 text-red-300 hover:bg-status-crit/20"
            : "bg-white/6 text-zinc-200 hover:bg-white/10",
        className,
      )}
    >
      {Icon ? <Icon className="size-4" aria-hidden /> : null}
      {children}
    </button>
  );
}

/** A row of mutually exclusive options. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon?: LucideIcon }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid gap-1 rounded-xl bg-white/[0.04] p-1"
      style={{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
      }}
    >
      {options.map((o) => {
        const Icon = o.icon;
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-[12px] font-semibold capitalize transition",
              on ? "bg-cat-500 text-ink-950" : "text-zinc-300 hover:bg-white/8",
            )}
          >
            {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const Pill = ({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "crit" | "off";
  children: React.ReactNode;
}) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold",
      tone === "ok" && "bg-status-ok/15 text-status-ok",
      tone === "warn" && "bg-status-warn/15 text-status-warn",
      tone === "crit" && "bg-status-crit/15 text-status-crit",
      tone === "off" && "bg-white/6 text-zinc-400",
    )}
  >
    {children}
  </span>
);

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] leading-relaxed text-muted">{children}</p>;
}

function RangeRow({
  label,
  value,
  unit,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-[12px] text-zinc-400">
      <span className="w-16 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-cat-500"
        aria-label={label}
      />
      <span className="w-14 text-right font-mono text-zinc-100">
        {Number.isInteger(value) ? value : value.toFixed(1)} {unit}
      </span>
    </label>
  );
}

/* ------------------------------------------------------------------ the bench */

type Tab = "scenarios" | "safety" | "conditions" | "operator";

const TABS: [Tab, string][] = [
  ["scenarios", "Scenarios"],
  ["safety", "Safety"],
  ["conditions", "Conditions"],
  ["operator", "Operator"],
];

export function TestBench({
  display,
}: {
  display: React.RefObject<VehicleDisplayHandle | null>;
}) {
  const live = useLiveMachine();
  const twin = useTwinStore();
  const hmi = useHmiStore();
  const { data: incidents, report } = useIncidents(live.id);
  const [side, setSide] = React.useState<Side>("rear");
  const [distance, setDistance] = React.useState(4);
  const [tab, setTab] = React.useState<Tab>("scenarios");

  const player = useScenarioPlayer();
  const engine = twin.engine;
  const physicsScenario = twin.snapshot.scenario;
  const physics = twin.snapshot.physics;
  const refresh = () => twin.refresh();
  const weather = (w: WeatherMode) => twin.setWeather(w);

  const resetAll = () => {
    if (player.id) player.stop();
    if (physicsScenario && !physicsScenario.done) twin.stopScenario();
    hmi.reset();
    engine.clearWorkers();
    twin.setWeather("clear");
    twin.resetMachine();
    if (engine.emergencyStopped) twin.toggleEmergencyStop();
    refresh();
  };

  // A dot on a tab says "something here is active right now".
  const busy: Record<Tab, boolean> = {
    scenarios:
      Boolean(player.id) || Boolean(physicsScenario && !physicsScenario.done),
    safety: hmi.seatbelt === "unfastened" || live.proximity.level !== "safe",
    conditions:
      live.weather !== "clear" || hmi.harshEvents > 0 || live.tipOver < 1.5,
    operator: Object.values(hmi.camera.simulated).some(Boolean),
  };

  return (
    <aside
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-white/8 bg-ink-900/70 backdrop-blur-xl"
      aria-label="Test bench"
    >
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <header className="shrink-0 border-b border-white/8 px-4 pb-3 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cat-500">
                Test bench
              </p>
              <h2 className="text-lg font-semibold text-zinc-50">
                Simulate every feature
              </h2>
            </div>
            <span
              className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/6 px-2.5 py-1 text-[11px] text-zinc-300"
              title="Rapier rigid-body physics"
            >
              <Atom
                className={cn(
                  "size-3.5",
                  physics?.active ? "text-status-ok" : "text-zinc-500",
                )}
                aria-hidden
              />
              {physics
                ? physics.active
                  ? `Physics · ${physics.avgStepMs.toFixed(1)} ms`
                  : "Physics paused (live)"
                : "Physics loading"}
            </span>
          </div>
          <details className="mt-2">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12px] text-muted hover:text-zinc-300">
              <Keyboard className="size-3.5" aria-hidden /> Keyboard controls
            </summary>
            <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-400">
              Arrow keys drive the machine. Shift + ←/→ slews, W/S/A/D/Q/E work
              the arm, Space is e-stop.
            </p>
          </details>
          <TabsList className="mt-3 grid w-full grid-cols-4">
            {TABS.map(([id, label]) => (
              <TabsTrigger key={id} value={id} className="relative">
                {label}
                {busy[id] ? (
                  <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-status-crit" />
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-width:thin]">
          {/* ---------------------------------------------------- scenarios */}
          <TabsContent value="scenarios" className="space-y-3">
            <Section
              title="Physics scenarios"
              icon={Atom}
              status={
                physicsScenario && !physicsScenario.done ? (
                  <Pill tone="warn">{physicsScenario.t.toFixed(1)} s</Pill>
                ) : (
                  <Pill tone="off">rigid bodies</Pill>
                )
              }
            >
              {physicsScenario && !physicsScenario.done ? (
                <div className="rounded-xl border border-cat-500/30 bg-cat-500/8 p-3">
                  <p className="text-[13px] font-semibold text-zinc-100">
                    {physicsScenario.title}
                  </p>
                  <p className="text-[12px] text-cat-500">
                    {physicsScenario.step}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {physicsScenario.met.map((m) => (
                      <li
                        key={m.label}
                        className="flex items-center justify-between text-[12px]"
                      >
                        <span
                          className={
                            m.at === null ? "text-zinc-500" : "text-zinc-100"
                          }
                        >
                          {m.at === null ? "○" : "●"} {m.label}
                        </span>
                        {m.at !== null ? (
                          <span className="font-mono text-zinc-400">
                            {m.at.toFixed(1)} s
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <Btn
                    icon={Square}
                    onClick={() => twin.stopScenario()}
                    className="mt-2 w-full"
                  >
                    Stop and restore
                  </Btn>
                </div>
              ) : (
                <div className="grid gap-2">
                  {engine.physicsScenarios.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => twin.runScenario(s.id)}
                      disabled={!physics?.active}
                      className="flex w-full items-start gap-3 rounded-xl bg-white/5 px-3 py-2.5 text-left transition hover:bg-white/9 disabled:opacity-50"
                    >
                      <Play
                        className="mt-0.5 size-4 shrink-0 text-cat-500"
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold text-zinc-100">
                          {s.title}
                        </span>
                        <span className="line-clamp-2 block text-[11px] leading-snug text-muted">
                          {s.summary}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {physicsScenario?.done ? (
                <Hint>
                  Last run: {physicsScenario.title} —{" "}
                  {physicsScenario.met.filter((m) => m.at !== null).length}/
                  {physicsScenario.met.length} outcomes observed.
                </Hint>
              ) : null}
            </Section>

            <Section
              title="Recorded hazards · 120 Hz"
              icon={Clapperboard}
              status={
                player.id ? (
                  <Pill
                    tone={
                      player.phase === "intervention"
                        ? "crit"
                        : player.phase === "hazard"
                          ? "warn"
                          : "ok"
                    }
                  >
                    {player.t.toFixed(1)} s · {player.phase}
                  </Pill>
                ) : (
                  <Pill tone="off">playback</Pill>
                )
              }
            >
              <div className="grid gap-2">
                {SCENARIO_IDS.map((id, i) => {
                  const s = getScenario(id);
                  const on = player.id === id;
                  return (
                    <Btn
                      key={id}
                      active={on}
                      onClick={() => (on ? player.stop() : player.start(id))}
                      className="h-auto w-full min-w-0 justify-start py-2.5 text-left"
                    >
                      <span className="font-mono text-[11px] opacity-60">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block">{s.title}</span>
                        <span
                          className={cn(
                            "block truncate text-[11px] font-normal",
                            on ? "text-ink-950/70" : "text-muted",
                          )}
                        >
                          {s.subtitle}
                        </span>
                      </span>
                      <span className="text-[11px]">
                        {on ? "Stop" : "Play"}
                      </span>
                    </Btn>
                  );
                })}
              </div>
              <Hint>
                Data: data/scenarios/*.csv · regenerate with npm run
                scenarios:export
              </Hint>
            </Section>
          </TabsContent>

          {/* ------------------------------------------------------- safety */}
          <TabsContent value="safety" className="space-y-3">
            <Section
              title="Seatbelt compliance"
              icon={Armchair}
              status={
                hmi.seatbelt === "fastened" ? (
                  <Pill tone="ok">Fastened</Pill>
                ) : (
                  <Pill tone="crit">Locked out</Pill>
                )
              }
            >
              <div className="grid grid-cols-2 gap-2">
                <Btn
                  active={hmi.seatbelt === "fastened"}
                  onClick={() => hmi.setSeatbelt("fastened")}
                >
                  Fasten
                </Btn>
                <Btn
                  tone="danger"
                  active={hmi.seatbelt === "unfastened"}
                  onClick={() => hmi.setSeatbelt("unfastened")}
                >
                  Unbuckle
                </Btn>
              </div>
              <Hint>
                Unbuckling engages a real hydraulic lockout: try driving.{" "}
                {Math.round(hmi.beltOffSeconds)} s unbelted so far.
              </Hint>
            </Section>

            <Section
              title="Proximity hazards"
              icon={ShieldAlert}
              status={
                <Pill
                  tone={
                    live.proximity.level === "critical"
                      ? "crit"
                      : live.proximity.level === "warning"
                        ? "warn"
                        : "ok"
                  }
                >
                  {live.proximity.level === "safe"
                    ? "Clear"
                    : `${live.proximity.side} · ${live.proximity.distance?.toFixed(1)} m`}
                </Pill>
              }
            >
              <Segmented
                label="Worker side"
                value={side}
                onChange={setSide}
                options={(["front", "rear", "left", "right"] as Side[]).map(
                  (s) => ({ value: s, label: s }),
                )}
              />
              <RangeRow
                label="Distance"
                value={distance}
                unit="m"
                min={2}
                max={14}
                step={0.5}
                onChange={setDistance}
              />
              <div className="grid grid-cols-2 gap-2">
                <Btn
                  icon={Footprints}
                  onClick={() => {
                    engine.placeWorker(side, distance);
                    refresh();
                  }}
                >
                  Place worker
                </Btn>
                <Btn
                  icon={Footprints}
                  onClick={() => twin.forceWorkerApproach()}
                >
                  Walk-in approach
                </Btn>
                <Btn icon={Truck} onClick={() => twin.forceCollisionRisk()}>
                  Dozer conflict
                </Btn>
                <Btn
                  onClick={() => {
                    engine.clearWorkers();
                    refresh();
                  }}
                >
                  Clear zone
                </Btn>
              </div>
              <Hint>
                With physics on, distance is measured to the machine&apos;s
                hull, and the dozer conflict ends in real contact.
              </Hint>
            </Section>

            <Section
              title="Incident logging"
              icon={NotebookPen}
              status={
                <Pill tone="off">
                  {hmi.autoIncidents} auto · {incidents.length} total
                </Pill>
              }
            >
              <Hint>
                Seatbelt, danger-zone, stability and critical camera events log
                themselves. Operators file the rest from Safety.
              </Hint>
              <div className="grid grid-cols-2 gap-2">
                <Btn
                  onClick={() =>
                    report({
                      machineId: live.id,
                      kind: "proximity",
                      severity: "warning",
                      title: "Near miss (test)",
                      summary: "Filed from the test bench.",
                    })
                  }
                >
                  File test report
                </Btn>
                <Btn onClick={() => display.current?.openApp("safety")}>
                  Open Safety
                </Btn>
              </div>
            </Section>
          </TabsContent>

          {/* --------------------------------------------------- conditions */}
          <TabsContent value="conditions" className="space-y-3">
            <Section
              title="Working conditions"
              icon={ThermometerSun}
              status={
                <Pill
                  tone={
                    live.weather === "clear" && hmi.ambientC < 40
                      ? "ok"
                      : "warn"
                  }
                >
                  {live.weather} · {hmi.ambientC}°C
                </Pill>
              }
            >
              <Segmented
                label="Weather"
                value={live.weather as WeatherMode}
                onChange={weather}
                options={[
                  { value: "clear", label: "clear", icon: Sun },
                  { value: "rain", label: "rain", icon: CloudRain },
                  { value: "fog", label: "fog", icon: Cloudy },
                  { value: "heat", label: "heat", icon: Flame },
                ]}
              />
              <RangeRow
                label="Ambient"
                value={hmi.ambientC}
                unit="°C"
                min={18}
                max={48}
                onChange={(v) => hmi.setAmbient(v)}
              />
              <Hint>
                Rain soaks the ground: every surface loses grip, loose spoil and
                wet clay most of all.
              </Hint>
              <Btn
                icon={Mountain}
                onClick={() => twin.forceTipOver()}
                className="w-full"
              >
                Load shift on the sidehill (stability {live.tipOver.toFixed(2)}
                ×)
              </Btn>
            </Section>

            <Section
              title="Unusual machine usage"
              icon={Zap}
              status={
                <Pill
                  tone={hmi.harshEvents || hmi.idleStreak > 45 ? "warn" : "ok"}
                >
                  idle {Math.round(hmi.idleSeconds / 60)}m · harsh{" "}
                  {hmi.harshEvents}
                </Pill>
              }
            >
              <Hint>
                Detected live from your driving: sit still to idle, slam ↑ then
                ↓ for harsh operation.
              </Hint>
              <div className="grid grid-cols-2 gap-2">
                <Btn icon={Timer} onClick={() => hmi.addIdle(600, true)}>
                  Idle 10 min
                </Btn>
                <Btn
                  icon={Zap}
                  onClick={() => {
                    hmi.addHarsh(3);
                    if (
                      hmi.raise({
                        key: "harsh",
                        level: 2,
                        source: "monitor",
                        title: "Harsh operation",
                        action:
                          "Three abrupt control inputs in 20 s. Feather the controls.",
                      })
                    )
                      setTimeout(
                        () => useHmiStore.getState().resolve("harsh"),
                        8000,
                      );
                  }}
                >
                  Harsh burst
                </Btn>
                <Btn
                  icon={ThermometerSun}
                  onClick={() => twin.forceHydraulicSpike()}
                >
                  Hydraulic spike
                </Btn>
                <Btn icon={Fuel} onClick={() => twin.forceLowFuel()}>
                  Low fuel
                </Btn>
                <Btn
                  icon={Wrench}
                  onClick={() => twin.forceEngineWarning()}
                  className="col-span-2"
                >
                  Engine fault code
                </Btn>
              </div>
            </Section>
          </TabsContent>

          {/* ----------------------------------------------------- operator */}
          <TabsContent value="operator" className="space-y-3">
            <Section
              title="Operator camera"
              icon={Camera}
              status={
                <Pill
                  tone={
                    hmi.camera.status === "running"
                      ? "ok"
                      : hmi.camera.enabled
                        ? "warn"
                        : "off"
                  }
                >
                  {hmi.camera.enabled ? hmi.camera.status : "off"}
                </Pill>
              }
            >
              <div className="grid grid-cols-2 gap-2">
                <Btn
                  icon={Camera}
                  active={hmi.camera.enabled}
                  onClick={() =>
                    hmi.setCamera({ enabled: !hmi.camera.enabled })
                  }
                >
                  {hmi.camera.enabled ? "Camera on" : "Use webcam"}
                </Btn>
                <Btn onClick={() => display.current?.openApp("camera")}>
                  Open camera view
                </Btn>
              </div>
              <Hint>
                With the webcam on, close your eyes, look away, yawn or hold up
                a phone. Or simulate:
              </Hint>
              <div className="flex flex-wrap gap-1.5">
                {CAMERA_CHECKS.map((c) => {
                  const on = Boolean(hmi.camera.simulated[c.id]);
                  const firing = cameraActive(hmi.camera, c.id);
                  return (
                    <Btn
                      key={c.id}
                      active={on}
                      onClick={() => hmi.simulate(c.id, !on)}
                      className={cn(
                        "h-8 text-[12px]",
                        firing && !on && "ring-1 ring-status-crit",
                      )}
                    >
                      {c.title
                        .replace(" detected", "")
                        .replace("Operator not ", "Not ")}
                    </Btn>
                  );
                })}
              </div>
            </Section>

            <Section title="Task time estimation" icon={Timer}>
              <Hint>
                The estimate follows live weather and ambient temperature.
                Change them under Conditions and watch it move.
              </Hint>
              <Btn
                onClick={() => display.current?.openApp("estimate")}
                className="w-full"
              >
                Open estimator
              </Btn>
            </Section>

            <Section title="Operator training" icon={GraduationCap}>
              <div className="grid grid-cols-2 gap-2">
                <Btn active onClick={() => display.current?.launchLesson()}>
                  Guided lesson
                </Btn>
                <Btn onClick={() => display.current?.openApp("training")}>
                  Videos · booking
                </Btn>
              </div>
            </Section>
          </TabsContent>
        </div>
      </Tabs>

      <footer className="grid shrink-0 grid-cols-2 gap-2 border-t border-white/8 p-3">
        <Btn icon={Lightbulb} onClick={() => display.current?.lampTest()}>
          Lamp test
        </Btn>
        <Btn icon={RotateCcw} onClick={resetAll}>
          Reset everything
        </Btn>
      </footer>
    </aside>
  );
}
