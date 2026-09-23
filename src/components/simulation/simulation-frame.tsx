"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { DEVICE_SIZES, type DeviceSizeKey } from "@/store/machine-store";

/**
 * Rugged in-cab display mock: machined chassis, physical side keys and a glass
 * layer over the active area. The screen contents are rendered at true device
 * resolution and scaled to fit, so layout breakpoints behave realistically.
 */
export function SimulationFrame({
  deviceSize,
  children,
  className,
}: {
  deviceSize: DeviceSizeKey;
  children: React.ReactNode;
  className?: string;
}) {
  const { w, h } = DEVICE_SIZES[deviceSize];
  const hostRef = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);

  React.useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setScale(Math.min((rect.width - 100) / w, (rect.height - 84) / h, 1));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h]);

  return (
    <div ref={hostRef} className={cn("flex h-full w-full items-center justify-center", className)}>
      <div
        className="relative rounded-[22px] border border-white/10 bg-gradient-to-b from-[#26292e] to-[#15171a] p-5 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.95)]"
        style={{ width: w * scale + 88, height: h * scale + 72 }}
      >
        {/* chassis top details */}
        <div className="absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-2">
          <span className="size-1.5 rounded-full bg-status-ok shadow-[0_0_6px_#3ddc84]" />
          <span className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-500">Cat display</span>
          <span className="size-1.5 rounded-full bg-zinc-600" />
        </div>

        {/* speaker grille */}
        <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 gap-1" aria-hidden>
          {Array.from({ length: 18 }, (_, i) => (
            <span key={i} className="h-1 w-1 rounded-full bg-black/60 shadow-[inset_0_0_1px_rgba(255,255,255,0.15)]" />
          ))}
        </div>

        {/* left indicator stack */}
        <div className="absolute left-2 top-1/2 flex -translate-y-1/2 flex-col gap-3" aria-hidden>
          <span className="size-2 rounded-full bg-cat-500 shadow-[0_0_6px_#ffcd11]" />
          <span className="size-2 rounded-full bg-status-info/70" />
          <span className="size-2 rounded-full bg-zinc-700" />
        </div>

        {/* right physical keys */}
        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 flex-col gap-2.5" aria-hidden>
          {["I", "II", "III", "⏻"].map((k) => (
            <span
              key={k}
              className="flex h-9 w-6 items-center justify-center rounded-sm border border-white/10 bg-gradient-to-b from-[#31353b] to-[#1d2024] text-[9px] font-bold text-zinc-400 shadow-[0_1px_0_rgba(255,255,255,0.08)_inset]"
            >
              {k}
            </span>
          ))}
        </div>

        {/* bezel + screen */}
        <div
          className="relative mx-auto overflow-hidden rounded-lg border-4 border-black/70 bg-black"
          style={{ width: w * scale, height: h * scale }}
        >
          <div
            className="origin-top-left"
            style={{ width: w, height: h, transform: `scale(${scale})` }}
          >
            {children}
          </div>

          {/* glass reflection */}
          <div
            className="pointer-events-none absolute inset-0 rounded-md"
            style={{
              background:
                "linear-gradient(135deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 28%, transparent 46%)",
            }}
          />
          <div className="pointer-events-none absolute inset-0 rounded-md shadow-[inset_0_0_60px_rgba(0,0,0,0.55)]" />

          <span className="pointer-events-none absolute bottom-2 right-2 rounded border border-cat-500/40 bg-ink-950/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.22em] text-cat-500">
            Simulation mode
          </span>
        </div>
      </div>
    </div>
  );
}
