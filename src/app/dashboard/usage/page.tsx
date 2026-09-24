"use client";

import { PageHeader, RunSimulationButton } from "@/components/navigation/dashboard-shell";
import { AnomalyFeed } from "@/components/anomalies/anomaly-feed";
import { useAnomalies } from "@/lib/hooks/use-site";

export default function UsagePage() {
  const { data: anomalies } = useAnomalies();

  return (
    <div className="pb-10">
      <PageHeader
        title="Unusual usage"
        subtitle="Machine behaviour that does not match the job or the machine's own history — detected, not reported."
        actions={<RunSimulationButton size="md" />}
      />
      <div className="p-6">
        <AnomalyFeed anomalies={anomalies} />
      </div>
    </div>
  );
}
