"use client";

/**
 * The frame every surface sits in.
 *
 * `/cab` collapses the rail on arrival: the operator surface should read as a
 * machine interface, not a manager's console, but the presenter still needs to
 * get to the next screen in one click during the demo.
 */
import * as React from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Menu, X } from "lucide-react";
import { AppSidebar } from "./app-sidebar";
import { TopBar } from "./top-bar";
import { CommandPalette } from "./command-palette";
import { AssistantDrawer } from "@/components/assistant/global-assistant";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/**
 * Routes that want the rail out of the way on arrival.
 *
 * These are surfaces where the content is the point — an operator display, a
 * 3D site, a phone-width procedure — and a 240px rail costs them more than it
 * gives. The rail collapses to icons rather than disappearing, so navigation is
 * always one click away.
 */
const FOCUSED_ROUTES = ["/hmi", "/training/lesson", "/cab", "/ar/procedures", "/director", "/twin", "/machine"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const focused = FOCUSED_ROUTES.some((r) => pathname.startsWith(r));

  const [collapsed, setCollapsed] = React.useState(focused);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  // Follow the route's intent on navigation, but never fight a manual toggle
  // within the same route.
  const lastRoute = React.useRef(pathname);
  React.useEffect(() => {
    if (lastRoute.current !== pathname) {
      lastRoute.current = pathname;
      setCollapsed(focused);
      setMobileOpen(false);
    }
  }, [pathname, focused]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden">
      <div className="hidden lg:block">
        <AppSidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      </div>

      <AnimatePresence>
        {mobileOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              initial={{ x: -260 }}
              animate={{ x: 0 }}
              exit={{ x: -260 }}
              transition={{ type: "spring", stiffness: 280, damping: 30 }}
              className="relative h-full w-60"
            >
              <AppSidebar collapsed={false} />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close navigation"
                className="absolute right-2 top-3"
                onClick={() => setMobileOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onOpenNav={() => setMobileOpen(true)}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <main className={cn("min-w-0 flex-1 overflow-hidden")}>{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      {/* The drawer view of the one assistant (its dock is in the top bar; its state in AssistantProvider). */}
      <AssistantDrawer />
    </div>
  );
}

/** Menu button for the mobile top bar, exported so `TopBar` stays presentational. */
export function NavToggle({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={onClick}>
      <Menu className="size-5" />
    </Button>
  );
}
