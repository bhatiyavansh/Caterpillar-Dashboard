"use client";

/**
 * The static world: ground, roads, zone demarcation and set dressing.
 * Mostly static; the conveyor, gate, pond and machine dust are the only moving parts.
 */

import { Terrain } from "./Terrain";
import { Roads } from "./Roads";
import { TaskZones } from "./TaskZone";
import { SiteProps } from "./SiteProps";
import { SiteDetails } from "./SiteDetails";
import { MachineDust } from "./MachineDust";

export function Site() {
  return (
    <group>
      <Terrain />
      <Roads />
      <TaskZones />
      <SiteProps />
      <SiteDetails />
      <MachineDust />
    </group>
  );
}
