"use client";

/**
 * Assistant scopes for pages whose context lives in a store or the URL rather
 * than in one screen component. Each renders nothing; it tells the global
 * assistant which machine the page is about, so a question asked there goes
 * out with the right `machine_id`. The surface itself comes from the route
 * (`surfaceForRoute`) unless a scope says otherwise.
 */

import { useParams, usePathname } from "next/navigation";
import { useTwinStore } from "@/store/twinStore";
import { PRIMARY_MACHINE_ID } from "@/lib/api/seed";
import { useAssistantScope } from "./assistant-provider";

/** The 3D twin: whichever machine is selected (followed by the camera). */
export function TwinAssistantScope({ label = "Site twin" }: { label?: string }) {
  const machineId = useTwinStore((s) => s.selectedMachine);
  useAssistantScope({ surface: "command", machineId, label: `${label} · ${machineId}` });
  return null;
}

/**
 * The records section. Its primary record, CAT-320-014, is EXC001 on the
 * site; the other records are historical and not on the hub, so they carry
 * no machine id rather than one the hub would not recognise.
 */
const RECORD_TO_FLEET: Record<string, string> = { "CAT-320-014": PRIMARY_MACHINE_ID };

/** Records pages about the primary machine without an id in the URL. */
const PRIMARY_PAGES = ["/dashboard/live", "/dashboard/diagnostics"];

export function DashboardAssistantScope() {
  const pathname = usePathname() ?? "";
  const params = useParams<{ id?: string }>();
  const record = params?.id ? decodeURIComponent(params.id) : undefined;
  const machineId = record
    ? RECORD_TO_FLEET[record]
    : PRIMARY_PAGES.some((p) => pathname.startsWith(p))
      ? PRIMARY_MACHINE_ID
      : undefined;
  const label = record ? `Records · ${record}` : machineId ? `Records · ${machineId}` : "Machine records";
  useAssistantScope({ surface: "command", machineId, label });
  return null;
}
