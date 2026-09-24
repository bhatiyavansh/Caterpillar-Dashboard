"use client";
/**
 * useAssistant: chat state for one conversation. Wraps streamAssistant + confirm/cancel.
 *   const a = useAssistant({ surface: "cab", machineId: "EXC001" });
 *   a.send("How long will this trench take?");  a.confirm(a.pending[0].action_id);
 * Typing or saying "confirm"/"cancel" while an action is pending resolves it locally.
 * The options are read at send time, so one conversation can follow the user across screens:
 * each question goes out with the surface, machine and screen context current when it is asked.
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { AssistantContext, Citation, SseConfirmRequired, SseSpecialist } from "../stream/contracts.gen";
import { CANCEL_RE, CONFIRM_RE, cancelAction, confirmAction, streamAssistant, type StreamOptions } from "./client";

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
}

let counter = 0;
const nextId = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

export function useAssistant(opts: UseAssistantOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<AssistantStatus>("idle");
  const [draft, setDraft] = useState("");
  const [specialist, setSpecialist] = useState<SseSpecialist | null>(null);
  const [pending, setPending] = useState<SseConfirmRequired[]>([]);
  const [error, setError] = useState<string | null>(null);
  const conversation = useRef<string>("");
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
        setMessages((m) => [...m, { id: nextId(), role: "assistant", text: `${res.status === "confirmed" ? "Done" : "Cancelled"}: ${res.summary}.` }]);
      } catch (e) {
        setError(String(e));
      }
    },
    [],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy.current) return;
      if (pending.length && CONFIRM_RE.test(trimmed)) return resolve(pending[pending.length - 1].action_id, "confirm");
      if (pending.length && CANCEL_RE.test(trimmed)) return resolve(pending[pending.length - 1].action_id, "cancel");
      const o = latest.current;
      if (!conversation.current) conversation.current = `conv-${nextId()}`;
      let context: AssistantContext | null | undefined;
      try {
        context = o.getContext?.();
      } catch {
        context = undefined; // a broken screen context must never cost the question
      }
      busy.current = true;
      setError(null);
      setDraft("");
      setMessages((m) => [...m, { id: nextId(), role: "user", text: trimmed }]);
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
          operator_id: o.operatorId ?? null, conversation_id: conversation.current };
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
        setMessages((m) => [...m, { id: nextId(), role: "assistant", text: final.text, speakText: final.speak_text,
          mode, grounded: final.grounded, tools, citations: final.citations?.length ? final.citations : citations }]);
        setStatus("idle");
      } catch (e) {
        setError(String(e));
        setStatus("error");
      } finally {
        setDraft("");
        busy.current = false;
      }
    },
    [pending, resolve],
  );

  /** Start a fresh conversation (new server-side history). Pending actions stay until resolved or expired. */
  const reset = useCallback(() => {
    if (busy.current) return;
    conversation.current = "";
    setMessages([]);
    setDraft("");
    setSpecialist(null);
    setError(null);
    setStatus("idle");
  }, []);

  return {
    messages, status, draft, specialist, pending, error, send, reset,
    confirm: (id: string) => resolve(id, "confirm"),
    cancel: (id: string) => resolve(id, "cancel"),
  };
}
