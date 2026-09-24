"use client";

/**
 * The operator's in-cab display.
 *
 * The live 3D machine is the hero of the screen, as a modern vehicle shows the
 * car: the interface floats over it on glass. Drive mode shows the instrument
 * cluster, the operator camera and the current job; every other app opens as
 * a sheet from the right while the machine stays visible and drivable on the
 * left. The arrow keys drive the machine the whole time.
 *
 * The screen is designed at 1280×800 and scaled to whatever space it has, so
 * it looks identical on a laptop, a projector or a phone.
 */
import * as React from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import { Barlow } from "next/font/google";
import { AnimatePresence, motion } from "motion/react";
import {
  Armchair,
  Camera,
  Clapperboard,
  CloudFog,
  CloudRain,
  Fuel,
  Gauge,
  GraduationCap,
  ListChecks,
  OctagonAlert,
  Radar,
  ScrollText,
  ShieldCheck,
  Signal,
  Thermometer,
  Timer,
  TriangleAlert,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useFleet, useIncidents, useTasks } from "@/lib/hooks/use-site";
import { useTwinStore } from "@/store/twinStore";
import { useHmiStore, type HmiAlert } from "@/lib/hmi/hmi-store";
import { useLiveMachine, useMachineMonitor, type LiveMachine } from "@/lib/hmi/use-machine";
import { useOperatorCamera } from "@/lib/hmi/use-operator-camera";
import { GuidedLesson } from "@/components/training/guided-lesson";
import { cn } from "@/lib/utils";
import { CameraFeed } from "./camera-feed";
import { ScenarioHud, ScenariosApp } from "./hmi-scenarios";
import { useScenarioPlayer } from "@/lib/scenarios/player";
import { ArcGauge, Button, C, Dot, Meter, Num, Ring, fmtMin, glass } from "./hmi-ui";
import { CameraApp, CoachApp, EstimateApp, JobsApp, LogApp, SafetyApp, SurroundView, TrainingApp, type AppId, type AppProps } from "./hmi-apps";

const barlow = Barlow({ subsets: ["latin"], weight: ["200", "300", "400", "500", "600", "700"], display: "swap" });

const TwinStage = dynamic(() => import("@/components/twin/TwinExperience").then((m) => m.TwinStage), { ssr: false });

export const SCREEN_W = 1280;
export const SCREEN_H = 800;
const BEZEL = 14;

const DOCK: { id: AppId; label: string; icon: LucideIcon }[] = [
  { id: "drive", label: "Drive", icon: Gauge },
  { id: "scenarios", label: "Scenarios", icon: Clapperboard },
  { id: "jobs", label: "Jobs", icon: ListChecks },
  { id: "safety", label: "Safety", icon: ShieldCheck },
  { id: "camera", label: "Camera", icon: Camera },
  { id: "coach", label: "Coach", icon: Radar },
  { id: "estimate", label: "Estimate", icon: Timer },
  { id: "training", label: "Training", icon: GraduationCap },
  { id: "log", label: "Log", icon: ScrollText },
];

const noopSubscribe = () => () => {};
function useIsClient() {
  return React.useSyncExternalStore(noopSubscribe, () => true, () => false);
}

function useFitScale(ref: React.RefObject<HTMLDivElement | null>) {
  const [scale, setScale] = React.useState(0.6);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      const s = Math.min(width / (SCREEN_W + BEZEL * 2), height / (SCREEN_H + BEZEL * 2));
      setScale(Math.max(0.2, Math.min(1.4, s)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return scale;
}

/* ------------------------------------------------------------- lamps */

function Lamps({ live, lampTest }: { live: LiveMachine; lampTest: boolean }) {
  const seatbelt = useHmiStore((s) => s.seatbelt);
  const lamps: { id: string; icon: LucideIcon; label: string; on: "crit" | "warn" | "info" | null }[] = [
    { id: "belt", icon: Armchair, label: "Seatbelt", on: seatbelt === "unfastened" ? "crit" : null },
    { id: "prox", icon: Users, label: "Person nearby", on: live.proximity.level === "critical" ? "crit" : live.proximity.level === "warning" ? "warn" : null },
    { id: "tip", icon: TriangleAlert, label: "Stability", on: live.tipOver < 1.2 ? "crit" : live.tipOver < 1.5 ? "warn" : null },
    { id: "hyd", icon: Thermometer, label: "Hydraulic temperature", on: live.hydraulicC > 90 ? "crit" : live.hydraulicC > 80 ? "warn" : null },
    { id: "fuel", icon: Fuel, label: "Low fuel", on: live.fuel < 15 ? "crit" : live.fuel < 25 ? "warn" : null },
    { id: "stop", icon: OctagonAlert, label: "Emergency stop", on: live.estop ? "crit" : null },
    { id: "wx", icon: live.weather === "fog" ? CloudFog : CloudRain, label: "Weather", on: live.weather === "rain" || live.weather === "fog" ? "info" : null },
  ];
  return (
    <ul className="flex items-center gap-1.5" aria-label="Warning lamps">
      {lamps.map((l) => {
        const Icon = l.icon;
        const state = lampTest ? "crit" : l.on;
        const color = state === "crit" ? C.crit : state === "warn" ? C.warn : state === "info" ? C.cyan : "rgba(255,255,255,0.14)";
        return (
          <motion.li
            key={l.id}
            title={l.label}
            aria-label={`${l.label}: ${state ?? "normal"}`}
            animate={{ scale: state ? [1, 1.12, 1] : 1 }}
            transition={{ duration: 0.4 }}
            className="grid size-8 place-items-center"
            style={{ color, filter: state ? `drop-shadow(0 0 6px ${color})` : undefined }}
          >
            <Icon className="size-[18px]" strokeWidth={2.2} aria-hidden />
          </motion.li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------ cluster */

function Cluster({ live }: { live: LiveMachine }) {
  const speed = Math.abs(live.speedKmh);
  const fuelTone = live.fuel < 15 ? "crit" : live.fuel < 25 ? "warn" : "accent";
  const hydTone = live.hydraulicC > 90 ? "crit" : live.hydraulicC > 80 ? "warn" : "cyan";
  const tipTone = live.tipOver < 1.2 ? "crit" : live.tipOver < 1.5 ? "warn" : "ok";
  return (
    <div className={cn("w-[300px] rounded-[28px] p-5", glass)}>
      <div className="flex justify-center">
        <ArcGauge value={speed} max={9} size={240} color={live.estop ? C.crit : C.accent}>
          <p className="text-[64px] font-extralight leading-none tracking-tight text-white">
            <Num value={speed} decimals={1} />
          </p>
          <p className="mt-1 text-[13px] tracking-wide text-[#8E98A6]">km/h</p>
        </ArcGauge>
      </div>
      <div className="mt-4 flex items-center justify-center gap-5 text-[20px] font-medium">
        {(["R", "N", "D"] as const).map((g) => (
          <span key={g} className="relative w-6 text-center" style={{ color: live.gear === g ? "#fff" : "rgba(255,255,255,0.22)" }}>
            {g}
            {live.gear === g ? <motion.span layoutId="gear" className="absolute -bottom-1.5 left-1 right-1 h-0.5 rounded-full bg-[#FFC72C]" /> : null}
          </span>
        ))}
      </div>
      <p className="mt-3 text-center text-[13px] capitalize text-[#8E98A6]">{live.estop ? "Stopped · locked" : live.activity}</p>
      <div className="mt-5 space-y-3.5">
        {[
          { label: "Fuel", value: `${Math.round(live.fuel)}%`, pct: live.fuel / 100, tone: fuelTone },
          { label: "Hydraulic", value: `${Math.round(live.hydraulicC)}°`, pct: live.hydraulicC / 110, tone: hydTone },
          { label: "Stability", value: `${live.tipOver.toFixed(2)}×`, pct: (live.tipOver - 1) / 1.5, tone: tipTone },
        ].map((m) => (
          <div key={m.label}>
            <div className="flex justify-between text-[13px]">
              <span className="text-[#8E98A6]">{m.label}</span>
              <span className="tabular-nums text-white">{m.value}</span>
            </div>
            <Meter value={m.pct} tone={m.tone as "accent"} className="mt-1.5" />
          </div>
        ))}
      </div>
    </div>
  );
}

function JobCard({ fleetId }: { fleetId: string }) {
  const { data: tasks } = useTasks(fleetId);
  const job = tasks.find((t) => t.state === "active") ?? tasks.find((t) => t.state === "queued");
  if (!job) return null;
  return (
    <div className={cn("flex items-center gap-4 rounded-[22px] p-4", glass)}>
      <Ring value={job.progress / 100} size={58} stroke={5}>
        <span className="text-[14px] tabular-nums">{Math.round(job.progress)}%</span>
      </Ring>
      <div className="min-w-0">
        <p className="text-[12px] text-[#8E98A6]">Current job</p>
        <p className="truncate text-[16px] text-white">{job.title}</p>
        <p className="text-[13px] tabular-nums text-[#FFC72C]">{fmtMin(job.etaMinutes)} left</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- alerts */

const LEVEL_COLOR = { 1: C.cyan, 2: C.warn, 3: C.crit } as const;

interface ShownAlert {
  id: string;
  level: 1 | 2 | 3;
  title: string;
  action: string;
  source: string;
  onAck: () => void;
}

function useShownAlerts(): ShownAlert[] {
  const hmiAlerts = useHmiStore((s) => s.alerts);
  const ack = useHmiStore((s) => s.ack);
  const acked = useHmiStore((s) => s.ackedMachineAlerts);
  const ackMachine = useHmiStore((s) => s.ackMachineAlert);
  const twinAlerts = useTwinStore((s) => s.snapshot.alerts);
  const fromHmi: ShownAlert[] = hmiAlerts
    .filter((a: HmiAlert) => !a.acked && !a.resolved && a.key !== "seatbelt")
    .map((a) => ({ id: a.id, level: a.level, title: a.title, action: a.action, source: a.source, onAck: () => ack(a.id) }));
  const fromTwin: ShownAlert[] = twinAlerts
    .filter((a) => !acked.includes(a.id) && a.kind !== "emergency_stop")
    .map((a) => ({
      id: a.id,
      level: a.severity === "critical" ? 3 : a.severity === "warning" ? 2 : 1,
      // The twin's titles are all caps; the display speaks in sentence case.
      title: a.title.charAt(0) + a.title.slice(1).toLowerCase(),
      action: a.recommendation || a.message,
      source: "machine",
      onAck: () => ackMachine(a.id),
    }));
  return [...fromTwin, ...fromHmi].sort((a, b) => b.level - a.level).slice(0, 3);
}

function AlertStack({ alerts }: { alerts: ShownAlert[] }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-[76px] z-30 flex w-[560px] -translate-x-1/2 flex-col gap-2" aria-live="assertive">
      <AnimatePresence initial={false}>
        {alerts.map((a) => (
          <motion.div
            key={a.id}
            layout
            initial={{ opacity: 0, y: -24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 60, transition: { duration: 0.18 } }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            role="alert"
            className={cn("pointer-events-auto flex items-center gap-4 overflow-hidden rounded-2xl py-3 pl-3 pr-3", glass)}
            style={{ boxShadow: `inset 3px 0 0 ${LEVEL_COLOR[a.level]}, 0 20px 50px -20px rgba(0,0,0,0.8)` }}
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: `${LEVEL_COLOR[a.level]}22`, color: LEVEL_COLOR[a.level] }}>
              {a.source === "camera" ? <Camera className="size-5" /> : <OctagonAlert className="size-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-medium text-white">{a.title}</p>
              <p className="truncate text-[13px] text-[#AEB6C1]">{a.action}</p>
            </div>
            <button onClick={a.onAck} aria-label={`Dismiss ${a.title}`} className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/6 text-[#C4CBD4] transition hover:bg-white/12">
              <X className="size-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function SeatbeltLock({ onHide }: { onHide: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-40 grid place-items-center bg-black/60 backdrop-blur-sm" role="alertdialog" aria-label="Seatbelt unfastened">
      <motion.div initial={{ scale: 0.92, y: 12 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 26 }} className={cn("w-[520px] rounded-[28px] p-8 text-center", glass)} style={{ boxShadow: `0 0 0 1px ${C.crit}66, 0 30px 90px -20px ${C.crit}55` }}>
        <motion.span animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 1.2 }} className="mx-auto grid size-20 place-items-center rounded-full" style={{ background: C.crit }}>
          <Armchair className="size-10 text-white" />
        </motion.span>
        <p className="mt-5 text-[13px] font-medium tracking-[0.2em] text-[#FF5A67]">LOCKED OUT</p>
        <p className="mt-1 text-[32px] font-light text-white">Fasten your seatbelt</p>
        <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-[#AEB6C1]">Hydraulics and travel are disabled. They release the moment the belt latches. This has been logged.</p>
        <Button onClick={onHide} className="mt-6 w-full">
          Hide for 20 s
        </Button>
      </motion.div>
    </motion.div>
  );
}

function Boot() {
  return (
    <motion.div exit={{ opacity: 0, transition: { duration: 0.5 } }} className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#05070a]">
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, ease: "easeOut" }} className="rounded-xl bg-[#FFC72C] px-5 py-2 text-[48px] font-bold tracking-tight text-black">
        CAT
      </motion.div>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="mt-5 text-[14px] tracking-[0.3em] text-[#8E98A6]">
        OPERATOR ASSIST
      </motion.p>
      <div className="mt-8 h-0.5 w-56 overflow-hidden rounded-full bg-white/10">
        <motion.div className="h-full bg-[#FFC72C]" initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: 1.6, ease: "easeInOut" }} />
      </div>
    </motion.div>
  );
}

/* --------------------------------------------------------------- dock */

function Dock({ app, onApp, flags }: { app: AppId; onApp: (a: AppId) => void; flags: Partial<Record<AppId, boolean>> }) {
  return (
    <nav aria-label="Apps" className={cn("absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-[26px] p-2", glass)}>
      {DOCK.map((d) => {
        const Icon = d.icon;
        const on = app === d.id;
        return (
          <button
            key={d.id}
            onClick={(e) => {
              onApp(d.id);
              // Hand the keyboard back to the machine.
              (e.currentTarget as HTMLButtonElement).blur();
            }}
            aria-current={on ? "page" : undefined}
            className="relative flex h-[60px] w-[88px] flex-col items-center justify-center gap-1 rounded-[18px] text-[12px] font-medium transition-colors"
            style={{ color: on ? "#14110a" : C.muted }}
          >
            {on ? <motion.span layoutId="dock-pill" className="absolute inset-0 rounded-[18px] bg-[#FFC72C]" transition={{ type: "spring", stiffness: 420, damping: 34 }} /> : null}
            <Icon className="relative size-[22px]" strokeWidth={on ? 2.2 : 1.8} />
            <span className="relative">{d.label}</span>
            {flags[d.id] ? <span className="absolute right-5 top-2 size-2 rounded-full bg-[#FF5A67] ring-2 ring-[#0d1016]" /> : null}
          </button>
        );
      })}
    </nav>
  );
}

/* --------------------------------------------------------------- root */

export interface VehicleDisplayHandle {
  lampTest: () => void;
  launchLesson: () => void;
  openApp: (a: AppId) => void;
}

export const VehicleDisplay = React.forwardRef<VehicleDisplayHandle>(function VehicleDisplay(_, handle) {
  const isClient = useIsClient();
  const live = useLiveMachine();
  const { data: machines } = useFleet();
  const fleet = machines.find((m) => m.id === live.id) ?? machines[0];
  const { report } = useIncidents(live.id);
  const seatbelt = useHmiStore((s) => s.seatbelt);
  const ambient = useHmiStore((s) => s.ambientC);
  const cameraEnabled = useHmiStore((s) => s.camera.enabled);
  const camera = useHmiStore((s) => s.camera);
  const [app, setApp] = React.useState<AppId>("drive");
  const [booting, setBooting] = React.useState(true);
  const [lampTest, setLampTest] = React.useState(true);
  const [snoozeUntil, setSnoozeUntil] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  const [lesson, setLesson] = React.useState(false);
  const fitRef = React.useRef<HTMLDivElement>(null);
  const scale = useFitScale(fitRef);
  const { videoRef: detectorVideo } = useOperatorCamera(cameraEnabled);

  const sink = React.useCallback(
    (i: Parameters<Parameters<typeof useMachineMonitor>[0]>[0]) => report({ machineId: live.id, kind: i.kind, severity: i.severity, title: `Auto · ${i.title}`, summary: i.summary }),
    [report, live.id],
  );
  useMachineMonitor(sink);
  const alerts = useShownAlerts();
  const scenarioDone = useScenarioPlayer((p) => p.done);

  React.useImperativeHandle(handle, () => ({
    lampTest: () => {
      setLampTest(true);
      setTimeout(() => setLampTest(false), 2000);
    },
    launchLesson: () => setLesson(true),
    openApp: setApp,
  }));

  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    const b = setTimeout(() => setBooting(false), 2000);
    const l = setTimeout(() => setLampTest(false), 2800);
    return () => {
      clearInterval(t);
      clearTimeout(b);
      clearTimeout(l);
    };
  }, []);

  if (!isClient || !fleet) return <div ref={fitRef} className="size-full" />;

  const locked = seatbelt === "unfastened" && now > snoozeUntil && !booting;
  const critical = alerts.some((a) => a.level === 3) || seatbelt === "unfastened";
  const cameraFiring = Object.values(camera.simulated).some(Boolean) || Object.values(camera.detected).some(Boolean);
  const flags: Partial<Record<AppId, boolean>> = {
    safety: seatbelt === "unfastened" || live.proximity.level !== "safe",
    camera: cameraFiring,
  };
  const props: AppProps = { live, fleet, onLaunchLesson: () => setLesson(true) };
  const Sheet =
    app === "drive" || app === "scenarios"
      ? null
      : { jobs: JobsApp, safety: SafetyApp, camera: CameraApp, coach: CoachApp, estimate: EstimateApp, training: TrainingApp, log: LogApp }[app];
  const hour = Number(live.clock.slice(0, 2));

  return (
    <div ref={fitRef} className={cn("relative size-full overflow-hidden", barlow.className)}>
      <div className="absolute left-1/2 top-1/2" style={{ width: SCREEN_W + BEZEL * 2, height: SCREEN_H + BEZEL * 2, transform: `translate(-50%, -50%) scale(${scale})` }}>
        {/* Device */}
        <div className="size-full rounded-[40px] bg-linear-to-b from-[#1b1f27] to-[#0a0c10] p-[14px] shadow-[0_50px_120px_-30px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.08)]">
          <div className="relative size-full overflow-hidden rounded-[28px] bg-[#05070a] text-[#F2F5F8]">
            {/* The machine */}
            <div className="absolute inset-0">
              <TwinStage liveLink={false} hud={false} />
            </div>
            {/* Legibility scrims */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-44" style={{ background: "linear-gradient(to bottom, rgba(5,7,10,0.96) 0%, rgba(5,7,10,0.7) 45%, rgba(5,7,10,0) 100%)" }} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-48" style={{ background: "linear-gradient(to top, rgba(5,7,10,0.92) 0%, rgba(5,7,10,0) 100%)" }} />
            <AnimatePresence>
              {critical ? (
                <motion.div
                  key="vignette"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0.55, 1, 0.55] }}
                  exit={{ opacity: 0 }}
                  transition={{ repeat: Infinity, duration: 1.4 }}
                  className="pointer-events-none absolute inset-0 z-10"
                  style={{ boxShadow: `inset 0 0 0 3px ${C.crit}, inset 0 0 140px ${C.crit}55` }}
                />
              ) : null}
            </AnimatePresence>

            {/* Status bar */}
            <header className="absolute inset-x-0 top-0 z-20 flex h-[64px] items-center gap-6 px-7">
              <div className="flex items-baseline gap-3">
                <span className="text-[30px] font-light tabular-nums tracking-tight">{live.clock.slice(0, 5)}</span>
                <span className="text-[14px] text-[#8E98A6]">
                  {ambient}° · <span className="capitalize">{live.weather}</span>
                </span>
              </div>
              <div className="mx-auto">
                <Lamps live={live} lampTest={lampTest} />
              </div>
              <div className="flex items-center gap-4 text-[14px] text-[#C4CBD4]">
                <span className="flex items-center gap-1.5">
                  <Dot tone={camera.status === "running" ? "ok" : cameraFiring ? "warn" : "off"} pulse={camera.status === "running"} />
                  <Camera className="size-4" />
                </span>
                <Signal className="size-4" />
                <span className="flex items-center gap-2 rounded-full bg-white/6 py-1 pl-1 pr-3">
                  <span className="grid size-7 place-items-center rounded-full bg-[#FFC72C] text-[11px] font-semibold text-black">
                    {(fleet.operator?.name ?? "OP").split(/[\s.]+/).filter(Boolean).map((p) => p[0]).join("").slice(0, 2)}
                  </span>
                  {hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening"}, {fleet.operator?.name.split(" ").pop() ?? "operator"}
                </span>
              </div>
            </header>

            {/* Drive overlays */}
            <motion.div className="absolute left-6 top-[84px] z-20" animate={{ x: 0, opacity: 1 }} initial={{ x: -30, opacity: 0 }} transition={{ delay: 2.1, type: "spring", stiffness: 200, damping: 24 }}>
              <Cluster live={live} />
            </motion.div>

            <AnimatePresence>
              {app === "drive" ? (
                <motion.div key="right" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ type: "spring", stiffness: 260, damping: 28 }} className="absolute right-6 top-[84px] z-20 flex w-[300px] flex-col gap-3">
                  <button onClick={() => setApp("camera")} className={cn("rounded-[22px] p-2.5 text-left", glass)} aria-label="Open operator camera">
                    <CameraFeed compact />
                  </button>
                  <div className={cn("flex items-center gap-4 rounded-[22px] p-3", glass)}>
                    <SurroundView live={live} size={84} />
                    <div>
                      <p className="text-[12px] text-[#8E98A6]">Surroundings</p>
                      <p className="text-[16px]" style={{ color: live.proximity.level === "critical" ? C.crit : live.proximity.level === "warning" ? C.warn : C.text }}>
                        {live.proximity.level === "safe" ? "Clear" : `Person ${live.proximity.side} · ${live.proximity.distance?.toFixed(1)} m`}
                      </p>
                    </div>
                  </div>
                  <JobCard fleetId={fleet.id} />
                </motion.div>
              ) : null}
            </AnimatePresence>

            {/* App sheet */}
            <AnimatePresence>
              {app !== "drive" ? (
                <motion.section
                  key={app}
                  initial={{ x: 80, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: 80, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 32 }}
                  className={cn("absolute bottom-[104px] right-5 top-[76px] z-20 w-[900px] overflow-hidden rounded-[30px]", "border border-white/7 bg-[#0b0e13]/88 backdrop-blur-2xl")}
                >
                  <button onClick={() => setApp("drive")} aria-label="Close" className="absolute right-4 top-4 z-10 grid size-10 place-items-center rounded-full bg-white/6 text-[#C4CBD4] hover:bg-white/12">
                    <X className="size-5" />
                  </button>
                  <div className="h-full overflow-y-auto p-7 [scrollbar-width:thin]">
                    {app === "scenarios" ? <ScenariosApp onClose={() => setApp("drive")} /> : Sheet ? <Sheet {...props} /> : null}
                  </div>
                </motion.section>
              ) : null}
            </AnimatePresence>

            <ScenarioHud />
            <Dock app={app} onApp={setApp} flags={flags} />
            <AlertStack alerts={scenarioDone ? [] : alerts} />
            <AnimatePresence>{locked ? <SeatbeltLock onHide={() => setSnoozeUntil(Date.now() + 20_000)} /> : null}</AnimatePresence>
            <AnimatePresence>{booting ? <Boot /> : null}</AnimatePresence>

            {/* Detector input: processed off-screen, shown via CameraFeed. */}
            {cameraEnabled ? <video ref={detectorVideo} muted playsInline className="pointer-events-none absolute size-px opacity-0" aria-hidden /> : null}
          </div>
        </div>
      </div>

      {lesson
        ? createPortal(
            <div className={cn("fixed inset-0 z-[70] bg-[#05070a]", barlow.className)}>
              <GuidedLesson onExit={() => setLesson(false)} />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});
