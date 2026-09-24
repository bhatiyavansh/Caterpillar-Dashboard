"use client";

/**
 * `/hmi`: the in-cab display with the test bench beside it.
 *
 * Wide screens put them side by side, the display on a softly lit stage so
 * the device reads as hardware. Narrower ones stack them, and the display
 * keeps its 16:10 shape by sizing to the width instead.
 */
import * as React from "react";
import { Cpu, MonitorSmartphone } from "lucide-react";
import { TestBench } from "./test-bench";
import { VehicleDisplay, type VehicleDisplayHandle } from "./vehicle-display";

const noopSubscribe = () => () => {};

export function HmiPage() {
  const display = React.useRef<VehicleDisplayHandle>(null);
  // Both halves read the live simulation, which only exists in the browser.
  const isClient = React.useSyncExternalStore(noopSubscribe, () => true, () => false);
  return (
    <div className="flex h-full min-w-0 flex-col gap-4 overflow-y-auto overflow-x-hidden p-3 sm:p-5 xl:flex-row xl:overflow-hidden">
      <div className="flex min-w-0 flex-col gap-3 xl:min-h-0 xl:flex-1">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
          <span className="grid size-9 place-items-center rounded-xl bg-cat-500/12 text-cat-500">
            <MonitorSmartphone className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-zinc-50">In-cab display</h1>
            <p className="text-xs text-muted">EXC001 · CAT 320 · designed at 1280 × 800, scaled to fit</p>
          </div>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-zinc-300">
            <Cpu className="size-3.5 text-status-ok" aria-hidden />
            Live machine · rigid-body physics
          </span>
        </header>
        <div
          className="relative aspect-[1308/828] w-full shrink-0 overflow-hidden rounded-[36px] xl:aspect-auto xl:min-h-0 xl:flex-1"
          style={{
            background:
              "radial-gradient(80% 70% at 50% 45%, rgba(255,205,17,0.06), transparent 70%), radial-gradient(60% 60% at 50% 110%, rgba(74,168,255,0.07), transparent 70%)",
          }}
        >
          <VehicleDisplay ref={display} />
        </div>
      </div>
      <div className="h-[760px] min-w-0 shrink-0 xl:h-full xl:w-[400px]">
        {isClient ? <TestBench display={display} /> : null}
      </div>
    </div>
  );
}
