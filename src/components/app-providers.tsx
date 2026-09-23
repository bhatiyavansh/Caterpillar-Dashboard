"use client";

import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SensorEngine } from "@/components/simulation/sensor-engine";
import { SimulationHost } from "@/components/simulation/simulation-host";
import { AlertSoundWatcher } from "@/components/alerts/alert-sound-watcher";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={200}>
      <SensorEngine />
      <AlertSoundWatcher />
      {children}
      <SimulationHost />
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#14171c",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "#e9edf2",
          },
        }}
      />
    </TooltipProvider>
  );
}
