import type { Metadata } from "next";
import { TwinExperience } from "@/components/twin/TwinExperience";
import { TwinAssistantScope } from "@/components/assistant/page-scopes";

export const metadata: Metadata = {
  title: "Live Digital Twin",
  description:
    "3D construction site digital twin with a keyboard-driven CAT 320 excavator, proximity safety engine and predictive collision screening.",
};

export default function TwinPage() {
  return (
    <>
      <TwinAssistantScope />
      <TwinExperience />
    </>
  );
}
