/**
 * Level progression: what the learner has passed, and what that unlocks.
 *
 * Deliberately pure apart from two localStorage calls at the edges, so the
 * unlock rules can be reasoned about and tested without a browser. Nothing here
 * asks the coach model anything — a level is unlocked because of what the
 * learner has actually done, never because a language model said so.
 */

import { CURRICULUM } from "./curriculum";

/** Bumped when the shape changes, so an old record is ignored, not crashed on. */
const STORAGE_KEY = "cat.training.v1";

export interface LevelRecord {
  /** Every step in the level completed at least once. */
  passed: boolean;
  /** 1-3. Earned on the run that passed the level. */
  stars: number;
  /** Total attempts across the level's steps, best run. */
  attempts: number;
  /** Mean step score on the best run, 0-100. */
  score: number;
  /** Wall time for the best run, milliseconds. */
  bestMs: number;
}

export type TrainingProgress = Record<string, LevelRecord>;

export const EMPTY_PROGRESS: TrainingProgress = {};

/**
 * Stars reward doing it cleanly, not just finishing.
 *
 * Three means first time through every step; one means they got there in the
 * end. One star still unlocks the next level — the ladder is there to teach,
 * not to gatekeep, and a learner who has to grind a level has earned the next
 * one more than someone who breezed it.
 */
export function starsFor(score: number, attempts: number, steps: number): number {
  if (attempts <= steps && score >= 85) return 3;
  if (attempts <= steps * 2) return 2;
  return 1;
}

/** A level is open once every level it requires has been passed. */
export function isUnlocked(moduleId: string, progress: TrainingProgress): boolean {
  const index = CURRICULUM.findIndex((m) => m.id === moduleId);
  if (index <= 0) return true;
  // Sequential ladder: the previous level is the only requirement.
  const previous = CURRICULUM[index - 1];
  return progress[previous.id]?.passed === true;
}

/** Why a level is locked, for the ladder to say out loud. */
export function lockReason(moduleId: string, progress: TrainingProgress): string | null {
  if (isUnlocked(moduleId, progress)) return null;
  const index = CURRICULUM.findIndex((m) => m.id === moduleId);
  return `Pass ${CURRICULUM[index - 1].title} first`;
}

/** Index of the level the learner should be sent to when they press start. */
export function firstUnpassedIndex(progress: TrainingProgress): number {
  const index = CURRICULUM.findIndex((m) => !progress[m.id]?.passed);
  return index === -1 ? 0 : index;
}

export function levelsPassed(progress: TrainingProgress): number {
  return CURRICULUM.filter((m) => progress[m.id]?.passed).length;
}

export function totalStars(progress: TrainingProgress): number {
  return CURRICULUM.reduce((sum, m) => sum + (progress[m.id]?.stars ?? 0), 0);
}

/**
 * Merges a run into the record, keeping the learner's best.
 *
 * Replaying a passed level can raise a star count but never lower it — nobody
 * should be punished for practising.
 */
export function recordLevel(
  progress: TrainingProgress,
  moduleId: string,
  run: { stars: number; attempts: number; score: number; ms: number },
): TrainingProgress {
  const previous = progress[moduleId];
  const better = !previous || run.stars > previous.stars;
  return {
    ...progress,
    [moduleId]: {
      passed: true,
      stars: Math.max(run.stars, previous?.stars ?? 0),
      attempts: better ? run.attempts : previous.attempts,
      score: better ? run.score : previous.score,
      bestMs: better ? run.ms : previous.bestMs,
    },
  };
}

/* ------------------------------ storage ------------------------------- */

export function loadProgress(): TrainingProgress {
  if (typeof window === "undefined") return EMPTY_PROGRESS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_PROGRESS;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY_PROGRESS;
    return parsed as TrainingProgress;
  } catch {
    // Private mode, blocked storage, or a record from an older shape. Starting
    // fresh is always better than refusing to open the page.
    return EMPTY_PROGRESS;
  }
}

export function saveProgress(progress: TrainingProgress): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Not being able to remember is survivable; crashing mid-lesson is not.
  }
}

/* --------------------------- react binding --------------------------- */

/**
 * `localStorage` is an external store, so React reads it through
 * `useSyncExternalStore` rather than an effect that calls `setState`.
 *
 * The snapshot must be referentially stable between commits or React loops, so
 * it is cached here and only replaced by `commitProgress`.
 */
let cached: TrainingProgress | null = null;
const listeners = new Set<() => void>();

export function getProgressSnapshot(): TrainingProgress {
  if (cached === null) cached = loadProgress();
  return cached;
}

/** The server has no storage; an empty ladder is the honest first paint. */
export function getServerProgressSnapshot(): TrainingProgress {
  return EMPTY_PROGRESS;
}

export function subscribeProgress(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Writes through to storage and notifies every mounted ladder. */
export function commitProgress(next: TrainingProgress): void {
  cached = next;
  saveProgress(next);
  for (const listener of listeners) listener();
}

export function clearProgress(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing useful to do */
  }
  cached = EMPTY_PROGRESS;
  for (const listener of listeners) listener();
}
