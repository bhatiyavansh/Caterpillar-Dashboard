"use client";

/**
 * The cab's two live panels: the site assistant and the rear camera.
 *
 * Both host work owned by other tracks — the voice assistant and the browser
 * person detector — inside product chrome that stays put whether or not those
 * pieces are available. Each degrades to a useful resting state rather than an
 * error, because a camera that will not start must never take the cab HMI down
 * mid-demo.
 */
import * as React from "react";
import dynamic from "next/dynamic";
import { motion } from "motion/react";
import { Camera, CameraOff, Mic, ShieldAlert, ShieldCheck, Volume2 } from "lucide-react";
import type { ProximityLevel } from "@/lib/api/contracts";
import { PROXIMITY } from "@/lib/status";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { CvProximityEvent } from "@web/components/cv";
import { publishCvEvent } from "@web/lib/cv";

export type AvatarState = "idle" | "listening" | "thinking" | "talking" | "alert";

/** Browser-only: both reach for `navigator`, so neither can render on the server. */
const Avatar2D = dynamic(() => import("@web/components/avatar").then((m) => m.Avatar2D), {
  ssr: false,
  loading: () => <div className="size-16 shrink-0 rounded-full border-2 border-white/15 bg-ink-900" />,
});

const PersonDetector = dynamic(() => import("@web/components/cv").then((m) => m.PersonDetector), {
  ssr: false,
  loading: () => <div className="aspect-video w-full bg-ink-950" />,
});

const AVATAR_COPY: Record<AvatarState, { label: string; text: string }> = {
  idle: { label: "Ready", text: "text-muted" },
  listening: { label: "Listening", text: "text-status-info" },
  thinking: { label: "Thinking", text: "text-cat-500" },
  talking: { label: "Speaking", text: "text-cat-500" },
  alert: { label: "Alerting", text: "text-status-crit" },
};

export function AvatarSlot({
  state,
  message,
  onPushToTalk,
  className,
}: {
  state: AvatarState;
  /** The last thing the assistant said, so the panel is useful when silent. */
  message: string;
  onPushToTalk?: () => void;
  className?: string;
}) {
  const copy = AVATAR_COPY[state];
  const speaking = state === "talking";

  return (
    <section
      className={cn("flex min-h-0 flex-col overflow-hidden rounded border border-white/10 bg-ink-850", className)}
      aria-label="Site assistant"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="label-xs">Site assistant</span>
        <span className={cn("inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider", copy.text)}>
          <span className={cn("size-1.5 rounded-full", state === "idle" ? "bg-zinc-500" : "bg-current")} aria-hidden />
          {copy.label}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-center gap-3 p-3">
        <Avatar2D state={state} size={64} label={false} />

        <div className="min-w-0 flex-1">
          <p className="line-clamp-4 text-xs leading-relaxed text-zinc-200">{message}</p>
          {speaking ? (
            <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-cat-500">
              <Volume2 className="size-3" aria-hidden />
              Speaking
            </span>
          ) : null}
        </div>
      </div>

      {onPushToTalk ? (
        <div className="shrink-0 border-t border-white/10 p-2">
          <Button variant="secondary" size="touch" className="w-full" onClick={onPushToTalk}>
            <Mic className="size-5" aria-hidden />
            Hold to ask
          </Button>
        </div>
      ) : null}
    </section>
  );
}

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
          <PersonDetector
            machineId={machineId}
            onEvent={handleEvent}
            enabled={cameraOn}
            className="absolute inset-0 size-full"
          />
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
    </section>
  );
}
