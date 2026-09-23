"use client";

/**
 * Floating sensor tags anchored to each machine.
 *
 * Rather than drei's <Html> (which mounts a React root per label and trips
 * StrictMode's double-mount check), the world position is projected to screen
 * space inside the Canvas and written to a plain module-level table. The DOM
 * layer then moves each tag with a transform on its own rAF loop: smooth at
 * 60fps, while the text only re-renders at the HUD's throttled rate.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { MACHINES } from "@/lib/twin/simulation";
import { toKmh } from "@/lib/twin/telemetry";
import { useTwinStore } from "@/store/twinStore";

interface LabelSlot {
  x: number;
  y: number;
  visible: boolean;
}

/** Screen-space position per machine, refreshed every frame by the projector. */
const slots = new Map<string, LabelSlot>(
  MACHINES.map((m) => [m.id, { x: 0, y: 0, visible: false }]),
);

/** Tag heights roughly match each machine's silhouette. */
const HEIGHTS: Record<string, number> = {
  EXC001: 5.4,
  DZR001: 4.4,
  LDR001: 4.8,
  TRK001: 5.0,
};

/* ------------------------------------------------------------------ */
/*  Inside the Canvas                                                  */
/* ------------------------------------------------------------------ */

export function LabelProjector() {
  const engine = useTwinStore((s) => s.engine);
  const size = useThree((s) => s.size);
  const point = useRef(new THREE.Vector3());

  useFrame(({ camera }) => {
    for (const machine of MACHINES) {
      const slot = slots.get(machine.id);
      if (!slot) continue;

      const t = engine.telemetryOf(machine.id);
      const v = point.current.set(t.x, t.y + (HEIGHTS[machine.id] ?? 4.6), t.z);
      v.project(camera);

      // z > 1 means the point is behind the camera and would mirror onto screen.
      const onScreen =
        v.z < 1 && v.x > -1.25 && v.x < 1.25 && v.y > -1.25 && v.y < 1.25;

      slot.x = (v.x * 0.5 + 0.5) * size.width;
      slot.y = (-v.y * 0.5 + 0.5) * size.height;
      slot.visible = onScreen;
    }
  });

  return null;
}

/* ------------------------------------------------------------------ */
/*  In the DOM overlay                                                 */
/* ------------------------------------------------------------------ */

const ACTIVITY_TONE: Record<string, string> = {
  idle: "text-zinc-400",
  traveling: "text-status-info",
  digging: "text-cat-500",
  loading: "text-cat-500",
  swinging: "text-cat-500",
  emergency_stop: "text-status-crit",
};

function Row({
  label,
  value,
  unit,
  warn,
}: {
  label: string;
  value: string;
  unit: string;
  warn?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1">
      <dt className="text-zinc-500">{label}</dt>
      <dd className={warn ? "font-bold text-status-warn" : "text-zinc-200"}>
        {value}
        <span className="ml-0.5 text-zinc-600">{unit}</span>
      </dd>
    </div>
  );
}

function MachineTag({ machineId }: { machineId: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const selected = useTwinStore((s) => s.selectedMachine === machineId);
  const select = useTwinStore((s) => s.selectMachine);
  const telemetry = useTwinStore((s) =>
    s.snapshot.machines.find((m) => m.machineId === machineId),
  );
  const descriptor = MACHINES.find((m) => m.id === machineId);

  // Position is driven outside React so the tag tracks the machine smoothly.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = holder.current;
      const slot = slots.get(machineId);
      if (el && slot) {
        el.style.transform = `translate3d(${slot.x}px, ${slot.y}px, 0) translate(-50%, -100%)`;
        el.style.opacity = slot.visible ? "1" : "0";
        el.style.pointerEvents = slot.visible ? "auto" : "none";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [machineId]);

  if (!telemetry || !descriptor) return null;
  const critical = telemetry.activity === "emergency_stop";

  return (
    <div
      ref={holder}
      className="absolute left-0 top-0 will-change-transform"
      style={{ opacity: 0 }}
    >
      <button
        type="button"
        onClick={() => select(machineId)}
        className={`w-max min-w-24 cursor-pointer rounded border bg-ink-950/85 px-2 py-1.5 text-left font-mono backdrop-blur-sm transition ${
          selected
            ? "border-cat-500/80 shadow-[0_0_0_1px_rgba(255,205,17,0.25)]"
            : "border-white/15 hover:border-white/40"
        }`}
      >
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block size-1.5 rounded-full ${
              critical ? "bg-status-crit" : selected ? "bg-cat-500" : "bg-status-ok"
            }`}
          />
          <span className="text-[11px] font-bold tracking-wider text-zinc-100">
            {machineId}
          </span>
        </div>
        <div className="text-[9px] uppercase tracking-wider text-zinc-500">
          {descriptor.model}
        </div>
        <div
          className={`text-[9px] font-bold uppercase tracking-wider ${
            ACTIVITY_TONE[telemetry.activity] ?? "text-zinc-400"
          }`}
        >
          {telemetry.activity.replace("_", " ")}
        </div>

        {selected ? (
          <dl className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 border-t border-white/10 pt-1.5 text-[9px]">
            <Row label="ENG" value={`${Math.round(telemetry.engineRpm)}`} unit="rpm" />
            <Row
              label="HYD"
              value={`${Math.round(telemetry.hydraulicTemperature)}`}
              unit="°C"
              warn={telemetry.hydraulicTemperature > 92}
            />
            <Row
              label="FUEL"
              value={`${Math.round(telemetry.fuel)}`}
              unit="%"
              warn={telemetry.fuel < 15}
            />
            <Row label="LOAD" value={(telemetry.payload / 1000).toFixed(2)} unit="T" />
            <Row label="SPD" value={Math.abs(toKmh(telemetry.speed)).toFixed(1)} unit="km/h" />
            <Row
              label="PROX"
              value={
                Number.isFinite(telemetry.nearestPerson)
                  ? telemetry.nearestPerson.toFixed(1)
                  : "--"
              }
              unit="m"
              warn={telemetry.nearestPerson <= 10}
            />
          </dl>
        ) : null}
      </button>
    </div>
  );
}

export function MachineLabels() {
  const hidden = useTwinStore((s) => s.cameraMode === "driver");

  return (
    <div
      aria-hidden={hidden}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ visibility: hidden ? "hidden" : "visible" }}
    >
      {MACHINES.map((m) => (
        <MachineTag key={m.id} machineId={m.id} />
      ))}
    </div>
  );
}
