"use client";

import { useRouter } from "next/navigation";
import { SimulationStage } from "./simulation-host";

/** Standalone /simulation route — the same stage the dashboard opens inline. */
export function SimulationPageClient() {
  const router = useRouter();
  return (
    <div className="h-dvh w-full">
      <SimulationStage onExit={() => router.push("/dashboard")} />
    </div>
  );
}
