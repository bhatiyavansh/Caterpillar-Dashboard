"use client";

/**
 * Harness for the training "local control" mode.
 *
 * Mounts the twin with `liveLink={false}` while the simulator is running, so we
 * can prove the learner's keyboard still drives the machine rather than being
 * overwritten by socket frames sixty times a second.
 *
 * Dev-only. The training coach will mount `<TwinStage liveLink={false} />` the
 * same way.
 */

import { TwinStage } from "@/components/twin/TwinExperience";

export default function LocalControlHarness() {
  return (
    <main className="fixed inset-0 bg-ink-950">
      <TwinStage liveLink={false} />
    </main>
  );
}
