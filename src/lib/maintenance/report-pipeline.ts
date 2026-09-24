"use client";

/**
 * Runs a report through its pipeline, stage by stage, writing progress into the
 * fault store so every open window shows the same stage.
 *
 * A Web Lock makes sure only one window drafts a given report even when two
 * notice at the same moment that it is due.
 */
import { deriveFault } from "./hydraulic-leak";
import { useFaultStore, type ReportKind } from "./fault-store";
import {
  breakdownFacts,
  breakdownTemplate,
  PIPELINE,
  REMOTE_STAGE,
  RETRIEVAL_QUERY,
  serviceFacts,
  serviceTemplate,
} from "./report";
import type { ReportResponse } from "@/app/api/maintenance/report/route";

const STAGE_MS = 650;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const hasLocks = () => typeof navigator !== "undefined" && "locks" in navigator;

async function withLock(name: string, fn: () => Promise<void>) {
  if (hasLocks()) {
    await navigator.locks.request(name, { ifAvailable: true }, async (lock) => {
      if (lock) await fn();
    });
  } else {
    await fn();
  }
}

export function runReport(kind: ReportKind): Promise<void> {
  return withLock(`cat-copilot:report:${kind}`, async () => {
    const store = useFaultStore;
    // Another window may have just finished; storage is the source of truth.
    await store.persist.rehydrate();
    const { fault, reports } = store.getState();
    // Holding the lock means no window is drafting this report, so a
    // "running" status here was left by a window that closed mid-run.
    const status = reports[kind].status;
    if (!fault || status === "ready" || (status === "running" && !hasLocks())) return;
    const faultId = fault.id;
    // A reset or a new fault mid-run makes this run stale.
    const stale = () => store.getState().fault?.id !== faultId;

    const facts =
      kind === "breakdown" ? breakdownFacts(deriveFault(fault, Date.now())) : serviceFacts(fault);
    const fallback = kind === "breakdown" ? breakdownTemplate(facts) : serviceTemplate(facts);

    const set = (patch: Parameters<ReturnType<typeof store.getState>["setReport"]>[1]) => {
      if (!stale()) store.getState().setReport(kind, patch);
    };

    set({ status: "running", stage: 0 });
    const stages = PIPELINE[kind];
    let result: ReportResponse | null = null;

    for (let i = 0; i < stages.length; i++) {
      if (stale()) return;
      set({ stage: i });
      if (i === REMOTE_STAGE[kind]) {
        const [res] = await Promise.all([
          fetch("/api/maintenance/report", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind, facts, fallback, query: RETRIEVAL_QUERY[kind] }),
          })
            .then((r) => (r.ok ? (r.json() as Promise<ReportResponse>) : null))
            .catch(() => null),
          wait(STAGE_MS),
        ]);
        result = res;
      } else {
        await wait(STAGE_MS);
      }
    }

    set({
      status: "ready",
      stage: stages.length,
      summary: result?.summary ?? fallback,
      source: result?.source ?? "template",
      citations: result?.citations?.map(({ citation, title, quote }) => ({ citation, title, quote })) ?? [],
      generatedAt: Date.now(),
    });
  });
}
