/**
 * Writes the three hazard scenarios as 120 Hz datasets:
 *   data/scenarios/<id>.csv          every frame, assisted + counterfactual channels
 *   data/scenarios/<id>.events.json  timeline of hazards, system actions and outcomes
 *   data/scenarios/summary.json      one line per scenario
 *
 * Run: npm run scenarios:export   (plain Node 22.6+, no build step)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCENARIO_IDS, getScenario, toCsv } from "../src/lib/scenarios/generate.ts";

const out = join(process.cwd(), "data", "scenarios");
mkdirSync(out, { recursive: true });

const summary = SCENARIO_IDS.map((id) => {
  const s = getScenario(id);
  writeFileSync(join(out, `${id}.csv`), toCsv(s));
  writeFileSync(join(out, `${id}.events.json`), JSON.stringify({ id, title: s.title, fps: s.fps, duration: s.duration, events: s.events, outcome: s.outcome }, null, 2));
  const minClear = Math.min(...s.frames.map((f) => f.personDist));
  const minMargin = Math.min(...s.frames.map((f) => f.tipMargin));
  const row = {
    id,
    frames: s.frames.length,
    fps: s.fps,
    durationS: s.duration,
    firstSystemActionS: s.events.find((e) => e.actor === "system")?.t ?? null,
    unassistedOutcomeS: s.outcome.unassistedAt,
    assistedMinPersonDistM: Math.round(minClear * 100) / 100,
    assistedMinTipMargin: Math.round(minMargin * 100) / 100,
  };
  console.log(row);
  return row;
});
writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2));
