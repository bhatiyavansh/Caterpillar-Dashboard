import type { Metadata } from "next";
import { ArMaintenance } from "@/components/ar/ar-maintenance";

export const metadata: Metadata = {
  title: "Routine procedures",
  description: "Guided maintenance procedures with manual citations, for use at the machine.",
};

export default function ProceduresPage() {
  return <ArMaintenance />;
}
