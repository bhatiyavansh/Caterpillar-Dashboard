import type { Metadata } from "next";
import { TrainingHub } from "@/components/training/training-hub";

export const metadata: Metadata = {
  title: "Training hub",
  description: "Skill path, incident replays and the browser machine simulator.",
};

export default function TrainingPage() {
  return <TrainingHub />;
}
