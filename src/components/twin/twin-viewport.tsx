"use client";

/**
 * The stage the twin lives on: view switch, layer controls, expand, and the
 * scene itself.
 *
 * Layer toggles drive the 3D twin's own store as well as the 2D plan, so the
 * same control means the same thing in either view.
 */
import * as React from "react";
import {
  Box,
  Eye,
  Flame,
  HardHat,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  Radio,
  Users,
  type LucideIcon,
} from "lucide-react";
import { TwinPlan, TwinScene } from "./twin-scene";
import { SitePlanLegend } from "./site-plan";
import {
  DEFAULT_LAYERS,
  type TwinLayers,
  type TwinSceneProps,
} from "./twin-contract";
import { useTwinStore } from "@/store/twinStore";
import { Button } from "@/components/ui/primitives";
import { Hint } from "@/components/ui/tooltip";
import { LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/utils";

const LAYER_CONTROLS: {
  key: keyof TwinLayers;
  label: string;
  short: string;
  icon: LucideIcon;
}[] = [
  { key: "bubbles", label: "Safety bubbles", short: "Bubbles", icon: Eye },
  { key: "v2v", label: "Machine-to-machine paths", short: "V2V", icon: Radio },
  { key: "workers", label: "Ground workers", short: "Workers", icon: Users },
  {
    key: "heatmap",
    label: "Incident density",
    short: "Incidents",
    icon: Flame,
  },
  { key: "zones", label: "Zone boundaries", short: "Zones", icon: HardHat },
];

type ViewMode = "3d" | "plan";

export function TwinViewport({
  machines,
  alerts,
  selectedId,
  onSelect,
  markers,
  replayAt,
  loading,
  className,
}: Omit<TwinSceneProps, "layers" | "expanded"> & {
  loading?: boolean;
  className?: string;
}) {
  const [layers, setLayers] = React.useState<TwinLayers>(DEFAULT_LAYERS);
  const [expanded, setExpanded] = React.useState(false);
  const [view, setView] = React.useState<ViewMode>("3d");

  const setShowBubble = useTwinStore((s) => s.setShowBubble);
  const setShowPaths = useTwinStore((s) => s.setShowPaths);
  const setShowIncidents = useTwinStore((s) => s.setShowIncidents);

  // One control, both views.
  const toggle = (key: keyof TwinLayers) => {
    setLayers((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (key === "bubbles") setShowBubble(next.bubbles);
      if (key === "v2v") setShowPaths(next.v2v);
      if (key === "heatmap") setShowIncidents(next.heatmap);
      return next;
    });
  };

  // Scrubbing the timeline shows the plan, which can actually draw a past
  // moment; the live 3D canvas always renders now.
  const replaying = replayAt !== null;
  const effectiveView: ViewMode = replaying ? "plan" : view;

  React.useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const sceneProps: TwinSceneProps = {
    machines,
    alerts,
    selectedId,
    onSelect,
    layers,
    replayAt,
    markers,
    expanded,
  };

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div
        className={cn(
          "relative flex min-h-0 flex-1 flex-col overflow-hidden bg-ink-950",
          expanded && "fixed inset-0 z-[90]",
        )}
      >
        {/* Controls float above the scene so the canvas keeps the full box. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-2.5">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2.5">
            {/* View switch */}
            <div className="flex items-center gap-1.5 rounded border border-white/12 bg-ink-900/90 px-1.5 py-1">
              <span className="label-xs !text-[9px] pl-0.5 pr-0.5 text-zinc-500">View</span>
              <div className="flex items-center overflow-hidden rounded-sm">
                {[
                  { id: "3d" as const, label: "3D", icon: Box },
                  { id: "plan" as const, label: "Plan", icon: MapIcon },
                ].map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setView(id)}
                    disabled={replaying}
                    aria-pressed={effectiveView === id}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-40",
                      effectiveView === id
                        ? "bg-cat-500 text-ink-950"
                        : "text-muted hover:text-zinc-200",
                    )}
                  >
                    <Icon className="size-3" aria-hidden />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Layer toggles */}
            <div className="flex items-center gap-1 rounded border border-white/12 bg-ink-900/90 px-1.5 py-1">
              <span className="label-xs !text-[9px] pl-0.5 pr-0.5 text-zinc-500">Layers</span>
              {LAYER_CONTROLS.map(({ key, label, short, icon: Icon }) => (
                <Hint key={key} label={label}>
                  <button
                    onClick={() => toggle(key)}
                    aria-pressed={layers[key]}
                    aria-label={label}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors",
                      layers[key] ? "bg-cat-500/12 text-cat-500" : "text-muted hover:text-zinc-200",
                    )}
                  >
                    <Icon className="size-3" aria-hidden />
                    <span className="hidden lg:inline">{short}</span>
                  </button>
                </Hint>
              ))}
            </div>
          </div>

          <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
            {replaying ? (
              <span className="rounded border border-cat-500/50 bg-cat-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-cat-500">
                Replay
              </span>
            ) : null}
            <Button
              variant="outline"
              size="icon"
              className="size-7 bg-ink-900/90"
              aria-label={
                expanded ? "Exit full screen" : "Expand the twin to full screen"
              }
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? (
                <Minimize2 className="size-3.5" />
              ) : (
                <Maximize2 className="size-3.5" />
              )}
            </Button>
          </div>
        </div>

        {/* Scene */}
        <div className="relative min-h-0 flex-1">
          {loading ? (
            <LoadingState
              label="Loading site geometry and machine positions…"
              className="h-full"
            />
          ) : effectiveView === "3d" ? (
            <TwinScene {...sceneProps} />
          ) : (
            <div className="absolute inset-0 p-2">
              <TwinPlan {...sceneProps} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/10 bg-ink-900/70 px-3 py-1.5">
          <SitePlanLegend />
          <p className="hidden text-[10px] text-muted sm:block">
            {effectiveView === "3d"
              ? "Drag to orbit · scroll to zoom · click a machine to inspect"
              : "Click a machine to inspect it"}
            {expanded ? " · Esc to exit" : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
