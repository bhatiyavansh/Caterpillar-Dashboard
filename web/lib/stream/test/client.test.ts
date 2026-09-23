import assert from "node:assert/strict";
import { test } from "node:test";
import { CLOSE_RESYNC, StreamClient } from "../client";

/** In-memory WebSocket double (labelled fake; no network). */
class FakeWS {
  static instances: FakeWS[] = [];
  readyState = 1;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closedWith: number | null = null;
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  close(code = 1000) {
    this.closedWith = code;
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.({ code }));
  }
  push(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const env = (seq: number, epoch = "E1") => ({ seq, epoch, hub_ts: new Date().toISOString() });
const hello = (seq: number, epoch = "E1") => ({ type: "hello", ...env(seq, epoch), server: "t", contract_version: "1.0.0", resumed: false, sources: [], features: {} });
const snapshot = (seq: number, rseqAt: number, epoch = "E1", machines: object[] = []) => ({
  type: "snapshot", ...env(seq, epoch), ts: "t", rseq_at: rseqAt, machines, workers: [], active_alerts: [],
  environment: {}, sources: [], events_truncated: false,
});
const event = (seq: number, rseq: number, epoch = "E1") => ({
  type: "event", ...env(seq, epoch), rseq, id: `e${rseq}`, ts: "t", event: "proximity_alert",
  severity: "high", machine_id: "EXC001", source: "simulator", message: "m", data: {},
});

function client(extra: object = {}) {
  FakeWS.instances = [];
  return new StreamClient({ url: "ws://hub/ws/live", WebSocketImpl: FakeWS, backoffMinMs: 5, backoffMaxMs: 40,
    random: () => 0.5, ...extra });
}

test("applies hello + snapshot + events and reports live", () => {
  const c = client();
  c.start();
  const ws = FakeWS.instances[0];
  ws.push(hello(1));
  ws.push(snapshot(2, 0, "E1", [{ machine_id: "EXC001", pos: { x: 1, y: 2, lat: 0, lon: 0 } }]));
  ws.push(event(3, 1));
  const s = c.store.getState();
  assert.equal(s.status, "live");
  assert.equal(s.epoch, "E1");
  assert.equal(s.lastRseq, 1);
  assert.deepEqual(Object.keys(s.machines), ["EXC001"]);
  assert.equal(s.events.length, 1);
  c.stop();
});

test("reconnects with backoff and resumes with since_rseq + epoch", async () => {
  const c = client();
  c.start();
  const first = FakeWS.instances[0];
  first.push(hello(1));
  first.push(snapshot(2, 4));
  first.push(event(3, 5));
  first.drop();
  assert.equal(c.store.getState().status, "connecting");
  await tick(20);
  const second = FakeWS.instances[1];
  assert.ok(second, "reconnected");
  assert.equal(second.url, "ws://hub/ws/live?since_rseq=5&epoch=E1");
  assert.equal(c.store.getState().reconnects, 1);
  c.stop();
});

test("rseq gap closes with CLOSE_RESYNC and reconnects immediately", async () => {
  const c = client();
  c.start();
  const ws = FakeWS.instances[0];
  ws.push(hello(1));
  ws.push(snapshot(2, 10));
  ws.push(event(3, 11));
  ws.push(event(4, 13)); // 12 missing
  assert.equal(ws.closedWith, CLOSE_RESYNC);
  assert.equal(c.store.getState().events.length, 1, "the event after the gap is not applied");
  await tick(0);
  assert.equal(FakeWS.instances[1].url, "ws://hub/ws/live?since_rseq=11&epoch=E1");
  assert.equal(c.store.getState().resyncs, 1);
  c.stop();
});

test("heartbeat announcing an unseen rseq triggers resync (tail gap)", async () => {
  const c = client();
  c.start();
  const ws = FakeWS.instances[0];
  ws.push(hello(1));
  ws.push(snapshot(2, 3));
  ws.push({ type: "heartbeat", ...env(5), last_seq: 5, last_rseq: 4, clients: 1, sources: [] });
  assert.equal(ws.closedWith, CLOSE_RESYNC);
  await tick(0);
  assert.match(FakeWS.instances[1].url, /since_rseq=3/);
  c.stop();
});

test("duplicates after a resume are ignored", () => {
  const c = client();
  c.start();
  const ws = FakeWS.instances[0];
  ws.push(hello(1));
  ws.push(snapshot(2, 0));
  ws.push(event(3, 1));
  ws.push(event(4, 1));
  assert.equal(c.store.getState().events.length, 1);
  c.stop();
});

test("new epoch resets state instead of resuming", () => {
  const c = client();
  c.start();
  const ws = FakeWS.instances[0];
  ws.push(hello(1, "OLD"));
  ws.push(snapshot(2, 7, "OLD", [{ machine_id: "EXC001", pos: { x: 0, y: 0, lat: 0, lon: 0 } }]));
  ws.push(hello(1, "NEW")); // hub restarted
  const s = c.store.getState();
  assert.equal(s.epoch, "NEW");
  assert.deepEqual(s.machines, {});
  assert.equal(s.lastRseq, null);
  ws.push(event(3, 1, "NEW")); // no gap check before the new snapshot
  assert.equal(c.store.getState().events.length, 1);
  c.stop();
});

test("goes stale when frames stop, live again on the next frame", async () => {
  let now = 1_000;
  const c = client({ staleAfterMs: 30, now: () => now });
  c.start();
  const ws = FakeWS.instances[0];
  ws.push(hello(1));
  now += 100;
  await tick(40);
  assert.equal(c.store.getState().status, "stale");
  ws.push(event(2, 1));
  assert.equal(c.store.getState().status, "live");
  c.stop();
  assert.equal(c.store.getState().status, "offline");
});

test("backoff grows exponentially and is capped", () => {
  const c = client();
  const seen = [];
  for (let i = 0; i < 6; i++) {
    seen.push(c.nextBackoffMs());
    (c as unknown as { attempt: number }).attempt += 1;
  }
  assert.deepEqual(seen, [5, 10, 20, 40, 40, 40]);
});
