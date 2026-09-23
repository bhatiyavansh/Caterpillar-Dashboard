"use client";

/**
 * Loading, empty and error states.
 *
 * Every panel routes through `<PanelState>` so a screen never shows a blank
 * rectangle, and so "nothing is wrong" and "nothing loaded" never look alike.
 */
import * as React from "react";
import { AlertOctagon, Inbox, Loader2, RotateCw, ShieldCheck } from "lucide-react";
import { Button } from "./primitives";
import { cn } from "@/lib/utils";

export function LoadingState({ label, className }: { label: string; className?: string }) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-3 px-6 py-10 text-center", className)}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-5 animate-spin text-cat-500" aria-hidden />
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

export function EmptyPanel({
  title,
  body,
  icon,
  tone = "neutral",
  action,
  className,
}: {
  title: string;
  body: string;
  icon?: React.ReactNode;
  /** `good` is for "nothing wrong here", which is a result, not an absence. */
  tone?: "neutral" | "good";
  action?: React.ReactNode;
  className?: string;
}) {
  const Icon = tone === "good" ? ShieldCheck : Inbox;
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-10 text-center",
        className,
      )}
    >
      <span className={cn("rounded-full p-2", tone === "good" ? "bg-status-ok/10 text-status-ok" : "bg-white/5 text-muted")}>
        {icon ?? <Icon className="size-5" aria-hidden />}
      </span>
      <p className={cn("text-sm font-semibold", tone === "good" ? "text-status-ok" : "text-zinc-200")}>{title}</p>
      <p className="max-w-xs text-xs leading-relaxed text-muted">{body}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Unable to connect to the fleet stream",
  body,
  onRetry,
  className,
}: {
  title?: string;
  body: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}
      role="alert"
    >
      <span className="rounded-full bg-status-crit/10 p-2 text-status-crit">
        <AlertOctagon className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-zinc-100">{title}</p>
      <p className="max-w-xs text-xs leading-relaxed text-muted">{body}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
          <RotateCw className="size-3.5" aria-hidden />
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The one wrapper panels use. It resolves loading, error and empty in the right
 * order so callers only write the happy path.
 */
export function PanelState<T>({
  query,
  isEmpty,
  loadingLabel,
  empty,
  children,
  className,
}: {
  query: { data: T; loading: boolean; error: string | null };
  isEmpty?: (data: T) => boolean;
  loadingLabel: string;
  empty?: React.ReactNode;
  children: (data: T) => React.ReactNode;
  className?: string;
}) {
  if (query.loading) return <LoadingState label={loadingLabel} className={className} />;
  if (query.error) return <ErrorState body={query.error} className={className} />;
  if (isEmpty?.(query.data) && empty) return <>{empty}</>;
  return <>{children(query.data)}</>;
}

/** Row skeletons for lists that are still filling. */
export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2 p-3", className)} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="size-8 animate-pulse rounded bg-white/6" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 w-1/3 animate-pulse rounded bg-white/8" />
            <div className="h-2 w-1/2 animate-pulse rounded bg-white/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
