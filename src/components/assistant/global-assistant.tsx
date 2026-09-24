"use client";

/**
 * The assistant's permanent entry point: a dock in the top bar of every shell
 * screen, and the drawer it opens beneath it.
 *
 * The dock sits in the top bar, not floating over the page, so it can never
 * cover a screen's own controls (the lesson's start button, the cab's input).
 *
 * Both are views of the one provider conversation. The dock's microphone is
 * hold-to-talk, the same gesture as the cab panel's, and uses the same voice
 * pipeline (browser speech or the hub's /api/stt, then the assistant, then
 * browser TTS). On a screen that already shows the conversation inline, the
 * dock focuses that panel instead of opening a second copy.
 */
import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { MessageSquare, Mic, VolumeX } from "lucide-react";
import { Avatar2D } from "@web/components/avatar";
import { cn } from "@/lib/utils";
import { AssistantPanel, STATE_DOT, STATE_LABEL } from "./assistant-panel";
import { useGlobalAssistant } from "./assistant-provider";

/** The drawer view of the conversation. Mounted once, by the app shell. */
export function AssistantDrawer() {
  const { open, setOpen, hasInlineView } = useGlobalAssistant();
  const visible = open && !hasInlineView;

  React.useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, setOpen]);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.aside
          key="assistant-drawer"
          initial={{ x: "100%", opacity: 0.6 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0.6 }}
          transition={{ type: "spring", stiffness: 320, damping: 34 }}
          className="fixed bottom-0 right-0 top-16 z-40 flex w-full max-w-[420px] flex-col border-l border-white/12 bg-ink-900 shadow-2xl"
          aria-label="Site assistant drawer"
        >
          <AssistantPanel variant="drawer" className="min-h-0 flex-1 rounded-none border-0" onClose={() => setOpen(false)} />
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

/** The entry point: avatar + state (opens the conversation) and a hold-to-talk microphone. */
export function AssistantDock() {
  const { voice, scope, open, setOpen, reveal, hasInlineView } = useGlobalAssistant();
  const busy = voice.status === "thinking" || voice.status === "calling_tool" || voice.status === "answering";
  const drawerOpen = open && !hasInlineView;

  const micLabel = !voice.sttSupported
    ? "Voice unavailable in this browser"
    : voice.listening
      ? "Listening, release to send"
      : voice.transcribing
        ? "Transcribing"
        : "Hold to talk to the assistant";

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-0.5 rounded-full border bg-white/[0.03] p-0.5 transition-colors",
        voice.state === "alert" ? "border-status-crit/50" : drawerOpen || voice.listening ? "border-cat-500/60" : "border-white/[0.08]",
      )}
      role="group"
      aria-label="Site assistant"
    >
      <button
        type="button"
        onClick={() => (drawerOpen ? setOpen(false) : reveal())}
        aria-expanded={hasInlineView ? undefined : drawerOpen}
        aria-label={drawerOpen ? "Close the assistant" : "Open the assistant"}
        className="flex h-9 items-center gap-2 rounded-full pl-0.5 pr-2.5 transition-colors hover:bg-white/6"
      >
        <Avatar2D state={voice.state} pulse={voice.pulse} size={32} label={false} />
        <span className="hidden text-left sm:block">
          <span className="block text-[11px] font-bold leading-tight text-zinc-100">Assistant</span>
          <span className="flex items-center gap-1 text-[10px] leading-tight text-muted">
            <span className={cn("size-1.5 rounded-full", STATE_DOT[voice.state], voice.state !== "idle" && "animate-pulse")} aria-hidden />
            {voice.state === "idle" ? scope.label : STATE_LABEL[voice.state]}
          </span>
        </span>
        <MessageSquare className="size-3.5 text-muted sm:hidden" aria-hidden />
      </button>

      {voice.speaking ? (
        <button
          type="button"
          onClick={voice.stopSpeaking}
          aria-label="Stop speaking"
          title="Stop speaking"
          className="grid size-9 place-items-center rounded-full text-zinc-300 transition-colors hover:bg-white/10"
        >
          <VolumeX className="size-4" aria-hidden />
        </button>
      ) : null}

      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault(); // keep focus where it was (the lesson's keyboard controls, an input)
          voice.startTalking();
        }}
        onPointerUp={voice.stopTalking}
        onPointerLeave={() => voice.listening && voice.stopTalking()}
        onContextMenu={(e) => e.preventDefault()}
        disabled={!voice.sttSupported}
        aria-label={micLabel}
        aria-pressed={voice.listening}
        title={micLabel}
        className={cn(
          "relative grid size-9 place-items-center rounded-full transition-colors",
          voice.listening ? "bg-cat-500 text-ink-950" : "bg-cat-500/15 text-cat-400 hover:bg-cat-500/25",
          (busy || voice.transcribing) && !voice.listening && "text-cat-500",
          !voice.sttSupported && "cursor-not-allowed opacity-40",
        )}
      >
        <Mic className="size-4" aria-hidden />
        {voice.listening ? (
          <motion.span
            className="absolute inset-0 rounded-full border-2 border-cat-500"
            animate={{ scale: [1, 1.45], opacity: [0.8, 0] }}
            transition={{ duration: 1.2, repeat: Infinity }}
            aria-hidden
          />
        ) : busy || voice.transcribing ? (
          <motion.span
            className="absolute inset-1 rounded-full border-2 border-cat-500/70 border-t-transparent"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            aria-hidden
          />
        ) : null}
      </button>
    </div>
  );
}
