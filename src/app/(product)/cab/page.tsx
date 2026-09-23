import { Suspense } from "react";
import type { Metadata } from "next";
import { CabHmi } from "@/components/cab/cab-hmi";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = {
  title: "Operator cab - CAT Copilot",
  description: "In-cab assistant: task, machine health, safety and the site assistant.",
};

export default function CabPage() {
  return (
    <Suspense fallback={<LoadingState label="Connecting to the machine..." className="h-full" />}>
      <CabHmi />
    </Suspense>
  );
}
