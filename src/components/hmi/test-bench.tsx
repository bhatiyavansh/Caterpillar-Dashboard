"use client";

/**
 * Test bench: one section per line of the brief, each with the controls to
 * simulate it and a live readout of what the display detected.
 *
 * Every control drives the real systems — the 3D twin engine (workers,
 * weather, stability, hydraulics, fuel) or the display's own state (seatbelt,
 * idle and harsh counters, camera checks) — so what you see on the display is
 * the product reacting, not a canned animation.
 */
import * as React from "react";
import {
  Armchair,
  Camera,
  Clapperboard,
  CloudRain,
  Cloudy,
  Flame,
  Footprints,
  Fuel,
  GraduationCap,
  Lightbulb,
  Mountain,
  NotebookPen,
  RotateCcw,
  ShieldAlert,
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
import type { VehicleDisplayHandle } from "./vehicle-display";
import { getScenario, SCENARIO_IDS } from "@/lib/scenarios/generate";
import { useScenarioPlayer } from "@/lib/scenarios/player";

function Section({ n, title, icon: Icon, status, children }: { n: number; title: string; icon: LucideIcon; status?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/7 bg-white/[0.025] p-4">
      <header className="mb-3 flex items-center gap-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-cat-500/15 font-mono text-[11px] font-bold text-cat-500">{n}</span>
        <Icon className="size-4 text-zinc-400" aria-hidden />
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        <span className="ml-auto text-right text-[11px]">{status}</span>
      </header>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function Btn({ children, icon: Icon, active, tone, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: LucideIcon; active?: boolean; tone?: "danger" }) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-all active:scale-[0.97]",
        active ? "bg-cat-500 text-ink-950" : tone === "danger" ? "bg-status-crit/15 text-red-300 hover:bg-status-crit/25" : "bg-white/6 text-zinc-200 hover:bg-white/11",
        className,
      )}
    >
      {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
      {children}
    </button>
  );
}

const Pill = ({ tone, children }: { tone: "ok" | "warn" | "crit" | "off"; children: React.ReactNode }) => (
  <span
    className={cn(
      "rounded-full px-2 py-0.5 font-semibold",
      tone === "ok" && "bg-status-ok/15 text-status-ok",
      tone === "warn" && "bg-status-warn/15 text-status-warn",
      tone === "crit" && "bg-status-crit/15 text-status-crit",
      tone === "off" && "bg-white/5 text-zinc-500",
    )}
  >
    {children}
  </span>
);

export function TestBench({ display }: { display: React.RefObject<VehicleDisplayHandle | null> }) {
  const live = useLiveMachine();
  const twin = useTwinStore();
  const hmi = useHmiStore();
  const { data: incidents, report } = useIncidents(live.id);
  const [side, setSide] = React.useState<Side>("rear");
  const [distance, setDistance] = React.useState(4);

  const player = useScenarioPlayer();
  const engine = twin.engine;
  const refresh = () => twin.refresh();
  const weather = (w: WeatherMode) => twin.setWeather(w);

  const resetAll = () => {
    if (player.id) player.stop();
    hmi.reset();
    engine.clearWorkers();
    twin.setWeather("clear");
    twin.resetMachine();
    if (engine.emergencyStopped) twin.toggleEmergencyStop();
    refresh();
  };

  return (
    <aside className="flex flex-col gap-3" aria-label="Test bench">
      <div className="flex items-end justify-between gap-3 px-1">
        <div>
          <p className="label-xs !text-cat-500">Test bench</p>
          <h2 className="text-lg font-bold text-zinc-50">Simulate every feature</h2>
          <p className="text-xs text-muted">Arrow keys drive the machine. Shift + ←/→ slews, W/S/A/D/Q/E work the arm, Space is e-stop.</p>
        </div>
      </div>

      <Section
        n={0}
        title="Real-world scenarios"
        icon={Clapperboard}
        status={player.id ? <Pill tone={player.phase === "intervention" ? "crit" : player.phase === "hazard" ? "warn" : "ok"}>{player.t.toFixed(1)} s · {player.phase}</Pill> : <Pill tone="off">120 fps data</Pill>}
      >
        <div className="grid gap-2">
          {SCENARIO_IDS.map((id, i) => {
            const s = getScenario(id);
            const on = player.id === id;
            return (
              <Btn key={id} active={on} onClick={() => (on ? player.stop() : player.start(id))} className="h-auto w-full min-w-0 justify-start py-2 text-left">
                <span className="font-mono text-[10px] opacity-60">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block">{s.title}</span>
                  <span className={cn("block truncate text-[10px] font-normal", on ? "text-ink-950/70" : "text-muted")}>{s.subtitle}</span>
                </span>
                <span className="text-[10px]">{on ? "Stop" : "Play"}</span>
              </Btn>
            );
          })}
        </div>
        <p className="text-[11px] text-muted">Data: data/scenarios/*.csv · regenerate with npm run scenarios:export</p>
      </Section>

      <Section
        n={1}
        title="Seatbelt compliance"
        icon={Armchair}
        status={hmi.seatbelt === "fastened" ? <Pill tone="ok">Fastened</Pill> : <Pill tone="crit">Locked out</Pill>}
      >
        <div className="grid grid-cols-2 gap-2">
          <Btn active={hmi.seatbelt === "fastened"} onClick={() => hmi.setSeatbelt("fastened")}>
            Fasten
          </Btn>
          <Btn tone="danger" active={hmi.seatbelt === "unfastened"} onClick={() => hmi.setSeatbelt("unfastened")}>
            Unbuckle
          </Btn>
        </div>
        <p className="text-[11px] text-muted">Unbuckling engages a real hydraulic lockout: try driving. {Math.round(hmi.beltOffSeconds)} s unbelted so far.</p>
      </Section>

      <Section
        n={2}
        title="Proximity hazards"
        icon={ShieldAlert}
        status={
          <Pill tone={live.proximity.level === "critical" ? "crit" : live.proximity.level === "warning" ? "warn" : "ok"}>
            {live.proximity.level === "safe" ? "Clear" : `${live.proximity.side} · ${live.proximity.distance?.toFixed(1)} m`}
          </Pill>
        }
      >
        <div className="grid grid-cols-4 gap-1.5">
          {(["front", "rear", "left", "right"] as Side[]).map((s) => (
            <Btn key={s} active={side === s} onClick={() => setSide(s)} className="capitalize">
              {s}
            </Btn>
          ))}
        </div>
        <label className="flex items-center gap-3 text-xs text-zinc-400">
          Distance
          <input type="range" min={2} max={14} step={0.5} value={distance} onChange={(e) => setDistance(Number(e.target.value))} className="flex-1 accent-[#FFC72C]" aria-label="Worker distance" />
          <span className="w-12 text-right font-mono text-zinc-200">{distance.toFixed(1)} m</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Btn icon={Footprints} onClick={() => { engine.placeWorker(side, distance); refresh(); }}>Place worker</Btn>
          <Btn icon={Footprints} onClick={() => twin.forceWorkerApproach()}>Walk-in approach</Btn>
          <Btn icon={Truck} onClick={() => twin.forceCollisionRisk()}>Dozer conflict</Btn>
          <Btn onClick={() => { engine.clearWorkers(); refresh(); }}>Clear zone</Btn>
        </div>
      </Section>

      <Section n={3} title="Incident logging" icon={NotebookPen} status={<Pill tone="off">{hmi.autoIncidents} auto · {incidents.length} total</Pill>}>
        <p className="text-[11px] text-muted">Seatbelt, danger-zone, stability and critical camera events log themselves. Operators file the rest from Safety.</p>
        <div className="grid grid-cols-2 gap-2">
          <Btn onClick={() => report({ machineId: live.id, kind: "proximity", severity: "warning", title: "Near miss (test)", summary: "Filed from the test bench." })}>File test report</Btn>
          <Btn onClick={() => display.current?.openApp("safety")}>Open Safety</Btn>
        </div>
      </Section>

      <Section n={4} title="Working conditions" icon={ThermometerSun} status={<Pill tone={live.weather === "clear" && hmi.ambientC < 40 ? "ok" : "warn"}>{live.weather} · {hmi.ambientC}°C</Pill>}>
        <div className="grid grid-cols-4 gap-1.5">
          {([
            ["clear", Sun],
            ["rain", CloudRain],
            ["fog", Cloudy],
            ["heat", Flame],
          ] as const).map(([w, Icon]) => (
            <Btn key={w} icon={Icon} active={live.weather === w} onClick={() => weather(w)} className="capitalize">
              {w}
            </Btn>
          ))}
        </div>
        <label className="flex items-center gap-3 text-xs text-zinc-400">
          Ambient
          <input type="range" min={18} max={48} value={hmi.ambientC} onChange={(e) => hmi.setAmbient(Number(e.target.value))} className="flex-1 accent-[#FFC72C]" aria-label="Ambient temperature" />
          <span className="w-12 text-right font-mono text-zinc-200">{hmi.ambientC}°C</span>
        </label>
        <Btn icon={Mountain} onClick={() => twin.forceTipOver()} className="w-full">
          Steep cross-slope (stability {live.tipOver.toFixed(2)}×)
        </Btn>
      </Section>

      <Section
        n={5}
        title="Unusual machine usage"
        icon={Zap}
        status={<Pill tone={hmi.harshEvents || hmi.idleStreak > 45 ? "warn" : "ok"}>idle {Math.round(hmi.idleSeconds / 60)}m · harsh {hmi.harshEvents}</Pill>}
      >
        <p className="text-[11px] text-muted">Detected live from your driving: sit still to idle, slam ↑ then ↓ for harsh operation.</p>
        <div className="grid grid-cols-2 gap-2">
          <Btn icon={Timer} onClick={() => hmi.addIdle(600, true)}>Idle 10 min</Btn>
          <Btn
            icon={Zap}
            onClick={() => {
              hmi.addHarsh(3);
              if (hmi.raise({ key: "harsh", level: 2, source: "monitor", title: "Harsh operation", action: "Three abrupt control inputs in 20 s. Feather the controls." }))
                setTimeout(() => useHmiStore.getState().resolve("harsh"), 8000);
            }}
          >
            Harsh burst
          </Btn>
          <Btn icon={ThermometerSun} onClick={() => twin.forceHydraulicSpike()}>Hydraulic spike</Btn>
          <Btn icon={Fuel} onClick={() => twin.forceLowFuel()}>Low fuel</Btn>
          <Btn icon={Wrench} onClick={() => twin.forceEngineWarning()} className="col-span-2">Engine fault code</Btn>
        </div>
      </Section>

      <Section
        n={6}
        title="Operator camera"
        icon={Camera}
        status={<Pill tone={hmi.camera.status === "running" ? "ok" : hmi.camera.enabled ? "warn" : "off"}>{hmi.camera.enabled ? hmi.camera.status : "off"}</Pill>}
      >
        <div className="grid grid-cols-2 gap-2">
          <Btn icon={Camera} active={hmi.camera.enabled} onClick={() => hmi.setCamera({ enabled: !hmi.camera.enabled })}>
            {hmi.camera.enabled ? "Camera on" : "Use webcam"}
          </Btn>
          <Btn onClick={() => display.current?.openApp("camera")}>Open camera view</Btn>
        </div>
        <p className="text-[11px] text-muted">With the webcam on, close your eyes, look away, yawn or hold up a phone. Or simulate:</p>
        <div className="flex flex-wrap gap-1.5">
          {CAMERA_CHECKS.map((c) => {
            const on = Boolean(hmi.camera.simulated[c.id]);
            const firing = cameraActive(hmi.camera, c.id);
            return (
              <Btn key={c.id} active={on} onClick={() => hmi.simulate(c.id, !on)} className={cn("h-8", firing && !on && "ring-1 ring-status-crit")}>
                {c.title.replace(" detected", "").replace("Operator not ", "Not ")}
              </Btn>
            );
          })}
        </div>
      </Section>

      <Section n={7} title="Task time estimation" icon={Timer}>
        <p className="text-[11px] text-muted">The estimate follows live weather and ambient temperature. Change them in section 4 and watch it move.</p>
        <Btn onClick={() => display.current?.openApp("estimate")} className="w-full">Open estimator</Btn>
      </Section>

      <Section n={8} title="Operator training" icon={GraduationCap}>
        <div className="grid grid-cols-2 gap-2">
          <Btn active onClick={() => display.current?.launchLesson()}>Guided lesson</Btn>
          <Btn onClick={() => display.current?.openApp("training")}>Videos · booking</Btn>
        </div>
      </Section>

      <div className="grid grid-cols-2 gap-2 pb-2">
        <Btn icon={Lightbulb} onClick={() => display.current?.lampTest()}>Lamp test</Btn>
        <Btn icon={RotateCcw} onClick={resetAll}>Reset everything</Btn>
      </div>
    </aside>
  );
}
