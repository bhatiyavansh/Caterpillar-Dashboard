"use client";

/**
 * Operator monitoring camera: watches the person in the seat and reports what
 * they are doing — microsleep, drowsiness building (PERCLOS), repeated
 * yawning, looking away, head down, holding a phone, not in the seat, a
 * second person in view.
 *
 * Face analysis runs every frame through the shared driver-monitoring engine
 * (`@web/components/cv/operator-monitor`, which owns the fatigue thresholds);
 * the object detector runs every few frames for phone and passenger checks.
 * Results go to the HMI store; the monitor loop turns them into alerts and
 * hub events. Every check can also be simulated from the test bench, so the
 * demo works without a camera.
 */
import * as React from "react";
import { useWebcam } from "@web/components/cv/useWebcam";
import {
  getFaceLandmarker,
  getObjectDetector,
  nextTimestamp,
  type FaceLandmarker,
  type FaceLandmarkerResult,
  type ObjectDetector,
} from "@web/components/cv/mediapipe";
import { Latch, OperatorMonitor } from "@web/components/cv/operator-monitor";
import { snapshotFrom } from "@web/lib/cv";
import { useHmiStore, type CameraCheck } from "./hmi-store";

/** Latest face box and gaze, normalised 0-1, for the feed overlay to draw. */
export const cameraOverlay: {
  face: { x: number; y: number; w: number; h: number } | null;
  yaw: number;
  eyesClosed: boolean;
  objects: { label: string; x: number; y: number; w: number; h: number }[];
  videoW: number;
  videoH: number;
} = { face: null, yaw: 0, eyesClosed: false, objects: [], videoW: 640, videoH: 480 };

/** Object-detector checks. Face checks are tuned in DMS_THRESHOLDS. */
const PHONE_MIN_SCORE = 0.45;
const PHONE_HOLD_S = 1.0;
const PERSON_MIN_SCORE = 0.5;
const EXTRA_PERSON_HOLD_S = 2.0;
/** Run the (heavier) object detector on every Nth frame. */
const OBJECT_EVERY = 4;
const METRICS_INTERVAL_MS = 250;

/** The element the detector is reading, for evidence stills. */
let detectorVideo: HTMLVideoElement | null = null;

/** A JPEG still of the operator camera right now, if it is running. */
export function operatorSnapshot(): string | undefined {
  return snapshotFrom(detectorVideo);
}

export function useOperatorCamera(enabled: boolean) {
  const { videoRef, status } = useWebcam(enabled);
  const setCamera = useHmiStore((s) => s.setCamera);
  const setDetected = useHmiStore((s) => s.setDetected);

  React.useEffect(() => {
    if (!enabled) {
      setCamera({ status: "off", fps: 0, metrics: null });
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
    let metricsAt = 0;
    let lastObjects: { label: string; score: number }[] = [];
    const monitor = new OperatorMonitor();
    const phone = new Latch(PHONE_HOLD_S, 1.0, 0.6);
    const extraPerson = new Latch(EXTRA_PERSON_HOLD_S, 1.0, 0.6);

    setCamera({ status: "loading" });
    // The face model is what fatigue needs; the object detector is a bonus and must not block it.
    getFaceLandmarker()
      .then((f) => {
        if (cancelled) return;
        face = f;
        setCamera({ status: "running" });
      })
      .catch((err) => {
        console.warn("[cv] face landmarker failed to load", err);
        if (!cancelled) setCamera({ status: "error" });
      });
    getObjectDetector()
      .then((o) => {
        if (!cancelled) objects = o;
      })
      .catch((err) => console.warn("[cv] object detector failed to load; phone/passenger checks off", err));

    const loop = () => {
      if (cancelled) return;
      raf = requestAnimationFrame(loop);
      const video = videoRef.current;
      if (!video || !face || video.readyState < 2 || !video.videoWidth || video.currentTime === lastTime) return;
      lastTime = video.currentTime;
      detectorVideo = video;
      const W = video.videoWidth;
      const H = video.videoHeight;
      cameraOverlay.videoW = W;
      cameraOverlay.videoH = H;

      let result: FaceLandmarkerResult;
      try {
        result = face.detectForVideo(video, nextTimestamp(face));
      } catch {
        return; // a dropped frame
      }

      if (objects && frame++ % OBJECT_EVERY === 0) {
        try {
          const r = objects.detectForVideo(video, nextTimestamp(objects));
          lastObjects = r.detections.map((d) => ({ label: d.categories[0]?.categoryName ?? "", score: d.categories[0]?.score ?? 0 }));
          cameraOverlay.objects = r.detections
            .filter((d) => ["cell phone", "person"].includes(d.categories[0]?.categoryName ?? ""))
            .map((d) => ({
              label: d.categories[0].categoryName,
              x: (d.boundingBox?.originX ?? 0) / W,
              y: (d.boundingBox?.originY ?? 0) / H,
              w: (d.boundingBox?.width ?? 0) / W,
              h: (d.boundingBox?.height ?? 0) / H,
            }));
        } catch {
          /* keep last */
        }
      }

      const now = performance.now();
      const { conditions, metrics } = monitor.update(result, W, H, now);
      const t = now / 1000;

      const lm = result.faceLandmarks?.[0];
      if (lm) {
        let minX = 1, minY = 1, maxX = 0, maxY = 0;
        for (const p of lm) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        cameraOverlay.face = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      } else {
        cameraOverlay.face = null;
      }
      cameraOverlay.yaw = Math.max(-1, Math.min(1, (metrics.yawDeg ?? 0) / 60));
      cameraOverlay.eyesClosed = metrics.eyesClosed;

      const persons = lastObjects.filter((o) => o.label === "person" && o.score >= PERSON_MIN_SCORE).length;
      const detected: Record<CameraCheck, boolean> = {
        absent: conditions.absent,
        drowsy: conditions.microsleep,
        fatigue: conditions.drowsy,
        yawn: conditions.yawning,
        distracted: conditions.distracted,
        head_down: conditions.head_down,
        phone: phone.update(lastObjects.some((o) => o.label === "cell phone" && o.score >= PHONE_MIN_SCORE), t),
        extra_person: extraPerson.update(persons >= 2, t),
      };

      fpsCount++;
      if (now - fpsAt > 1000) {
        setCamera({ fps: fpsCount });
        fpsCount = 0;
        fpsAt = now;
      }
      if (now - metricsAt > METRICS_INTERVAL_MS) {
        metricsAt = now;
        setCamera({ metrics });
      }
      const prev = useHmiStore.getState().camera.detected;
      if ((Object.keys(detected) as CameraCheck[]).some((k) => Boolean(prev[k]) !== detected[k])) setDetected(detected);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      detectorVideo = null;
      cameraOverlay.face = null;
      cameraOverlay.objects = [];
    };
  }, [enabled, status, videoRef, setCamera, setDetected]);

  return { videoRef };
}
