/**
 * Pure offline-policy helpers for protected races.
 * Frontend reports; backend adjudicates.
 */

import type { OfflineEpisode } from "./raceVerificationTypes";

export type OfflineMonitorSnapshot = {
  offlineStartedAt: string | null;
  continuousOfflineMs: number;
  totalOfflineMs: number;
  episodes: OfflineEpisode[];
  offlinePolicyExceeded: boolean;
};

export function createEmptyOfflineSnapshot(): OfflineMonitorSnapshot {
  return {
    offlineStartedAt: null,
    continuousOfflineMs: 0,
    totalOfflineMs: 0,
    episodes: [],
    offlinePolicyExceeded: false,
  };
}

export function applyConnectivityChange(args: {
  snapshot: OfflineMonitorSnapshot;
  isOnline: boolean;
  nowIso: string;
  raceDurationMs: number;
  maxContinuousOfflineMs: number;
  maxOfflinePercent: number;
}): OfflineMonitorSnapshot {
  const now = Date.parse(args.nowIso);
  const snap = { ...args.snapshot, episodes: [...args.snapshot.episodes] };

  if (!args.isOnline) {
    if (!snap.offlineStartedAt) {
      snap.offlineStartedAt = args.nowIso;
    }
    const start = Date.parse(snap.offlineStartedAt);
    snap.continuousOfflineMs = Number.isFinite(now - start)
      ? Math.max(0, now - start)
      : snap.continuousOfflineMs;
  } else if (snap.offlineStartedAt) {
    const start = Date.parse(snap.offlineStartedAt);
    const durationMs = Number.isFinite(now - start) ? Math.max(0, now - start) : 0;
    snap.episodes.push({
      disconnectedAt: snap.offlineStartedAt,
      reconnectedAt: args.nowIso,
      durationMs,
    });
    snap.totalOfflineMs += durationMs;
    snap.offlineStartedAt = null;
    snap.continuousOfflineMs = 0;
  }

  const continuous = snap.offlineStartedAt
    ? Math.max(
        snap.continuousOfflineMs,
        Number.isFinite(now - Date.parse(snap.offlineStartedAt))
          ? now - Date.parse(snap.offlineStartedAt)
          : 0,
      )
    : 0;
  snap.continuousOfflineMs = continuous;

  const cumulativeCap =
    args.raceDurationMs > 0
      ? (args.raceDurationMs * Math.max(0, args.maxOfflinePercent)) / 100
      : Number.POSITIVE_INFINITY;

  snap.offlinePolicyExceeded =
    continuous > args.maxContinuousOfflineMs ||
    snap.totalOfflineMs + continuous > cumulativeCap;

  return snap;
}

export function evaluateOfflinePolicy(args: {
  continuousOfflineMs: number;
  totalOfflineMs: number;
  raceDurationMs: number;
  maxContinuousOfflineMinutes: number;
  maxOfflinePercent: number;
}): { exceeded: boolean; reason?: "continuous" | "cumulative" } {
  const maxContinuousMs = args.maxContinuousOfflineMinutes * 60_000;
  if (args.continuousOfflineMs > maxContinuousMs) {
    return { exceeded: true, reason: "continuous" };
  }
  if (args.raceDurationMs > 0) {
    const cap = (args.raceDurationMs * args.maxOfflinePercent) / 100;
    if (args.totalOfflineMs + args.continuousOfflineMs > cap) {
      return { exceeded: true, reason: "cumulative" };
    }
  }
  return { exceeded: false };
}
