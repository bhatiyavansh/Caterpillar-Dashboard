"use client";

/**
 * Swap point for the 3D digital twin.
 *
 * The twin owner replaces the body of `TwinScene` with the React Three Fiber
 * canvas. The props it receives are fixed by `TwinSceneProps`, so nothing else
 * in the product has to change, and `hasThreeDimensionalTwin` flips to `true`
 * so the viewport stops offering the 2D plan as the primary view.
 *
 * Until then this renders the live 2D site plan, which is a real working view
 * rather than a placeholder — and stays available as the fallback afterwards.
 */
import { SitePlan } from "./site-plan";
import type { TwinSceneProps } from "./twin-contract";

/** Flip to `true` in the same commit that lands the R3F canvas below. */
export const hasThreeDimensionalTwin = false;

export function TwinScene(props: TwinSceneProps) {
  return <SitePlan {...props} />;
}
