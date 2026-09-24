/**
 * Manual retrieval for the training coach. Server-only: imported by the
 * `/api/coach` route handler, never by a client component.
 *
 * Prefers the backend's hybrid (embedding + keyword) search. When the backend
 * is not running it falls back to a keyword scorer over the very same chunk
 * file the backend indexes, so the coach is grounded in the manuals either way.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface ManualHit {
  citation: string;
  title: string;
  quote: string;
  via: "backend" | "local";
}

interface Chunk {
  citation: string;
  title: string;
  text: string;
}

const BACKEND = process.env.COPILOT_API_URL ?? "http://127.0.0.1:8000";
const STOP = new Set("the a an and or of to in on for with is are be it this that as at by from your you".split(" "));

let chunks: Promise<Chunk[]> | null = null;

function loadChunks(): Promise<Chunk[]> {
  chunks ??= readFile(path.join(process.cwd(), "backend", "data", "index", "chunks.json"), "utf8")
    .then((raw) => JSON.parse(raw) as Chunk[])
    .catch(() => []);
  return chunks;
}

const tokens = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

async function localSearch(query: string, k: number): Promise<ManualHit[]> {
  const all = await loadChunks();
  if (!all.length) return [];
  const q = tokens(query);
  // Inverse document frequency, so "machine" counts for less than "seatbelt".
  const df = new Map<string, number>();
  for (const c of all) for (const w of new Set(tokens(c.text))) df.set(w, (df.get(w) ?? 0) + 1);
  const scored = all.map((c) => {
    const words = tokens(`${c.title} ${c.text}`);
    let score = 0;
    for (const w of q) {
      const tf = words.filter((x) => x === w).length;
      if (tf) score += (1 + Math.log(tf)) * Math.log(all.length / (df.get(w) ?? 1));
    }
    return { c, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ c }) => ({ citation: c.citation, title: c.title, quote: c.text.slice(0, 400), via: "local" as const }));
}

export async function searchManuals(query: string, k = 2): Promise<ManualHit[]> {
  try {
    const res = await fetch(`${BACKEND}/api/rag/search?q=${encodeURIComponent(query)}&k=${k}`, {
      signal: AbortSignal.timeout(900),
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as { hits: { citation: string; title: string; quote: string }[] };
      if (data.hits?.length) {
        return data.hits.slice(0, k).map((h) => ({ citation: h.citation, title: h.title, quote: h.quote.slice(0, 400), via: "backend" }));
      }
    }
  } catch {
    // Backend down: fall through to the local index.
  }
  return localSearch(query, k);
}
