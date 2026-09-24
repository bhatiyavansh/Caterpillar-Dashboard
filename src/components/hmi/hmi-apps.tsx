"use client";

/**
 * The display's apps. Each opens as a sheet over the live 3D view and covers
 * a line of the brief:
 *
 *   Jobs      today's scheduled tasks, with ML time estimates
 *   Safety    seatbelt compliance, proximity, working conditions, incident log
 *   Camera    operator monitoring: fatigue, distraction, phone, seat presence
 *   Coach     unusual usage — idling, harsh operation — live and historical
 *   Estimate  predict a job's duration from past data and conditions
 *   Training  guided keyboard lesson, video lessons, instructor booking
 *   Log       the fleet usage table from the brief
 */
import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Armchair, CalendarCheck, Check, CirclePlay, Flame, Keyboard, Lock, Pause, Send, Siren, TriangleAlert, Wind, type LucideIcon } from "lucide-react";
import { useAnomalies, useFleet, useIncidents, useTasks, useTraining } from "@/lib/hooks/use-site";
import { predictTaskTime, type TaskConditions } from "@/lib/intel";
import type { Soil, TaskType, Weather } from "@/lib/intel/model";
import type { AlertKind, AlertSeverity, Machine } from "@/lib/api/contracts";
import { relativeTime } from "@/components/alerts/alert-card";
import { useHmiStore } from "@/lib/hmi/hmi-store";
import type { LiveMachine } from "@/lib/hmi/use-machine";
import { cn } from "@/lib/utils";
import { CameraFeed } from "./camera-feed";
import { Button, C, Card, Dot, Label, Meter, Num, Ring, SheetTitle, Stat, fmtMin } from "./hmi-ui";

export type AppId = "drive" | "scenarios" | "jobs" | "safety" | "camera" | "coach" | "estimate" | "training" | "log";

export interface AppProps {
  live: LiveMachine;
  fleet: Machine;
  onLaunchLesson: () => void;
}

/* ---------------------------------------------------------- top view */

const ZONE_ANGLE = { front: -90, right: 0, rear: 90, left: 180 } as const;

function sector(c: number, r0: number, r1: number, a0: number, a1: number) {
  const p = (r: number, a: number) => `${c + r * Math.cos((a * Math.PI) / 180)} ${c + r * Math.sin((a * Math.PI) / 180)}`;
  return `M ${p(r0, a0)} L ${p(r1, a0)} A ${r1} ${r1} 0 0 1 ${p(r1, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 0 0 ${p(r0, a0)} Z`;
}

/** 360° surround sensor view: the side a person is on lights up. */
export function SurroundView({ live, size = 200 }: { live: LiveMachine; size?: number }) {
  const { level, side } = live.proximity;
  const c = size / 2;
  const hot = level === "critical" ? C.crit : C.warn;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`Proximity ${level}${side ? `, ${side}` : ""}`}>
      <circle cx={c} cy={c} r={c * 0.96} fill="none" stroke="rgba(255,255,255,0.06)" />
      {(Object.keys(ZONE_ANGLE) as (keyof typeof ZONE_ANGLE)[]).map((z) => {
        const on = side === z && level !== "safe";
        return (
          <motion.path
            key={z}
            d={sector(c, c * 0.56, c * 0.92, ZONE_ANGLE[z] - 40, ZONE_ANGLE[z] + 40)}
            initial={false}
            animate={{ fill: on ? hot : "rgba(98,208,255,0.08)", opacity: on ? [1, 0.55, 1] : 1 }}
            transition={on ? { opacity: { repeat: Infinity, duration: 0.9 } } : { duration: 0.3 }}
          />
        );
      })}
      <g transform={`translate(${c} ${c}) scale(${size / 340})`}>
        <rect x="-40" y="-50" width="16" height="100" rx="4" fill="#2a3140" />
        <rect x="24" y="-50" width="16" height="100" rx="4" fill="#2a3140" />
        <rect x="-30" y="-32" width="60" height="64" rx="10" fill={C.accent} />
        <rect x="-7" y="-104" width="14" height="74" rx="4" fill="#d9a91f" />
      </g>
    </svg>
  );
}

/* ================================================================ JOBS */

export function JobsApp({ fleet }: AppProps) {
  const { data: tasks } = useTasks(fleet.id);
  const [selected, setSelected] = React.useState<string | null>(null);
  const task = tasks.find((t) => t.id === selected) ?? tasks.find((t) => t.state === "active") ?? tasks[0];

  return (
    <div>
      <SheetTitle title="Today's jobs" detail={`${tasks.length} scheduled for ${fleet.id} · estimates from the task-time model`} />
      <div className="grid grid-cols-[1fr_300px] gap-4">
        <ol className="space-y-2">
          {tasks.map((t, i) => {
            const on = task?.id === t.id;
            return (
              <li key={t.id}>
                <button
                  onClick={() => setSelected(t.id)}
                  aria-pressed={on}
                  className={cn("flex w-full items-center gap-4 rounded-2xl px-4 py-3.5 text-left transition", on ? "bg-white/8 ring-1 ring-cat-500/50" : "bg-white/3 hover:bg-white/6")}
                >
                  <span className="w-12 shrink-0 text-[14px] tabular-nums text-muted">{t.startsAt}</span>
                  {t.state === "active" ? (
                    <Ring value={t.progress / 100} size={40} stroke={4}>
                      <span className="text-[10px] tabular-nums">{Math.round(t.progress)}</span>
                    </Ring>
                  ) : (
                    <span className={cn("grid size-10 shrink-0 place-items-center rounded-full text-[13px]", t.state === "done" ? "bg-status-ok/15 text-status-ok" : "bg-white/5 text-muted")}>
                      {t.state === "done" ? <Check className="size-4" /> : i + 1}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] text-white">{t.title}</span>
                    <span className="text-[13px] text-muted">
                      {t.zone} · {t.soil} soil
                    </span>
                  </span>
                  <span className="text-right text-[15px] tabular-nums text-zinc-300">{t.state === "done" ? "Done" : fmtMin(t.state === "active" ? t.etaMinutes : t.totalMinutes)}</span>
                </button>
              </li>
            );
          })}
        </ol>
        {task ? (
          <Card title="How long, and why">
            <Stat label="Model estimate" value={fmtMin(task.totalMinutes)} tone="accent" size="lg" />
            <p className="mt-1 text-[13px] text-muted">Planner said {fmtMin(task.plannerMinutes)}</p>
            <ul className="mt-5 space-y-3">
              {task.drivers.map((d) => (
                <li key={d.feature}>
                  <div className="flex justify-between text-[14px]">
                    <span className="text-zinc-300">{d.label}</span>
                    <span className="tabular-nums" style={{ color: d.impactMin > 0 ? C.warn : C.ok }}>
                      {d.impactMin > 0 ? "+" : ""}
                      {d.impactMin}m
                    </span>
                  </div>
                  <Meter value={(Math.abs(d.impactMin) / Math.max(1, task.totalMinutes)) * 3} tone={d.impactMin > 0 ? "warn" : "ok"} className="mt-1.5 h-1" />
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

/* ============================================================== SAFETY */

const INCIDENT_TYPES: { label: string; kind: AlertKind; icon: LucideIcon }[] = [
  { label: "Near miss", kind: "proximity", icon: TriangleAlert },
  { label: "Person in zone", kind: "proximity", icon: Siren },
  { label: "Unstable ground", kind: "tip_over", icon: Wind },
  { label: "Machine fault", kind: "hydraulic", icon: Flame },
];

export function SafetyApp({ live, fleet }: AppProps) {
  const seatbelt = useHmiStore((s) => s.seatbelt);
  const beltOff = useHmiStore((s) => s.beltOffSeconds);
  const ambient = useHmiStore((s) => s.ambientC);
  const { data: incidents, report } = useIncidents(fleet.id);
  const [type, setType] = React.useState(0);
  const [severity, setSeverity] = React.useState<AlertSeverity>("warning");
  const [note, setNote] = React.useState("");
  const [logged, setLogged] = React.useState(false);
  const belted = seatbelt === "fastened";
  const prox = live.proximity;

  const submit = () => {
    const t = INCIDENT_TYPES[type];
    report({ machineId: fleet.id, kind: t.kind, severity, title: t.label, summary: note.trim() || `${t.label} reported from the cab.` });
    setNote("");
    setLogged(true);
    setTimeout(() => setLogged(false), 2500);
  };

  const conditions: { label: string; value: string; bad: boolean }[] = [
    { label: "Weather", value: live.weather, bad: live.weather !== "clear" },
    { label: "Ambient", value: `${ambient}°C`, bad: ambient >= 40 },
    { label: "Stability", value: `${live.tipOver.toFixed(2)}×`, bad: live.tipOver < 1.5 },
    { label: "Hydraulic oil", value: `${Math.round(live.hydraulicC)}°C`, bad: live.hydraulicC > 85 },
  ];

  return (
    <div>
      <SheetTitle title="Safety" detail="Live interlocks, surroundings, conditions and incident reporting" />
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-4">
          <Card>
            <div className="flex items-center gap-4">
              <span className="grid size-14 place-items-center rounded-2xl" style={{ background: belted ? "rgba(61,220,151,0.12)" : C.crit, color: belted ? C.ok : "#fff" }}>
                {belted ? <Armchair className="size-7" /> : <Lock className="size-7" />}
              </span>
              <div>
                <p className="text-[20px] text-white">{belted ? "Seatbelt fastened" : "Seatbelt open · locked out"}</p>
                <p className="text-[13px] text-muted">{beltOff > 0 ? `${Math.round(beltOff)} s unbelted this shift` : "100% compliant this shift"}</p>
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-center gap-5">
              <SurroundView live={live} size={132} />
              <div>
                <Stat
                  label="Nearest person"
                  value={prox.distance !== null && prox.distance < 30 ? prox.distance.toFixed(1) : "—"}
                  unit="m"
                  tone={prox.level === "critical" ? "crit" : prox.level === "warning" ? "warn" : undefined}
                />
                <p className="mt-1 text-[13px] text-zinc-300">
                  {prox.level === "critical" ? `Stop. Person ${prox.side}.` : prox.level === "warning" ? `Slow down, person ${prox.side}.` : "Work zone clear"}
                </p>
              </div>
            </div>
          </Card>
          <Card title="Working conditions">
            <ul className="grid grid-cols-2 gap-x-5 gap-y-3">
              {conditions.map((c) => (
                <li key={c.label}>
                  <Label>{c.label}</Label>
                  <p className="mt-0.5 text-[17px] capitalize" style={{ color: c.bad ? C.warn : C.text }}>
                    {c.value}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card
          title="Report an incident"
          action={
            <AnimatePresence>
              {logged ? (
                <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-[13px] text-status-ok" role="status">
                  Logged
                </motion.span>
              ) : null}
            </AnimatePresence>
          }
        >
          <div className="grid grid-cols-2 gap-2">
            {INCIDENT_TYPES.map((t, i) => (
              <Button key={t.label} icon={t.icon} variant={type === i ? "selected" : "default"} onClick={() => setType(i)} aria-pressed={type === i}>
                {t.label}
              </Button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(["info", "warning", "critical"] as AlertSeverity[]).map((s) => (
              <Button key={s} variant={severity === s ? "selected" : "default"} onClick={() => setSeverity(s)} aria-pressed={severity === s}>
                {s === "info" ? "Low" : s === "warning" ? "Medium" : "High"}
              </Button>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            aria-label="Incident note"
            placeholder="What happened? (optional)"
            className="mt-3 w-full resize-none rounded-xl bg-white/5 p-3 text-[15px] text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cat-500/60"
          />
          <Button variant="primary" icon={Send} onClick={submit} className="mt-3 w-full">
            Submit report
          </Button>
          <p className="mt-5 text-[12px] font-medium tracking-wide text-muted">Recent · auto and manual</p>
          <ul className="mt-2 space-y-2">
            {incidents.slice(0, 5).map((i) => (
              <li key={i.id} className="flex items-center gap-2.5 text-[14px]">
                <Dot tone={i.severity === "critical" ? "crit" : i.severity === "warning" ? "warn" : "off"} />
                <span className="min-w-0 flex-1 truncate text-zinc-300">{i.title}</span>
                <span className="shrink-0 tabular-nums text-zinc-500">{relativeTime(i.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

/* ============================================================== CAMERA */

export function CameraApp() {
  const camera = useHmiStore((s) => s.camera);
  const setCamera = useHmiStore((s) => s.setCamera);
  return (
    <div>
      <SheetTitle
        title="Operator camera"
        detail="On-device vision watches for fatigue, distraction, phone use and seat presence. Nothing leaves the cab."
        action={camera.enabled ? <Button onClick={() => setCamera({ enabled: false })}>Turn off</Button> : null}
      />
      <CameraFeed />
    </div>
  );
}

/* =============================================================== COACH */

const TIP: Record<string, string> = {
  excessive_idling: "Shut down if you'll wait more than 5 minutes. Auto-idle cuts fuel burn by up to 25%.",
  seatbelt_violation: "Buckle up before starting. The interlock logs every unbelted second.",
  overload: "Take a smaller bite. Overloading wears the pins and slows your cycle.",
  harsh_operation: "Feather the controls. Smooth inputs are faster over a shift and easier on the machine.",
  temperature_anomaly: "Let hydraulics cool at low idle and check the cooler for dust.",
  low_productivity: "Park the truck on your swing side to cut cycle time.",
  unusual_pattern: "This shift looks unlike your usual one.",
};

export function CoachApp({ fleet }: AppProps) {
  const idle = useHmiStore((s) => s.idleSeconds);
  const streak = useHmiStore((s) => s.idleStreak);
  const harsh = useHmiStore((s) => s.harshEvents);
  const { data: anomalies } = useAnomalies();
  const mine = anomalies.filter((a) => a.machineId === fleet.id);
  const idleMin = idle / 60;

  return (
    <div>
      <SheetTitle title="Coach" detail="Unusual usage, detected from how the machine is being driven right now" />
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <Stat label="Idle this shift" value={<Num value={idleMin} />} unit="min" size="lg" tone={idleMin > 30 ? "crit" : idleMin > 15 ? "warn" : undefined} />
          <Meter value={idleMin / 60} tone={idleMin > 15 ? "warn" : "ok"} className="mt-4" />
          <p className="mt-2 text-[13px] text-muted">{streak > 1 ? `Idling now · ${Math.round(streak)} s` : "Target under 15 min"}</p>
        </Card>
        <Card>
          <Stat label="Harsh events" value={<Num value={harsh} />} size="lg" tone={harsh > 3 ? "crit" : harsh > 0 ? "warn" : undefined} />
          <p className="mt-4 text-[13px] text-muted">Abrupt speed changes and snap reversals, measured live.</p>
        </Card>
        <Card>
          <Stat label="Fuel used" value={Math.round(fleet.fuelUsedL)} unit="L" size="lg" />
          <p className="mt-4 text-[13px] text-muted">
            {Math.round(fleet.loadCycles)} load cycles · {Math.round(fleet.utilization)}% utilised
          </p>
        </Card>
      </div>
      <p className="mb-3 mt-6 text-[13px] font-medium tracking-wide text-muted">Flagged by the anomaly model</p>
      <div className="space-y-3">
        {mine.length === 0 ? (
          <Card>
            <p className="flex items-center gap-2 text-[16px] text-status-ok">
              <Check className="size-5" /> Nothing unusual in the historical pattern
            </p>
          </Card>
        ) : (
          mine.slice(0, 3).map((a) => (
            <Card key={a.id}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[17px] text-white">{a.title}</p>
                <p className="text-[14px] tabular-nums text-status-warn">₹{Math.round(a.costInr).toLocaleString("en-IN")}</p>
              </div>
              <p className="mt-1 text-[14px] text-muted">{a.explanation}</p>
              <p className="mt-3 rounded-xl bg-cat-500/8 px-4 py-2.5 text-[14px] text-[#F2E3B5]">{TIP[a.pattern] ?? TIP.unusual_pattern}</p>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

/* ============================================================ ESTIMATE */

const TASK_TYPES: TaskType[] = ["trenching", "loading", "grading", "dozing", "hauling"];
const SOILS: Soil[] = ["sand", "mixed", "clay", "rock"];
const WEATHERS: Weather[] = ["clear", "heat", "wind", "rain", "fog"];

function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: T[]; value: T; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[12px] font-medium tracking-wide text-muted">{label}</legend>
      <div className="relative flex rounded-xl bg-white/4 p-1">
        {options.map((o) => (
          <button key={o} onClick={() => onChange(o)} aria-pressed={value === o} className="relative z-10 h-10 flex-1 rounded-lg text-[14px] capitalize transition-colors" style={{ color: value === o ? "#14110a" : C.muted }}>
            {value === o ? <motion.span layoutId={`seg-${label}`} className="absolute inset-0 -z-10 rounded-lg bg-cat-500" transition={{ type: "spring", stiffness: 400, damping: 32 }} /> : null}
            {o}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function EstimateApp({ live, fleet }: AppProps) {
  const ambient = useHmiStore((s) => s.ambientC);
  const [taskType, setTaskType] = React.useState<TaskType>("trenching");
  const [soil, setSoil] = React.useState<Soil>("mixed");
  const [override, setOverride] = React.useState<Weather | null>(null);
  const [volume, setVolume] = React.useState(400);
  // Weather follows the site unless the operator picks one to plan with.
  const weather = override ?? live.weather;

  const conditions: TaskConditions = {
    taskType,
    machineModel: fleet.model.replace(/^CAT\s*/, ""),
    operatorSkill: fleet.operator?.skill ?? "intermediate",
    soil,
    weather,
    volumeM3: volume,
    operatorYears: fleet.operator?.years ?? 5,
    temperatureC: ambient,
    visibilityM: weather === "fog" ? 150 : weather === "rain" ? 600 : 2000,
    siteCongestion: 0.35,
    timeOfDay: Number(live.clock.slice(0, 2)) || 9,
    machineHealth: live.hydraulicC > 85 ? 0.55 : 0.9,
  };
  const est = predictTaskTime(conditions);

  return (
    <div>
      <SheetTitle title="Task time" detail="Predicted from past jobs on this site and live conditions" />
      <div className="grid grid-cols-[1fr_300px] gap-4">
        <Card className="space-y-5">
          <Segmented label="Job" options={TASK_TYPES} value={taskType} onChange={setTaskType} />
          <Segmented label="Soil" options={SOILS} value={soil} onChange={setSoil} />
          <Segmented label="Weather" options={WEATHERS} value={weather} onChange={setOverride} />
          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="est-volume" className="text-[12px] font-medium tracking-wide text-muted">
                Job size
              </label>
              <span className="text-[20px] font-light tabular-nums">{volume.toLocaleString()}</span>
            </div>
            <input id="est-volume" type="range" min={50} max={2000} step={50} value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="mt-2 w-full accent-cat-500" />
          </div>
        </Card>
        <Card>
          <Label>Most likely</Label>
          <p className="mt-1 text-[52px] font-extralight leading-none tracking-tight text-cat-500">{fmtMin(est.p50)}</p>
          <p className="mt-2 text-[13px] text-muted">
            80% range {fmtMin(est.p10)} – {fmtMin(est.p90)}
          </p>
          <p className="mt-1 text-[13px] text-muted">Planner {fmtMin(est.plannerMin)}</p>
          <ul className="mt-5 space-y-2.5">
            {est.reasons.map((r) => (
              <li key={r.feature} className="flex justify-between text-[14px]">
                <span className="text-zinc-300">{r.label}</span>
                <span className="tabular-nums" style={{ color: r.impactMin > 0 ? C.warn : C.ok }}>
                  {r.impactMin > 0 ? "+" : ""}
                  {r.impactMin}m
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

/* ============================================================ TRAINING */

const SLOT_TIMES = ["07:30", "12:30", "16:00"];
const INSTRUCTORS = ["A. Menon", "K. Rao", "S. Iyer"];

function LessonPlayer({ title, onClose }: { title: string; onClose: () => void }) {
  const chapters = ["Walk-around check", "Controls and interlocks", "Safe working practice", "Knowledge check"];
  const [t, setT] = React.useState(0);
  const [playing, setPlaying] = React.useState(true);
  React.useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setT((v) => Math.min(100, v + 0.8)), 100);
    return () => clearInterval(id);
  }, [playing]);
  const chapter = Math.min(chapters.length - 1, Math.floor((t / 100) * chapters.length));
  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-10 flex flex-col rounded-3xl bg-ink-900 p-6" role="dialog" aria-label={title}>
      <SheetTitle title={title} detail={`Chapter ${chapter + 1} of ${chapters.length}`} action={<Button onClick={onClose}>Close</Button>} />
      <div className="relative grid flex-1 place-items-center overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_30%_20%,#243044,#0b0e13_70%)]">
        <AnimatePresence mode="wait">
          <motion.p key={chapter} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="text-[34px] font-light text-white">
            {chapters[chapter]}
          </motion.p>
        </AnimatePresence>
        <Button onClick={() => setPlaying((p) => !p)} icon={playing ? Pause : CirclePlay} className="absolute bottom-4 left-4">
          {playing ? "Pause" : "Play"}
        </Button>
      </div>
      <Meter value={t / 100} className="mt-4" />
    </motion.div>
  );
}

export function TrainingApp({ onLaunchLesson }: AppProps) {
  const { data: modules } = useTraining();
  const [playing, setPlaying] = React.useState<string | null>(null);
  const [booked, setBooked] = React.useState<string | null>(null);
  const [days] = React.useState(() => {
    const out: string[] = [];
    for (let i = 1; i <= 3; i++) out.push(new Date(Date.now() + i * 86_400_000).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }));
    return out;
  });

  return (
    <div className="relative min-h-full">
      <SheetTitle title="Training" />
      <button onClick={onLaunchLesson} className="group relative mb-4 flex w-full items-center gap-5 overflow-hidden rounded-2xl bg-linear-to-r from-cat-500 to-status-warn p-5 text-left text-ink-950">
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-black/10">
          <Keyboard className="size-7" />
        </span>
        <span className="flex-1">
          <span className="block text-[20px] font-semibold">Guided lesson in the 3D simulator</span>
          <span className="block text-[14px] opacity-80">Arrow keys, 14 steps, checked by sensors, coached by the on-board AI</span>
        </span>
        <span className="text-[15px] font-semibold transition group-hover:translate-x-1">Start →</span>
      </button>
      <div className="grid grid-cols-[1.2fr_1fr] gap-4">
        <Card title="Video lessons" pad={false}>
          <ul className="px-2 pb-2 pt-2">
            {modules.slice(0, 4).map((m) => (
              <li key={m.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/3">
                <Ring value={m.progress / 100} size={40} stroke={4}>
                  <span className="text-[10px] tabular-nums">{Math.round(m.progress)}</span>
                </Ring>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-white">{m.title}</span>
                  <span className="text-[12px] text-muted">
                    {m.lessonsDone}/{m.lessons} lessons
                  </span>
                </span>
                <Button disabled={m.locked} icon={m.locked ? Lock : CirclePlay} onClick={() => setPlaying(m.title)} className="min-h-10">
                  {m.locked ? "Locked" : "Play"}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Book an instructor">
          <div className="space-y-2">
            {days.map((day, di) => (
              <div key={day} className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-[13px] text-muted">{day}</span>
                {SLOT_TIMES.map((time, ti) => {
                  const id = `${day} ${time}`;
                  const taken = (di + ti) % 4 === 1;
                  return (
                    <Button key={id} disabled={taken} variant={booked === id ? "selected" : "default"} onClick={() => setBooked(booked === id ? null : id)} className={cn("min-h-11 flex-1 px-1 tabular-nums", taken && "line-through")}>
                      {time}
                    </Button>
                  );
                })}
              </div>
            ))}
          </div>
          <p className="mt-4 flex items-center gap-2 text-[13px] text-zinc-300" role="status">
            <CalendarCheck className="size-4 text-muted" />
            {booked ? `Booked with ${INSTRUCTORS[booked.length % 3]}, ${booked}` : "Pick a free slot"}
          </p>
        </Card>
      </div>
      <AnimatePresence>{playing ? <LessonPlayer title={playing} onClose={() => setPlaying(null)} /> : null}</AnimatePresence>
    </div>
  );
}

/* ================================================================= LOG */

export function LogApp({ fleet }: AppProps) {
  const { data: machines, snapshot } = useFleet();
  return (
    <div>
      <SheetTitle title="Fleet log" detail="Live usage across the site" />
      <div className="overflow-hidden rounded-2xl border border-white/6">
        <table className="w-full text-left text-[14px] tabular-nums">
          <thead className="bg-white/3 text-[12px] text-muted">
            <tr>
              {["Machine", "Operator", "Engine h", "Fuel", "Cycles", "Idling", "Seatbelt", "Alerts"].map((h) => (
                <th key={h} className="px-3 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {machines.map((m) => {
              const alerts = snapshot.alerts.filter((a) => a.machineId === m.id && !a.resolvedAt).length;
              return (
                <tr key={m.id} className={cn("border-t border-white/5", m.id === fleet.id && "bg-cat-500/6")}>
                  <td className="px-3 py-2.5 text-white">{m.id}</td>
                  <td className="px-3 text-zinc-300">{m.operator?.name ?? "—"}</td>
                  <td className="px-3 text-zinc-300">{m.engineHours.toLocaleString()}</td>
                  <td className="px-3 text-zinc-300">{Math.round(m.fuelUsedL)} L</td>
                  <td className="px-3 text-zinc-300">{Math.round(m.loadCycles)}</td>
                  <td className="px-3" style={{ color: m.idleMinutes > 15 ? C.warn : "#C4CBD4" }}>
                    {Math.round(m.idleMinutes)}m
                  </td>
                  <td className="px-3">
                    <span className="flex items-center gap-2 text-zinc-300">
                      <Dot tone={m.seatbelt === "unfastened" ? "crit" : m.seatbelt === "fastened" ? "ok" : "off"} />
                      {m.seatbelt === "not_fitted" ? "n/a" : m.seatbelt}
                    </span>
                  </td>
                  <td className="px-3" style={{ color: alerts ? C.crit : C.dim }}>
                    {alerts || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
