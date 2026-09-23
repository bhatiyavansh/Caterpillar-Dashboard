"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { LogOut, Monitor, SlidersHorizontal } from "lucide-react";
import { Button, Select } from "@/components/ui/primitives";
import { MachineApp, type MachineScreen } from "@/components/machine/machine-app";
import { DEVICE_SIZES, type DeviceSizeKey, useMachineStore } from "@/store/machine-store";
import { SimulationControls } from "./simulation-controls";
import { SimulationFrame } from "./simulation-frame";

/** The simulated machine display, in a full-screen overlay over the dashboard. */
export function SimulationStage({ onExit }: { onExit?: () => void }) {
  const deviceSize = useMachineStore((s) => s.deviceSize);
  const setDeviceSize = useMachineStore((s) => s.setDeviceSize);
  const controlsOpen = useMachineStore((s) => s.controlsOpen);
  const toggleControls = useMachineStore((s) => s.toggleControls);
  const [screen, setScreen] = React.useState<MachineScreen>("home");

  return (
    <div className="flex h-full w-full flex-col bg-[#0a0b0d]">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-ink-900 px-4">
        <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-cat-500">
          <Monitor className="size-4" aria-hidden />
          Simulation mode
        </span>
        <span className="hidden text-xs text-muted sm:block">
          CAT 320 · CAT-320-014 · in-cab display emulator
        </span>

        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="device-size" className="hidden text-xs text-muted sm:block">
            Screen size
          </label>
          <Select
            id="device-size"
            value={deviceSize}
            onChange={(e) => setDeviceSize(e.target.value as DeviceSizeKey)}
            className="h-10"
          >
            {(Object.keys(DEVICE_SIZES) as DeviceSizeKey[]).map((k) => (
              <option key={k} value={k}>
                {DEVICE_SIZES[k].label}
              </option>
            ))}
          </Select>
          <Button variant="outline" onClick={toggleControls} aria-pressed={controlsOpen}>
            <SlidersHorizontal className="size-4" aria-hidden />
            {controlsOpen ? "Hide controls" : "Controls"}
          </Button>
          {onExit ? (
            <Button variant="danger" onClick={onExit}>
              <LogOut className="size-4" aria-hidden />
              Exit simulation
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 p-4">
          <SimulationFrame deviceSize={deviceSize}>
            <MachineApp screen={screen} onNavigate={setScreen} />
          </SimulationFrame>
        </div>
        <AnimatePresence>{controlsOpen ? <SimulationControls /> : null}</AnimatePresence>
      </div>
    </div>
  );
}

/** Mounted once at the app root; opens whenever RUN SIMULATION is pressed. */
export function SimulationHost() {
  const open = useMachineStore((s) => s.simulationOpen);
  const close = useMachineStore((s) => s.closeSimulation);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, close]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Machine display simulation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90]"
        >
          <SimulationStage onExit={close} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
