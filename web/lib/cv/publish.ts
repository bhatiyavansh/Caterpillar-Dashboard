/**
 * Publishes browser CV detections to the hub.
 *
 * The detectors in `web/components/cv` run entirely in the browser and, until now, handed their
 * findings to whichever panel happened to be mounted. A person detected behind a machine was
 * visible in one cab panel and nowhere else: not on the command centre, not in the twin, not in
 * the alert ribbon, not in the database, and not to the assistant.
 *
 * `POST /api/events` exists for exactly this. Publishing through it makes a webcam detection an
 * ordinary hub event — stamped, deduped, protocol-enriched, persisted, and fanned out to every
 * connected surface on the same socket as everything else.
 *
 * Failure policy: a detection that cannot be published is dropped after a short timeout and
 * logged once. A camera or a backend that is having a bad day must never take the cab HMI down,
 * and the detector keeps rendering its own overlay regardless.
 */
import { apiBase } from "@web/lib/stream";

/** The hub stamps `id` and `ts`; we send the rest of the contract's event shape. */
export interface CvEventInput {
  event: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  machine_id: string;
  message: string;
  data?: Record<string, unknown>;
  /** `data:image/jpeg;base64,...`, at most 150 KB decoded. Dropped if larger. */
  snapshot?: string;
}

/** Decoded byte limit the hub enforces; check here too so we fail fast and keep the event. */
const SNAPSHOT_MAX_BYTES = 150 * 1024;
const POST_TIMEOUT_MS = 4000;

/**
 * Don't flood the hub. The detectors already rate-limit their own emits, but a wobbling
 * confidence score around the threshold can still chatter, and each event is fanned out to every
 * connected client.
 */
const MIN_INTERVAL_MS = 2000;

let lastSentAt = 0;
let lastKey = "";
let warned = false;

function approxDecodedBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  // 4 base64 chars -> 3 bytes, minus padding.
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Send one detection. Resolves true when the hub accepted it.
 *
 * `force` skips the rate limit — use it for a severity escalation, which is news even if the
 * previous event was recent.
 */
export async function publishCvEvent(e: CvEventInput, opts: { force?: boolean } = {}): Promise<boolean> {
  const now = Date.now();
  const key = `${e.event}:${e.machine_id}:${e.severity}`;
  if (!opts.force && key === lastKey && now - lastSentAt < MIN_INTERVAL_MS) return false;

  const body: Record<string, unknown> = {
    type: "event",
    event: e.event,
    severity: e.severity,
    machine_id: e.machine_id,
    source: "webcam",
    message: e.message,
    data: e.data ?? {},
  };

  // An oversized snapshot must cost us the image, not the detection.
  if (e.snapshot && approxDecodedBytes(e.snapshot) <= SNAPSHOT_MAX_BYTES) body.snapshot = e.snapshot;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  try {
    const res = await fetch(`${apiBase()}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`hub answered ${res.status}`);
    lastSentAt = now;
    lastKey = key;
    return true;
  } catch (err) {
    // Once per session: a detector firing every few seconds must not fill the console.
    if (!warned) {
      warned = true;
      console.warn("[cv] detections are not reaching the hub; showing them locally only", err);
    }
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Grab a JPEG still from the detector's video element, for the incident record. */
export function snapshotFrom(video: HTMLVideoElement | null, maxWidth = 480, quality = 0.6): string | undefined {
  if (!video || !video.videoWidth) return undefined;
  try {
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    // Tainted canvas or no 2d context: the event is still worth sending without a picture.
    return undefined;
  }
}
