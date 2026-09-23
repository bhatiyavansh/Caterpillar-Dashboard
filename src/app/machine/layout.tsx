import { AppShell } from "@/components/shell/app-shell";

/**
 * The in-cab display sits inside the product shell.
 *
 * It keeps its own on-device navigation — that rail is part of what is being
 * simulated — but nesting it here means it is clearly a display being previewed
 * rather than a dead end the presenter has to use the browser back button to
 * escape.
 */
export default function MachineLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
