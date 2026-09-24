"use client";

import { PageHeader, RunSimulationButton } from "@/components/navigation/dashboard-shell";
import { TaskBoard } from "@/components/tasks/task-board";
import { useSnapshot, useTasks } from "@/lib/hooks/use-site";

const WEATHER_LABEL: Record<string, string> = {
  clear: "clear",
  rain: "rain",
  fog: "fog",
  heat: "extreme heat",
};

export default function TasksPage() {
  const { data: tasks } = useTasks();
  const snapshot = useSnapshot();

  return (
    <div className="pb-10">
      <PageHeader
        title="Today's tasks"
        subtitle={
          `Scheduled work for the shift, estimated against ${WEATHER_LABEL[snapshot.weather] ?? snapshot.weather} ` +
          `at ${snapshot.temperatureC}°C. Every estimate updates as conditions do.`
        }
        actions={<RunSimulationButton size="md" />}
      />

      <div className="p-6">
        <TaskBoard tasks={tasks} />
      </div>
    </div>
  );
}
