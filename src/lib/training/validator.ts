/**
 * The step watcher: hold timers, timeouts and failure diagnosis.
 *
 * Pure — it is fed telemetry and a clock and returns what happened. The hook
 * that owns it runs it every animation frame; nothing here touches React, the
 * engine or the network, so it can be driven by synthetic telemetry in tests.
 */
import type { MachineTelemetry } from "@/types/twin";
import type { LessonStep, StepContext } from "./curriculum";

export type ValidatorEvent =
  | { kind: "progress"; hold: number; elapsed: number }
  | { kind: "pass"; elapsedMs: number }
  | { kind: "timeout"; reason: string };

export class StepValidator {
  private readonly start: MachineTelemetry;
  private readonly startedAt: number;
  private holdSince: number | null = null;
  private done = false;
  /** Most frequent diagnosis seen while the step was failing. */
  private readonly reasons = new Map<string, number>();

  constructor(
    readonly step: LessonStep,
    start: MachineTelemetry,
    now: number,
    /** Remediation relaxes the clock rather than the pass condition. */
    private readonly timeoutMs = step.timeoutMs,
  ) {
    // Copy: telemetry is mutated in place by the engine every frame.
    this.start = { ...start };
    this.startedAt = now;
  }

  context(now: number, emergencyStopped: boolean): StepContext {
    return { start: this.start, elapsedMs: now - this.startedAt, emergencyStopped };
  }

  tick(t: MachineTelemetry, now: number, emergencyStopped: boolean): ValidatorEvent {
    if (this.done) return { kind: "progress", hold: 1, elapsed: now - this.startedAt };
    const ctx = this.context(now, emergencyStopped);

    if (this.step.success(t, ctx)) {
      this.holdSince ??= now;
      const held = now - this.holdSince;
      if (held >= this.step.holdMs) {
        this.done = true;
        return { kind: "pass", elapsedMs: ctx.elapsedMs };
      }
      return { kind: "progress", hold: this.step.holdMs ? held / this.step.holdMs : 1, elapsed: ctx.elapsedMs };
    }

    this.holdSince = null;
    const hint = this.step.hints.find((h) => h.when(t, ctx));
    if (hint) this.reasons.set(hint.reason, (this.reasons.get(hint.reason) ?? 0) + 1);

    if (ctx.elapsedMs > this.timeoutMs) {
      this.done = true;
      return { kind: "timeout", reason: this.worstReason() };
    }
    return { kind: "progress", hold: 0, elapsed: ctx.elapsedMs };
  }

  private worstReason(): string {
    let best = "The learner did not complete the step in time.";
    let n = 0;
    for (const [reason, count] of this.reasons) {
      if (count > n) {
        best = reason;
        n = count;
      }
    }
    return best;
  }
}
