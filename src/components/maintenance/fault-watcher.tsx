"use client";

/**
 * Mounted once at the root. It does three jobs for the breakdown workflow:
 *
 *   1. loads the shared fault from storage and follows other windows' changes
 *   2. tells whoever is looking at another screen that Maintenance needs them
 *   3. starts each report's pipeline when it becomes due
 *
 * The breakdown workspace itself only lives in AR maintenance. Every other
 * surface just points there.
 */
import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { DETECT_S, MACHINE, phaseAtLeast, type Phase } from "@/lib/maintenance/hydraulic-leak";
import { STORAGE_KEY, useFaultStore, useFaultView } from "@/lib/maintenance/fault-store";
import { runReport } from "@/lib/maintenance/report-pipeline";

/** The maintenance hub, and the machine page inside it that holds a breakdown. */
export const MAINTENANCE_HREF = "/ar";
export const breakdownHref = (machineId: string) => `${MAINTENANCE_HREF}/${machineId}`;
export const inMaintenance = (pathname: string) =>
  pathname === MAINTENANCE_HREF || pathname.startsWith(`${MAINTENANCE_HREF}/`);

type Milestone = "degrading" | "detected" | "report" | "verified";

export function FaultWatcher() {
  const router = useRouter();
  const pathname = usePathname();
  const onMaintenance = inMaintenance(pathname);
  const view = useFaultView();
  const breakdown = useFaultStore((s) => s.reports.breakdown);
  const service = useFaultStore((s) => s.reports.service);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    void Promise.resolve(useFaultStore.persist.rehydrate()).then(() => setHydrated(true));
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) void useFaultStore.persist.rehydrate();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Milestones already announced for this fault. Seeded on first sight so a
  // reload does not replay history as fresh news.
  const announced = React.useRef<{ id: string | null; seen: Set<Milestone> }>({ id: null, seen: new Set() });

  const phase: Phase | null = view?.phase ?? null;
  const faultId = view?.record.id ?? null;
  const reached = React.useMemo(() => {
    const r = new Set<Milestone>();
    if (!phase) return r;
    if (phaseAtLeast(phase, "degrading")) r.add("degrading");
    if (phaseAtLeast(phase, "detected")) r.add("detected");
    if (breakdown.status === "ready") r.add("report");
    if (phaseAtLeast(phase, "verified")) r.add("verified");
    return r;
  }, [phase, breakdown.status]);

  const open = React.useCallback(() => router.push(breakdownHref(MACHINE.id)), [router]);

  React.useEffect(() => {
    if (!hydrated) return;
    if (!faultId) {
      toast.dismiss("fault-detected");
      announced.current = { id: null, seen: new Set() };
      return;
    }
    // The shared clock catches up a moment after first subscribe; judging
    // "fresh" against a stale clock would replay history as news.
    if (!view || view.now < view.record.startedAt - 1000) return;
    const a = announced.current;
    if (a.id !== faultId) {
      // First sight of this fault in this window. Anything already true is
      // history, except an open fault, which is still worth pointing at.
      const fresh = view.tNow < 2;
      a.id = faultId;
      a.seen = fresh ? new Set() : new Set(reached);
      if (!fresh && reached.has("detected") && !phaseAtLeast(phase!, "closed")) a.seen.delete("detected");
    }
    const isNew = (m: Milestone) => reached.has(m) && !a.seen.has(m);
    const action = onMaintenance ? undefined : { label: "Open report", onClick: open };

    if (isNew("degrading") && !reached.has("detected")) {
      toast.warning(`${MACHINE.id}: hydraulic health trending down`, {
        id: "fault-degrading",
        description: "Tank level falling slowly. No alarm yet; watching the trend.",
        action,
      });
    }
    if (isNew("detected")) {
      toast.dismiss("fault-degrading");
      if (!onMaintenance) {
        toast.error(`${MACHINE.label}: hydraulic leak`, {
          id: "fault-detected",
          description: "Machine stopping safely. Diagnosis and breakdown report are in AR maintenance.",
          duration: Infinity,
          action,
        });
      }
    }
    if (isNew("report") && !onMaintenance) {
      toast(`Breakdown report ${faultId} ready`, {
        id: "fault-report",
        description: "Root cause, parts list and repair procedure are drafted.",
        action,
      });
    }
    if (isNew("verified")) {
      toast.success(`${MACHINE.id} repair verified`, {
        id: "fault-verified",
        description: "Pressure restored, level holding, no drift. Ready to close the work order.",
        action,
      });
    }
    for (const m of reached) a.seen.add(m);
  }, [hydrated, faultId, reached, onMaintenance, open, phase, view]);

  // Arriving on Maintenance answers the "go to Maintenance" toast.
  React.useEffect(() => {
    if (onMaintenance) toast.dismiss("fault-detected");
  }, [onMaintenance]);

  // Report pipelines. The breakdown report starts two seconds after
  // detection; the service report starts when the work order closes.
  const tNow = view?.tNow ?? 0;
  const closed = phase === "closed";
  React.useEffect(() => {
    if (!hydrated || !faultId) return;
    // Also called while "running": the pipeline's lock turns that into a
    // no-op unless the window that started it has gone away.
    if (tNow >= DETECT_S + 2 && breakdown.status !== "ready") void runReport("breakdown");
    if (closed && service.status !== "ready") void runReport("service");
  }, [hydrated, faultId, tNow, closed, breakdown.status, service.status]);

  return null;
}
