"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Bell,
  Camera,
  ChevronLeft,
  ClipboardCheck,
  Gauge,
  Home,
  Map as MapIcon,
  MessageSquareText,
  Signal,
  Stethoscope,
  TriangleAlert,
  User,
  Wifi,
} from "lucide-react";
import { cn, statusStyles } from "@/lib/utils";
import { useMachineHealth, useMachineStore } from "@/store/machine-store";
import { StatusDot } from "@/components/shared/status";
import { HomeScreen } from "./screens/home-screen";
import { AssistantScreen } from "./screens/assistant-screen";
import { InspectionScreen } from "./screens/inspection-screen";
import { AlertsScreen } from "./screens/alerts-screen";
import { CameraScreen } from "./screens/camera-screen";
import { MapScreen } from "./screens/map-screen";
import { PerformanceScreen } from "./screens/performance-screen";
import { StatusScreen } from "./screens/status-screen";
import { OperatorScreen } from "./screens/operator-screen";
import { NotificationsScreen } from "./screens/notifications-screen";

export type MachineScreen =
  | "home"
  | "assistant"
  | "inspection"
  | "alerts"
  | "camera"
  | "map"
  | "performance"
  | "status"
  | "operator"
  | "notifications";

export const SCREEN_TITLES: Record<MachineScreen, string> = {
  home: "Machine home",
  assistant: "Machine Assistant",
  inspection: "Daily inspection",
  alerts: "Alerts",
  camera: "Camera & vision",
  map: "Worksite map",
  performance: "Performance",
  status: "Machine status",
  operator: "Operator",
  notifications: "Notifications",
};

const screens: Record<MachineScreen, React.ComponentType<{ navigate: (s: MachineScreen) => void }>> = {
  home: HomeScreen,
  assistant: AssistantScreen,
  inspection: InspectionScreen,
  alerts: AlertsScreen,
  camera: CameraScreen,
  map: MapScreen,
  performance: PerformanceScreen,
  status: StatusScreen,
  operator: OperatorScreen,
  notifications: NotificationsScreen,
};

const quickActions: { screen: MachineScreen; label: string; icon: React.ElementType }[] = [
  { screen: "home", label: "Home", icon: Home },
  { screen: "assistant", label: "Assistant", icon: MessageSquareText },
  { screen: "inspection", label: "Inspection", icon: ClipboardCheck },
  { screen: "camera", label: "Camera", icon: Camera },
  { screen: "map", label: "Map", icon: MapIcon },
  { screen: "performance", label: "Performance", icon: Gauge },
  { screen: "status", label: "Status", icon: Stethoscope },
  { screen: "alerts", label: "Alerts", icon: TriangleAlert },
];

function ClockReadout() {
  const [now, setNow] = React.useState<string>("--:--");
  React.useEffect(() => {
    const update = () =>
      setNow(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    update();
    const id = window.setInterval(update, 10_000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="font-mono text-xl font-semibold tabular-nums text-zinc-100">{now}</span>;
}

export function MachineTopBar({
  screen,
  navigate,
}: {
  screen: MachineScreen;
  navigate: (s: MachineScreen) => void;
}) {
  const health = useMachineHealth();
  const unread = useMachineStore((s) => s.notifications.filter((n) => !n.read).length);
  const s = statusStyles[health];

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b-2 border-white/10 bg-ink-900 px-4">
      {screen !== "home" ? (
        <button
          onClick={() => navigate("home")}
          className="flex h-12 items-center gap-2 rounded bg-white/5 px-3 text-sm font-semibold text-zinc-200 hover:bg-white/10"
          aria-label="Back to machine home"
        >
          <ChevronLeft className="size-5" aria-hidden />
          Back
        </button>
      ) : (
        <div className="flex size-11 items-center justify-center rounded bg-cat-500 text-sm font-black text-ink-950">
          CAT
        </div>
      )}

      <div className="min-w-0">
        <p className="truncate text-base font-bold tracking-wide text-zinc-50">
          {screen === "home" ? "CAT 320" : SCREEN_TITLES[screen]}
        </p>
        <p className="truncate text-[11px] uppercase tracking-[0.16em] text-muted">
          {screen === "home" ? "Hydraulic Excavator · CAT-320-014" : "CAT 320 · CAT-320-014"}
        </p>
      </div>

      <div
        className={cn(
          "ml-4 hidden items-center gap-2 rounded border px-3 py-2 sm:flex",
          s.bg,
          s.border,
          s.text,
        )}
      >
        <StatusDot status={health} pulse />
        <span className="text-sm font-bold uppercase tracking-[0.12em]">
          {health === "healthy" ? "Operational" : health === "warning" ? "Caution" : "Critical"}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <span className="hidden items-center gap-1.5 text-xs text-muted md:flex">
          <Signal className="size-4 text-status-ok" aria-hidden /> GPS
        </span>
        <span className="hidden items-center gap-1.5 text-xs text-muted md:flex">
          <Wifi className="size-4 text-status-ok" aria-hidden /> LTE
        </span>
        <button
          onClick={() => navigate("notifications")}
          className="relative flex size-12 items-center justify-center rounded bg-white/5 hover:bg-white/10"
          aria-label={`Notifications, ${unread} unread`}
        >
          <Bell className="size-5 text-zinc-200" aria-hidden />
          {unread > 0 ? (
            <span className="absolute right-2 top-2 size-2.5 rounded-full bg-status-crit ring-2 ring-ink-900" />
          ) : null}
        </button>
        <ClockReadout />
        <button
          onClick={() => navigate("operator")}
          className="flex h-12 items-center gap-2 rounded bg-white/5 px-3 hover:bg-white/10"
          aria-label="Operator profile"
        >
          <User className="size-5 text-cat-500" aria-hidden />
          <span className="hidden text-sm font-semibold text-zinc-200 sm:block">Alex</span>
        </button>
      </div>
    </header>
  );
}

export function QuickActionDock({
  screen,
  navigate,
}: {
  screen: MachineScreen;
  navigate: (s: MachineScreen) => void;
}) {
  const openAlerts = useMachineStore((s) => s.alerts.filter((a) => !a.acknowledged).length);

  return (
    <nav
      aria-label="Machine quick actions"
      className="flex h-20 shrink-0 items-stretch gap-2 border-t-2 border-white/10 bg-ink-900 px-2 py-2"
    >
      {quickActions.map(({ screen: target, label, icon: Icon }) => {
        const active = screen === target;
        return (
          <button
            key={target}
            onClick={() => navigate(target)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex min-w-[72px] flex-1 flex-col items-center justify-center gap-1 rounded transition-colors",
              active ? "bg-cat-500 text-ink-950" : "bg-white/5 text-zinc-300 hover:bg-white/10",
            )}
          >
            <Icon className="size-6" aria-hidden />
            <span className="text-[11px] font-bold uppercase tracking-wider">{label}</span>
            {target === "alerts" && openAlerts > 0 ? (
              <span className="absolute right-2 top-1.5 rounded-full bg-status-crit px-1.5 text-[10px] font-bold text-white">
                {openAlerts}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * The complete in-cab application. Rendered both at /machine and inside the
 * simulated display, so what the demo shows is literally the shipping UI.
 */
export function MachineApp({
  screen,
  onNavigate,
}: {
  screen: MachineScreen;
  onNavigate: (s: MachineScreen) => void;
}) {
  const Screen = screens[screen];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-ink-950 text-zinc-100">
      <MachineTopBar screen={screen} navigate={onNavigate} />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={screen}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="h-full overflow-y-auto"
          >
            <Screen navigate={onNavigate} />
          </motion.div>
        </AnimatePresence>
      </div>
      <QuickActionDock screen={screen} navigate={onNavigate} />
    </div>
  );
}
