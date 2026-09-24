"use client";

/**
 * Page shell for the digital twin.
 *
 * `TwinStage` fills whatever box it is given, so it works both full-screen at
 * /twin and inside the in-cab device frame on /simulation. The scene is
 * client-only, mounted behind a `mounted` gate so the simulation clock and
 * randomised fleet state can never produce a hydration mismatch, and WebGL is
 * never asked for during SSR.
 */

import { Suspense, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useTwinStore } from "@/store/twinStore";
import { useVehicleControls } from "@/hooks/twin/useVehicleControls";
import { useLiveLink } from "@/hooks/twin/useLiveLink";
import { useLocalControl } from "@/hooks/twin/useLocalControl";
import { CommandCenter } from "./CommandCenter";

const SimulationScene = dynamic(
  () => import("./SimulationScene").then((m) => m.SimulationScene),
  { ssr: false, loading: () => <BootScreen /> },
);

function BootScreen() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-ink-950">
      <div className="text-center">
        <div className="mx-auto mb-4 h-1.5 w-40 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/3 animate-[scan_1.4s_ease-in-out_infinite] rounded-full bg-cat-500" />
        </div>
        <div className="text-sm font-bold tracking-[0.22em] text-cat-500">CAT COPILOT</div>
        <div className="mt-1.5 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
          Initialising digital twin
        </div>
      </div>
    </div>
  );
}

export interface TwinStageProps {
  /**
   * Whether this stage owns the keyboard. False when the twin is mounted but
   * another view (the in-cab HMI) is in front of it.
   */
  active?: boolean;
  /**
   * Trims the overlay to the essentials and enlarges it. Used inside the in-cab
   * frame, where the whole stage is CSS-scaled down and a full-size HUD would
   * render at unreadable point sizes.
   */
  dense?: boolean;
  /**
   * Whether this stage may attach itself to the live simulator.
   *
   * Set `false` for training: a lesson has to own the machine. Live frames
   * overwrite position and joint angles every frame, so the learner's
   * keypresses would go nowhere and every step would time out. With this off
   * the stage never probes for a simulator and holds the keyboard source for
   * as long as it is mounted.
   */
  liveLink?: boolean;
  /**
   * Whether to draw the twin's own HUD (telemetry, fleet strip, key hints).
   * Off for the guided lesson, which brings its own focused overlay.
   */
  hud?: boolean;
}

/** Fills its positioned parent. */
export function TwinStage({
  active = true,
  dense = false,
  liveLink = true,
  hud = true,
}: TwinStageProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Keyboard lives here, outside the Canvas — never inside a 3D component.
  useVehicleControls(mounted && active);
  // Attach to the simulator if one is running; otherwise stay self-contained.
  useLiveLink(mounted && active && liveLink);
  // Training mode: hold the keyboard source so the learner actually drives.
  useLocalControl(mounted && !liveLink);

  return (
    <div className="absolute inset-0 overflow-hidden bg-ink-950">
      {/* faint instrument grid behind the scene */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />

      {mounted ? (
        <>
          <div className="absolute inset-0 z-1">
            <SimulationScene />
          </div>
          {hud ? <CommandCenter dense={dense} /> : null}
        </>
      ) : (
        <BootScreen />
      )}
    </div>
  );
}

/**
 * `/twin?xray=<machine>&c=<component>` opens the X-ray inspection on arrival.
 * Every anomaly and alert surface in the product links here (use-xray.ts).
 */
function XrayDeepLink() {
  const params = useSearchParams();
  const machine = params.get("xray");
  const component = params.get("c");
  useEffect(() => {
    if (machine && /^[A-Z0-9-]{3,24}$/.test(machine)) {
      useTwinStore.getState().openXray(machine, component && /^[a-z_]{2,40}$/.test(component) ? component : null);
    }
  }, [machine, component]);
  return null;
}

/**
 * The /twin route.
 *
 * It fills the app shell's content area rather than covering the viewport, so
 * the primary navigation stays visible. The immersive full-screen view is one
 * click away through the expand control in the twin's own HUD.
 */
export function TwinExperience() {
  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-ink-950">
      <TwinStage />
      <Suspense fallback={null}>
        <XrayDeepLink />
      </Suspense>
    </div>
  );
}
