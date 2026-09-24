"use client";
/**
 * useAssistant: chat state for one conversation. Wraps streamAssistant + confirm/cancel.
 *   const a = useAssistant({ surface: "cab", machineId: "EXC001" });
 *   a.send("How long will this trench take?");  a.confirm(a.pending[0].action_id);
 * Typing or saying "confirm"/"cancel" while an action is pending resolves it locally.
 * The options are read at send time, so one conversation can follow the user across screens:
 * each question goes out with the surface, machine and screen context current when it is asked.
 * With `persist`, the messages and conversation id are kept in localStorage (see conversation-store.ts):
 * they survive a reload and are shared by every tab. Pending confirmations never are — the hub expires
 * them after two minutes, so a restored card could only fail.
 */
import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AssistantContext, Citation, SseConfirmRequired, SseSpecialist } from "../stream/contracts.gen";
import { CANCEL_RE, CONFIRM_RE, cancelAction, confirmAction, streamAssistant, type StreamOptions } from "./client";
import { conversationStore, expire, memoryConversation } from "./conversation-store";

export type AssistantStatus = "idle" | "thinking" | "calling_tool" | "answering" | "error";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  speakText?: string;
  mode?: "live" | "cache" | "fallback";
  grounded?: boolean;
  tools?: { name: string; ok: boolean; provenance: string }[];
  /** Manual/protocol passages the answer is grounded in, in citation order. */
  citations?: Citation[];
}

export type AssistantSurface = "cab" | "command" | "owner" | "training" | "ar";

export interface UseAssistantOptions extends Pick<StreamOptions, "apiBase" | "fetchImpl"> {
  surface: AssistantSurface;
  machineId?: string;
  operatorId?: string;
  /** Screen context sent with each question (route, training lesson state). Called at send time. */
  getContext?: () => AssistantContext | null | undefined;
  /**
   * Keep the conversation in localStorage under `key` (newest `maxMessages`, default 100). Read once,
   * when the hook mounts.
   */
  persist?: { key: string; maxMessages?: number };
}

let counter = 0;
const nextId = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

export function useAssistant(opts: UseAssistantOptions) {
  const [store] = useState(() =>
    opts.persist ? conversationStore(opts.persist.key, opts.persist.maxMessages) : memoryConversation());
  const conversation = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const setMessages = useCallback(
    (fn: (m: ChatMessage[]) => ChatMessage[]) => store.update((c) => ({ ...c, messages: fn(c.messages) })),
    [store],
  );
  const [status, setStatus] = useState<AssistantStatus>("idle");
  const [draft, setDraft] = useState("");
  const [specialist, setSpecialist] = useState<SseSpecialist | null>(null);
  const [pending, setPending] = useState<SseConfirmRequired[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** The last answer this hook produced — not one restored from storage or written by another tab. */
  const [answeredId, setAnsweredId] = useState<string | null>(null);
  const busy = useRef(false);
  const latest = useRef(opts);
  useLayoutEffect(() => {
    latest.current = opts;
  });

  const resolve = useCallback(
    async (actionId: string, verb: "confirm" | "cancel") => {
      const fn = verb === "confirm" ? confirmAction : cancelAction;
      const o = latest.current;
      try {
        const res = await fn(actionId, { apiBase: o.apiBase, fetchImpl: o.fetchImpl });
        setPending((p) => p.filter((a) => a.action_id !== actionId));
        const id = nextId();
        setMessages((m) => [...m, { id, role: "assistant", text: `${res.status === "confirmed" ? "Done" : "Cancelled"}: ${res.summary}.` }]);
        setAnsweredId(id);
      } catch (e) {
        setError(String(e));
      }
    },
    [setMessages],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy.current) return;
      if (pending.length && CONFIRM_RE.test(trimmed)) return resolve(pending[pending.length - 1].action_id, "confirm");
      if (pending.length && CANCEL_RE.test(trimmed)) return resolve(pending[pending.length - 1].action_id, "cancel");
      const o = latest.current;
      let context: AssistantContext | null | undefined;
      try {
        context = o.getContext?.();
      } catch {
        context = undefined; // a broken screen context must never cost the question
      }
      busy.current = true;
      setError(null);
      setDraft("");
      // A conversation the hub has already forgotten starts afresh; the old messages stay on screen.
      store.update((c) => {
        const live = expire(c);
        return {
          ...live,
          conversationId: live.conversationId || `conv-${nextId()}`,
          messages: [...live.messages, { id: nextId(), role: "user", text: trimmed }],
        };
      });
      const conversationId = store.getSnapshot().conversationId;
      setStatus("thinking");
      const tools: ChatMessage["tools"] = [];
      const citations: Citation[] = [];
      let mode: ChatMessage["mode"];
      const onEvent: NonNullable<StreamOptions["onEvent"]> = (e) => {
        if (e.name === "meta") mode = e.data.mode;
        else if (e.name === "status") setStatus(e.data.state);
        else if (e.name === "token") setDraft((d) => d + e.data.delta);
        else if (e.name === "specialist") setSpecialist(e.data);
        else if (e.name === "tool_result") tools.push({ name: e.data.name, ok: e.data.ok, provenance: e.data.provenance });
        else if (e.name === "citation") citations.push(e.data);
        else if (e.name === "confirm_required") setPending((p) => [...p, e.data]);
        else if (e.name === "error") setError(`${e.data.code}${e.data.fallback_used ? " (answered from data)" : ""}`);
      };
      try {
        const request = { surface: o.surface, message: trimmed, machine_id: o.machineId ?? null,
          operator_id: o.operatorId ?? null, conversation_id: conversationId };
        const stream = (withContext: boolean) => streamAssistant(
          withContext && context ? { ...request, context } : request,
          { apiBase: o.apiBase, fetchImpl: o.fetchImpl, onEvent });
        let final;
        try {
          final = await stream(true);
        } catch (e) {
          // A hub older than contract 1.3.0 refuses the unknown `context` field (422): ask again without
          // the screen context rather than losing the question.
          if (!context || (e as { status?: number }).status !== 422) throw e;
          final = await stream(false);
        }
        const id = nextId();
        setMessages((m) => [...m, { id, role: "assistant", text: final.text, speakText: final.speak_text,
          mode, grounded: final.grounded, tools, citations: final.citations?.length ? final.citations : citations }]);
        setAnsweredId(id);
        setStatus("idle");
      } catch (e) {
        setError(String(e));
        setStatus("error");
      } finally {
        setDraft("");
        busy.current = false;
      }
    },
    [pending, resolve, setMessages, store],
  );

  /** Start a fresh conversation (new server-side history). Pending actions stay until resolved or expired. */
  const reset = useCallback(() => {
    if (busy.current) return;
    store.clear();
    setDraft("");
    setSpecialist(null);
    setError(null);
    setStatus("idle");
  }, [store]);

  return {
    messages: conversation.messages,
    /** Index of the first message the assistant still remembers; earlier ones are history only. */
    contextFrom: conversation.contextFrom,
    answeredId,
    status, draft, specialist, pending, error, send, reset,
    confirm: (id: string) => resolve(id, "confirm"),
    cancel: (id: string) => resolve(id, "cancel"),
  };
}
