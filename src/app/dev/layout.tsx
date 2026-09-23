import { AppShell } from "@/components/shell/app-shell";

/**
 * Developer benches sit inside the shell too.
 *
 * They are internal tools, not product surfaces, but they are reachable from
 * the sidebar — so without the shell they would strand whoever opened them
 * with no way back except the browser button.
 */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
