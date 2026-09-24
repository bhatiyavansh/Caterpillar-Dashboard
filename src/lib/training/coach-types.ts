/** Wire types for `/api/coach`, shared by the route and the client hook. */
import type { ManualHit } from "./manual-search";

export type CoachEvent = "brief" | "pass" | "timeout";
export type CoachTool = "say" | "remediate" | "demo";

export interface CoachRequest {
  event: CoachEvent;
  module: string;
  step: string;
  realControl: string;
  /** Human key labels, e.g. ["↑"] or ["Shift", "←"]. */
  keys: string[];
  /** Deterministic diagnosis from the validator, on timeout. */
  reason?: string;
  attempt: number;
  /** Compact telemetry digest, for colour only — never for a verdict. */
  digest: string;
  learner: { name: string; level: string; weakest: string };
  /** The scripted line, returned verbatim if the model is unavailable. */
  scripted: string;
}

export interface CoachResponse {
  tool: CoachTool;
  say: string;
  source: "live" | "scripted";
  citation: ManualHit | null;
  latencyMs: number;
}
