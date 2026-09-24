/**
 * MediaPipe loading, isolated so every detector shares one WASM bundle and one
 * cached copy of each model.
 *
 * Everything is loaded lazily and cached, so the first detector to mount pays
 * the download and the rest get it for free.  After the first successful
 * load the browser cache serves these offline.
 *
 * Two failure modes this module absorbs so callers don't have to:
 *  - No usable WebGL (VMs, some Linux/remote-desktop setups): the GPU delegate
 *    throws at creation, so we retry on the CPU delegate.
 *  - A failed download: the cached promise is dropped, so the next mount
 *    retries instead of inheriting a permanently rejected promise.
 */

const WASM_ROOT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm";
const OBJECT_MODEL =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

/**
 * The object detector is shared, so it is created with a floor low enough for
 * every caller; each caller then applies its own confidence threshold.
 */
const OBJECT_SCORE_FLOOR = 0.3;

/**
 * The bundle is imported dynamically (it pulls in WASM), so the value import happens at runtime
 * while these type-only imports cost nothing and keep every caller type-checked.
 */
type Vision = typeof import("@mediapipe/tasks-vision");
type Fileset = Awaited<ReturnType<Vision["FilesetResolver"]["forVisionTasks"]>>;
export type ObjectDetector = Awaited<ReturnType<Vision["ObjectDetector"]["createFromOptions"]>>;
export type FaceLandmarker = Awaited<ReturnType<Vision["FaceLandmarker"]["createFromOptions"]>>;
export type ObjectDetectorResult = ReturnType<ObjectDetector["detectForVideo"]>;
export type FaceLandmarkerResult = ReturnType<FaceLandmarker["detectForVideo"]>;

let visionPromise: Promise<{ vision: Vision; fileset: Fileset }> | null = null;
let objectDetectorPromise: Promise<ObjectDetector> | null = null;
let faceLandmarkerPromise: Promise<FaceLandmarker> | null = null;

async function loadVision() {
  if (!visionPromise) {
    visionPromise = (async () => {
      const vision = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_ROOT);
      return { vision, fileset };
    })();
    visionPromise.catch(() => {
      visionPromise = null;
    });
  }
  return visionPromise;
}

async function withDelegateFallback<T>(create: (delegate: "GPU" | "CPU") => Promise<T>): Promise<T> {
  try {
    return await create("GPU");
  } catch (err) {
    console.warn("[cv] GPU delegate unavailable, falling back to CPU", err);
    return create("CPU");
  }
}

export async function getObjectDetector(): Promise<ObjectDetector> {
  if (!objectDetectorPromise) {
    objectDetectorPromise = (async () => {
      const { vision, fileset } = await loadVision();
      return withDelegateFallback((delegate) =>
        vision.ObjectDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: OBJECT_MODEL, delegate },
          scoreThreshold: OBJECT_SCORE_FLOOR,
          runningMode: "VIDEO",
          maxResults: 5,
        }),
      );
    })();
    objectDetectorPromise.catch(() => {
      objectDetectorPromise = null;
    });
  }
  return objectDetectorPromise;
}

export async function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = (async () => {
      const { vision, fileset } = await loadVision();
      return withDelegateFallback((delegate) =>
        vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: FACE_MODEL, delegate },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          // Defaults are 0.5; a cab camera sees side light, glasses and a face
          // that is often turned, so hold on to the track a little harder.
          minFaceDetectionConfidence: 0.4,
          minFacePresenceConfidence: 0.4,
          minTrackingConfidence: 0.4,
        }),
      );
    })();
    faceLandmarkerPromise.catch(() => {
      faceLandmarkerPromise = null;
    });
  }
  return faceLandmarkerPromise;
}

/**
 * VIDEO-mode tasks reject any timestamp that is not strictly greater than the
 * previous one *for that task instance*.  The instances are shared, so two
 * loops calling in the same millisecond (or a remount in StrictMode) would
 * otherwise throw on every frame — silently, since callers treat a throw as a
 * dropped frame — and detection would just stop.
 */
const lastTimestamp = new WeakMap<object, number>();

export function nextTimestamp(task: object): number {
  const now = performance.now();
  const prev = lastTimestamp.get(task) ?? -Infinity;
  const ts = now > prev + 1 ? now : prev + 1;
  lastTimestamp.set(task, ts);
  return ts;
}
