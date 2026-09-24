import type { Metadata } from "next";
import { DirectorPanel } from "@/components/director/director-panel";

export const metadata: Metadata = {
  title: "Demo control",
  description: "Internal scenario control for the live demonstration.",
  robots: { index: false, follow: false },
};

export default function DirectorPage() {
  return <DirectorPanel />;
}
