"use client";

/**
 * Horizontal section rail for areas that have sub-pages.
 *
 * `/dashboard` used to carry a second full sidebar of its own, which made the
 * records area read as a different product. Its sections live here instead:
 * one shell, one primary rail, and sub-navigation that stays visibly inside it.
 */
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DASHBOARD_SECTIONS, type NavItem } from "./nav-config";
import { cn } from "@/lib/utils";

export function SectionNav({
  items,
  title,
  actions,
  className,
}: {
  items: NavItem[];
  /** Names the area these sections belong to. */
  title: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const active = [...items]
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-3 border-b border-white/[0.07] bg-ink-900/40 px-3 backdrop-blur-xl sm:px-5",
        className,
      )}
    >
      <span className="label-xs hidden shrink-0 lg:block">{title}</span>
      <span className="hidden h-4 w-px shrink-0 bg-white/10 lg:block" aria-hidden />

      <nav aria-label={`${title} sections`} className="min-w-0 flex-1">
        <ul className="flex items-center gap-0.5 overflow-x-auto py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items.map((item) => {
            const isActive = active?.href === item.href;
            const Icon = item.icon;
            return (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                    isActive
                      ? "bg-gradient-cat text-ink-950 shadow-[0_4px_14px_-6px_rgb(255_205_17/0.6)]"
                      : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100",
                  )}
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * Machine-records sections.
 *
 * It imports the section list itself rather than receiving it: the icons are
 * function references, and those cannot be passed from a server layout into a
 * client component.
 */
export function DashboardSectionNav({ actions }: { actions?: React.ReactNode }) {
  return <SectionNav items={DASHBOARD_SECTIONS} title="Machine records" actions={actions} />;
}
