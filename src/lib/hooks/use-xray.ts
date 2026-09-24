"use client";

/**
 * X-ray deep links and drafted-report records.
 *
 * Every anomaly/alert surface in the product opens the same X-ray inspection
 * through one entry point. Off the twin, that is a link to
 * `/twin?xray=<machine>&c=<component>`, which the twin page turns into
 * `useTwinStore.openXray(...)` on arrival — so dashboard pages never have to
 * load the 3D engine just to offer the link. On the twin itself, call
 * `useTwinStore.getState().openXray` directly.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiBase } from "@web/lib/stream";
import type { DraftedRecord } from "@/lib/api/actions";

export function xrayHref(machineId: string, componentId?: string | null): string {
  const q = new URLSearchParams({ xray: machineId });
  if (componentId) q.set("c", componentId);
  return `/twin?${q.toString()}`;
}

/** Navigate to the twin with an X-ray open on `machineId` (and `componentId`). */
export function useOpenXray(): (machineId: string, componentId?: string | null) => void {
  const router = useRouter();
  return useCallback(
    (machineId: string, componentId?: string | null) => router.push(xrayHref(machineId, componentId)),
    [router],
  );
}

export type RecordsState =
  | { status: "loading"; records: DraftedRecord[] }
  | { status: "ready"; records: DraftedRecord[] }
  | { status: "offline"; records: DraftedRecord[]; detail: string };

/**
 * Work orders or incidents the Copilot backend has drafted. No mock fallback:
 * these are real filed documents, so offline means an empty, labelled list.
 */
export function useCopilotRecords(kind: "work_order" | "incident", refreshKey = 0): RecordsState {
  const [state, setState] = useState<RecordsState>({ status: "loading", records: [] });
  useEffect(() => {
    let alive = true;
    const path = kind === "work_order" ? "/api/work-orders" : "/api/incidents";
    const key = kind === "work_order" ? "work_orders" : "incidents";
    fetch(`${apiBase()}${path}?limit=50`, { signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json: Record<string, DraftedRecord[]>) => {
        if (alive) setState({ status: "ready", records: json[key] ?? [] });
      })
      .catch((err: unknown) => {
        if (alive) setState({ status: "offline", records: [], detail: String(err) });
      });
    return () => {
      alive = false;
    };
  }, [kind, refreshKey]);
  return state;
}
