"use client";

/**
 * The static world: ground, roads, zone demarcation and set dressing.
 * Nothing in here changes after mount except the terrain's wet-weather shading.
 */

import { Terrain } from "./Terrain";
import { Roads } from "./Roads";
import { TaskZones } from "./TaskZone";
import { SiteProps } from "./SiteProps";
import { SiteDetails } from "./SiteDetails";

export function Site() {
  return (
    <group>
      <Terrain />
      <Roads />
      <TaskZones />
      <SiteProps />
      <SiteDetails />
    </group>
  );
}
