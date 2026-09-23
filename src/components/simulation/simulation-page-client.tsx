"use client";

import { useRouter } from "next/navigation";
import { SimulationStage } from "./simulation-host";

/**
 * Standalone /simulation route — the same stage the records pages open inline.
 *
 * Exiting returns the operator wherever they came from rather than to a fixed
 * route, so opening the emulator from the cab does not dump them in records.
 */
export function SimulationPageClient() {
  const router = useRouter();

  const exit = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/command");
  };

  return (
    <div className="h-dvh w-full">
      <SimulationStage onExit={exit} />
    </div>
  );
}
