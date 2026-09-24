import type { Metadata } from "next";
import { GuidedLesson } from "@/components/training/guided-lesson";

export const metadata: Metadata = {
  title: "Guided lesson",
  description: "Learn the excavator step by step with the keyboard, coached by a local LLM.",
};

export default function GuidedLessonPage() {
  return <GuidedLesson />;
}
