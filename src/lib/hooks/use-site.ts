"use client";

/**
 * The hooks every screen reads from.
 *
 * They wrap `FleetSource` and nothing else, so when the WebSocket hub replaces
 * the simulated source not one component changes.
 */
import * as React from "react";
import { getFleetSource } from "@/lib/api";
import { serverSnapshot } from "@/lib/api/server-snapshot";
import { ownerKpisFrom, ownerSeries } from "@/lib/api/owner-report";
import type {
  Anomaly,
  ConnectionState,
  DirectorResult,
  DirectorScenarioId,
  FleetKpis,
  Incident,
  Machine,
  MaintenanceItem,
  OwnerKpis,
  OwnerSeries,
  SiteAlert,
  SiteSnapshot,
  SiteTask,
  TelemetryPoint,
  TimelineMarker,
  TrainingModule,
} from "@/lib/api/contracts";

/** Describes any async-ish read so screens can render loading and error states. */
export interface Query<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

const subscribe = (cb: () => void) => getFleetSource().subscribe(cb);

/** True once we are on the client and the live source can be touched. */
const onClient = () => typeof window !== "undefined";

/**
 * Snapshot of the whole site.
 *
 * The server pass and the hydration pass both use the resting snapshot, so
 * screens render their real layout immediately instead of a spinner. The live
 * source takes over from the first tick onwards.
 */
export function useSnapshot(): SiteSnapshot {
  return React.useSyncExternalStore(subscribe, () => getFleetSource().getSnapshot(), serverSnapshot);
}

/** Whether the live stream has produced a frame yet. */
function useHydrated(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

export function useConnection(): ConnectionState {
  return useHydrated() ? getFleetSource().getConnection() : "connecting";
}

export function useFleet(): Query<Machine[]> & { kpis: FleetKpis; snapshot: SiteSnapshot } {
  const snapshot = useSnapshot();
  return { data: snapshot.machines, kpis: snapshot.kpis, snapshot, loading: false, error: null };
}

export function useMachine(machineId: string | null): Query<Machine | null> {
  const snapshot = useSnapshot();
  const machine = machineId ? (snapshot.machines.find((m) => m.id === machineId) ?? null) : null;
  return {
    data: machine,
    loading: false,
    error: machineId && !machine ? `Machine ${machineId} is not reporting on this site.` : null,
  };
}

export function useAlerts(options?: { machineId?: string; includeAcknowledged?: boolean }): Query<SiteAlert[]> & {
  acknowledge: (id: string) => void;
  acknowledgeAll: () => void;
  critical: SiteAlert[];
} {
  const snapshot = useSnapshot();
  const { machineId, includeAcknowledged = true } = options ?? {};

  const alerts = React.useMemo(() => {
    let list = snapshot.alerts;
    if (machineId) list = list.filter((a) => a.machineId === machineId);
    if (!includeAcknowledged) list = list.filter((a) => !a.acknowledged);
    return list;
  }, [snapshot, machineId, includeAcknowledged]);

  return {
    data: alerts,
    critical: alerts.filter((a) => a.severity === "critical"),
    loading: false,
    error: null,
    acknowledge: React.useCallback((id: string) => getFleetSource().acknowledgeAlert(id), []),
    acknowledgeAll: React.useCallback(() => getFleetSource().acknowledgeAll(), []),
  };
}

export function useTasks(machineId?: string): Query<SiteTask[]> {
  const snapshot = useSnapshot();
  const tasks = React.useMemo(() => {
    const list = snapshot.tasks;
    return machineId ? list.filter((t) => t.machineId === machineId) : list;
  }, [snapshot, machineId]);
  return { data: tasks, loading: false, error: null };
}

export function useTelemetry(machineId: string | null): Query<TelemetryPoint[]> {
  const snapshot = useSnapshot();
  const data = React.useMemo(
    () => (machineId && onClient() ? getFleetSource().getTelemetry(machineId) : []),
    // The snapshot reference changing is the signal that a new sample landed.
    [machineId, snapshot],
  );
  return { data, loading: false, error: null };
}

export function useIncidents(): Query<Incident[]> {
  const snapshot = useSnapshot();
  const data = React.useMemo(() => (onClient() ? getFleetSource().getIncidents() : []), [snapshot]);
  return { data, loading: false, error: null };
}

export function useMaintenance(): Query<MaintenanceItem[]> {
  const snapshot = useSnapshot();
  const data = React.useMemo(() => (onClient() ? getFleetSource().getMaintenance() : []), [snapshot]);
  return { data, loading: false, error: null };
}

export function useAnomalies(): Query<Anomaly[]> {
  const snapshot = useSnapshot();
  const data = React.useMemo(() => (onClient() ? getFleetSource().getAnomalies() : []), [snapshot]);
  return { data, loading: false, error: null };
}

export function useOwnerReport(): Query<{ kpis: OwnerKpis; series: OwnerSeries }> {
  const snapshot = useSnapshot();
  const data = React.useMemo(
    () => ({ kpis: ownerKpisFrom(snapshot), series: ownerSeries() }),
    [snapshot],
  );
  return { data, loading: false, error: null };
}

export function useTraining(): Query<TrainingModule[]> {
  const snapshot = useSnapshot();
  const data = React.useMemo(() => (onClient() ? getFleetSource().getTrainingModules() : []), [snapshot]);
  return { data, loading: false, error: null };
}

export function useTimelineMarkers(): Query<TimelineMarker[]> {
  const snapshot = useSnapshot();
  const data = React.useMemo(() => (onClient() ? getFleetSource().getTimelineMarkers() : []), [snapshot]);
  return { data, loading: false, error: null };
}

export interface DirectorHandle {
  /** Scenario currently running, if any. */
  active: string | null;
  /** Scenario id mid-flight, so the button can disable itself. */
  pending: DirectorScenarioId | null;
  log: DirectorResult[];
  trigger: (id: DirectorScenarioId) => Promise<void>;
}

export function useDirector(): DirectorHandle {
  const snapshot = useSnapshot();
  const [pending, setPending] = React.useState<DirectorScenarioId | null>(null);
  const [log, setLog] = React.useState<DirectorResult[]>([]);

  const trigger = React.useCallback(async (id: DirectorScenarioId) => {
    setPending(id);
    try {
      const result = await getFleetSource().triggerScenario(id);
      setLog((l) => [result, ...l].slice(0, 12));
    } catch {
      setLog((l) => [{ ok: false, scenario: id, message: "Scenario failed to dispatch.", at: Date.now() }, ...l].slice(0, 12));
    } finally {
      setPending(null);
    }
  }, []);

  return { active: snapshot.activeScenario, pending, log, trigger };
}
