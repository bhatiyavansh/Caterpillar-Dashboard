import type { Metadata } from "next";
import { OwnerPortal } from "@/components/owner/owner-portal";

export const metadata: Metadata = {
  title: "Fleet and cost",
  description: "Utilisation, fuel, idle cost, carbon, maintenance and detected anomalies.",
};

export default function OwnerPage() {
  return <OwnerPortal />;
}
