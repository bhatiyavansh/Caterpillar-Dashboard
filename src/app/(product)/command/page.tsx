import { Suspense } from "react";
import type { Metadata } from "next";
import { CommandCenter } from "@/components/command/command-center";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = {
  title: "Command centre",
  description: "Live situational awareness across every machine, worker and hazard on site.",
};

export default function CommandPage() {
  return (
    <Suspense fallback={<LoadingState label="Connecting to the site stream..." className="h-full" />}>
      <CommandCenter />
    </Suspense>
  );
}
