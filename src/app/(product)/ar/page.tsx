import type { Metadata } from "next";
import { MaintenanceHub } from "@/components/maintenance/maintenance-hub";

export const metadata: Metadata = {
  title: "AR maintenance",
  description: "Every machine's maintenance state, open breakdowns and their reports.",
};

export default function ArPage() {
  return <MaintenanceHub />;
}
