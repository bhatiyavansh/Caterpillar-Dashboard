"use client";

/**
 * Page shell for the digital twin.
 *
 * The scene is client-only: it is mounted behind a `mounted` gate so the
 * simulation clock and randomised fleet state can never produce a server/client
 * hydration mismatch, and WebGL is never asked for during SSR.
 */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useVehicleControls } from "@/hooks/twin/useVehicleControls";
import { CommandCenter } from "./CommandCenter";

const SimulationScene = dynamic(
  () => import("./SimulationScene").then((m) => m.SimulationScene),
  { ssr: false, loading: () => <BootScreen /> },
);

function BootScreen() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-ink-950">
      <div className="text-center">
        <div className="mx-auto mb-4 h-1.5 w-40 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/3 animate-[scan_1.4s_ease-in-out_infinite] rounded-full bg-cat-500" />
        </div>
        <div className="text-sm font-bold tracking-[0.22em] text-cat-500">CAT COPILOT</div>
        <div className="mt-1.5 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
          Initialising digital twin
        </div>
      </div>
    </div>
  );
}

export function TwinExperience() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Keyboard lives here, outside the Canvas — never inside a 3D component.
  useVehicleControls(mounted);

  return (
    <main className="fixed inset-0 overflow-hidden bg-ink-950">
      {/* faint instrument grid behind the scene */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />

      {mounted ? (
        <>
          <div className="absolute inset-0 z-[1]">
            <SimulationScene />
          </div>
          <CommandCenter />
        </>
      ) : (
        <BootScreen />
      )}

      <Link
        href="/dashboard"
        className="absolute bottom-4 left-1/2 z-20 hidden -translate-x-1/2 translate-y-10 text-[10px] uppercase tracking-[0.18em] text-zinc-600 transition hover:text-cat-500 2xl:block"
      >
        ← Back to dashboard
      </Link>
    </main>
  );
}
