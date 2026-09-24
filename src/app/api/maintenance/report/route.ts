/**
 * Report drafting for the breakdown workflow.
 *
 * Same pattern as the backend's report service: the facts are computed on the
 * client from telemetry, the model only writes the summary paragraph, and a
 * summary that quotes any number not present in the facts is thrown away in
 * favour of the template the client sent. Retrieval grounds the report in the
 * site manuals either way.
 */
import { searchManuals, type ManualHit } from "@/lib/training/manual-search";

export const dynamic = "force-dynamic";

const LLM_URL = process.env.LLAMACPP_BASE_URL ?? "http://127.0.0.1:8081/v1";
const DEADLINE_MS = 20_000;

interface ReportRequest {
  kind: "breakdown" | "service";
  facts: Record<string, string | number>;
  query: string;
  /** What ships if the model is unavailable or fails the grounding check. */
  fallback: string;
}

export interface ReportResponse {
  summary: string;
  source: "llm" | "template";
  citations: ManualHit[];
  latencyMs: number;
  /** Why the model's draft was rejected, when it was. */
  rejected?: string;
}

const SYSTEM = `You write equipment maintenance reports for a construction site.
Rules:
- Write one paragraph of 3 to 4 plain sentences. No lists, no markdown, no headings.
- Use ONLY the facts given. Never invent a number, part, time or name.
- Say what failed, the most likely cause with its confidence, the machine's current state, and what happens next.`;

const numbers = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

/** Every number in the draft must appear somewhere in the facts. Small counts are allowed. */
function ungrounded(summary: string, facts: ReportRequest["facts"]): number[] {
  const known = new Set(numbers(JSON.stringify(facts)));
  return numbers(summary).filter((n) => n > 10 && !known.has(n));
}

export async function POST(request: Request): Promise<Response> {
  const started = Date.now();
  let body: ReportRequest;
  try {
    body = (await request.json()) as ReportRequest;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const citations = await searchManuals(body.query, 2).catch(() => [] as ManualHit[]);
  const template = (rejected?: string): ReportResponse => ({
    summary: body.fallback,
    source: "template",
    citations,
    latencyMs: Date.now() - started,
    rejected,
  });

  try {
    const res = await fetch(`${LLM_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(DEADLINE_MS)]),
      body: JSON.stringify({
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Report type: ${body.kind}.\nFacts (JSON):\n${JSON.stringify(body.facts, null, 1)}`,
          },
        ],
        max_tokens: 180,
        temperature: 0.2,
      }),
    });
    if (!res.ok) return Response.json(template());
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const summary = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (summary.length < 40) return Response.json(template("draft too short"));
    const bad = ungrounded(summary, body.facts);
    if (bad.length) return Response.json(template(`quoted numbers not in the facts: ${bad.join(", ")}`));
    const out: ReportResponse = { summary, source: "llm", citations, latencyMs: Date.now() - started };
    return Response.json(out);
  } catch {
    return Response.json(template());
  }
}
