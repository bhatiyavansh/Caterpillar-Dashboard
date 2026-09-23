"use client";

/**
 * The 3D digital twin, mounted inside the product shell.
 *
 * The twin owns its own simulation engine and renders the canvas; this file is
 * the seam that lets the command centre host it without either side knowing
 * about the other's state. Selection is bridged both ways so clicking a machine
 * in the fleet list frames it in 3D, and clicking it in 3D fills the inspector.
 *
 * The 2D site plan remains available as a deliberate fallback: it needs no
 * WebGL, so it is what the demo falls back to on a machine that cannot render
 * the canvas.
 */
import * as React from "react";
import dynamic from "next/dynamic";
import { SitePlan } from "./site-plan";
import type { TwinSceneProps } from "./twin-contract";
import { useTwinStore } from "@/store/twinStore";
import { LoadingState } from "@/components/ui/states";

/** The 3D canvas is real now, so the viewport offers it as the primary view. */
export const hasThreeDimensionalTwin = true;

const SimulationScene = dynamic(
  () => import("./SimulationScene").then((m) => m.SimulationScene),
  {
    ssr: false,
    loading: () => <LoadingState label="Starting the 3D site…" className="h-full" />,
  },
);

/**
 * Keeps the product's selection and the twin's selection in step.
 *
 * Each direction only fires when the two actually differ, so they cannot chase
 * each other in a loop.
 */
function useSelectionBridge(selectedId: string | null, onSelect: (id: string | null) => void) {
  const twinSelected = useTwinStore((s) => s.selectedMachine);
  const selectMachine = useTwinStore((s) => s.selectMachine);

  // Product -> twin.
  React.useEffect(() => {
    if (selectedId && selectedId !== twinSelected) selectMachine(selectedId);
  }, [selectedId, twinSelected, selectMachine]);

  // Twin -> product. The callback is held in a ref so a new function identity
  // from the parent cannot re-fire the bridge on its own.
  const onSelectRef = React.useRef(onSelect);
  React.useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const lastReported = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!twinSelected || twinSelected === lastReported.current) return;
    lastReported.current = twinSelected;
    onSelectRef.current(twinSelected);
  }, [twinSelected]);
}

/** Renders the live 3D world. */
export function TwinScene(props: TwinSceneProps) {
  useSelectionBridge(props.selectedId, props.onSelect);
  return <SimulationScene />;
}

/** The no-WebGL fallback, and the view used for replay scrubbing. */
export function TwinPlan(props: TwinSceneProps) {
  return <SitePlan {...props} />;
}
