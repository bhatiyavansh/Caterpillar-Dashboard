import { AppShell } from "@/components/shell/app-shell";
import { DashboardSectionNav } from "@/components/shell/section-nav";

/**
 * Machine records shares the one app shell. Its own sections sit in a rail
 * under the top bar rather than in a second sidebar.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col">
        <DashboardSectionNav />
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </AppShell>
  );
}
