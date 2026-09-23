"use client";

/**
 * Measures an element's own layout box.
 *
 * The twin renders at very different sizes — full-screen at /twin, and inside a
 * CSS-scaled in-cab frame on /simulation — so the HUD picks its density from
 * the space it actually has rather than from the browser viewport. Media
 * queries and `vh` units are wrong here: they describe the window, not the box.
 */

import { useLayoutEffect, useRef, useState } from "react";

export interface Size {
  width: number;
  height: number;
}

export type DensityTier = "compact" | "medium" | "full";

/**
 * Thresholds are driven by the widest element, not the columns.
 *
 * The side columns only need ~250px + ~270px, but the centre column has to fit
 * the full key-hint strip (~700px) plus the camera bar. Sizing off the columns
 * alone let the hint strip overflow into its neighbours, so "full" demands the
 * room that strip actually needs.
 */
export function densityOf({ width, height }: Size): DensityTier {
  if (width === 0) return "full";
  if (width < 1100 || height < 620) return "compact";
  if (width < 1400 || height < 800) return "medium";
  return "full";
}

export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      // clientWidth/Height report the zoomed coordinate space, which is the
      // space children will actually lay out in.
      setSize((prev) =>
        prev.width === el.clientWidth && prev.height === el.clientHeight
          ? prev
          : { width: el.clientWidth, height: el.clientHeight },
      );
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, size, density: densityOf(size) };
}
