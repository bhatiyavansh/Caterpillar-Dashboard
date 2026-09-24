"use client";

import * as React from "react";
import { motion } from "motion/react";
import { CircleDot, TriangleAlert } from "lucide-react";
import { cameraDetections } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { getStreamStore } from "@web/lib/stream";
import { PRIMARY_MACHINE_ID } from "@/lib/api/seed";
import { useMachineStore } from "@/store/machine-store";
import { detectionsFrom, type CameraView, type Detection } from "@/lib/hmi/camera";
import { ScreenPad } from "../touch";

const VIEWS = [
  { id: "front", label: "Front" },
  { id: "rear", label: "Rear" },
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "360", label: "360°" },
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

type DetectionMap = Record<CameraView, Omit<Detection, "kind">[]>;

/**
 * Live detections from site positions while the hub is streaming; the demo
 * overlays otherwise.
 *
 * Sampled at 4 Hz rather than subscribed: the stream can run at 60 Hz, and a
 * camera overlay gains nothing from re-rendering that often.
 */
function useDetections(): { detections: DetectionMap; live: boolean } {
  const backendConnected = useMachineStore((s) => s.backendConnected);
  const [live, setLive] = React.useState<DetectionMap | null>(null);

  React.useEffect(() => {
    if (!backendConnected) return;
    const sample = () => {
      const state = getStreamStore().getState();
      const self = state.machines[PRIMARY_MACHINE_ID];
      if (!self) return;
      setLive(detectionsFrom(self, Object.values(state.machines), Object.values(state.workers)));
    };
    sample();
    const id = window.setInterval(sample, 250);
    return () => window.clearInterval(id);
  }, [backendConnected]);

  if (backendConnected && live) return { detections: live, live: true };
  return { detections: cameraDetections as DetectionMap, live: false };
}

/** Mock camera feed — a stylised scene rather than video, but laid out with the
 * same overlays a real vision system would draw. */
function Scene({ view, detections, live }: { view: ViewId; detections: DetectionMap[CameraView]; live: boolean }) {

  return (
    <div className="relative h-full w-full overflow-hidden rounded bg-gradient-to-b from-[#20303f] via-[#2c2b24] to-[#1a1712]">
      {/* sky / horizon */}
      <div className="absolute inset-x-0 top-0 h-[42%] bg-gradient-to-b from-[#31506b] to-[#6b6a55]" />
      <div className="absolute inset-x-0 top-[42%] h-px bg-white/25" />

      {/* ground texture */}
      <div
        className="absolute inset-x-0 bottom-0 h-[58%] opacity-40"
        style={{
          backgroundImage:
            "repeating-linear-gradient(115deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 22px)",
        }}
      />

      {/* spoil piles */}
      <div className="absolute bottom-[18%] left-[8%] h-24 w-56 rounded-t-[60%] bg-[#4a3f2c]" />
      <div className="absolute bottom-[14%] right-[10%] h-20 w-48 rounded-t-[60%] bg-[#433a29]" />

      {/* machine boundary + safety zones */}
      {view !== "360" ? (
        <>
          <div className="absolute inset-x-[18%] bottom-0 h-[26%] rounded-t-xl border-2 border-cat-500/70 bg-cat-500/5" />
          <div className="absolute inset-x-[8%] bottom-[24%] h-[16%] border-2 border-dashed border-status-warn/60" />
          <span className="absolute bottom-[41%] left-[9%] rounded bg-ink-950/80 px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest text-status-warn">
            Caution zone · 5 m
          </span>
        </>
      ) : (
        <>
          <div className="absolute left-1/2 top-1/2 size-56 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-status-warn/50" />
          <div className="absolute left-1/2 top-1/2 size-36 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cat-500/70 bg-cat-500/10" />
          <div className="absolute left-1/2 top-1/2 h-20 w-12 -translate-x-1/2 -translate-y-1/2 rounded bg-cat-500/80" />
        </>
      )}

      {/* detections */}
      {detections.map((d) => (
        <motion.div
          key={d.label + d.x}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute"
          style={{ left: `${d.x}%`, top: `${d.y}%` }}
        >
          <div
            className={cn(
              "flex h-24 w-16 -translate-x-1/2 -translate-y-1/2 items-end justify-center rounded border-2",
              d.critical ? "border-status-crit bg-status-crit/15" : "border-status-info bg-status-info/10",
            )}
          >
            <span
              className={cn(
                "mb-[-26px] whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-black uppercase tracking-wider",
                d.critical ? "bg-status-crit text-white" : "bg-status-info text-ink-950",
              )}
            >
              {d.label} · {d.distance} m
            </span>
          </div>
        </motion.div>
      ))}

      {/* scan sweep */}
      <motion.div
        className="pointer-events-none absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-cat-500/10 to-transparent"
        animate={{ y: ["-10%", "110%"] }}
        transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
      />

      <span
        className={cn(
          "absolute left-3 top-3 inline-flex items-center gap-2 rounded bg-ink-950/75 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em]",
          live ? "text-status-crit" : "text-zinc-400",
        )}
      >
        <CircleDot className="size-3.5" aria-hidden />
        {/* Honest about the source: boxes come from positioning, not video. */}
        {live ? "Live · site positioning" : "Demo overlay"}
      </span>
    </div>
  );
}

export function CameraScreen() {
  const [view, setView] = React.useState<ViewId>("front");
  const { detections: all, live } = useDetections();
  const detections = all[view] ?? [];
  const critical = detections.find((d) => d.critical);

  return (
    <ScreenPad className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            aria-pressed={view === v.id}
            className={cn(
              "min-h-14 min-w-24 rounded px-5 text-base font-bold uppercase tracking-[0.1em] transition-colors",
              view === v.id ? "bg-cat-500 text-ink-950" : "border border-white/12 bg-white/6 text-zinc-200 hover:bg-white/12",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="relative min-h-[260px] flex-1">
        <Scene view={view} detections={detections} live={live} />
        {critical ? (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute inset-x-3 top-3 flex items-center gap-4 rounded border-2 border-status-crit bg-status-crit/90 px-5 py-4"
          >
            <TriangleAlert className="size-9 shrink-0 text-white" aria-hidden />
            <div>
              <p className="text-xl font-black uppercase tracking-[0.1em] text-white">Object detected</p>
              <p className="text-base font-semibold text-white/90">
                {critical.label} · {critical.distance} m — stop slewing until clear
              </p>
            </div>
          </motion.div>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {detections.length === 0 ? (
          <p className="rounded border border-white/10 bg-ink-900 px-4 py-3 text-sm text-muted sm:col-span-3">
            No objects detected in this view.
          </p>
        ) : (
          detections.map((d) => (
            <div
              key={d.label + d.x}
              className={cn(
                "rounded border bg-ink-900 px-4 py-3",
                d.critical ? "border-status-crit/50" : "border-white/12",
              )}
            >
              <p className="label-xs">{d.critical ? "Hazard" : "Object"}</p>
              <p className="text-lg font-bold text-zinc-100">{d.label}</p>
              <p className={cn("font-mono text-2xl font-bold", d.critical ? "text-status-crit" : "text-zinc-300")}>
                {d.distance.toFixed(1)} m
              </p>
            </div>
          ))
        )}
      </div>
    </ScreenPad>
  );
}
