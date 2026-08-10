/**
 * Walk session start timestamp — UI derives elapsed locally (no 1Hz WalkContext fan-out).
 */
import { useSyncExternalStore } from "react";

let sessionStartedAtMs: number | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getWalkSessionStartedAtMs(): number | null {
  return sessionStartedAtMs;
}

export function setWalkSessionStartedAtMs(ms: number | null): void {
  if (sessionStartedAtMs === ms) return;
  sessionStartedAtMs = ms;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useWalkSessionStartedAtMs(): number | null {
  return useSyncExternalStore(subscribe, getWalkSessionStartedAtMs, getWalkSessionStartedAtMs);
}
