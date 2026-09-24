import assert from "node:assert/strict";
import { test } from "node:test";
import { CANCEL_RE, CONFIRM_RE, streamAssistant } from "../client";
import { SseParser } from "../sse";

const sse = (name: string, data: object) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

test("parser handles events split across chunks", () => {
  const p = new SseParser();
  const text = sse("token", { delta: "Hel" }) + sse("token", { delta: "lo" });
  const out = [...p.feed(text.slice(0, 17)), ...p.feed(text.slice(17, 40)), ...p.feed(text.slice(40))];
  assert.deepEqual(out.map((m) => JSON.parse(m.data).delta), ["Hel", "lo"]);
});

test("streamAssistant returns the authoritative final and relays every event", async () => {
  const body = [
    sse("meta", { turn_id: "t", surface: "cab", mode: "live", model: "claude-opus-5" }),
    sse("token", { delta: "EXC001 fuel is 37%" }),
    sse("final", { text: "EXC001 fuel is 84.4%.", speak_text: "EXC001 fuel is 84.4%.", citations: [], actions: [], grounded: true }),
    sse("done", {}),
  ].join("");
  const enc = new TextEncoder();
  const fakeFetch = (async () =>
    new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(body.slice(0, 50))); c.enqueue(enc.encode(body.slice(50))); c.close(); } }),
      { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
  const seen: string[] = [];
  const final = await streamAssistant({ surface: "cab", message: "fuel?" }, { fetchImpl: fakeFetch, apiBase: "http://x",
    onEvent: (e) => seen.push(e.name) });
  assert.equal(final.text, "EXC001 fuel is 84.4%."); // not the streamed draft
  assert.deepEqual(seen, ["meta", "token", "final", "done"]);
});

test("stream without final is an error, not a silent empty answer", async () => {
  const fakeFetch = (async () => new Response(sse("meta", { turn_id: "t", surface: "cab", mode: "live" }),
    { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(streamAssistant({ surface: "cab", message: "x" }, { fetchImpl: fakeFetch, apiBase: "http://x" }),
    /without a final event/);
});

test("local confirm/cancel phrases", () => {
  for (const s of ["confirm", "Yes, confirm.", "go ahead", "file it", "yes"]) assert.ok(CONFIRM_RE.test(s), s);
  for (const s of ["confirm the tasks for tomorrow please", "what is confirm"]) assert.ok(!CONFIRM_RE.test(s), s);
  for (const s of ["cancel", "no", "never mind that"]) assert.ok(CANCEL_RE.test(s), s);
});

test("screen context is sent as-is, and a refusal carries its HTTP status for the old-hub fallback", async () => {
  let sent: unknown = null;
  const refusing = (async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return new Response("{}", { status: 422 });
  }) as unknown as typeof fetch;
  const context = { route: "/training/lesson", training: { lesson_active: true, phase: "running" as const, step_id: "t1" } };
  await assert.rejects(
    streamAssistant({ surface: "training", message: "what next?", context }, { fetchImpl: refusing, apiBase: "http://x" }),
    (e: Error & { status?: number }) => e.status === 422,
  );
  assert.deepEqual((sent as { context: unknown }).context, context);
});
