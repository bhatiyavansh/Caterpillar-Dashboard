/**
 * The contract between the product shell and the 3D digital twin.
 *
 * The twin owner implements `TwinSceneComponent` in `twin-scene.tsx` and does
 * not need to know anything else about the product. Everything the scene needs
 * arrives through these props; everything it wants to report goes back through
 * the callbacks. No shared state, no shared store.
 */
import type { Machine, SiteAlert, TimelineMarker } from "@/lib/api/contracts";

export interface TwinLayers {
  /** Safety bubbles around each machine. */
  bubbles: boolean;
  /** Predicted-path lines between machines that may conflict. */
  v2v: boolean;
  /** Near-miss and idle density overlay. */
  heatmap: boolean;
  /** Worker markers. */
  workers: boolean;
  /** Zone boundaries and labels. */
  zones: boolean;
}

export interface TwinSceneProps {
  machines: Machine[];
  alerts: SiteAlert[];
  /** Machine the inspector is showing, or null. */
  selectedId: string | null;
  onSelect: (machineId: string | null) => void;
  layers: TwinLayers;
  /**
   * Null when following live data. A timestamp means the twin is scrubbed to a
   * past moment and should render the replay state for that instant.
   */
  replayAt: number | null;
  markers: TimelineMarker[];
  /** Grows when the stage is expanded, so the scene can re-fit its camera. */
  expanded: boolean;
}

export const DEFAULT_LAYERS: TwinLayers = {
  bubbles: true,
  v2v: true,
  heatmap: false,
  workers: true,
  zones: true,
};

/** Site extent in metres, shared by the 2D plan and the 3D scene. */
export const SITE_EXTENT = { minX: -110, maxX: 110, minZ: -90, maxZ: 110 };

export interface SiteZoneShape {
  id: string;
  label: string;
  x: number;
  z: number;
  w: number;
  d: number;
  kind: "dig" | "haul" | "stock" | "service";
}

/** Zones as the product draws them. Mirrors the simulator's site layout. */
export const SITE_ZONES: SiteZoneShape[] = [
  { id: "zone-b", label: "Zone B", x: -46, z: -80, w: 84, d: 62, kind: "dig" },
  { id: "zone-c", label: "Zone C", x: 14, z: -46, w: 64, d: 56, kind: "dig" },
  { id: "haul", label: "Haul road", x: -10, z: 4, w: 96, d: 30, kind: "haul" },
  { id: "stockpile", label: "Stockpile", x: -80, z: 16, w: 58, d: 48, kind: "stock" },
  { id: "yard", label: "Yard and fuel bay", x: -34, z: 62, w: 76, d: 40, kind: "service" },
];
