"use client";

/**
 * The site assistant, as an actual conversation rather than a scripted line.
 *
 * This is Person B's `useVoice`/`useAssistant` stack (SSE streaming, tool
 * calls, specialist routing, RAG citations, confirm/cancel actions) with a
 * real chat surface around it. Before this, the cab showed a single sentence
 * chosen by a local `if` statement and a mic button wired to nothing — every
 * one of these capabilities existed in the backend and in `/machine/assistant`
 * but was never reachable from the product's actual operator screen.
 *
 * Kept deliberately un-templated: no bubble avatars floating over gradients,
 * no glassmorphism. It is a panel in the cab, styled like everything else
 * in the cab.
 */
import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  Wrench,
  X,
} from "lucide-react";
import { useVoice, type AvatarState } from "@web/lib/voice";
import type { Citation } from "@web/lib/stream";
import type { ChatMessage } from "@web/lib/assistant";
import { Avatar2D } from "@web/components/avatar";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export type { AvatarState };

/** What each mode badge says and how alarming it should look. */
const MODE_LABEL: Record<NonNullable<ChatMessage["mode"]>, string> = {
  live: "Live",
  cache: "Cached",
  fallback: "From data",
};

const STATE_LABEL: Record<AvatarState, string> = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  talking: "Speaking",
  alert: "Alert",
};

const STATE_DOT: Record<AvatarState, string> = {
  idle: "bg-zinc-500",
  listening: "bg-status-info",
  thinking: "bg-cat-500",
  talking: "bg-cat-500",
  alert: "bg-status-crit",
};

/**
 * Turns the plain-text answer into paragraphs and `- ` bullet lists.
 *
 * The backend returns prose, not markdown, but multi-item answers (task
 * lists, step lists) come back as `- ` lines, and those deserve to render as
 * a list rather than a wall of text with literal dashes in it.
 */
function AnswerText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        const lines = block.split("\n").filter(Boolean);
        const isList = lines.length > 1 && lines.every((l) => /^[-•]\s/.test(l.trim()));
        if (isList) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-4">
              {lines.map((l, j) => (
                <li key={j}>{l.replace(/^[-•]\s/, "")}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{block}</p>;
      })}
    </div>
  );
}

function CitationChip({ citation }: { citation: Citation }) {
  const [open, setOpen] = React.useState(false);
  const where = citation.page ? `p. ${citation.page}` : citation.step ? `step ${citation.step}` : null;
  return (
    <div className="inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold transition-colors",
          "border-cat-500/30 bg-cat-500/8 text-cat-500 hover:bg-cat-500/15",
        )}
      >
        {citation.kind === "protocol" ? <Wrench className="size-2.5" aria-hidden /> : <BookOpen className="size-2.5" aria-hidden />}
        {citation.title}
        {where ? `, ${where}` : ""}
      </button>
      {open ? (
        <p className="mt-1 max-w-sm rounded border border-white/10 bg-ink-950 px-2.5 py-2 text-[11px] italic leading-relaxed text-zinc-400">
          &ldquo;{citation.quote}&rdquo;
        </p>
      ) : null}
    </div>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex", isUser && "justify-end")}>
      <div
        className={cn(
          "max-w-[92%] rounded px-3 py-2 text-[13px] leading-relaxed",
          isUser ? "bg-white/8 text-zinc-100" : "border border-cat-500/25 bg-cat-500/[0.06] text-zinc-100",
        )}
      >
        {!isUser ? <AnswerText text={message.text} /> : <p>{message.text}</p>}

        {!isUser && (message.mode || message.citations?.length) ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/8 pt-1.5">
            {message.mode && message.mode !== "live" ? (
              <span className="rounded bg-white/8 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted">
                {MODE_LABEL[message.mode]}
              </span>
            ) : null}
            {message.citations?.map((c, i) => <CitationChip key={i} citation={c} />)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Suggestion chips shown only before the first turn — a scannable starting point, not a form. */
const SUGGESTIONS = [
  "How long will this task take?",
  "Why did that alert fire?",
  "What does the hydraulic warning mean?",
];

export interface AssistantPanelProps {
  surface: "cab" | "command" | "owner" | "training" | "ar";
  machineId?: string;
  operatorId?: string;
  /** True while a safety alert is open on this surface — drives the avatar's alert ring. */
  alert?: boolean;
  className?: string;
}

/**
 * The full conversational surface: avatar, history, streaming draft, pending
 * confirmations, suggestions, and a combined text/voice input row.
 */
export function AssistantPanel({ surface, machineId, operatorId, alert, className }: AssistantPanelProps) {
  const voice = useVoice({ surface, machineId, operatorId, alert });
  const [input, setInput] = React.useState("");
  const logRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [voice.messages.length, voice.draft]);

  const busy = voice.status === "thinking" || voice.status === "calling_tool" || voice.status === "answering";

  const submit = (text: string) => {
    if (!text.trim() || busy) return;
    setInput("");
    void voice.send(text);
  };

  const micLabel = voice.listening
    ? "Listening…"
    : voice.transcribing
      ? "Transcribing…"
      : voice.sttSupported
        ? "Hold to talk"
        : "Voice unavailable";

  return (
    <section
      className={cn("flex min-h-0 flex-col overflow-hidden rounded border border-white/10 bg-ink-850", className)}
      aria-label="Site assistant"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-white/10 px-3 py-2">
        <Avatar2D state={voice.state} pulse={voice.pulse} size={28} label={false} />
        <span className="text-xs font-bold text-zinc-100">Site assistant</span>
        {voice.specialist ? (
          <span className="rounded bg-white/6 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted">
            {voice.specialist.label}
          </span>
        ) : null}
        <span className={cn("ml-auto inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider", "text-muted")}>
          <span className={cn("size-1.5 rounded-full", STATE_DOT[voice.state], voice.state !== "idle" && "animate-pulse")} aria-hidden />
          {STATE_LABEL[voice.state]}
        </span>
      </div>

      {/* Conversation */}
      <div ref={logRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" role="log" aria-live="polite">
        {voice.messages.length === 0 && !voice.draft ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-2 text-center">
            <Avatar2D state="idle" size={44} label={false} />
            <p className="text-xs leading-relaxed text-muted">
              Ask about this machine, the plan, an alert or the manual.
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  className="rounded border border-white/12 bg-white/4 px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:bg-white/10"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {voice.messages.map((m) => (
              <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <Bubble message={m} />
              </motion.div>
            ))}
          </AnimatePresence>
        )}

        {voice.draft ? (
          <Bubble message={{ id: "draft", role: "assistant", text: voice.draft }} />
        ) : busy ? (
          <div className="flex items-center gap-1.5 px-1">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="size-1.5 rounded-full bg-cat-500"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1, repeat: Infinity, delay: i * 0.18 }}
              />
            ))}
          </div>
        ) : null}

        {voice.error ? (
          <p className="flex items-center gap-1.5 rounded border border-status-warn/30 bg-status-warn/8 px-2.5 py-1.5 text-[11px] text-status-warn">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            {voice.error}
          </p>
        ) : null}

        {voice.micError ? (
          <p className="flex items-center gap-1.5 rounded border border-status-warn/30 bg-status-warn/8 px-2.5 py-1.5 text-[11px] text-status-warn">
            <MicOff className="size-3.5 shrink-0" aria-hidden />
            {voice.micError}
          </p>
        ) : null}
      </div>

      {/* Pending confirmations — never executed on the model's say-so */}
      {voice.pending.length ? (
        <div className="shrink-0 space-y-1.5 border-t border-status-warn/25 bg-status-warn/[0.05] p-2.5">
          {voice.pending.map((p) => (
            <div key={p.action_id} className="rounded border border-status-warn/30 bg-ink-900 p-2">
              <p className="text-xs font-semibold text-zinc-100">{p.summary}</p>
              <div className="mt-1.5 flex gap-1.5">
                <Button variant="primary" size="sm" onClick={() => void voice.confirm(p.action_id)}>
                  <Check className="size-3.5" aria-hidden />
                  Confirm
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void voice.cancel(p.action_id)}>
                  <X className="size-3.5" aria-hidden />
                  Cancel
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Input row */}
      <form
        className="flex shrink-0 items-center gap-1.5 border-t border-white/10 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <button
          type="button"
          onPointerDown={voice.startTalking}
          onPointerUp={voice.stopTalking}
          onPointerLeave={voice.stopTalking}
          disabled={!voice.sttSupported}
          aria-label={micLabel}
          aria-pressed={voice.listening}
          title={micLabel}
          className={cn(
            "relative flex size-9 shrink-0 items-center justify-center rounded-full transition-colors",
            voice.listening ? "bg-cat-500 text-ink-950" : "bg-white/8 text-zinc-300 hover:bg-white/14",
            !voice.sttSupported && "cursor-not-allowed opacity-40",
          )}
        >
          <Mic className="size-4" aria-hidden />
          {voice.listening ? (
            <motion.span
              className="absolute inset-0 rounded-full border-2 border-cat-500"
              animate={{ scale: [1, 1.4], opacity: [0.8, 0] }}
              transition={{ duration: 1.2, repeat: Infinity }}
            />
          ) : null}
        </button>

        <input
          ref={inputRef}
          value={voice.listening ? (voice.interim || micLabel) : input}
          onChange={(e) => setInput(e.target.value)}
          disabled={voice.listening}
          placeholder="Ask the assistant…"
          aria-label="Message to the site assistant"
          className="h-9 min-w-0 flex-1 rounded border border-white/12 bg-white/4 px-3 text-xs text-zinc-100 placeholder:text-muted focus:border-cat-500 focus:outline-none disabled:opacity-60"
        />

        {voice.messages.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            aria-label="Restart the conversation"
            onClick={() => window.location.reload()}
          >
            <RotateCcw className="size-3.5" aria-hidden />
          </Button>
        ) : null}

        <Button type="submit" variant="primary" size="icon" className="size-9 shrink-0" disabled={!input.trim() || busy} aria-label="Send">
          <Send className="size-4" aria-hidden />
        </Button>
      </form>
    </section>
  );
}
