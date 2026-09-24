/**
 * Ground friction by running surface and weather.
 *
 * The surface classes come from `surfaceAt` in terrain.ts — the same
 * classification that colours the terrain mesh — so there is exactly one map
 * of "what the ground is made of", read by the eye and by the tyres alike.
 *
 * Values are Coulomb coefficients for rubber/steel on that ground, in the
 * ranges published for haul-road design (dry compacted gravel ~0.8, wet
 * clay ~0.2). Rain is the one weather that changes them; fog and heat leave
 * the ground as it was.
 */

import type { WeatherMode } from "@/types/twin";
import type { SurfaceClass } from "./terrain";

export const FRICTION: Record<SurfaceClass, { dry: number; wet: number }> = {
  road: { dry: 0.85, wet: 0.55 },
  packed: { dry: 0.8, wet: 0.5 },
  natural: { dry: 0.7, wet: 0.42 },
  rock_face: { dry: 0.75, wet: 0.6 },
  gravel_windrow: { dry: 0.55, wet: 0.4 },
  // Tipped spoil turns to slop in rain: this is what makes the dump ramp bite.
  loose_spoil: { dry: 0.5, wet: 0.16 },
  wet_clay: { dry: 0.35, wet: 0.15 },
};

/**
 * Friction for a surface right now. `wetness` is the engine's 0..1 soak
 * level, so the ground dries and soaks gradually rather than switching.
 */
export function frictionFor(surface: SurfaceClass, wetness: number): number {
  const f = FRICTION[surface];
  return f.dry + (f.wet - f.dry) * Math.min(Math.max(wetness, 0), 1);
}

/** Weather -> target wetness, for callers that do not track the soak. */
export function wetnessFor(weather: WeatherMode): number {
  return weather === "rain" ? 1 : 0;
}
