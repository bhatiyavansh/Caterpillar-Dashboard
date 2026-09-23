"use client";

/**
 * The cab's rear camera panel.
 *
 * Hosts work owned by another track — the browser person and fatigue
 * detectors — inside product chrome that stays put whether or not the models
 * have loaded. It degrades to a useful resting state rather than an error,
 * because a camera that will not start must never take the cab HMI down
 * mid-demo.
 *
 * The site assistant used to live here too, as a scripted one-line message
 * with a mic button wired to nothing. It is now `AssistantPanel`
 * (`@/components/assistant/assistant-panel`), a real conversation backed by
 * the same `useVoice`/`useAssistant` stack this file already used for its
 * state names — that capability existed all along, just not reachable from
 * this screen.
 *
 * `FatigueDetector` was in the same position: fully built (MediaPipe face
 * landmarker, times eyes-closed duration, fires `fatigue_alert`) but never
 * mounted anywhere. It runs headless here (`showVideo={false}`) off the same
 * shared camera stream `useWebcam` already ref-counts for `PersonDetector`,
 * so there is still exactly one permission prompt and one visible feed.
 */
import * as React from "react";
import dynamic from "next/dynamic";
import { motion } from "motion/react";
import { Camera, CameraOff, Eye, EyeOff, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ProximityLevel } from "@/lib/api/contracts";
import { PROXIMITY, MACHINE_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { CvFatigueEvent, CvProximityEvent } from "@web/components/cv";
import { publishCvEvent } from "@web/lib/cv";

const PersonDetector = dynamic(() => import("@web/components/cv").then((m) => m.PersonDetector), {
  ssr: false,
  loading: () => <div className="aspect-video w-full bg-ink-950" />,
});

const FatigueDetector = dynamic(() => import("@web/components/cv").then((m) => m.FatigueDetector), {
  ssr: false,
  loading: () => null,
});

/** How long a fatigue alert stays shown after the last eyes-closed event. */
const FATIGUE_ALERT_HOLD_MS = 8000;

export function WebcamSlot({
  machineId,
  level,
  distanceM,
  zone,
  cameraOn,
  onToggleCamera,
  onDetection,
  className,
}: {
  machineId: string;
  level: ProximityLevel;
  distanceM: number | null;
  zone: string | null;
  cameraOn: boolean;
  onToggleCamera: () => void;
  /** Raised when the browser detector sees somebody. */
  onDetection?: (e: CvProximityEvent) => void;
  className?: string;
}) {
  const token = PROXIMITY[level];
  const detected = level !== "safe" && distanceM !== null;

  // A detection is a site event, not a cab-local one: publish it to the hub so the command
  // centre, the twin, the alert ribbon, the database and the assistant all see it too. The
  // local callback still fires first, so this panel never waits on the network.
  const lastSeverity = React.useRef<string | null>(null);
  const handleEvent = React.useCallback(
    (e: CvProximityEvent) => {
      onDetection?.(e);
      const escalated = lastSeverity.current !== null && lastSeverity.current !== e.severity;
      lastSeverity.current = e.severity;
      void publishCvEvent(
        {
          event: e.event,
          severity: e.severity,
          machine_id: e.machine_id,
          message: e.message,
          data: e.data,
        },
        { force: escalated },
      );
    },
    [onDetection],
  );

  // Fatigue has no simulated channel to fall back to the way proximity does from
  // machine.proximity — this reflects only what the browser detector itself has
  // seen, and clears itself out after a hold so a one-off blink does not stick.
  const [fatigue, setFatigue] = React.useState<{ eyesClosedS: number; at: number } | null>(null);
  const handleFatigueEvent = React.useCallback((e: CvFatigueEvent) => {
    setFatigue({ eyesClosedS: e.data.eyes_closed_s, at: Date.now() });
    void publishCvEvent({
      event: e.event,
      severity: e.severity,
      machine_id: e.machine_id,
      message: e.message,
      data: e.data,
    });
  }, []);
  React.useEffect(() => {
    if (!fatigue) return;
    const timer = setTimeout(() => setFatigue(null), FATIGUE_ALERT_HOLD_MS);
    return () => clearTimeout(timer);
  }, [fatigue]);
  const fatigueActive = fatigue !== null;

  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden rounded border bg-ink-850",
        detected ? token.border : "border-white/10",
        className,
      )}
      aria-label="Person detection"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="label-xs">Person detection</span>
        <button
          onClick={onToggleCamera}
          className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted transition-colors hover:text-zinc-200"
          aria-pressed={cameraOn}
        >
          {cameraOn ? <Camera className="size-3" aria-hidden /> : <CameraOff className="size-3" aria-hidden />}
          {cameraOn ? "Rear camera" : "Camera off"}
        </button>
      </div>

      <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-ink-950">
        {cameraOn ? (
          <>
            <PersonDetector
              machineId={machineId}
              onEvent={handleEvent}
              enabled={cameraOn}
              className="absolute inset-0 size-full"
            />
            {/* Headless: same shared camera stream, no second video feed to fit. */}
            <FatigueDetector machineId={machineId} onEvent={handleFatigueEvent} showVideo={false} enabled={cameraOn} />
          </>
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            <span className="text-[11px] text-muted">Camera off</span>
          </div>
        )}

        {/* Simulator-driven detections still need to read on screen when the
            camera is off or the model could not load. */}
        {detected && !cameraOn ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            className="pointer-events-none absolute inset-0 grid place-items-center"
          >
            <span className="rounded border-2 border-status-crit px-10 py-12" />
            <span className="absolute rounded bg-status-crit px-1.5 py-0.5 text-[10px] font-bold text-white">
              PERSON {distanceM?.toFixed(1)}m
            </span>
          </motion.div>
        ) : null}

        <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-300">
          Rear · 120&deg;
        </span>
      </div>

      <div className={cn("flex shrink-0 items-center gap-2.5 px-3 py-2.5", detected && token.bg)}>
        <span className={cn("shrink-0", token.text)}>
          {detected ? <ShieldAlert className="size-5" aria-hidden /> : <ShieldCheck className="size-5" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("text-xs font-bold uppercase tracking-wider", token.text)}>
            {detected ? "Person detected" : "Clear"}
          </p>
          <p className="truncate text-[11px] text-muted">
            {detected ? `${distanceM?.toFixed(1)} m ${zone ?? "near"} of the machine` : "No person inside the work envelope"}
          </p>
        </div>
        {detected ? (
          <span className={cn("shrink-0 font-mono text-xl font-bold tabular-nums", token.text)}>
            {distanceM?.toFixed(1)}m
          </span>
        ) : null}
      </div>

      {cameraOn ? (
        <div
          className={cn(
            "flex shrink-0 items-center gap-2.5 border-t border-white/10 px-3 py-2",
            fatigueActive && MACHINE_STATUS.critical.bg,
          )}
        >
          <span className={cn("shrink-0", fatigueActive ? MACHINE_STATUS.critical.text : "text-muted")}>
            {fatigueActive ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "text-[11px] font-bold uppercase tracking-wider",
                fatigueActive ? MACHINE_STATUS.critical.text : "text-zinc-300",
              )}
            >
              {fatigueActive ? "Fatigue detected" : "Fatigue monitor"}
            </p>
            <p className="truncate text-[10px] text-muted">
              {fatigueActive ? `Eyes closed ${fatigue?.eyesClosedS.toFixed(1)} s — take a break` : "Watching for microsleep"}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
