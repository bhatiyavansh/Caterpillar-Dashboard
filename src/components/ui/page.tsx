"use client";

/**
 * Page-level layout primitives.
 *
 * Every scrolling screen in the product routes through `PageShell`, so page
 * width, gutters and vertical rhythm are decided once rather than per screen.
 * Before this existed the same layout was written five slightly different ways
 * — 1500px here, 1400px there, none at all on the records pages — which is what
 * made moving between surfaces feel like moving between products.
 */
import * as React from "react";
import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Content width.
 *
 * `wide` is the default for analytical screens. `full` is for screens that own
 * the viewport (the command centre, the cab), which manage their own panes and
 * must not be centred. `narrow` is for single-column reading and phone-first
 * surfaces such as AR maintenance.
 */
export type PageWidth = "narrow" | "wide" | "full";

const WIDTH: Record<PageWidth, string> = {
  narrow: "mx-auto w-full max-w-3xl",
  wide: "mx-auto w-full max-w-[1600px]",
  full: "w-full",
};

/**
 * The scroll container for a page. Owns the gutter and the space between
 * sections so individual pages never have to guess.
 */
export function PageShell({
  width = "wide",
  children,
  className,
}: {
  width?: PageWidth;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className={cn(WIDTH[width], "space-y-4 p-4 pb-10", className)}>{children}</div>
    </div>
  );
}

/**
 * A page header that is not full-bleed — it sits inside `PageShell`, unlike
 * the records `PageHeader`, which spans the scroll container.
 */
export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex flex-wrap items-center gap-1 text-[11px] text-muted">
        <li className="flex items-center gap-1">
          <Link
            href="/command"
            className="inline-flex items-center gap-1 rounded transition-colors hover:text-zinc-200"
          >
            <Home className="size-3" aria-hidden />
            <span className="sr-only">Command centre</span>
          </Link>
        </li>
        {items.map((crumb, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1">
              <ChevronRight className="size-3 shrink-0 text-zinc-600" aria-hidden />
              {crumb.href && !last ? (
                <Link href={crumb.href} className="truncate rounded transition-colors hover:text-zinc-200">
                  {crumb.label}
                </Link>
              ) : (
                <span className={cn("truncate", last && "font-semibold text-zinc-300")} aria-current={last ? "page" : undefined}>
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Title block for a page inside `PageShell`.
 *
 * The heading is `text-lg`, not a display size: the top bar already names the
 * surface, so a 32px title here would repeat it and push the actual content
 * below the fold.
 */
export function PageTitle({
  title,
  subtitle,
  crumbs,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  crumbs?: Crumb[];
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        {crumbs?.length ? <Breadcrumbs items={crumbs} className="mb-1" /> : null}
        <h1 className="truncate text-lg font-bold leading-tight tracking-tight text-zinc-50">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-xs leading-relaxed text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * A titled block of content. Used for the repeated
 * "heading, optional meta, bordered body" pattern that every analytical screen
 * has, so the border, radius and header height match everywhere.
 */
export function Panel({
  title,
  meta,
  actions,
  children,
  bodyClassName,
  className,
}: {
  title?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
  className?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded border border-white/10 bg-ink-900", className)}>
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <h2 className="label-xs !text-zinc-300">{title}</h2>
            {meta ? <span className="truncate text-[11px] text-muted">{meta}</span> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </div>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
