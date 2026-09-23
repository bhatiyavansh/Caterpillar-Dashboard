"use client";

/**
 * The 2D command-centre overlay that frames the 3D world.
 *
 * The container is `pointer-events-none` so the mouse reaches the canvas for
 * orbit and zoom; individual panels opt back in.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { CameraMode, TelemetrySource } from "@/types/twin";
import { MACHINES } from "@/lib/twin/simulation";
import { activeKeys } from "@/lib/twin/controls";
import { useTwinStore } from "@/store/twinStore";

import { SafetyStatus } from "./SafetyStatus";
import { TelemetryPanel } from "./TelemetryPanel";
import { EventFeed } from "./EventFeed";
import { AlertOverlay } from "./AlertOverlay";
import { DirectorPanel } from "./DirectorPanel";
import { MachineLabels } from "./MachineLabel";

/* ------------------------------- brand -------------------------------- */

function Brand() {
  return (
    <div className="panel pointer-events-auto px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className="hazard-stripe block h-5 w-1.5 rounded-sm" aria-hidden />
        <div>
          <div className="text-sm font-bold leading-none tracking-[0.2em] text-cat-500">
            CAT COPILOT
          </div>
          <div className="mt-1 text-[11px] leading-none text-zinc-400">
            CHENNAI DEMO SITE
          </div>
        </div>
      </div>
      <div className="label-xs mt-2 border-t border-white/10 pt-2">Live digital twin</div>
    </div>
  );
}

/* ----------------------------- live badge ----------------------------- */

function LiveBadge() {
  const clock = useTwinStore((s) => s.snapshot.clock);
  const fps = useTwinStore((s) => s.snapshot.fps);
  const paused = useTwinStore((s) => s.snapshot.paused);
  const source = useTwinStore((s) => s.snapshot.source);

  return (
    <div className="panel pointer-events-auto flex items-center gap-3 px-3 py-2">
      <div>
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block size-2 rounded-full ${
              paused ? "bg-status-warn" : "bg-status-ok animate-pulse"
            }`}
          />
          <span className="text-[11px] font-bold tracking-[0.18em] text-zinc-100">
            {paused ? "PAUSED" : "LIVE"}
          </span>
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-wider text-zinc-500">
          ● {source === "keyboard" ? "connected" : "iot stream"}
        </div>
      </div>

      <div className="h-7 w-px bg-white/10" />

      <div className="text-right">
        <div className="font-mono text-[11px] leading-none tabular-nums text-zinc-200">
          {clock}
        </div>
        <div className="mt-1 font-mono text-[10px] leading-none tabular-nums text-zinc-500">
          {Math.round(fps)} fps
        </div>
      </div>
    </div>
  );
}

/* --------------------------- camera controls --------------------------- */

const CAMERA_MODES: { mode: CameraMode; label: string }[] = [
  { mode: "follow", label: "Follow machine" },
  { mode: "site", label: "Site overview" },
  { mode: "top", label: "Top down" },
  { mode: "driver", label: "Driver view" },
];

/** Horizontal camera bar — sits above the key hints so the columns stay short. */
function CameraBar() {
  const mode = useTwinStore((s) => s.cameraMode);
  const setMode = useTwinStore((s) => s.setCameraMode);
  const resetCamera = useTwinStore((s) => s.resetCamera);

  return (
    <div className="panel pointer-events-auto flex items-center gap-1.5 px-2 py-1.5">
      <span className="label-xs mr-1 hidden lg:block">Camera</span>
      {CAMERA_MODES.map((c) => (
        <button
          key={c.mode}
          type="button"
          onClick={() => setMode(c.mode)}
          aria-pressed={mode === c.mode}
          className={`rounded border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition ${
            mode === c.mode
              ? "border-cat-500/70 bg-cat-500/15 text-cat-500"
              : "border-white/12 text-zinc-300 hover:border-white/35 hover:bg-white/5"
          }`}
        >
          {c.label}
        </button>
      ))}
      <button
        type="button"
        onClick={resetCamera}
        className="rounded border border-white/12 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 transition hover:border-white/35 hover:bg-white/5"
      >
        Reset
      </button>
    </div>
  );
}

/* --------------------------- layers + source --------------------------- */

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-[11px] uppercase tracking-wider text-zinc-300 transition hover:bg-white/5"
    >
      <span>{label}</span>
      <span
        className={`relative h-3.5 w-7 shrink-0 rounded-full transition ${
          checked ? "bg-cat-500/80" : "bg-white/15"
        }`}
      >
        <span
          className={`absolute top-0.5 size-2.5 rounded-full bg-ink-950 transition-all ${
            checked ? "left-4" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}

function SceneLayers() {
  const showBubble = useTwinStore((s) => s.showBubble);
  const showPaths = useTwinStore((s) => s.showPaths);
  const setShowBubble = useTwinStore((s) => s.setShowBubble);
  const setShowPaths = useTwinStore((s) => s.setShowPaths);
  const source = useTwinStore((s) => s.snapshot.source);
  const setSource = useTwinStore((s) => s.setSource);
  const toggleDirector = useTwinStore((s) => s.toggleDirector);

  const sources: { id: TelemetrySource; label: string }[] = [
    { id: "keyboard", label: "Keyboard" },
    { id: "mock_iot", label: "Mock IoT" },
  ];

  return (
    <div className="panel pointer-events-auto p-2.5">
      <div className="label-xs mb-1.5">Layers</div>
      <Toggle label="Safety bubble" checked={showBubble} onChange={setShowBubble} />
      <Toggle label="Predicted paths" checked={showPaths} onChange={setShowPaths} />

      <div className="label-xs mb-1.5 mt-2.5 border-t border-white/10 pt-2.5">
        Simulation source
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {sources.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSource(s.id)}
            aria-pressed={source === s.id}
            className={`rounded border px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition ${
              source === s.id
                ? "border-cat-500/70 bg-cat-500/15 text-cat-500"
                : "border-white/12 text-zinc-300 hover:border-white/35 hover:bg-white/5"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={toggleDirector}
        className="mt-2 w-full rounded border border-white/12 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 transition hover:border-cat-500/60 hover:text-cat-500"
      >
        Director · Ctrl+D
      </button>
    </div>
  );
}

/* --------------------------- machine + task ---------------------------- */

function MachineCard() {
  const selectedId = useTwinStore((s) => s.selectedMachine);
  const select = useTwinStore((s) => s.selectMachine);
  const telemetry = useTwinStore((s) =>
    s.snapshot.machines.find((m) => m.machineId === selectedId),
  );
  const descriptor = MACHINES.find((m) => m.id === selectedId);
  if (!telemetry || !descriptor) return null;

  const stopped = telemetry.activity === "emergency_stop";

  return (
    <div className="panel-raised pointer-events-auto w-62 p-3">
      <div className="flex items-center gap-2.5">
        <span className="hazard-stripe block h-9 w-1.5 rounded-sm" aria-hidden />
        <div className="min-w-0">
          <div className="font-mono text-xl font-bold leading-none text-cat-500">
            {telemetry.machineId}
          </div>
          <div className="mt-1 text-[11px] leading-none text-zinc-400">
            {descriptor.model}
          </div>
        </div>
        <div
          className={`ml-auto text-right text-[11px] font-bold uppercase leading-none tracking-wider ${
            stopped ? "text-status-crit" : "text-cat-500"
          }`}
        >
          {telemetry.activity.replace("_", " ")}
        </div>
      </div>

      {/* machine selector */}
      <div className="mt-2.5 flex gap-1 border-t border-white/10 pt-2.5">
        {MACHINES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => select(m.id)}
            aria-pressed={m.id === selectedId}
            className={`flex-1 rounded border px-1 py-1 font-mono text-[10px] font-bold transition ${
              m.id === selectedId
                ? "border-cat-500/70 bg-cat-500/15 text-cat-500"
                : "border-white/12 text-zinc-400 hover:border-white/35 hover:text-zinc-200"
            }`}
          >
            {m.id}
          </button>
        ))}
      </div>
    </div>
  );
}

function TaskCard() {
  const task = useTwinStore((s) => s.snapshot.activeTask);
  const activity = useTwinStore((s) => s.snapshot.primary.activity);
  if (!task) return null;

  // Remaining work at the nominal 4.5%/s advance rate.
  const secondsLeft = Math.max(0, ((100 - task.progress) / 4.5) * 1000);
  const eta = new Date(Date.now() + secondsLeft * 1000);
  const etaLabel = eta.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const blocks = 16;
  const filled = Math.round((task.progress / 100) * blocks);

  return (
    <div className="panel-raised pointer-events-auto w-62 p-3">
      <div className="label-xs">Current task</div>
      <div className="mt-1 text-sm font-bold tracking-wider text-zinc-100">{task.name}</div>

      <div className="mt-2.5 flex items-center gap-2">
        <div
          className="font-mono text-[13px] leading-none tracking-tighter text-cat-500"
          aria-hidden
        >
          {"█".repeat(filled)}
          <span className="text-white/15">{"░".repeat(blocks - filled)}</span>
        </div>
        <span className="ml-auto font-mono text-sm font-bold tabular-nums text-zinc-100">
          {Math.round(task.progress)}%
        </span>
      </div>

      <div className="mt-2.5 flex items-baseline justify-between border-t border-white/10 pt-2">
        <div>
          <div className="label-xs leading-none">Status</div>
          <div className="mt-1 text-[11px] font-bold uppercase tracking-wider text-cat-500">
            {activity.replace("_", " ")}
          </div>
        </div>
        <div className="text-right">
          <div className="label-xs leading-none">ETA</div>
          <div className="mt-1 font-mono text-[11px] font-bold tabular-nums text-zinc-200">
            {etaLabel}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ key hints ------------------------------ */

const HINTS: { keys: string[]; codes: string[]; label: string }[] = [
  { keys: ["↑", "↓"], codes: ["ArrowUp", "ArrowDown"], label: "Drive" },
  { keys: ["←", "→"], codes: ["ArrowLeft", "ArrowRight"], label: "Steer" },
  { keys: ["⇧", "←→"], codes: [], label: "Swing" },
  { keys: ["W", "S"], codes: ["KeyW", "KeyS"], label: "Boom" },
  { keys: ["A", "D"], codes: ["KeyA", "KeyD"], label: "Stick" },
  { keys: ["Q", "E"], codes: ["KeyQ", "KeyE"], label: "Bucket" },
  { keys: ["SPACE"], codes: [], label: "E-stop" },
  { keys: ["R"], codes: [], label: "Reset" },
];

function KeyHints() {
  // Re-reads on the HUD tick, which is responsive enough to feel live.
  useTwinStore((s) => s.snapshot.tick);
  const pressed = activeKeys();

  return (
    <div className="panel pointer-events-auto flex items-center gap-3 px-3 py-2">
      {HINTS.map((hint) => {
        const active = hint.codes.some((c) => pressed.has(c));
        return (
          <div key={hint.label} className="flex items-center gap-1.5">
            <div className="flex gap-1">
              {hint.keys.map((k) => (
                <kbd
                  key={k}
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold transition ${
                    active
                      ? "border-cat-500 bg-cat-500/25 text-cat-500"
                      : "border-white/15 bg-white/5 text-zinc-400"
                  }`}
                >
                  {k}
                </kbd>
              ))}
            </div>
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">
              {hint.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------- first-run hint --------------------------- */

function StartHint() {
  const [dismissed, setDismissed] = useState(false);
  const moving = useTwinStore((s) => Math.abs(s.snapshot.primary.speed) > 0.3);

  useEffect(() => {
    if (moving) setDismissed(true);
  }, [moving]);

  return (
    <AnimatePresence>
      {dismissed ? null : (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="pointer-events-none rounded border border-cat-500/40 bg-ink-950/85 px-4 py-2 backdrop-blur-md"
        >
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-cat-500">
            Press ↑ to drive EXC001
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------ assembly ------------------------------- */

/**
 * Three flex columns rather than absolutely-positioned corners.
 *
 * Corner anchoring collided badly once the viewport got short — the telemetry
 * stack ran straight through the camera controls at 720p. As columns, the
 * flexible middle panels shrink and scroll instead of overlapping.
 */
export function CommandCenter() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex select-none gap-3 p-4">
      {/* machine tags project onto this layer from inside the Canvas */}
      <MachineLabels />

      {/* ---------------- left ---------------- */}
      <div className="relative z-10 flex w-62 shrink-0 flex-col gap-3">
        <Brand />
        <div className="min-h-0 flex-1 overflow-hidden">
          <EventFeed />
        </div>
        <TaskCard />
        <MachineCard />
      </div>

      {/* ---------------- centre ---------------- */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col items-center gap-3">
        <SafetyStatus />
        <AlertOverlay />
        <div className="mt-auto flex flex-col items-center gap-2">
          <StartHint />
          <CameraBar />
          <KeyHints />
        </div>
      </div>

      {/* ---------------- right ---------------- */}
      <div className="relative z-10 flex w-67 shrink-0 flex-col items-end gap-3">
        <LiveBadge />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <TelemetryPanel />
        </div>
        <SceneLayers />
      </div>

      {/* director drawer floats over the right column */}
      <div className="absolute right-4 top-4 z-30">
        <DirectorPanel />
      </div>
    </div>
  );
}
