"use client";

/**
 * Integration slots for work owned by other tracks.
 *
 * Each slot renders a real, working resting state and documents the exact
 * component that replaces it. That way the cab is never broken-looking while
 * the avatar and the webcam detector are still being built, and dropping them
 * in is a one-line change.
 */
import * as React from "react";
import { motion } from "motion/react";
import { Camera, CameraOff, Mic, ShieldAlert, ShieldCheck, Volume2 } from "lucide-react";
import type { ProximityLevel } from "@/lib/api/contracts";
import { PROXIMITY } from "@/lib/status";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export type AvatarState = "idle" | "listening" | "thinking" | "talking" | "alert";

const AVATAR_COPY: Record<AvatarState, { label: string; ring: string; text: string }> = {
  idle: { label: "Ready", ring: "border-white/15", text: "text-muted" },
  listening: { label: "Listening", ring: "border-status-info/60", text: "text-status-info" },
  thinking: { label: "Thinking", ring: "border-cat-500/60", text: "text-cat-500" },
  talking: { label: "Speaking", ring: "border-cat-500", text: "text-cat-500" },
  alert: { label: "Alerting", ring: "border-status-crit", text: "text-status-crit" },
};

/**
 * Where the 3D Caterpillar avatar mounts.
 *
 * Replace the inner block with the avatar component; keep the frame, the state
 * pill and the push-to-talk control so the cab layout does not shift.
 */
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
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="label-xs">Site assistant</span>
        <span className={cn("inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider", copy.text)}>
          <span className={cn("size-1.5 rounded-full", state === "idle" ? "bg-zinc-500" : "bg-current")} aria-hidden />
          {copy.label}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-center gap-3 p-3">
        {/* Avatar mount point */}
        <div
          className={cn(
            "relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-full border-2 bg-ink-900",
            copy.ring,
          )}
        >
          <span className="text-2xl" aria-hidden>
            👷
          </span>
          {speaking ? (
            <motion.span
              aria-hidden
              className="absolute inset-0 rounded-full border-2 border-cat-500"
              animate={{ scale: [1, 1.18, 1], opacity: [0.8, 0, 0.8] }}
              transition={{ duration: 1.4, repeat: Infinity }}
            />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <p className="line-clamp-3 text-xs leading-relaxed text-zinc-200">{message}</p>
          {speaking ? (
            <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-cat-500">
              <Volume2 className="size-3" aria-hidden />
              Speaking
            </span>
          ) : null}
        </div>
      </div>

      {onPushToTalk ? (
        <div className="border-t border-white/10 p-2">
          <Button variant="secondary" size="touch" className="w-full" onClick={onPushToTalk}>
            <Mic className="size-5" aria-hidden />
            Hold to ask
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Where the browser person-detection view mounts.
 *
 * Replace the video placeholder with the webcam canvas. The detection readout
 * below it is driven by machine telemetry, so it stays correct whether the
 * detection comes from the camera or from the simulator.
 */
export function WebcamSlot({
  level,
  distanceM,
  zone,
  cameraOn,
  onToggleCamera,
  className,
}: {
  level: ProximityLevel;
  distanceM: number | null;
  zone: string | null;
  cameraOn: boolean;
  onToggleCamera: () => void;
  className?: string;
}) {
  const token = PROXIMITY[level];
  const detected = level !== "safe" && distanceM !== null;

  return (
    <section
      className={cn("flex flex-col overflow-hidden rounded border bg-ink-850", detected ? token.border : "border-white/10", className)}
      aria-label="Person detection"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="label-xs">Person detection</span>
        <button
          onClick={onToggleCamera}
          className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted hover:text-zinc-200"
          aria-pressed={cameraOn}
        >
          {cameraOn ? <Camera className="size-3" aria-hidden /> : <CameraOff className="size-3" aria-hidden />}
          {cameraOn ? "Rear camera" : "Camera off"}
        </button>
      </div>

      {/* Camera mount point */}
      <div className="relative aspect-video w-full overflow-hidden bg-ink-950">
        <div
          className="absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 3px)",
          }}
          aria-hidden
        />
        <div className="absolute inset-0 grid place-items-center">
          {cameraOn ? (
            detected ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="rounded border-2 border-status-crit px-8 py-10"
              >
                <span className="absolute -mt-7 rounded bg-status-crit px-1.5 py-0.5 text-[10px] font-bold text-white">
                  PERSON {distanceM?.toFixed(1)}m
                </span>
              </motion.div>
            ) : (
              <span className="text-[11px] text-muted">Rear view clear</span>
            )
          ) : (
            <span className="text-[11px] text-muted">Camera off</span>
          )}
        </div>
        <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-300">
          Rear · 120&deg;
        </span>
      </div>

      <div className={cn("flex items-center gap-2.5 px-3 py-2.5", detected && token.bg)}>
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
