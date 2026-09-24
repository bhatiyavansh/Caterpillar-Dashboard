"use client";

/**
 * Shared palette and procedurally generated textures.
 *
 * Everything is drawn to a canvas at runtime — the prototype ships with zero
 * external image or model assets, so it works offline and loads instantly.
 */

import * as THREE from "three";

export const PALETTE = {
  catYellow: "#ffcd11",
  catYellowDark: "#d9a800",
  steel: "#2b3036",
  steelDark: "#1a1d21",
  steelLight: "#454d55",
  glass: "#8fc4e8",
  track: "#15181b",
  dirt: "#6b5a42",
  dirtDark: "#4f412e",
  dirtLight: "#8a7557",
  road: "#31343a",
  safe: "#3ddc84",
  warn: "#ffb020",
  crit: "#ff3b30",
  worker: "#ff7a1a",
  vest: "#f5f24a",
} as const;

/**
 * Ground colour per running surface. Keyed by the same classes as the
 * friction table (lib/twin/surface.ts), so colour and grip always agree.
 */
export const SURFACE_COLORS = {
  road: "#34373c",
  packed: "#7a6a52",
  natural: "#6b5a42",
  rock_face: "#5d544a",
  gravel_windrow: "#8f8778",
  loose_spoil: "#80613f",
  wet_clay: "#4d4234",
} as const;

const cache = new Map<string, THREE.Texture>();

function fromCanvas(
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  draw(ctx);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  cache.set(key, texture);
  return texture;
}

/**
 * Track shoe pattern. Scrolled via `map.offset` as the machine travels, which
 * is the cheapest convincing way to animate tracks — two meshes, one texture.
 */
export function trackTexture(): THREE.Texture {
  const tex = fromCanvas("track", 128, 64, (ctx) => {
    ctx.fillStyle = PALETTE.track;
    ctx.fillRect(0, 0, 128, 64);

    // Shoe plates.
    for (let i = 0; i < 8; i++) {
      const x = i * 16;
      ctx.fillStyle = "#23282d";
      ctx.fillRect(x + 1, 0, 13, 64);
      ctx.fillStyle = "#0e1012";
      ctx.fillRect(x + 12, 0, 4, 64);
      // Grouser bar down the middle of each shoe.
      ctx.fillStyle = "#3a4249";
      ctx.fillRect(x + 4, 22, 7, 20);
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(4, 1);
  return tex;
}

/** Zone signboard face: label over a coloured header bar. */
export function signTexture(label: string, sub: string, color: string): THREE.Texture {
  return fromCanvas(`sign:${label}:${sub}:${color}`, 512, 160, (ctx) => {
    ctx.fillStyle = "#101216";
    ctx.fillRect(0, 0, 512, 160);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 512, 10);
    ctx.fillRect(0, 150, 512, 10);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 46px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 256, 66, 470);

    ctx.fillStyle = color;
    ctx.font = "bold 26px system-ui, -apple-system, sans-serif";
    ctx.fillText(sub, 256, 112, 470);
  });
}

/** Diagonal hazard stripes for barriers and the restricted-zone fence. */
export function hazardTexture(color: string = PALETTE.catYellow): THREE.Texture {
  const tex = fromCanvas(`hazard:${color}`, 64, 64, (ctx) => {
    ctx.fillStyle = "#101216";
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = color;
    ctx.lineWidth = 14;
    for (let i = -64; i < 128; i += 28) {
      ctx.beginPath();
      ctx.moveTo(i, -10);
      ctx.lineTo(i + 74, 74);
      ctx.stroke();
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Disposes every cached texture. Called when the scene unmounts. */
export function disposeTextures(): void {
  cache.forEach((t) => t.dispose());
  cache.clear();
}
