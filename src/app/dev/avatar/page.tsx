"use client";

/** /dev/avatar: try the free browser voice + 2D avatar against the live hub (Person B dev page). */
import { useState } from "react";
import { Avatar2D } from "../../../../web/components/avatar";
import { useActiveAlerts } from "../../../../web/lib/stream";
import { useVoice, VOICE_LANGS } from "../../../../web/lib/voice";

export default function DevAvatarPage() {
  const alerts = useActiveAlerts();
  const critical = alerts.some((a) => a.machine_id === "EXC001" && (a.severity === "critical" || a.severity === "high"));
  const [lang, setLang] = useState("auto");
  const v = useVoice({ surface: "cab", machineId: "EXC001", alert: critical, lang });
  const [text, setText] = useState("");

  return (
    <main className="min-h-screen space-y-4 bg-ink-950 p-6 text-sm text-zinc-200">
      <h1 className="text-sm font-bold uppercase tracking-[0.2em] text-cat-500">/dev/avatar</h1>
      <div className="flex items-center gap-6">
        <Avatar2D state={v.state} pulse={v.pulse} size={120} />
        <div className="space-y-2">
          <button
            onPointerDown={v.startTalking}
            onPointerUp={v.stopTalking}
            disabled={!v.sttSupported}
            className="h-14 rounded bg-cat-500 px-6 font-bold text-ink-950 disabled:opacity-40"
          >
            {v.listening ? "Listening… release to send" : v.transcribing ? "Transcribing…" : "Hold to talk"}
          </button>
          <label className="flex items-center gap-2 text-xs text-muted">
            Language
            <select value={lang} onChange={(e) => setLang(e.target.value)} className="rounded border border-white/15 bg-ink-900 px-2 py-1">
              {VOICE_LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            <span>speech-to-text: {v.sttEngine === "server" ? "server (Whisper)" : "browser"}</span>
          </label>
          {!v.sttSupported && <p className="text-status-warn">Speech input not supported in this browser: type instead.</p>}
          {v.micError && <p className="text-status-crit">{v.micError}</p>}
          <p className="text-muted">{v.interim || v.draft}</p>
        </div>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void v.send(text); setText(""); }} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask, or type confirm / cancel"
          className="h-10 flex-1 rounded border border-white/15 bg-ink-900 px-3" />
        <button className="h-10 rounded border border-white/15 px-4">Send</button>
      </form>
      {v.pending.map((a) => (
        <div key={a.action_id} className="flex items-center gap-2 rounded border border-cat-500/50 p-2">
          <span className="flex-1">{a.summary}</span>
          <button onClick={() => v.confirm(a.action_id)} className="rounded bg-cat-500 px-3 py-1 text-ink-950">Confirm</button>
          <button onClick={() => v.cancel(a.action_id)} className="rounded border border-white/15 px-3 py-1">Cancel</button>
        </div>
      ))}
      <ul className="space-y-2">
        {v.messages.map((m) => (
          <li key={m.id} className={m.role === "user" ? "text-cat-400" : ""}>
            <b>{m.role}:</b> <span className="whitespace-pre-wrap">{m.text}</span>
            {m.mode === "fallback" && <span className="ml-2 text-status-warn">(answered from data)</span>}
          </li>
        ))}
      </ul>
      {v.error && <p className="text-status-warn">{v.error}</p>}
    </main>
  );
}
