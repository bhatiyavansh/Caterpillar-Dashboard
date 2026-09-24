import type { Metadata } from "next";
import { HmiPage } from "@/components/hmi/hmi-page";

export const metadata: Metadata = {
  title: "Vehicle display",
  description: "The operator's in-cab screen: tasks, safety, training, usage coaching and time estimates.",
};

export default function HmiRoute() {
  return <HmiPage />;
}
