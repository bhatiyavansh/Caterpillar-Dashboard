"use client";

import { useRouter } from "next/navigation";
import { MachineApp, type MachineScreen } from "./machine-app";

const paths: Record<MachineScreen, string> = {
  home: "/machine",
  assistant: "/machine/assistant",
  inspection: "/machine/inspection",
  alerts: "/machine/alerts",
  camera: "/machine/camera",
  map: "/machine/map",
  performance: "/machine/performance",
  status: "/machine/status",
  operator: "/machine/operator",
  notifications: "/machine/notifications",
};

/**
 * The in-cab app mounted as a real route. Same components as the simulator —
 * only the navigation mechanism differs.
 */
export function MachineRoute({ screen }: { screen: MachineScreen }) {
  const router = useRouter();
  return (
    <div className="h-full w-full">
      <MachineApp screen={screen} onNavigate={(s) => router.push(paths[s])} />
    </div>
  );
}
