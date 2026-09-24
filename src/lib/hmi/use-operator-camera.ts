"use client";

/**
 * Operator monitoring camera: watches the person in the seat and reports what
 * they are doing — eyes closed, yawning, looking away, head down, holding a
 * phone, not in the seat, a second person in view.
 *
 * Runs the repo's MediaPipe face landmarker every frame and the object
 * detector every few frames, off the shared webcam stream. Results go to the
 * HMI store; the monitor loop turns them into alerts. Every check can also be
 * simulated from the test bench, so the demo works without a camera.
 */
import * as React from "react";
import { useWebcam } from "@web/components/cv/useWebcam";
import { getFaceLandmarker, getObjectDetector, type FaceLandmarker, type ObjectDetector } from "@web/components/cv/mediapipe";
import { useHmiStore, type CameraCheck } from "./hmi-store";

/** Latest face box and gaze, normalised 0-1, for the feed overlay to draw. */
export const cameraOverlay: {
  face: { x: number; y: number; w: number; h: number } | null;
  yaw: number;
  objects: { label: string; x: number; y: number; w: number; h: number }[];
  videoW: number;
  videoH: number;
} = { face: null, yaw: 0, objects: [], videoW: 640, videoH: 480 };

/** How long a condition must persist before it counts, seconds. */
const HOLD: Record<CameraCheck, number> = {
  absent: 2.5,
  drowsy: 1.2,
  yawn: 1.0,
  distracted: 2.0,
  head_down: 2.0,
  phone: 0.6,
  extra_person: 1.0,
};

export function useOperatorCamera(enabled: boolean) {
  const { videoRef, status } = useWebcam(enabled);
  const setCamera = useHmiStore((s) => s.setCamera);
  const setDetected = useHmiStore((s) => s.setDetected);

  React.useEffect(() => {
    if (!enabled) {
      setCamera({ status: "off", fps: 0 });
      setDetected({});
      return;
    }
    if (status === "starting" || status === "idle") setCamera({ status: "starting" });
    if (status === "denied") setCamera({ status: "denied" });
    if (status === "unavailable") setCamera({ status: "unavailable" });
  }, [enabled, status, setCamera, setDetected]);

  React.useEffect(() => {
    if (!enabled || status !== "ready") return;
    let cancelled = false;
    let face: FaceLandmarker | null = null;
    let objects: ObjectDetector | null = null;
    let raf = 0;
    let frame = 0;
    let lastTime = -1;
    let fpsCount = 0;
    let fpsAt = performance.now();
    const since: Partial<Record<CameraCheck, number>> = {};
    let lastObjects: { label: string; score: number }[] = [];

    setCamera({ status: "loading" });
    Promise.all([getFaceLandmarker(), getObjectDetector(0.4)])
      .then(([f, o]) => {
        if (cancelled) return;
        face = f;
        objects = o;
        setCamera({ status: "running" });
      })
      .catch(() => !cancelled && setCamera({ status: "error" }));

    const hold = (id: CameraCheck, cond: boolean, now: number) => {
      if (!cond) {
        delete since[id];
        return false;
      }
      since[id] ??= now;
      return (now - since[id]!) / 1000 >= HOLD[id];
    };

    const loop = () => {
      if (cancelled) return;
      raf = requestAnimationFrame(loop);
      const video = videoRef.current;
      if (!video || !face || video.readyState < 2 || video.currentTime === lastTime) return;
      lastTime = video.currentTime;
      const now = performance.now();
      cameraOverlay.videoW = video.videoWidth || 640;
      cameraOverlay.videoH = video.videoHeight || 480;

      let lm: { x: number; y: number }[] | undefined;
      let shapes: { categoryName: string; score: number }[] | undefined;
      try {
        const r = face.detectForVideo(video, now);
        lm = r.faceLandmarks?.[0];
        shapes = r.faceBlendshapes?.[0]?.categories;
      } catch {
        return;
      }

      if (objects && frame++ % 4 === 0) {
        try {
          const r = objects.detectForVideo(video, now);
          lastObjects = r.detections.map((d) => ({ label: d.categories[0]?.categoryName ?? "", score: d.categories[0]?.score ?? 0 }));
          cameraOverlay.objects = r.detections
            .filter((d) => ["cell phone", "person"].includes(d.categories[0]?.categoryName ?? ""))
            .map((d) => ({
              label: d.categories[0].categoryName,
              x: (d.boundingBox?.originX ?? 0) / cameraOverlay.videoW,
              y: (d.boundingBox?.originY ?? 0) / cameraOverlay.videoH,
              w: (d.boundingBox?.width ?? 0) / cameraOverlay.videoW,
              h: (d.boundingBox?.height ?? 0) / cameraOverlay.videoH,
            }));
        } catch {
          /* keep last */
        }
      }

      const score = (name: string) => shapes?.find((c) => c.categoryName === name)?.score ?? 0;
      let yaw = 0;
      let pitch = 0.5;
      if (lm) {
        const xs = lm.map((p) => p.x);
        const ys = lm.map((p) => p.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        cameraOverlay.face = { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
        // Nose tip (1) between the cheeks (234, 454): 0 = centred.
        const l = lm[234];
        const rr = lm[454];
        yaw = ((lm[1].x - l.x) / Math.max(1e-3, rr.x - l.x) - 0.5) * 2;
        // Nose between forehead (10) and chin (152): ~0.5 level, larger = head down.
        pitch = (lm[1].y - lm[10].y) / Math.max(1e-3, lm[152].y - lm[10].y);
      } else {
        cameraOverlay.face = null;
      }
      cameraOverlay.yaw = yaw;

      const persons = lastObjects.filter((o) => o.label === "person").length;
      const detected: Partial<Record<CameraCheck, boolean>> = {
        absent: hold("absent", !lm, now),
        drowsy: hold("drowsy", !!lm && score("eyeBlinkLeft") > 0.5 && score("eyeBlinkRight") > 0.5, now),
        yawn: hold("yawn", !!lm && score("jawOpen") > 0.55, now),
        distracted: hold("distracted", !!lm && Math.abs(yaw) > 0.45, now),
        head_down: hold("head_down", !!lm && pitch > 0.68, now),
        phone: hold("phone", lastObjects.some((o) => o.label === "cell phone" && o.score > 0.4), now),
        extra_person: hold("extra_person", persons >= 2, now),
      };

      fpsCount++;
      if (now - fpsAt > 1000) {
        setCamera({ fps: fpsCount });
        fpsCount = 0;
        fpsAt = now;
      }
      const prev = useHmiStore.getState().camera.detected;
      if ((Object.keys(detected) as CameraCheck[]).some((k) => Boolean(prev[k]) !== detected[k])) setDetected(detected);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [enabled, status, videoRef, setCamera, setDetected]);

  return { videoRef };
}
