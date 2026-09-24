"use client";

/**
 * The cab's two camera panels.
 *
 * A real machine has two distinct cameras doing two distinct jobs: one
 * mounted rear-facing for the blind spot, one facing the operator for
 * fatigue. This demo has exactly one physical webcam, so both panels read
 * from the same `useWebcam` stream (ref-counted, so opening both still asks
 * for camera permission once) — but they are genuinely two independent
 * detectors, each with its own model, its own video preview and its own
 * status, not one feed doing double duty. Splitting them into separate
 * sections is what makes that legible: the operator can see that proximity
 * and fatigue are two different things being watched, not one generic
 * "camera" block.
 *
 * Both degrade to a useful resting state rather than an error, because a
 * camera that will not start must never take the cab HMI down mid-demo.
 *
 * The site assistant used to live in this file too, as a scripted one-line
 * message with a mic button wired to nothing. It is now `AssistantPanel`
 * (`@/components/assistant/assistant-panel`), a real conversation backed by
 * the same `useVoice`/`useAssistant` stack this file already used for its
 * state names — that capability existed all along, just not reachable from
 * this screen.
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
  loading: () => <div className="absolute inset-0 bg-ink-950" />,
});

const FatigueDetector = dynamic(() => import("@web/components/cv").then((m) => m.FatigueDetector), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-ink-950" />,
});

/** How long a fatigue alert stays shown after the last eyes-closed event. */
const FATIGUE_ALERT_HOLD_MS = 8000;

/** Shared chrome for a camera panel: label, on/off toggle, video area, status footer. */
function CameraPanel({
  label,
  badge,
  cameraOn,
  onToggleCamera,
  statusIcon,
  statusTone,
  statusLabel,
  statusDetail,
  trailing,
  children,
  className,
}: {
  label: string;
  /** Small tag over the video, e.g. "Rear · 120°" or "Front · driver". */
  badge: string;
  cameraOn: boolean;
  onToggleCamera: () => void;
  statusIcon: React.ReactNode;
  statusTone: "ok" | "critical";
  statusLabel: string;
  statusDetail: string;
  /** Right-aligned reading, e.g. a distance in metres. */
  trailing?: React.ReactNode;
  /** The detector, rendered only while the camera is on. */
  children: React.ReactNode;
  className?: string;
}) {
  const alerting = statusTone === "critical";
  const token = alerting ? MACHINE_STATUS.critical : MACHINE_STATUS.operating;

  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border bg-ink-850",
        alerting ? token.border : "border-white/10",
        className,
      )}
      aria-label={label}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-2.5 py-1.5">
        <span className="label-xs truncate">{label}</span>
        <button
          onClick={onToggleCamera}
          className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted transition-colors hover:text-zinc-200"
          aria-pressed={cameraOn}
        >
          {cameraOn ? <Camera className="size-3" aria-hidden /> : <CameraOff className="size-3" aria-hidden />}
        </button>
      </div>

      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-ink-950">
        {cameraOn ? (
          // Centred and inset so the detector's own status chip ("camera
          // unavailable") never sits under the camera badge.
          <div className="absolute inset-0 flex items-center justify-center px-2 pb-2 pt-7 [&>*]:w-full">{children}</div>
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            <span className="text-[11px] text-muted">Camera off</span>
          </div>
        )}
        <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-300">
          {badge}
        </span>
      </div>

      <div className={cn("flex shrink-0 items-center gap-2 px-2.5 py-2", alerting && token.bg)}>
        <span className={cn("shrink-0", alerting ? token.text : "text-muted")}>{statusIcon}</span>
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-[11px] font-bold uppercase tracking-wider", alerting ? token.text : "text-zinc-300")}>
            {statusLabel}
          </p>
          <p className="truncate text-[10px] text-muted">{statusDetail}</p>
        </div>
        {trailing}
      </div>
    </section>
  );
}

export function RearCameraPanel({
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

  return (
    <CameraPanel
      label="Rear camera"
      badge="Rear · 120°"
      cameraOn={cameraOn}
      onToggleCamera={onToggleCamera}
      statusIcon={detected ? <ShieldAlert className="size-4" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
      statusTone={detected ? "critical" : "ok"}
      statusLabel={detected ? "Person detected" : "Clear"}
      statusDetail={detected ? `${distanceM?.toFixed(1)} m ${zone ?? "near"} of the machine` : "No person behind the machine"}
      trailing={
        detected ? (
          <span className="shrink-0 font-mono text-base font-bold tabular-nums text-status-crit">
            {distanceM?.toFixed(1)}m
          </span>
        ) : null
      }
      className={className}
    >
      <PersonDetector machineId={machineId} onEvent={handleEvent} enabled={cameraOn} className="absolute inset-0 size-full" />
      {/* Simulator-driven detections still need to read on screen when the model has not loaded. */}
      {detected ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          className="pointer-events-none absolute inset-0 grid place-items-center"
        >
          <span className="rounded border-2 border-status-crit px-6 py-8" />
        </motion.div>
      ) : null}
    </CameraPanel>
  );
}

export function FrontCameraPanel({
  machineId,
  cameraOn,
  onToggleCamera,
  onDetection,
  className,
}: {
  machineId: string;
  cameraOn: boolean;
  onToggleCamera: () => void;
  /** Raised on a microsleep or when drowsiness builds up (see FatigueDetector). */
  onDetection?: (e: CvFatigueEvent) => void;
  className?: string;
}) {
  // Fatigue has no simulated channel to fall back to the way proximity falls back to
  // machine.proximity — this reflects only what the browser detector itself has seen,
  // and clears itself out after a hold once the detector stops re-raising it.
  const [fatigue, setFatigue] = React.useState<{ data: CvFatigueEvent["data"]; at: number } | null>(null);
  const handleEvent = React.useCallback(
    (e: CvFatigueEvent) => {
      onDetection?.(e);
      setFatigue({ data: e.data, at: Date.now() });
      void publishCvEvent(
        {
          event: e.event,
          severity: e.severity,
          machine_id: e.machine_id,
          message: e.message,
          data: e.data,
        },
        // A microsleep is always news, even seconds after the last one.
        { force: e.severity === "critical" },
      );
    },
    [onDetection],
  );
  React.useEffect(() => {
    if (!fatigue) return;
    const timer = setTimeout(() => setFatigue(null), FATIGUE_ALERT_HOLD_MS);
    return () => clearTimeout(timer);
  }, [fatigue]);
  const alerting = fatigue !== null;

  return (
    <CameraPanel
      label="Front camera"
      badge="Front · driver"
      cameraOn={cameraOn}
      onToggleCamera={onToggleCamera}
      statusIcon={alerting ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      statusTone={alerting ? "critical" : "ok"}
      statusLabel={fatigue ? (fatigue.data.condition === "microsleep" ? "Microsleep detected" : "Drowsiness building") : "Monitoring"}
      statusDetail={
        !fatigue
          ? "Watching for microsleep and drowsiness"
          : fatigue.data.condition === "microsleep"
            ? `Eyes closed ${fatigue.data.eyes_closed_s.toFixed(1)} s — stop and take a break`
            : fatigue.data.perclos !== null
              ? `Eyes closed ${Math.round(fatigue.data.perclos * 100)}% of the last minute — plan a break`
              : `${fatigue.data.long_blinks_60s} long blinks in the last minute — plan a break`
      }
      className={className}
    >
      <FatigueDetector machineId={machineId} onEvent={handleEvent} showVideo enabled={cameraOn} className="absolute inset-0 size-full" />
    </CameraPanel>
  );
}
