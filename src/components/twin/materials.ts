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
  gravel: "#a29682",
  gravelDark: "#7d7262",
  topsoil: "#6e5236",
  scrub: "#5c6532",
  scrubDry: "#8c7f4c",
  clay: "#54402e",
  strataLight: "#b89468",
  strataDark: "#5a3f2b",
  water: "#3f5e5a",
  concrete: "#a9a59b",
  safe: "#3ddc84",
  warn: "#ffb020",
  crit: "#ff3b30",
  worker: "#ff7a1a",
  vest: "#f5f24a",
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

/**
 * Compacted haul-road gravel. `u` runs across the road, `v` along it, so the
 * two worn wheel paths are vertical bands and the speckle tiles lengthwise.
 */
export function gravelTexture(): THREE.Texture {
  const tex = fromCanvas("gravel", 256, 256, (ctx) => {
    ctx.fillStyle = PALETTE.gravel;
    ctx.fillRect(0, 0, 256, 256);

    // Seeded speckle so the texture is identical on every load.
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 5200; i++) {
      const shade = rand();
      ctx.fillStyle =
        shade < 0.45 ? "rgba(70,62,50,0.35)" : shade < 0.8 ? "rgba(175,165,145,0.35)" : "rgba(40,36,30,0.4)";
      const s = 1 + rand() * 2.4;
      ctx.fillRect(rand() * 256, rand() * 256, s, s);
    }

    // Wheel paths: packed darker, with a faint tread streak inside each.
    for (const cx of [0.27, 0.73]) {
      const grad = ctx.createLinearGradient((cx - 0.11) * 256, 0, (cx + 0.11) * 256, 0);
      grad.addColorStop(0, "rgba(60,54,44,0)");
      grad.addColorStop(0.5, "rgba(60,54,44,0.32)");
      grad.addColorStop(1, "rgba(60,54,44,0)");
      ctx.fillStyle = grad;
      ctx.fillRect((cx - 0.11) * 256, 0, 0.22 * 256, 256);
      ctx.fillStyle = "rgba(40,36,30,0.18)";
      for (let k = -2; k <= 2; k++) ctx.fillRect(cx * 256 + k * 7, 0, 2, 256);
    }

    // Loose material pushed to the edges by traffic.
    for (const edge of [0, 1]) {
      const grad = ctx.createLinearGradient(edge * 256, 0, (edge ? 0.86 : 0.14) * 256, 0);
      grad.addColorStop(0, "rgba(120,98,70,0.55)");
      grad.addColorStop(1, "rgba(120,98,70,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(edge ? 0.86 * 256 : 0, 0, 0.14 * 256, 256);
    }
  });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Chain-link mesh with transparency, for the perimeter fence. */
export function chainLinkTexture(): THREE.Texture {
  const tex = fromCanvas("chainlink", 64, 64, (ctx) => {
    ctx.clearRect(0, 0, 64, 64);
    ctx.strokeStyle = "rgba(190,196,200,0.95)";
    ctx.lineWidth = 2;
    for (let i = -64; i <= 128; i += 16) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 64, 64);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i, 64);
      ctx.lineTo(i + 64, 0);
      ctx.stroke();
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Rubber conveyor belt with cleats. Scrolled along `v` to run the belt. */
export function beltTexture(): THREE.Texture {
  const tex = fromCanvas("belt", 32, 128, (ctx) => {
    ctx.fillStyle = "#1b1c1e";
    ctx.fillRect(0, 0, 32, 128);
    ctx.fillStyle = "#6b5a42";
    // material riding on the belt
    for (let y = 0; y < 128; y += 9) ctx.fillRect(6 + ((y * 7) % 9), y, 12 + ((y * 3) % 7), 5);
    ctx.fillStyle = "#34373b";
    for (let y = 0; y < 128; y += 32) ctx.fillRect(0, y, 32, 3);
  });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Disposes every cached texture. Called when the scene unmounts. */
export function disposeTextures(): void {
  cache.forEach((t) => t.dispose());
  cache.clear();
}
