/**
 * MediaPipe loading, isolated so both detectors share one WASM bundle and one
 * cached copy of each model.
 *
 * Everything is loaded lazily and cached, so the first detector to mount pays
 * the download and the second gets it for free.  After the first successful
 * load the browser cache serves these offline.
 */

const WASM_ROOT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm";
const OBJECT_MODEL =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

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
  }
  return visionPromise;
}

export async function getObjectDetector(minConfidence: number): Promise<ObjectDetector> {
  if (!objectDetectorPromise) {
    objectDetectorPromise = (async () => {
      const { vision, fileset } = await loadVision();
      return vision.ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: OBJECT_MODEL, delegate: "GPU" },
        scoreThreshold: minConfidence,
        runningMode: "VIDEO",
        maxResults: 5,
      });
    })();
  }
  return objectDetectorPromise;
}

export async function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = (async () => {
      const { vision, fileset } = await loadVision();
      return vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
      });
    })();
  }
  return faceLandmarkerPromise;
}
