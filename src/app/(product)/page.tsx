import type { Metadata } from "next";
import { HomeLaunchpad } from "@/components/home/home-launchpad";

export const metadata: Metadata = {
  title: "Home",
  description: "Every CAT Copilot surface, grouped by who it is for, with the live site at a glance.",
};

export default function HomePage() {
  return <HomeLaunchpad />;
}
