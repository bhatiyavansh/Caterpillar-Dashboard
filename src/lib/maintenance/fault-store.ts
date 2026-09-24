"use client";

/**
 * The one active breakdown, shared by every screen and every tab.
 *
 * Only the facts people create are stored (when the leak started, who was
 * dispatched, which steps were ticked). Telemetry, phase and diagnosis are
 * derived from those facts and the clock, so the demo-control window and the
 * maintenance window can never disagree about what is happening.
 *
 * Persisted to localStorage and re-read on the `storage` event, which is what
 * keeps a second window in step without a backend.
 */
import * as React from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  deriveFault,
  newFaultRecord,
  skipToFailure,
  TECHNICIAN,
  TEST_S,
  type FaultRecord,
  type FaultView,
  type StepId,
} from "./hydraulic-leak";

export type ReportKind = "breakdown" | "service";

export interface Citation {
  citation: string;
  title: string;
  quote: string;
}

export interface ReportDoc {
  status: "idle" | "running" | "ready";
  /** Index of the pipeline stage in progress. */
  stage: number;
  summary?: string;
  source?: "llm" | "template";
  citations?: Citation[];
  generatedAt?: number;
}

const IDLE: ReportDoc = { status: "idle", stage: 0 };

interface FaultState {
  fault: FaultRecord | null;
  reports: Record<ReportKind, ReportDoc>;

  trigger: () => void;
  skipToFailure: () => void;
  reset: () => void;
  dispatch: () => void;
  tickStep: (id: StepId) => void;
  startVerify: () => void;
  close: () => void;
  setReport: (kind: ReportKind, patch: Partial<ReportDoc>) => void;
}

export const STORAGE_KEY = "cat-copilot:fault";

export const useFaultStore = create<FaultState>()(
  persist(
    (set, get) => ({
      fault: null,
      reports: { breakdown: IDLE, service: IDLE },

      trigger: () => set({ fault: newFaultRecord(), reports: { breakdown: IDLE, service: IDLE } }),

      skipToFailure: () => {
        const { fault } = get();
        if (fault) set({ fault: skipToFailure(fault) });
      },

      reset: () => set({ fault: null, reports: { breakdown: IDLE, service: IDLE } }),

      dispatch: () =>
        set((s) =>
          s.fault && s.fault.dispatchedAt === undefined
            ? { fault: { ...s.fault, dispatchedAt: Date.now(), technician: TECHNICIAN } }
            : s,
        ),

      tickStep: (id) =>
        set((s) =>
          s.fault && s.fault.steps[id] === undefined
            ? { fault: { ...s.fault, steps: { ...s.fault.steps, [id]: Date.now() } } }
            : s,
        ),

      startVerify: () =>
        set((s) =>
          s.fault && s.fault.verifyStartedAt === undefined
            ? { fault: { ...s.fault, verifyStartedAt: Date.now() } }
            : s,
        ),

      close: () =>
        set((s) => {
          if (!s.fault || s.fault.closedAt !== undefined) return s;
          const now = Date.now();
          // The test step is done when telemetry proved it, not when signed off.
          const verify = s.fault.verifyStartedAt !== undefined ? s.fault.verifyStartedAt + TEST_S * 1000 : now;
          return { fault: { ...s.fault, closedAt: now, steps: { ...s.fault.steps, verify } } };
        }),

      setReport: (kind, patch) =>
        set((s) => ({ reports: { ...s.reports, [kind]: { ...s.reports[kind], ...patch } } })),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ fault: s.fault, reports: s.reports }),
      // Hydrated from `FaultWatcher` after mount, so the server render and the
      // first client render agree.
      skipHydration: true,
    },
  ),
);

/*
 * One shared half-second clock for every screen following the breakdown, so
 * a page with ten panels still runs a single timer.
 */
let clockNow = 0;
const clockListeners = new Set<() => void>();
let clockTimer: number | null = null;

function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  if (clockTimer === null) {
    clockTimer = window.setInterval(() => {
      clockNow = Date.now();
      clockListeners.forEach((l) => l());
    }, 500);
  }
  // Catch up at once rather than showing a stale time for up to a tick.
  clockNow = Date.now();
  queueMicrotask(listener);
  return () => {
    clockListeners.delete(listener);
    if (!clockListeners.size && clockTimer !== null) {
      window.clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

const idle = () => () => {};

/** Re-render on the shared clock while `active`. */
export function useNow(active: boolean): number {
  return React.useSyncExternalStore(active ? subscribeClock : idle, () => clockNow, () => 0);
}

/** The active breakdown as it stands right now, or null. */
export function useFaultView(): FaultView | null {
  const fault = useFaultStore((s) => s.fault);
  // Once closed the clock no longer changes anything worth re-rendering for.
  const now = useNow(fault !== null && fault.closedAt === undefined);
  return React.useMemo(() => (fault ? deriveFault(fault, Math.max(now, fault.closedAt ?? 0)) : null), [fault, now]);
}
