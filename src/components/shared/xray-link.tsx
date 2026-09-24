"use client";

import Link from "next/link";
import { ScanLine } from "lucide-react";
import { buttonVariants } from "@/components/ui/primitives";
import { componentForIssue, kindOf } from "@/lib/twin/components";
import { xrayHref } from "@/lib/hooks/use-xray";
import { cn } from "@/lib/utils";

/**
 * "Show me where on the machine": deep-links any alert, anomaly or
 * maintenance row into the twin's X-ray view of that machine, framed on the
 * component the issue concerns. The component is worked out from whatever the
 * row carries — an explicit component, an alert kind, an anomaly pattern, or
 * free text like "Hydraulic system".
 */
export function XrayLink({
  machineId,
  issue,
  label = "X-ray",
  compact = false,
  className,
}: {
  machineId: string;
  issue?: { component?: string | null; alertKind?: string | null; pattern?: string | null; text?: string | null };
  label?: string;
  compact?: boolean;
  className?: string;
}) {
  const kind = kindOf(machineId);
  const component = kind && issue ? componentForIssue(kind, issue) : null;
  return (
    <Link
      href={xrayHref(machineId, component)}
      aria-label={`Open ${machineId} in X-ray${component ? `, ${component.replace(/_/g, " ")}` : ""}`}
      title={component ? `X-ray · ${component.replace(/_/g, " ")}` : "X-ray"}
      className={cn(
        buttonVariants({ variant: "outline", size: compact ? "icon" : "sm" }),
        "border-[#62d0ff]/35 text-[#8fdcff] hover:border-[#62d0ff]/70 hover:bg-[#62d0ff]/10",
        compact && "size-8",
        className,
      )}
    >
      <ScanLine className="size-3.5" aria-hidden />
      {compact ? null : label}
    </Link>
  );
}
