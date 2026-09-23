export * from "./contracts.gen";
export { StreamClient, defaultWsUrl, CLOSE_RESYNC, type StreamClientOptions } from "./client";
export { createStreamStore, initialState, reduce, type Machine, type StreamState, type StreamStatus, type StreamStore, type Worker } from "./store";
export { siteToPlan, siteToTwin, twinToSite, degToRad, radToDeg, PLAN, TWIN, SITE } from "./geo";
export { LiveTelemetryProvider, TwinPublisher, TWIN_COMMANDS, TWIN_IDS, toTelemetry, type TwinEngineLike } from "./twin";
export {
  configureStream,
  getStreamStore,
  useActiveAlerts,
  useEnvironment,
  useEvents,
  useMachine,
  useMachineIds,
  useMachines,
  useSources,
  useStreamMeta,
  useStreamStatus,
  useStreamStore,
  useWorkers,
  type EventFilter,
} from "./hooks";

/** Base URL for the hub's REST API (director, events, history). */
export function apiBase(): string {
  const env = typeof process !== "undefined" ? process.env?.NEXT_PUBLIC_COPILOT_API : undefined;
  return (env ?? "http://localhost:8000").replace(/\/$/, "");
}
