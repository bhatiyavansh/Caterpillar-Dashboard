"use client";
/**
 * useAssistant: chat state for one surface. Wraps streamAssistant + confirm/cancel.
 *   const a = useAssistant({ surface: "cab", machineId: "EXC001" });
 *   a.send("How long will this trench take?");  a.confirm(a.pending[0].action_id);
 * Typing or saying "confirm"/"cancel" while an action is pending resolves it locally.
 */
import { useCallback, useRef, useState } from "react";
import type { SseConfirmRequired, SseSpecialist } from "../stream/contracts.gen";
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
}

export interface UseAssistantOptions extends Pick<StreamOptions, "apiBase" | "fetchImpl"> {
  surface: "cab" | "command" | "owner" | "training" | "ar";
  machineId?: string;
  operatorId?: string;
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
  const conversation = useRef<string>(`conv-${nextId()}`);
  const busy = useRef(false);

  const resolve = useCallback(
    async (actionId: string, verb: "confirm" | "cancel") => {
      const fn = verb === "confirm" ? confirmAction : cancelAction;
      try {
        const res = await fn(actionId, { apiBase: opts.apiBase, fetchImpl: opts.fetchImpl });
        setPending((p) => p.filter((a) => a.action_id !== actionId));
        setMessages((m) => [...m, { id: nextId(), role: "assistant", text: `${res.status === "confirmed" ? "Done" : "Cancelled"}: ${res.summary}.` }]);
      } catch (e) {
        setError(String(e));
      }
    },
    [opts.apiBase, opts.fetchImpl],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy.current) return;
      if (pending.length && CONFIRM_RE.test(trimmed)) return resolve(pending[pending.length - 1].action_id, "confirm");
      if (pending.length && CANCEL_RE.test(trimmed)) return resolve(pending[pending.length - 1].action_id, "cancel");
      busy.current = true;
      setError(null);
      setDraft("");
      setMessages((m) => [...m, { id: nextId(), role: "user", text: trimmed }]);
      setStatus("thinking");
      const tools: ChatMessage["tools"] = [];
      let mode: ChatMessage["mode"];
      try {
        const final = await streamAssistant(
          { surface: opts.surface, message: trimmed, machine_id: opts.machineId ?? null,
            operator_id: opts.operatorId ?? null, conversation_id: conversation.current },
          {
            apiBase: opts.apiBase,
            fetchImpl: opts.fetchImpl,
            onEvent: (e) => {
              if (e.name === "meta") mode = e.data.mode;
              else if (e.name === "status") setStatus(e.data.state);
              else if (e.name === "token") setDraft((d) => d + e.data.delta);
              else if (e.name === "specialist") setSpecialist(e.data);
              else if (e.name === "tool_result") tools.push({ name: e.data.name, ok: e.data.ok, provenance: e.data.provenance });
              else if (e.name === "confirm_required") setPending((p) => [...p, e.data]);
              else if (e.name === "error") setError(`${e.data.code}${e.data.fallback_used ? " (answered from data)" : ""}`);
            },
          },
        );
        setMessages((m) => [...m, { id: nextId(), role: "assistant", text: final.text, speakText: final.speak_text,
          mode, grounded: final.grounded, tools }]);
        setStatus("idle");
      } catch (e) {
        setError(String(e));
        setStatus("error");
      } finally {
        setDraft("");
        busy.current = false;
      }
    },
    [opts.surface, opts.machineId, opts.operatorId, opts.apiBase, opts.fetchImpl, pending, resolve],
  );

  return {
    messages, status, draft, specialist, pending, error, send,
    confirm: (id: string) => resolve(id, "confirm"),
    cancel: (id: string) => resolve(id, "cancel"),
  };
}
