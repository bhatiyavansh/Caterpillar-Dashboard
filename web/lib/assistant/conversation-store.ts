/**
 * Where a conversation's messages live, so they outlast the component that shows them.
 *
 *   const store = conversationStore("cat.assistant.v1");   // persisted in localStorage
 *   const store = memoryConversation();                      // this component only
 *
 * Read through useSyncExternalStore (`subscribe` / `getSnapshot` / `getServerSnapshot`): the server
 * snapshot is always empty, so a persisted history appears right after hydration, never in the HTML.
 * A persisted store follows the `storage` event, so every open tab shows the same conversation.
 *
 * The hub remembers a conversation for 30 minutes after its last answer (copilot/agent/loop.py). A
 * history older than that is still shown, but `contextFrom` marks where the assistant's memory
 * starts, and the next question opens a new server-side conversation.
 */
import type { ChatMessage } from "./hooks";

export interface Conversation {
  /** Server-side conversation id; "" until the first question. */
  conversationId: string;
  messages: ChatMessage[];
  /** Index of the first message the hub still remembers. 0 = all of them. */
  contextFrom: number;
  /** Epoch ms of the last change. */
  updatedAt: number;
}

export interface ConversationStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Conversation;
  getServerSnapshot(): Conversation;
  update(fn: (c: Conversation) => Conversation): void;
  clear(): void;
}

/** How long the hub keeps a conversation after its last answer. */
export const HUB_MEMORY_MS = 30 * 60 * 1000;

const EMPTY: Conversation = Object.freeze({ conversationId: "", messages: [], contextFrom: 0, updatedAt: 0 }) as Conversation;

/** The hub has forgotten this conversation: keep the messages, start a new one on the next question. */
export function expire(c: Conversation, now = Date.now()): Conversation {
  if (!c.messages.length || !c.conversationId || now - c.updatedAt < HUB_MEMORY_MS) return c;
  return { ...c, conversationId: "", contextFrom: c.messages.length };
}

function isMessage(m: unknown): m is ChatMessage {
  const x = m as ChatMessage;
  return Boolean(x) && typeof x.id === "string" && (x.role === "user" || x.role === "assistant") && typeof x.text === "string";
}

function parse(raw: string | null): Conversation {
  if (!raw) return EMPTY;
  try {
    const v = JSON.parse(raw) as Partial<Conversation>;
    const messages = Array.isArray(v.messages) ? v.messages.filter(isMessage) : [];
    const contextFrom = typeof v.contextFrom === "number" ? Math.min(Math.max(0, v.contextFrom), messages.length) : 0;
    return {
      conversationId: typeof v.conversationId === "string" ? v.conversationId : "",
      messages,
      contextFrom,
      updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : 0,
    };
  } catch {
    return EMPTY; // a corrupt entry must never break the assistant
  }
}

function createStore(persist: { key: string; maxMessages: number } | null): ConversationStore {
  const listeners = new Set<() => void>();
  let current: Conversation | null = null;
  const notify = () => listeners.forEach((l) => l());

  const read = (): Conversation => {
    if (!persist || typeof window === "undefined") return EMPTY;
    try {
      return expire(parse(window.localStorage.getItem(persist.key)));
    } catch {
      return EMPTY; // storage blocked (private mode, sandboxed frame)
    }
  };

  const write = (c: Conversation) => {
    if (!persist || typeof window === "undefined") return;
    try {
      if (!c.messages.length && !c.conversationId) window.localStorage.removeItem(persist.key);
      else window.localStorage.setItem(persist.key, JSON.stringify(c));
    } catch {
      // Quota or blocked storage: the conversation still works for this page.
    }
  };

  const onStorage = (e: StorageEvent) => {
    if (!persist || (e.key !== persist.key && e.key !== null)) return;
    current = read();
    notify();
  };

  const getSnapshot = (): Conversation => {
    if (current === null) current = read();
    return current;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (persist && listeners.size === 1 && typeof window !== "undefined") {
        window.addEventListener("storage", onStorage);
        // Another tab may have written while nobody here was listening.
        const fresh = read();
        if (current && fresh.updatedAt !== current.updatedAt) current = fresh;
      }
      return () => {
        listeners.delete(listener);
        if (persist && listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
      };
    },
    getSnapshot,
    getServerSnapshot() {
      return EMPTY;
    },
    update(fn) {
      const prev = getSnapshot();
      let next = fn(prev);
      if (next === prev) return;
      if (persist && next.messages.length > persist.maxMessages) {
        const drop = next.messages.length - persist.maxMessages;
        next = { ...next, messages: next.messages.slice(drop), contextFrom: Math.max(0, next.contextFrom - drop) };
      }
      current = { ...next, updatedAt: Date.now() };
      write(current);
      notify();
    },
    clear() {
      current = EMPTY;
      write(EMPTY);
      notify();
    },
  };
}

const persisted = new Map<string, ConversationStore>();

/**
 * The conversation stored under `key`, shared by every caller in this tab and mirrored across tabs.
 * Keeps the newest `maxMessages` (default 100).
 */
export function conversationStore(key: string, maxMessages = 100): ConversationStore {
  let store = persisted.get(key);
  if (!store) {
    store = createStore({ key, maxMessages });
    persisted.set(key, store);
  }
  return store;
}

/** A conversation held in memory only, for one component's lifetime. */
export function memoryConversation(): ConversationStore {
  return createStore(null);
}
