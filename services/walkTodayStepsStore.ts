/**
 * High-frequency Walk "today steps" UI store.
 * Isolates step ticks from the large WalkContext provider value so unrelated
 * Walk/Leaderboard/Profile trees do not re-render on every sensor update.
 *
 * Canonical progress authority remains raceProgressSlice + stepProgressCoordinator.
 * This store mirrors display steps for Walk UX only.
 */

import { useSyncExternalStore } from "react";

let _todaySteps = 0;
const _listeners = new Set<() => void>();

export function getWalkTodayStepsSnapshot(): number {
  return _todaySteps;
}

export function setWalkTodayStepsSnapshot(steps: number): void {
  const next = Math.max(0, Math.floor(steps));
  if (next === _todaySteps) return;
  _todaySteps = next;
  _listeners.forEach((l) => l());
}

export function subscribeWalkTodaySteps(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

/** Subscribe only to todaySteps — use in StepsHero / step-history overlays. */
export function useWalkTodaySteps(): number {
  return useSyncExternalStore(
    subscribeWalkTodaySteps,
    getWalkTodayStepsSnapshot,
    getWalkTodayStepsSnapshot,
  );
}
