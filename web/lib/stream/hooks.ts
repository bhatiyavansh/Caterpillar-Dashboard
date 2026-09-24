"use client";
/**
 * React bindings for the stream store. Each hook subscribes to a slice with a selector, so a
 * component re-renders only when its slice changes. The shared client starts on first use and
 * stops when the last component using it unmounts.
 */
import { useEffect } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { LiveEvent } from "./contracts.gen";
import { StreamClient, type StreamClientOptions } from "./client";
import { createStreamStore, type Machine, type StreamState, type StreamStore, type Worker } from "./store";

let shared: { store: StreamStore; client: StreamClient | null; users: number } | null = null;

/** The app-wide store (safe during SSR: the client is only created in the browser). */
export function getStreamStore(): StreamStore {
  if (!shared) shared = { store: createStreamStore(), client: null, users: 0 };
  return shared.store;
}

/** Configure the shared client before first use (optional; defaults read NEXT_PUBLIC_COPILOT_WS). */
export function configureStream(options: Omit<StreamClientOptions, "store">): void {
  const store = getStreamStore();
  if (shared?.client) shared.client.stop();
  shared = { store, client: new StreamClient({ ...options, store }), users: shared?.users ?? 0 };
  if (shared.users > 0) shared.client?.start();
}

/**
 * Start (or join) the one shared connection, outside React. Returns the release function.
 *
 * React components go through the hooks below; imperative consumers (the product's
 * `LiveFleetSource`, the twin's render loop) call this. Both share the same socket and the
 * same store, so every surface sees byte-identical state — that is the whole point.
 */
export function acquireStream(): () => void {
  const store = getStreamStore();
  const s = shared!;
  if (!s.client) s.client = new StreamClient({ store });
  s.users += 1;
  if (s.users === 1) s.client.start();
  let released = false;
  return () => {
    if (released) return; // releasing twice must not close the socket out from under others
    released = true;
    s.users -= 1;
    if (s.users === 0) s.client?.stop();
  };
}

function useConnection(): void {
  useEffect(() => acquireStream(), []);
}

/** Generic selector hook. Pass a selector that returns a stable value (or wrap it in useShallow). */
export function useStreamStore<T>(selector: (s: StreamState) => T): T {
  useConnection();
  return useStore(getStreamStore(), selector);
}

export const useStreamStatus = () => useStreamStore((s) => s.status);

export function useStreamMeta() {
  return useStreamStore(
    useShallow((s) => ({
      status: s.status,
      epoch: s.epoch,
      lastSeq: s.lastSeq,
      lastRseq: s.lastRseq,
      reconnects: s.reconnects,
      resyncs: s.resyncs,
      eventsTruncated: s.eventsTruncated,
      contractVersion: s.contractVersion,
    })),
  );
}

export const useSources = () => useStreamStore((s) => s.sources);
export const useEnvironment = () => useStreamStore((s) => s.environment);
export const useMachine = (id: string): Machine | undefined => useStreamStore((s) => s.machines[id]);
export const useMachineIds = (): string[] => useStreamStore(useShallow((s) => Object.keys(s.machines).sort()));
export const useMachines = (): Machine[] =>
  useStreamStore(useShallow((s) => Object.keys(s.machines).sort().map((k) => s.machines[k])));
export const useWorkers = (): Worker[] =>
  useStreamStore(useShallow((s) => Object.keys(s.workers).sort().map((k) => s.workers[k])));
export const useActiveAlerts = (): LiveEvent[] => useStreamStore((s) => s.activeAlerts);

export interface EventFilter {
  types?: string[];
  machineId?: string;
  limit?: number;
}

/** Newest first. */
export function useEvents(filter: EventFilter = {}): LiveEvent[] {
  const { types, machineId, limit = 50 } = filter;
  const key = types?.join(",") ?? "";
  return useStreamStore(
    useShallow((s) => {
      const out: LiveEvent[] = [];
      for (let i = s.events.length - 1; i >= 0 && out.length < limit; i--) {
        const e = s.events[i];
        if (key && !key.split(",").includes(e.event)) continue;
        if (machineId && e.machine_id !== machineId) continue;
        out.push(e);
      }
      return out;
    }),
  );
}
