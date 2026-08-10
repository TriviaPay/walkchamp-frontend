/**
 * High-frequency race progress for UI — isolated from RaceContext provider value
 * so Walk / invitation consumers that only need actions do not re-render on step ticks.
 */
import { useSyncExternalStore } from "react";

export type RaceUiProgressSnapshot = {
  userRaceSteps: number;
  walkRaceStepsDisplay: number;
};

let snapshot: RaceUiProgressSnapshot = {
  userRaceSteps: 0,
  walkRaceStepsDisplay: 0,
};
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getRaceUiProgressSnapshot(): RaceUiProgressSnapshot {
  return snapshot;
}

export function setRaceUiUserSteps(steps: number): void {
  const next = Math.max(0, steps);
  if (snapshot.userRaceSteps === next) return;
  snapshot = { ...snapshot, userRaceSteps: next };
  emit();
}

export function setRaceUiWalkDisplaySteps(steps: number): void {
  const next = Math.max(0, steps);
  if (snapshot.walkRaceStepsDisplay === next) return;
  snapshot = { ...snapshot, walkRaceStepsDisplay: next };
  emit();
}

export function resetRaceUiProgress(): void {
  if (snapshot.userRaceSteps === 0 && snapshot.walkRaceStepsDisplay === 0) return;
  snapshot = { userRaceSteps: 0, walkRaceStepsDisplay: 0 };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe to live race step display fields only. */
export function useRaceUiProgress(): RaceUiProgressSnapshot {
  return useSyncExternalStore(subscribe, getRaceUiProgressSnapshot, getRaceUiProgressSnapshot);
}

/** Stable race start time for local elapsed clocks (no 1Hz context fan-out). */
let raceStartAtMs: number | null = null;
const startListeners = new Set<() => void>();

export function getRaceStartAtMs(): number | null {
  return raceStartAtMs;
}

export function setRaceStartAtMs(ms: number | null): void {
  if (raceStartAtMs === ms) return;
  raceStartAtMs = ms;
  for (const l of startListeners) l();
}

function subscribeStart(listener: () => void): () => void {
  startListeners.add(listener);
  return () => {
    startListeners.delete(listener);
  };
}

export function useRaceStartAtMs(): number | null {
  return useSyncExternalStore(subscribeStart, getRaceStartAtMs, getRaceStartAtMs);
}
