"use client";

/**
 * Operator camera view: the live feed, with the face box and any phone the
 * detector finds drawn over it, and one chip per check.
 */
import * as React from "react";
import { Camera, CameraOff, ScanFace } from "lucide-react";
import { useWebcam } from "@web/components/cv/useWebcam";
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
        const color = active ? C.crit : C.cyan;
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

export function CameraFeed({ compact = false }: { compact?: boolean }) {
  const camera = useHmiStore((s) => s.camera);
  const setCamera = useHmiStore((s) => s.setCamera);
  const { videoRef } = useWebcam(camera.enabled);
  const firing = CAMERA_CHECKS.filter((c) => cameraActive(camera, c.id));
  const worst = firing.sort((a, b) => b.level - a.level)[0];
  const simulatedOnly = !camera.enabled && firing.length > 0;

  return (
    <div className={cn(compact ? "flex h-full flex-col" : "grid grid-cols-[1fr_260px] items-start gap-4")}>
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
        {camera.enabled ? (
          <>
            <video ref={videoRef} muted playsInline className="absolute inset-0 size-full -scale-x-100 object-cover" />
            <Overlay active={Boolean(worst)} />
          </>
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_40%,#1a2130,#07090d)]">
            <div className="flex flex-col items-center gap-2 text-center">
              {simulatedOnly ? <ScanFace className="size-8 text-status-warn" aria-hidden /> : <CameraOff className="size-7 text-zinc-500" aria-hidden />}
              <p className="text-[13px] text-muted">{simulatedOnly ? "Simulated detection" : "Operator camera off"}</p>
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

      {!compact ? (
        <ul className="grid gap-2">
          {CAMERA_CHECKS.map((c) => {
            const on = cameraActive(camera, c.id);
            return (
              <li key={c.id} className={cn("flex items-center justify-between rounded-xl px-3.5 py-3 text-[14px]", on ? "bg-status-crit/12" : "bg-white/4")}>
                <span className={on ? "text-white" : "text-zinc-300"}>{c.label}</span>
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
