"use client";

/**
 * Ctrl+K palette. During the demo it is the fastest way between surfaces, and
 * it doubles as machine search.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search } from "lucide-react";
import { ALL_NAV } from "./nav-config";
import { useFleet } from "@/lib/hooks/use-site";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/overlays";
import { MachineStatusChip } from "@/components/ui/status";
import { cn } from "@/lib/utils";

interface Entry {
  id: string;
  label: string;
  hint: string;
  href: string;
  group: "Screens" | "Machines";
  trailing?: React.ReactNode;
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const { data: machines } = useFleet();
  const [query, setQuery] = React.useState("");
  const [index, setIndex] = React.useState(0);

  const entries = React.useMemo<Entry[]>(() => {
    const screens: Entry[] = ALL_NAV.map((n) => ({
      id: n.href,
      label: n.label,
      hint: n.audience,
      href: n.href,
      group: "Screens",
    }));
    const fleet: Entry[] = machines.map((m) => ({
      id: m.id,
      label: m.id,
      hint: `${m.model} · ${m.zone}`,
      href: `/command?machine=${m.id}`,
      group: "Machines",
      trailing: <MachineStatusChip status={m.status} size="sm" />,
    }));
    const all = [...screens, ...fleet];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((e) => `${e.label} ${e.hint}`.toLowerCase().includes(q));
  }, [machines, query]);

  // Reset navigation state when the query changes or the palette reopens —
  // both are external triggers (typing, a keyboard shortcut), not derived
  // render state, so this is a legitimate synchronization effect.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing to external open/query changes, not derived render state
  React.useEffect(() => setIndex(0), [query]);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets local input state each time the dialog reopens
    if (open) setQuery("");
  }, [open]);

  const go = React.useCallback(
    (entry: Entry | undefined) => {
      if (!entry) return;
      onOpenChange(false);
      router.push(entry.href);
    },
    [onOpenChange, router],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, entries.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(entries[index]);
    }
  };

  let lastGroup = "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[18%] w-[min(94vw,36rem)] translate-y-0 p-0">
        <DialogTitle className="sr-only">Jump to a screen or machine</DialogTitle>

        <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3">
          <Search className="size-4 shrink-0 text-muted" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a screen or machine"
            aria-label="Jump to a screen or machine"
            className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-muted"
          />
          <kbd className="shrink-0 rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-muted">
            Esc
          </kbd>
        </div>

        <ul className="max-h-80 overflow-y-auto py-1.5" role="listbox" aria-label="Results">
          {entries.length ? (
            entries.map((entry, i) => {
              const header = entry.group !== lastGroup ? ((lastGroup = entry.group), entry.group) : null;
              return (
                <React.Fragment key={entry.id}>
                  {header ? <li className="label-xs px-4 pb-1 pt-2">{header}</li> : null}
                  <li role="option" aria-selected={i === index}>
                    <button
                      onClick={() => go(entry)}
                      onMouseEnter={() => setIndex(i)}
                      className={cn(
                        "flex w-full items-center gap-3 px-4 py-2 text-left transition-colors",
                        i === index ? "bg-cat-500/12" : "hover:bg-white/5",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-zinc-100">{entry.label}</span>
                        <span className="block truncate text-[11px] text-muted">{entry.hint}</span>
                      </span>
                      {entry.trailing}
                      {i === index ? <CornerDownLeft className="size-3.5 shrink-0 text-muted" aria-hidden /> : null}
                    </button>
                  </li>
                </React.Fragment>
              );
            })
          ) : (
            <li className="px-4 py-8 text-center text-xs text-muted">
              Nothing matches &ldquo;{query}&rdquo;.
            </li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
