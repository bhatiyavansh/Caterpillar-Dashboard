import { AppShell } from "@/components/shell/app-shell";
import { DashboardSectionNav } from "@/components/shell/section-nav";

/**
 * Machine records shares the one app shell. Its own sections sit in a rail
 * under the top bar rather than in a second sidebar.
 *
 * The width cap matches the rest of the product, so a records table and the
 * owner report line up at the same gutter on a wide monitor instead of one
 * running edge to edge while the other is centred.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col">
        <DashboardSectionNav />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </div>
      </div>
    </AppShell>
  );
}
