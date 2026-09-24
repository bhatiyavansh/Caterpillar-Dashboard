import type { Metadata } from "next";
import { MachineMaintenance } from "@/components/maintenance/machine-maintenance";

export async function generateMetadata(props: PageProps<"/ar/[machineId]">): Promise<Metadata> {
  const { machineId } = await props.params;
  return { title: `${machineId} · AR maintenance` };
}

export default async function MachineMaintenancePage(props: PageProps<"/ar/[machineId]">) {
  const { machineId } = await props.params;
  return <MachineMaintenance machineId={decodeURIComponent(machineId)} />;
}
