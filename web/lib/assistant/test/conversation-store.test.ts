import assert from "node:assert/strict";
import { test } from "node:test";
import { HUB_MEMORY_MS, conversationStore, expire, memoryConversation } from "../conversation-store";
import type { ChatMessage } from "../hooks";

/** A window with just enough localStorage and `storage` events for the store. */
function fakeWindow() {
  const data = new Map<string, string>();
  const listeners = new Set<(e: { key: string | null }) => void>();
  const w = {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    },
    addEventListener: (_: string, fn: (e: { key: string | null }) => void) => void listeners.add(fn),
    removeEventListener: (_: string, fn: (e: { key: string | null }) => void) => void listeners.delete(fn),
    /** What another tab writing the key looks like from here. */
    otherTabWrites(k: string, v: string) {
      data.set(k, v);
      listeners.forEach((fn) => fn({ key: k }));
    },
    data,
  };
  (globalThis as unknown as { window: typeof w }).window = w;
  return w;
}

const msg = (id: string, role: ChatMessage["role"] = "user"): ChatMessage => ({ id, role, text: id });
let n = 0;
const key = () => `test.${n++}`;

test("a persisted conversation is written, and read back by a fresh load", () => {
  const w = fakeWindow();
  const k = key();
  const a = conversationStore(k);
  a.update((c) => ({ ...c, conversationId: "conv-1", messages: [msg("q"), msg("a", "assistant")] }));
  const stored = JSON.parse(w.data.get(k)!);
  assert.equal(stored.conversationId, "conv-1");
  assert.deepEqual(stored.messages.map((m: ChatMessage) => m.id), ["q", "a"]);
});

test("the server snapshot is always empty, so persisted history never reaches the HTML", () => {
  fakeWindow();
  const s = conversationStore(key());
  s.update((c) => ({ ...c, messages: [msg("q")] }));
  assert.equal(s.getServerSnapshot().messages.length, 0);
  assert.equal(s.getSnapshot().messages.length, 1);
});

test("only the newest maxMessages are kept, and contextFrom moves with them", () => {
  fakeWindow();
  const s = conversationStore(key(), 3);
  s.update((c) => ({ ...c, messages: ["1", "2", "3", "4", "5"].map((id) => msg(id)), contextFrom: 3 }));
  assert.deepEqual(s.getSnapshot().messages.map((m) => m.id), ["3", "4", "5"]);
  assert.equal(s.getSnapshot().contextFrom, 1);
});

test("a conversation the hub has forgotten keeps its messages but not its id", () => {
  const now = 1_000_000_000;
  const fresh = { conversationId: "c", messages: [msg("q"), msg("a", "assistant")], contextFrom: 0, updatedAt: now - 60_000 };
  assert.equal(expire(fresh, now), fresh);
  const stale = { ...fresh, updatedAt: now - HUB_MEMORY_MS - 1 };
  const out = expire(stale, now);
  assert.equal(out.conversationId, "");
  assert.equal(out.contextFrom, 2);
  assert.equal(out.messages.length, 2);
});

test("a stale stored conversation is expired when it is loaded", () => {
  const w = fakeWindow();
  const k = key();
  w.data.set(k, JSON.stringify({ conversationId: "c", messages: [msg("q")], contextFrom: 0, updatedAt: Date.now() - HUB_MEMORY_MS - 5 }));
  const s = conversationStore(k);
  assert.equal(s.getSnapshot().conversationId, "");
  assert.equal(s.getSnapshot().contextFrom, 1);
});

test("another tab's write reaches this tab's subscribers", () => {
  const w = fakeWindow();
  const k = key();
  const s = conversationStore(k);
  let calls = 0;
  const off = s.subscribe(() => calls++);
  w.otherTabWrites(k, JSON.stringify({ conversationId: "x", messages: [msg("from-b")], contextFrom: 0, updatedAt: Date.now() }));
  assert.equal(calls, 1);
  assert.deepEqual(s.getSnapshot().messages.map((m) => m.id), ["from-b"]);
  off();
});

test("corrupt storage is ignored rather than breaking the assistant", () => {
  const w = fakeWindow();
  const k = key();
  w.data.set(k, "{not json");
  assert.equal(conversationStore(k).getSnapshot().messages.length, 0);
  const k2 = key();
  w.data.set(k2, JSON.stringify({ messages: [{ id: 1 }, msg("ok")], contextFrom: 99 }));
  const s = conversationStore(k2).getSnapshot();
  assert.deepEqual(s.messages.map((m) => m.id), ["ok"]);
  assert.equal(s.contextFrom, 1);
});

test("clear empties the conversation and removes it from storage", () => {
  const w = fakeWindow();
  const k = key();
  const s = conversationStore(k);
  s.update((c) => ({ ...c, conversationId: "c", messages: [msg("q")] }));
  s.clear();
  assert.equal(s.getSnapshot().messages.length, 0);
  assert.equal(w.data.has(k), false);
});

test("a memory conversation never touches storage", () => {
  const w = fakeWindow();
  const s = memoryConversation();
  s.update((c) => ({ ...c, messages: [msg("q")] }));
  assert.equal(s.getSnapshot().messages.length, 1);
  assert.equal(w.data.size, 0);
});
