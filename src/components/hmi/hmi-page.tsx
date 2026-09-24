"use client";

/**
 * `/hmi`: the in-cab display with the test bench beside it.
 *
 * Wide screens put them side by side. Narrower ones stack them, and the
 * display keeps its 16:10 shape by sizing to the width instead.
 */
import * as React from "react";
import { TestBench } from "./test-bench";
import { VehicleDisplay, type VehicleDisplayHandle } from "./vehicle-display";

const noopSubscribe = () => () => {};

export function HmiPage() {
  const display = React.useRef<VehicleDisplayHandle>(null);
  // Both halves read the live simulation, which only exists in the browser.
  const isClient = React.useSyncExternalStore(noopSubscribe, () => true, () => false);
  return (
    <div className="flex h-full min-w-0 flex-col gap-4 overflow-y-auto overflow-x-hidden p-3 sm:p-5 xl:flex-row xl:overflow-hidden">
      <div className="aspect-[1308/828] w-full shrink-0 xl:aspect-auto xl:h-full xl:min-w-0 xl:flex-1">
        <VehicleDisplay ref={display} />
      </div>
      <div className="min-w-0 xl:w-[380px] xl:shrink-0 xl:overflow-y-auto xl:overflow-x-hidden xl:pr-1">
        {isClient ? <TestBench display={display} /> : null}
      </div>
    </div>
  );
}
