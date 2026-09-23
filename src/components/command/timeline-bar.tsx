"use client";

/**
 * Shift timeline and replay control.
 *
 * Live is the resting state. Scrubbing moves the twin into replay and says so
 * loudly, because a manager looking at a past moment must never mistake it for
 * now. Incident markers are the point of the bar, so they sit on the track
 * itself rather than in a legend.
 */
import * as React from "react";
import { Pause, Play, Radio, SkipBack, SkipForward } from "lucide-react";
import type { TimelineMarker } from "@/lib/api/contracts";
import { ALERT_SEVERITY } from "@/lib/status";
import { Button } from "@/components/ui/primitives";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const SHIFT_HOURS = 8;

function fmt(t: number): string {
  return new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function TimelineBar({
  now,
  markers,
  replayAt,
  onReplayAtChange,
  className,
}: {
  now: number;
  markers: TimelineMarker[];
  replayAt: number | null;
  onReplayAtChange: (t: number | null) => void;
  className?: string;
}) {
  const [playing, setPlaying] = React.useState(false);

  // `now` is 0 on the server pass, before the first live frame. Rendering
  // clock labels from that would print 1970, so the bar waits.
  const ready = now > 0;
  const start = now - SHIFT_HOURS * 3_600_000;
  const span = now - start;
  const position = replayAt ?? now;
  const pct = ((position - start) / span) * 100;

  // Replay advances at 8x so a manager can watch a near-miss unfold without
  // waiting out the real duration.
  React.useEffect(() => {
    if (!playing || replayAt === null) return;
    const id = setInterval(() => {
      onReplayAtChange(Math.min(now, replayAt + 8000));
    }, 1000);
    return () => clearInterval(id);
  }, [playing, replayAt, now, onReplayAtChange]);

  // `now` ticks forward from the external site clock; when replay catches up
  // to it we hand control back to live. That is a genuine external sync, not
  // state derivable from props alone.
  React.useEffect(() => {
    if (replayAt !== null && replayAt >= now) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- replay has caught up to the live clock tick
      setPlaying(false);
      onReplayAtChange(null);
    }
  }, [replayAt, now, onReplayAtChange]);

  const live = replayAt === null;

  const jump = (dir: -1 | 1) => {
    const sorted = [...markers].sort((a, b) => a.at - b.at);
    const next =
      dir === 1 ? sorted.find((m) => m.at > position) : [...sorted].reverse().find((m) => m.at < position);
    if (next) {
      onReplayAtChange(next.at);
      setPlaying(false);
    }
  };

  const onScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = start + (Number(e.target.value) / 1000) * span;
    onReplayAtChange(t >= now - 2000 ? null : t);
  };

  return (
    <section
      className={cn(
        "flex shrink-0 items-center gap-3 border-t px-3 py-2",
        live ? "border-white/10 bg-ink-900" : "border-cat-500/40 bg-cat-500/8",
        className,
      )}
      aria-label="Shift timeline and replay"
    >
      <div className="flex shrink-0 items-center gap-1">
        <Hint label="Previous incident">
          <Button variant="ghost" size="icon" className="size-8" onClick={() => jump(-1)} aria-label="Jump to the previous incident">
            <SkipBack className="size-3.5" />
          </Button>
        </Hint>
        <Button
          variant={live ? "outline" : "primary"}
          size="icon"
          className="size-8"
          aria-label={playing ? "Pause replay" : live ? "Start replay from the earliest incident" : "Play replay"}
          onClick={() => {
            if (live) {
              const first = [...markers].sort((a, b) => a.at - b.at)[0];
              onReplayAtChange(first ? first.at : start);
              setPlaying(true);
            } else {
              setPlaying((p) => !p);
            }
          }}
        >
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </Button>
        <Hint label="Next incident">
          <Button variant="ghost" size="icon" className="size-8" onClick={() => jump(1)} aria-label="Jump to the next incident">
            <SkipForward className="size-3.5" />
          </Button>
        </Hint>
      </div>

      {/* Track */}
      <div className="relative min-w-0 flex-1">
        <div className="relative h-8">
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/10" />
          <div
            className={cn("absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full", live ? "bg-status-ok/50" : "bg-cat-500")}
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />

          {markers.map((m) => {
            const left = ((m.at - start) / span) * 100;
            if (left < 0 || left > 100) return null;
            const token = ALERT_SEVERITY[m.severity];
            return (
              <Hint key={m.id} label={`${ready ? fmt(m.at) : ""} · ${m.machineId} · ${m.label}`}>
                <button
                  onClick={() => {
                    onReplayAtChange(m.at);
                    setPlaying(false);
                  }}
                  aria-label={`Replay ${m.label} on ${m.machineId}`}
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${left}%` }}
                >
                  <span
                    className={cn(
                      "block size-2.5 rotate-45 rounded-[2px] border border-ink-950 transition-transform hover:scale-150",
                      token.dot,
                    )}
                  />
                </button>
              </Hint>
            );
          })}

          <input
            type="range"
            min={0}
            max={1000}
            value={Math.max(0, Math.min(1000, (pct / 100) * 1000))}
            onChange={onScrub}
            aria-label="Scrub the shift timeline"
            aria-valuetext={live ? "Live" : fmt(position)}
            className="absolute inset-0 w-full cursor-pointer appearance-none bg-transparent
              [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-ink-950 [&::-webkit-slider-thumb]:bg-cat-500
              [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2
              [&::-moz-range-thumb]:border-ink-950 [&::-moz-range-thumb]:bg-cat-500"
          />
        </div>
        <div className="flex justify-between px-0.5 font-mono text-[10px] text-muted">
          <span>{ready ? fmt(start) : "--:--"}</span>
          <span>{ready ? fmt(start + span / 2) : "--:--"}</span>
          <span>Now</span>
        </div>
      </div>

      {/* State */}
      <div className="flex shrink-0 items-center gap-2">
        {live ? (
          <span className="inline-flex items-center gap-1.5 rounded border border-status-ok/40 bg-status-ok/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-status-ok">
            <Radio className="size-3 animate-pulse" aria-hidden />
            Live
          </span>
        ) : (
          <>
            <span className="rounded border border-cat-500/50 bg-cat-500/15 px-2 py-1 font-mono text-[11px] font-bold tabular-nums text-cat-500">
              {ready ? fmt(position) : "--:--"}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onReplayAtChange(null);
                setPlaying(false);
              }}
            >
              Return to live
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
