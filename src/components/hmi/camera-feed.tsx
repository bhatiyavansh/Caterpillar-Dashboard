"use client";

/**
 * Operator camera view: the live feed, with the face box and any phone the
 * detector finds drawn over it, and one chip per check.
 */
import * as React from "react";
import { Camera, CameraOff, ScanFace } from "lucide-react";
import { useWebcam } from "@web/components/cv/useWebcam";
import { DMS_THRESHOLDS } from "@web/components/cv/operator-monitor";
import { CAMERA_CHECKS, cameraActive, useHmiStore } from "@/lib/hmi/hmi-store";
import { cameraOverlay } from "@/lib/hmi/use-operator-camera";
import { cn } from "@/lib/utils";
import { Button, C, Dot } from "./hmi-ui";

function Overlay({ active }: { active: boolean }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = ref.current;
      if (!cv) return;
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (cv.width !== w) cv.width = w;
      if (cv.height !== h) cv.height = h;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      const f = cameraOverlay.face;
      if (f) {
        const x = f.x * w;
        const y = f.y * h;
        const bw = f.w * w;
        const bh = f.h * h;
        const color = active ? C.crit : cameraOverlay.eyesClosed ? C.warn : C.cyan;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        const k = Math.min(bw, bh) * 0.22;
        // Corner brackets rather than a full box.
        for (const [cx, cy, dx, dy] of [
          [x, y, 1, 1],
          [x + bw, y, -1, 1],
          [x, y + bh, 1, -1],
          [x + bw, y + bh, -1, -1],
        ] as const) {
          ctx.beginPath();
          ctx.moveTo(cx + dx * k, cy);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx, cy + dy * k);
          ctx.stroke();
        }
        // Gaze direction tick.
        ctx.beginPath();
        ctx.moveTo(x + bw / 2, y - 8);
        ctx.lineTo(x + bw / 2 + cameraOverlay.yaw * bw * 0.5, y - 8);
        ctx.stroke();
      }
      for (const o of cameraOverlay.objects) {
        if (o.label !== "cell phone") continue;
        ctx.strokeStyle = C.crit;
        ctx.lineWidth = 2;
        ctx.strokeRect(o.x * w, o.y * h, o.w * w, o.h * h);
        ctx.fillStyle = C.crit;
        ctx.font = "600 12px sans-serif";
        ctx.fillText("PHONE", o.x * w + 4, o.y * h - 6);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  // Mirrored like the video, so the overlay lines up with a selfie view.
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 size-full -scale-x-100" aria-hidden />;
}

const FAILED: Partial<Record<string, string>> = {
  denied: "Camera permission denied. Allow camera access for this site in the browser, then turn the camera off and on.",
  unavailable: "No camera available, or another app is using it.",
  error: "The vision model failed to load. Check the network connection and try again.",
};

function Reading({ label, value, tone }: { label: string; value: string; tone?: "warn" | "crit" }) {
  return (
    <div className="rounded-lg bg-white/4 px-2.5 py-2">
      <p className="text-[11px] text-[#8E98A6]">{label}</p>
      <p className="text-[15px] tabular-nums" style={{ color: tone === "crit" ? C.crit : tone === "warn" ? C.warn : C.text }}>
        {value}
      </p>
    </div>
  );
}

/** What the driver-monitoring engine is measuring right now. */
function Readings() {
  const m = useHmiStore((s) => s.camera.metrics);
  const running = useHmiStore((s) => s.camera.status === "running");
  if (!running || !m) return null;
  const T = DMS_THRESHOLDS;
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
  return (
    <div className="grid gap-2">
      {!m.calibrated ? (
        <div className="rounded-lg bg-[#3BA9FF]/10 px-3 py-2 text-[12px] text-[#9fd2ff]">
          {m.face ? `Learning your eyes · look ahead normally · ${Math.round(m.calibration * 100)}%` : "Face the camera to calibrate"}
        </div>
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        <Reading label="Eye openness" value={m.eyesClosed ? "Closed" : pct(m.eyeOpenness)} tone={m.eyesClosed ? "warn" : undefined} />
        <Reading
          label="Eyes closed"
          value={`${m.eyesClosedS.toFixed(1)} s`}
          tone={m.eyesClosedS >= T.MICROSLEEP_S ? "crit" : m.eyesClosedS >= T.LONG_BLINK_S ? "warn" : undefined}
        />
        <Reading
          label="PERCLOS 60 s"
          value={m.perclos === null ? "collecting" : pct(m.perclos)}
          tone={m.perclos !== null && m.perclos >= T.PERCLOS_DROWSY ? "crit" : m.perclos !== null && m.perclos >= T.PERCLOS_CLEAR ? "warn" : undefined}
        />
        <Reading label="Blinks / min" value={m.blinksPerMin === null ? "—" : String(Math.round(m.blinksPerMin))} />
        <Reading label="Long blinks 60 s" value={String(m.longBlinks)} tone={m.longBlinks >= T.LONG_BLINKS_DROWSY ? "crit" : m.longBlinks > 0 ? "warn" : undefined} />
        <Reading label="Yawns 10 min" value={String(m.yawns)} tone={m.yawns >= T.YAWNS_FATIGUE ? "warn" : undefined} />
        <Reading
          label="Head turn"
          value={m.yawDeg === null ? "—" : `${Math.round(Math.abs(m.yawDeg))}°`}
          tone={m.yawDeg !== null && Math.abs(m.yawDeg) > T.DISTRACTED_YAW_DEG ? "warn" : undefined}
        />
        <Reading
          label="Head tilt"
          value={m.pitchDeg === null ? "—" : `${m.pitchDeg > 0 ? "↓" : "↑"} ${Math.round(Math.abs(m.pitchDeg))}°`}
          tone={m.pitchDeg !== null && m.pitchDeg > T.HEAD_DOWN_DEG ? "warn" : undefined}
        />
        <Reading label="Microsleeps 5 min" value={String(m.microsleeps)} tone={m.microsleeps > 0 ? "crit" : undefined} />
      </div>
    </div>
  );
}

export function CameraFeed({ compact = false }: { compact?: boolean }) {
  const camera = useHmiStore((s) => s.camera);
  const setCamera = useHmiStore((s) => s.setCamera);
  const { videoRef } = useWebcam(camera.enabled);
  const firing = CAMERA_CHECKS.filter((c) => cameraActive(camera, c.id));
  const worst = firing.sort((a, b) => b.level - a.level)[0];
  const simulatedOnly = !camera.enabled && firing.length > 0;

  return (
    <div className={cn(compact ? "flex h-full flex-col" : "grid grid-cols-[1fr_260px] items-start gap-4")}>
      <div className="grid gap-3">
        <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
          {camera.enabled ? (
            <>
              <video ref={videoRef} muted playsInline className="absolute inset-0 size-full -scale-x-100 object-cover" />
              <Overlay active={Boolean(worst)} />
              {FAILED[camera.status] ? (
                <div className="absolute inset-0 grid place-items-center bg-black/70 px-6 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <CameraOff className="size-7 text-[#FFB547]" aria-hidden />
                    <p className="text-[13px] text-[#C4CBD4]">{FAILED[camera.status]}</p>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_40%,#1a2130,#07090d)]">
              <div className="flex flex-col items-center gap-2 text-center">
                {simulatedOnly ? <ScanFace className="size-8 text-[#FFB547]" aria-hidden /> : <CameraOff className="size-7 text-[#566070]" aria-hidden />}
                <p className="text-[13px] text-[#8E98A6]">{simulatedOnly ? "Simulated detection" : "Operator camera off"}</p>
                {!compact ? (
                  <Button icon={Camera} variant="primary" onClick={() => setCamera({ enabled: true })} className="mt-2">
                    Turn on camera
                  </Button>
                ) : null}
              </div>
            </div>
          )}
          <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
            <Dot tone={camera.status === "running" ? "ok" : camera.enabled ? "warn" : "off"} pulse={camera.status === "running"} />
            {camera.status === "running" ? `Cab camera · ${camera.fps} fps` : camera.enabled ? camera.status : "Cab camera"}
          </div>
          {worst ? (
            <div
              className="absolute inset-x-2.5 bottom-2.5 rounded-lg px-3 py-2 text-[13px] font-semibold text-white"
              style={{ background: worst.level === 3 ? C.crit : "rgba(255,181,71,0.92)", color: worst.level === 3 ? "#fff" : "#1a1305" }}
            >
              {worst.title}
            </div>
          ) : null}
        </div>
        {!compact ? <Readings /> : null}
      </div>

      {!compact ? (
        <ul className="grid gap-2">
          {CAMERA_CHECKS.map((c) => {
            const on = cameraActive(camera, c.id);
            return (
              <li key={c.id} className={cn("flex items-center justify-between rounded-xl px-3.5 py-3 text-[14px]", on ? "bg-[#FF5A67]/12" : "bg-white/4")}>
                <span className={on ? "text-white" : "text-[#C4CBD4]"}>{c.label}</span>
                <span className="flex items-center gap-2 text-[12px]" style={{ color: on ? C.crit : camera.status === "running" ? C.ok : C.dim }}>
                  <Dot tone={on ? "crit" : camera.status === "running" ? "ok" : "off"} />
                  {on ? (camera.simulated[c.id] ? "Simulated" : "Detected") : camera.status === "running" ? "OK" : "—"}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
