/**
 * Lightweight Pusher health signals for adaptive HTTP fallback polling.
 * Does not change Pusher connection behavior — observers only.
 */

import { perf } from "@/utils/perfLogger";

type Listener = () => void;

let connected = false;
let lastEventAt = 0;
let lastReconcileAt = 0;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

export function markPusherConnected(isConnected: boolean): void {
  if (connected === isConnected) return;
  connected = isConnected;
  perf.pusherConnected(isConnected);
  notify();
}

export function markPusherEvent(source = "event"): void {
  lastEventAt = Date.now();
  if (__DEV__ && source) {
    /* keep quiet — high frequency; connection flips are logged via markPusherConnected */
  }
  notify();
}

export function markReconcileSuccess(): void {
  lastReconcileAt = Date.now();
}

export function isPusherHealthy(staleMs = 45_000): boolean {
  if (!connected) return false;
  if (!lastEventAt) return connected; // connected but quiet — treat as healthy until proven stale
  return Date.now() - lastEventAt < staleMs;
}

export function getPusherHealthSnapshot(): {
  connected: boolean;
  lastEventAt: number;
  lastReconcileAt: number;
  healthy: boolean;
} {
  return {
    connected,
    lastEventAt,
    lastReconcileAt,
    healthy: isPusherHealthy(),
  };
}

/**
 * When Pusher is healthy, stretch safety-poll intervals.
 * When unhealthy, return the configured baseline (current production cadence).
 * Does NOT alter step-sync intervals — callers must not pass those here.
 */
export function adaptivePollMs(baselineMs: number, healthyMultiplier = 2.5): number {
  if (!isPusherHealthy()) return baselineMs;
  return Math.round(baselineMs * healthyMultiplier);
}

export function subscribePusherHealth(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
