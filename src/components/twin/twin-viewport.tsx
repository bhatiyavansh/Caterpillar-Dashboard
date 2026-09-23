"use client";

/**
 * The stage the twin lives on: layer controls, expand, replay badge and the
 * scene itself. The scene is swappable; this frame is not.
 */
import * as React from "react";
import { Boxes, Eye, Flame, HardHat, Maximize2, Minimize2, Radio, Users } from "lucide-react";
import { TwinScene, hasThreeDimensionalTwin } from "./twin-scene";
import { SitePlanLegend } from "./site-plan";
import { DEFAULT_LAYERS, type TwinLayers, type TwinSceneProps } from "./twin-contract";
import { Button } from "@/components/ui/primitives";
import { Hint } from "@/components/ui/tooltip";
import { LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/utils";

const LAYER_CONTROLS: { key: keyof TwinLayers; label: string; icon: React.ElementType }[] = [
  { key: "bubbles", label: "Safety bubbles", icon: Eye },
  { key: "v2v", label: "Machine-to-machine paths", icon: Radio },
  { key: "workers", label: "Ground workers", icon: Users },
  { key: "heatmap", label: "Incident density", icon: Flame },
  { key: "zones", label: "Zone boundaries", icon: HardHat },
];

export function TwinViewport({
  machines,
  alerts,
  selectedId,
  onSelect,
  markers,
  replayAt,
  loading,
  className,
}: Omit<TwinSceneProps, "layers" | "expanded"> & { loading?: boolean; className?: string }) {
  const [layers, setLayers] = React.useState<TwinLayers>(DEFAULT_LAYERS);
  const [expanded, setExpanded] = React.useState(false);

  const toggle = (key: keyof TwinLayers) => setLayers((l) => ({ ...l, [key]: !l[key] }));

  React.useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const body = (
    <div
      className={cn(
        "relative flex min-h-0 flex-1 flex-col overflow-hidden bg-ink-950",
        expanded && "fixed inset-0 z-[90] bg-ink-950",
      )}
    >
      {/* Controls */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-2.5">
        <div className="flex flex-wrap items-center gap-1">
          {LAYER_CONTROLS.map(({ key, label, icon: Icon }) => (
            <Hint key={key} label={label}>
              <button
                onClick={() => toggle(key)}
                aria-pressed={layers[key]}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors",
                  layers[key]
                    ? "border-cat-500/40 bg-cat-500/12 text-cat-500"
                    : "border-white/10 bg-ink-900/85 text-muted hover:text-zinc-200",
                )}
              >
                <Icon className="size-3" aria-hidden />
                <span className="hidden sm:inline">{label.split(" ")[0]}</span>
              </button>
            </Hint>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {!hasThreeDimensionalTwin ? (
            <Hint label="The 3D twin mounts here. The live site plan is running in its place.">
              <span className="hidden items-center gap-1.5 rounded border border-white/10 bg-ink-900/85 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted md:inline-flex">
                <Boxes className="size-3" aria-hidden />
                Plan view
              </span>
            </Hint>
          ) : null}
          <Button
            variant="outline"
            size="icon"
            className="size-7 bg-ink-900/85"
            aria-label={expanded ? "Exit full screen" : "Expand the twin to full screen"}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </Button>
        </div>
      </div>

      {/* Scene */}
      <div className="min-h-0 flex-1 p-2">
        {loading ? (
          <LoadingState label="Loading site geometry and machine positions…" className="h-full" />
        ) : (
          <TwinScene
            machines={machines}
            alerts={alerts}
            selectedId={selectedId}
            onSelect={onSelect}
            layers={layers}
            replayAt={replayAt}
            markers={markers}
            expanded={expanded}
          />
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-ink-900/60 px-3 py-1.5">
        <SitePlanLegend />
        <p className="hidden text-[10px] text-muted sm:block">
          Select a machine to inspect it{expanded ? " · Esc to exit full screen" : ""}
        </p>
      </div>
    </div>
  );

  return <div className={cn("flex min-h-0 flex-col", className)}>{body}</div>;
}
