/**
 * The single seam between the product UI and whatever is producing site data.
 *
 * `MockFleetSource` implements it today. A `LiveFleetSource` backed by the
 * FastAPI WebSocket hub implements the same interface, and `getFleetSource()`
 * picks whichever is available. No screen imports a concrete source.
 */
import type {
  AlertKind,
  AlertSeverity,
  Anomaly,
  ConnectionState,
  DirectorResult,
  DirectorScenarioId,
  Incident,
  MaintenanceItem,
  OwnerKpis,
  OwnerSeries,
  SiteSnapshot,
  TelemetryPoint,
  TimelineMarker,
  TrainingModule,
} from "./contracts";

export interface FleetSource {
  readonly id: "mock" | "live";

  /** Current connection state, for the status pill in the shell. */
  getConnection(): ConnectionState;

  /** Latest snapshot. Always returns something — never null, never a promise. */
  getSnapshot(): SiteSnapshot;

  /** Subscribe to snapshots. Returns an unsubscribe function. */
  subscribe(listener: (snapshot: SiteSnapshot) => void): () => void;

  /** Rolling telemetry window for one machine, oldest first. */
  getTelemetry(machineId: string): TelemetryPoint[];

  acknowledgeAlert(alertId: string): void;
  acknowledgeAll(): void;

  /** Move a logged incident through review, optionally with a note. */
  fileIncident(incidentId: string, status: Incident["status"], note?: string): void;
  /** Log an incident a person witnessed, rather than one a rule caught. */
  reportIncident(input: {
    machineId: string;
    kind: AlertKind;
    severity: AlertSeverity;
    title: string;
    summary: string;
  }): Incident;

  getIncidents(): Incident[];
  getMaintenance(): MaintenanceItem[];
  getAnomalies(): Anomaly[];
  getOwnerKpis(): OwnerKpis;
  getOwnerSeries(): OwnerSeries;
  getTrainingModules(): TrainingModule[];
  getTimelineMarkers(): TimelineMarker[];

  triggerScenario(id: DirectorScenarioId): Promise<DirectorResult>;

  start(): void;
  stop(): void;
}
