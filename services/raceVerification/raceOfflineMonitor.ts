/**
 * Offline monitoring for protected races.
 * Sensor / FGS may continue while offline; backend adjudicates policy breaches.
 */

import NetInfo from "@react-native-community/netinfo";
import { store } from "@/store";
import { prizeVerificationActions } from "@/store/slices/prizeVerificationSlice";
import { registerReconnectFlush } from "@/context/NetworkContext";
import {
  applyConnectivityChange,
  createEmptyOfflineSnapshot,
  evaluateOfflinePolicy,
  type OfflineMonitorSnapshot,
} from "./raceOfflineLogic";
import { reportOfflinePolicyExceeded } from "./raceContinuityMonitor";

let _snapshot: OfflineMonitorSnapshot = createEmptyOfflineSnapshot();
let _unsubNet: (() => void) | null = null;
let _unsubReconnect: (() => void) | null = null;
let _raceDurationMs = 0;
let _maxContinuousOfflineMs = 10 * 60_000;
let _maxOfflinePercent = 20;
let _policyExceededReported = false;

function syncSnapshotToStore(snap: OfflineMonitorSnapshot): void {
  store.dispatch(
    prizeVerificationActions.setOfflineSnapshot({
      offlineStartedAt: snap.offlineStartedAt,
      totalOfflineMs: snap.totalOfflineMs,
      continuousOfflineMs: snap.continuousOfflineMs,
      episodes: snap.episodes,
    }),
  );
}

function applyOnlineState(isOnline: boolean): void {
  const nowIso = new Date().toISOString();
  _snapshot = applyConnectivityChange({
    snapshot: _snapshot,
    isOnline,
    nowIso,
    raceDurationMs: _raceDurationMs,
    maxContinuousOfflineMs: _maxContinuousOfflineMs,
    maxOfflinePercent: _maxOfflinePercent,
  });
  syncSnapshotToStore(_snapshot);

  const policy = evaluateOfflinePolicy({
    continuousOfflineMs: _snapshot.continuousOfflineMs,
    totalOfflineMs: _snapshot.totalOfflineMs,
    raceDurationMs: _raceDurationMs,
    maxContinuousOfflineMinutes: _maxContinuousOfflineMs / 60_000,
    maxOfflinePercent: _maxOfflinePercent,
  });

  if (policy.exceeded && !_policyExceededReported) {
    _policyExceededReported = true;
    reportOfflinePolicyExceeded(policy.reason);
  }
}

export function startPrizeOfflineMonitor(args: {
  raceDurationMs: number;
  maxContinuousOfflineMinutes: number;
  maxOfflinePercent: number;
}): void {
  stopPrizeOfflineMonitor();
  _snapshot = createEmptyOfflineSnapshot();
  _raceDurationMs = Math.max(0, args.raceDurationMs);
  _maxContinuousOfflineMs = Math.max(0, args.maxContinuousOfflineMinutes * 60_000);
  _maxOfflinePercent = Math.max(0, args.maxOfflinePercent);
  _policyExceededReported = false;

  void NetInfo.fetch().then((state) => {
    applyOnlineState(
      state.isConnected !== false && state.isInternetReachable !== false,
    );
  });

  _unsubNet = NetInfo.addEventListener((state) => {
    applyOnlineState(
      state.isConnected !== false && state.isInternetReachable !== false,
    );
  });

  _unsubReconnect = registerReconnectFlush(() => {
    applyOnlineState(true);
  });
}

export function stopPrizeOfflineMonitor(): void {
  _unsubNet?.();
  _unsubNet = null;
  _unsubReconnect?.();
  _unsubReconnect = null;
  _snapshot = createEmptyOfflineSnapshot();
  _policyExceededReported = false;
}

export function getPrizeOfflineSnapshot(): OfflineMonitorSnapshot {
  return _snapshot;
}
