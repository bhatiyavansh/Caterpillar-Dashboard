"use client";

import { PageHeader, RunSimulationButton } from "@/components/navigation/dashboard-shell";
import { IncidentLog } from "@/components/incidents/incident-log";
import { useFleet, useIncidents } from "@/lib/hooks/use-site";

export default function IncidentsPage() {
  const { data: incidents, file, report } = useIncidents();
  const { data: machines } = useFleet();

  return (
    <div className="pb-10">
      <PageHeader
        title="Incidents"
        subtitle="Near misses and safety events, logged as they happen rather than remembered afterwards."
        actions={<RunSimulationButton size="md" />}
      />
      <div className="p-6">
        <IncidentLog
          incidents={incidents}
          machineIds={machines.map((m) => m.id)}
          onFile={file}
          onReport={report}
        />
      </div>
    </div>
  );
}
