"use client";

import { BellOff, CheckCheck } from "lucide-react";
import { EmptyState } from "@/components/ui/primitives";
import { cn, severityStyles } from "@/lib/utils";
import { useMachineStore } from "@/store/machine-store";
import { ScreenPad, SectionTitle, TouchButton } from "../touch";

export function NotificationsScreen() {
  const notifications = useMachineStore((s) => s.notifications);
  const markRead = useMachineStore((s) => s.markNotificationsRead);
  const unread = notifications.filter((n) => !n.read).length;

  if (notifications.length === 0) {
    return (
      <ScreenPad>
        <EmptyState
          icon={<BellOff className="size-8" />}
          title="No notifications"
          body="Machine messages, reminders and work assignments will appear here."
        />
      </ScreenPad>
    );
  }

  return (
    <ScreenPad className="space-y-4">
      <SectionTitle
        right={
          <TouchButton className="min-h-12 px-4 text-sm" icon={<CheckCheck className="size-5" />} onClick={markRead}>
            Mark all read
          </TouchButton>
        }
      >
        {unread} unread
      </SectionTitle>

      <ul className="space-y-2">
        {notifications.map((n) => {
          const s = severityStyles[n.severity];
          return (
            <li
              key={n.id}
              className={cn(
                "flex min-h-20 items-start gap-4 rounded border bg-ink-900 p-4",
                n.read ? "border-white/8 opacity-70" : s.border,
              )}
            >
              <span className={cn("mt-1.5 size-3 shrink-0 rounded-full", s.dot)} />
              <div className="min-w-0">
                <p className="text-lg font-bold text-zinc-100">{n.title}</p>
                <p className="mt-0.5 text-base text-zinc-400">{n.body}</p>
              </div>
              <span className="ml-auto whitespace-nowrap font-mono text-sm text-muted">{n.time}</span>
            </li>
          );
        })}
      </ul>
    </ScreenPad>
  );
}
