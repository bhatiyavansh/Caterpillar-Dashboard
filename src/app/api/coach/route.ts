/**
 * The training coach's voice: local llama.cpp, grounded in the site manuals.
 *
 * The browser never talks to the model directly, so the endpoint can be
 * swapped for a hosted one without touching the UI.
 *
 * The model is only ever asked *what to say* at a step boundary. Whether the
 * step passed was already decided by the telemetry validator before this
 * request was made; the prompt states the verdict as a fact.
 *
 * Measured on this machine: ~10 tok/s on CPU. Replies are capped at 80 tokens,
 * and anything slower than the deadline falls back to the scripted line.
 */
import { searchManuals, type ManualHit } from "@/lib/training/manual-search";
import type { CoachRequest, CoachResponse, CoachTool } from "@/lib/training/coach-types";

export const dynamic = "force-dynamic";

const LLM_URL = process.env.LLAMACPP_BASE_URL ?? "http://127.0.0.1:8081/v1";
const DEADLINE_MS = 15_000;

/** Top-level `json_schema`: on this llama.cpp build `response_format` is silently ignored. */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tool", "say"],
  properties: {
    tool: { type: "string", enum: ["say", "remediate", "demo"] },
    say: { type: "string", maxLength: 240 },
  },
};

const SYSTEM = `You are a patient CAT 320 excavator instructor coaching a learner in a simulator.
Rules:
- Reply in one or two short spoken sentences, under 35 words. No lists, no markdown.
- The learner drives with the keyboard. Name keys exactly as given (e.g. "UP ARROW", "SHIFT and LEFT ARROW").
- The step result is decided by machine sensors and is stated to you as fact. Never contradict it.
- tool "say": normal instruction or praise. tool "remediate": the learner failed; give a simpler, more concrete instruction.
  tool "demo": the learner failed twice or more; tell them to watch the highlighted keys and try again.
- If a manual excerpt is given and relevant, weave in one safety point from it in plain words.`;

function userPrompt(r: CoachRequest, manual: ManualHit | null): string {
  const keys = r.keys.length ? r.keys.join(" + ") : "no keys (hands off)";
  const lines = [
    `Learner: ${r.learner.name}, ${r.learner.level}, weakest skill ${r.learner.weakest}.`,
    `Module: ${r.module}. Step: ${r.step}`,
    `Real control: ${r.realControl}. Simulator keys: ${keys}.`,
    `Machine now: ${r.digest}.`,
  ];
  if (r.event === "brief") lines.push(`EVENT: step starting. Give the instruction.`);
  if (r.event === "pass") lines.push(`EVENT: sensors CONFIRM the step passed. Praise briefly and add one practical tip.`);
  if (r.event === "timeout")
    lines.push(`EVENT: sensors say the step FAILED (attempt ${r.attempt}). Diagnosis: ${r.reason}. Help them succeed next try.`);
  if (manual) lines.push(`Manual excerpt (${manual.citation}): "${manual.quote}"`);
  return lines.join("\n");
}

function scripted(r: CoachRequest, citation: ManualHit | null, started: number): CoachResponse {
  const tool: CoachTool = r.event === "timeout" ? (r.attempt >= 2 ? "demo" : "remediate") : "say";
  const say = r.event === "timeout" ? `${r.reason ?? "Not quite."} ${r.scripted}` : r.scripted;
  return { tool, say, source: "scripted", citation, latencyMs: Date.now() - started };
}

export async function POST(request: Request): Promise<Response> {
  const started = Date.now();
  let body: CoachRequest;
  try {
    body = (await request.json()) as CoachRequest;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  // Ground only the safety-relevant moments: the brief and a failure.
  const manual =
    body.event === "pass" ? null : (await searchManuals(`${body.module} ${body.realControl} excavator safety`, 1))[0] ?? null;

  try {
    const res = await fetch(`${LLM_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // A superseded line is cancelled by the client; pass that through so
      // llama-server drops the work instead of finishing it for nobody.
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(DEADLINE_MS)]),
      body: JSON.stringify({
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt(body, manual) },
        ],
        max_tokens: 80,
        temperature: 0.3,
        json_schema: SCHEMA,
      }),
    });
    if (!res.ok) return Response.json(scripted(body, manual, started));
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "") as { tool?: string; say?: string };
    const tool = (["say", "remediate", "demo"] as const).find((t) => t === parsed.tool);
    if (!tool || typeof parsed.say !== "string" || !parsed.say.trim()) {
      return Response.json(scripted(body, manual, started));
    }
    const out: CoachResponse = { tool, say: parsed.say.trim(), source: "live", citation: manual, latencyMs: Date.now() - started };
    return Response.json(out);
  } catch {
    return Response.json(scripted(body, manual, started));
  }
}

/** Health + pre-warm: a one-token request so the first real line isn't cold. */
export async function GET(): Promise<Response> {
  try {
    const res = await fetch(`${LLM_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(DEADLINE_MS),
      body: JSON.stringify({ messages: [{ role: "user", content: "Ready?" }], max_tokens: 1 }),
    });
    return Response.json({ live: res.ok });
  } catch {
    return Response.json({ live: false });
  }
}
