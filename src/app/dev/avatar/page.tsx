"use client";

/**
 * /dev/avatar: the assistant bench.
 *
 * The same global assistant as the dock (one conversation, not a second
 * assistant), with its voice pipeline laid open: the avatar on a stage, the
 * hold-to-talk control, language and engine, a live readout of what the
 * pipeline is doing, and a gallery to preview every avatar state on demand.
 */
import * as React from "react";
import { Mic, Radio, Square, VolumeX } from "lucide-react";
import { motion } from "motion/react";
import { useAssistantScope, useGlobalAssistant } from "@/components/assistant/assistant-provider";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { PageShell } from "@/components/ui/page";
import { cn } from "@/lib/utils";
import { Avatar2D } from "../../../../web/components/avatar";
import { useActiveAlerts } from "../../../../web/lib/stream";
import { VOICE_LANGS, type AvatarState } from "../../../../web/lib/voice";

const STATES: AvatarState[] = ["idle", "listening", "thinking", "talking", "alert"];

function Card({ title, meta, children, className }: { title: string; meta?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("panel overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-2.5">
        <h2 className="label-xs !text-zinc-300">{title}</h2>
        {meta}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "ok" | "warn" | "crit" }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
      <span className="text-muted">{label}</span>
      <span
        className={cn(
          "truncate font-mono font-semibold",
          tone === "ok" ? "text-status-ok" : tone === "warn" ? "text-status-warn" : tone === "crit" ? "text-status-crit" : "text-zinc-200",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export default function DevAvatarPage() {
  const alerts = useActiveAlerts();
  const critical = alerts.some((a) => a.machine_id === "EXC001" && (a.severity === "critical" || a.severity === "high"));
  useAssistantScope({ surface: "cab", machineId: "EXC001", alert: critical, label: "Bench · EXC001" });
  const { voice: v, lang, setLang } = useGlobalAssistant();

  // Preview a state on the stage without driving the pipeline; "live" follows it.
  const [preview, setPreview] = React.useState<AvatarState | "live">("live");
  const [demoPulse, setDemoPulse] = React.useState(0);
  React.useEffect(() => {
    if (preview !== "talking") return;
    const id = window.setInterval(() => setDemoPulse((p) => p + 1), 160);
    return () => window.clearInterval(id);
  }, [preview]);
  const stageState = preview === "live" ? v.state : preview;
  const stagePulse = preview === "live" ? v.pulse : demoPulse;

  const busy = v.status === "thinking" || v.status === "calling_tool" || v.status === "answering";
  const talkLabel = !v.sttSupported
    ? "Voice unavailable in this browser"
    : v.listening
      ? "Listening… release to send"
      : v.transcribing
        ? "Transcribing…"
        : "Hold to talk";
  const transcript = v.listening ? v.interim : v.transcribing ? "…" : v.draft;

  return (
    <PageShell>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-xs">Internal · voice and avatar</p>
          <h1 className="text-lg font-bold tracking-tight text-zinc-50">Assistant bench</h1>
          <p className="text-xs text-muted">The same assistant as the dock, with its voice pipeline laid open.</p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold",
            critical ? "border-status-crit/40 bg-status-crit/10 text-status-crit" : "border-white/10 bg-white/[0.03] text-zinc-300",
          )}
        >
          <Radio className="size-3.5" aria-hidden />
          {critical ? "EXC001 alert open: avatar in alert state" : "EXC001 · no critical alert"}
        </span>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="space-y-4">
          {/* Stage */}
          <section className="panel-raised overflow-hidden">
            <div
              className="relative grid place-items-center px-6 pb-5 pt-8"
              style={{ background: "radial-gradient(60% 70% at 50% 35%, rgb(255 205 17 / 0.08), transparent 70%)" }}
            >
              <Avatar2D state={stageState} pulse={stagePulse} size={168} />
              {preview !== "live" ? (
                <button
                  onClick={() => setPreview("live")}
                  className="absolute right-3 top-3 rounded-full border border-cat-500/40 bg-cat-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-cat-500"
                >
                  Preview · back to live
                </button>
              ) : null}
              {v.specialist ? (
                <span className="absolute left-3 top-3 rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                  {v.specialist.label}
                </span>
              ) : null}
            </div>

            <div className="space-y-3 border-t border-white/10 p-4">
              <p className={cn("min-h-10 rounded-lg bg-ink-950/60 px-3 py-2 text-xs leading-relaxed", transcript ? "text-zinc-200" : "text-muted")}>
                {transcript || "Your words appear here as you speak."}
              </p>

              <div className="flex gap-2">
                <button
                  onPointerDown={(e) => {
                    e.preventDefault();
                    v.startTalking();
                  }}
                  onPointerUp={v.stopTalking}
                  onPointerLeave={() => v.listening && v.stopTalking()}
                  onContextMenu={(e) => e.preventDefault()}
                  disabled={!v.sttSupported}
                  aria-pressed={v.listening}
                  className={cn(
                    "relative flex h-14 flex-1 select-none items-center justify-center gap-2.5 overflow-hidden rounded-full text-sm font-bold transition-colors",
                    v.listening ? "bg-cat-500 text-ink-950" : "bg-gradient-cat text-ink-950 hover:brightness-110",
                    "disabled:cursor-not-allowed disabled:opacity-40",
                  )}
                >
                  {v.listening ? (
                    <motion.span
                      className="absolute inset-0 rounded-full border-2 border-ink-950/40"
                      animate={{ scale: [1, 1.08], opacity: [0.8, 0] }}
                      transition={{ duration: 1, repeat: Infinity }}
                      aria-hidden
                    />
                  ) : null}
                  {v.listening ? <Square className="size-4 fill-current" aria-hidden /> : <Mic className="size-5" aria-hidden />}
                  {talkLabel}
                </button>
                {v.speaking ? (
                  <button
                    onClick={v.stopSpeaking}
                    aria-label="Stop speaking"
                    title="Stop speaking"
                    className="grid size-14 shrink-0 place-items-center rounded-full border border-white/12 bg-white/[0.04] text-zinc-200 hover:bg-white/10"
                  >
                    <VolumeX className="size-5" aria-hidden />
                  </button>
                ) : null}
              </div>

              {v.micError ? <p className="text-[11px] text-status-crit">{v.micError}</p> : null}
              {!v.sttSupported ? <p className="text-[11px] text-status-warn">Speech input is not supported in this browser: type in the conversation instead.</p> : null}
            </div>
          </section>

          {/* Voice */}
          <Card title="Voice">
            <div className="space-y-3 p-4">
              <label className="block">
                <span className="label-xs">Language</span>
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-white/12 bg-ink-950 px-2.5 text-xs text-zinc-100 focus:border-cat-500 focus:outline-none"
                >
                  {VOICE_LANGS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="divide-y divide-white/5 border-t border-white/10">
              <Row label="Speech to text" value={v.sttEngine === "server" ? "Server · Whisper" : "Browser"} tone={v.sttSupported ? undefined : "warn"} />
              <Row label="Text to speech" value={v.ttsSupported ? "Browser" : "Unavailable"} tone={v.ttsSupported ? undefined : "warn"} />
            </div>
          </Card>

          {/* Pipeline */}
          <Card title="Pipeline" meta={<span className={cn("size-2 rounded-full", busy ? "animate-pulse bg-cat-500" : "bg-status-ok")} />}>
            <div className="divide-y divide-white/5">
              <Row label="Avatar" value={v.state} />
              <Row label="Assistant" value={v.status} tone={v.error ? "warn" : undefined} />
              <Row label="Specialist" value={v.specialist?.label ?? "—"} />
              <Row label="Messages" value={v.messages.length} />
              <Row label="Awaiting confirmation" value={v.pending.length} tone={v.pending.length ? "warn" : undefined} />
            </div>
          </Card>

          {/* Gallery */}
          <Card title="Avatar states" meta={<span className="text-[10px] text-muted">Click to preview on the stage</span>}>
            <div className="grid grid-cols-5 gap-1 p-3">
              {STATES.map((s) => (
                <button
                  key={s}
                  onClick={() => setPreview((p) => (p === s ? "live" : s))}
                  aria-pressed={preview === s}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg py-2 transition-colors",
                    preview === s ? "bg-cat-500/12 ring-1 ring-cat-500/40" : "hover:bg-white/[0.04]",
                    v.state === s && preview === "live" && "bg-white/[0.04]",
                  )}
                >
                  <Avatar2D state={s} pulse={s === "talking" ? demoPulse : 0} size={48} label={false} />
                  <span className="text-[9px] font-bold uppercase tracking-wider text-muted">{s}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* The real conversation, as the product shows it inline */}
        <AssistantPanel
          surface="cab"
          machineId="EXC001"
          alert={critical}
          className="h-[calc(100dvh-10rem)] min-h-[560px] lg:sticky lg:top-0"
        />
      </div>
    </PageShell>
  );
}
