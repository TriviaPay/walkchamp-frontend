/**
 * Battery-aware tracking operating modes (Android focus).
 * Modes describe intent — they do not replace sensor/HC ownership rules.
 *
 * TYPE_STEP_COUNTER → live/provisional
 * Health Connect → verified / settlement
 *
 * Pure helpers (no react-native import) so unit tests can run under tsx.
 */
import { STEP_SYNC_CONFIG } from "./stepSyncConfig";

/**
 * Explicit battery tracking modes (Phase 2).
 * Legacy aliases (`active_tracking*`) map onto walk/race foreground/background.
 */
export type BatteryTrackingMode =
  | "idle"
  | "auto_tracking_idle"
  | "app_active"
  | "live_race_foreground"
  | "live_race_background"
  | "active_walk_foreground"
  | "active_walk_background"
  | "finalizing"
  | "recovery"
  /** @deprecated Prefer active_walk_foreground / live_race_foreground */
  | "active_tracking"
  /** @deprecated Prefer *_background variants */
  | "active_tracking_background"
  /** @deprecated Prefer finalizing */
  | "finalization";

export type BatteryTrackingContext = {
  appVisible: boolean;
  walkFgsActive: boolean;
  raceLive: boolean;
  finalizing: boolean;
  /** OEM / sensor recovery path briefly holding wake work. */
  recovering?: boolean;
  /** Auto Tracking product toggle (may keep low-cost FGS without live-race work). */
  autoTrackingEnabled?: boolean;
};

export function resolveBatteryTrackingMode(
  ctx: BatteryTrackingContext,
): BatteryTrackingMode {
  if (ctx.recovering) return "recovery";
  if (ctx.finalizing) return "finalizing";
  if (ctx.raceLive) {
    return ctx.appVisible ? "live_race_foreground" : "live_race_background";
  }
  if (ctx.walkFgsActive) {
    // Auto Tracking idle: FGS may be up for daily steps without a live race.
    if (ctx.autoTrackingEnabled && !ctx.appVisible) {
      return "auto_tracking_idle";
    }
    return ctx.appVisible ? "active_walk_foreground" : "active_walk_background";
  }
  if (ctx.appVisible) return "app_active";
  if (ctx.autoTrackingEnabled) return "auto_tracking_idle";
  return "idle";
}

/** Suggested JS reconcile interval for the current mode (ms). */
export function reconcileIntervalForMode(mode: BatteryTrackingMode): number {
  switch (mode) {
    case "live_race_foreground":
    case "active_walk_foreground":
    case "active_tracking":
    case "app_active":
    case "finalizing":
    case "finalization":
    case "recovery":
      return STEP_SYNC_CONFIG.WALK_LOCAL_RECONCILE_POLL_MS;
    case "live_race_background":
    case "active_walk_background":
    case "active_tracking_background":
      // Native FGS owns sensors; JS should barely poll.
      return STEP_SYNC_CONFIG.WALK_LOCAL_RECONCILE_BACKGROUND_MS;
    case "auto_tracking_idle":
    case "idle":
    default:
      return STEP_SYNC_CONFIG.WALK_LOCAL_RECONCILE_IDLE_MS;
  }
}

/** Suggested race backend sync interval (ms). */
export function raceBackendSyncIntervalForMode(mode: BatteryTrackingMode): number {
  if (
    mode === "live_race_background" ||
    mode === "active_walk_background" ||
    mode === "active_tracking_background" ||
    mode === "auto_tracking_idle"
  ) {
    return STEP_SYNC_CONFIG.RACE_BACKEND_SYNC_BACKGROUND_MS;
  }
  return STEP_SYNC_CONFIG.RACE_BACKEND_SYNC_MS;
}

/** True when mode may run live-race networking / Pusher / race timers. */
export function modeAllowsLiveRaceWorkload(mode: BatteryTrackingMode): boolean {
  return (
    mode === "live_race_foreground" ||
    mode === "live_race_background" ||
    mode === "finalizing" ||
    mode === "finalization" ||
    mode === "recovery" ||
    mode === "active_tracking" ||
    mode === "active_tracking_background"
  );
}

let lastLoggedMode: BatteryTrackingMode | null = null;

/** Dev-only battery diagnostics — no-op in production. */
export function batteryDiag(
  event: string,
  data?: Record<string, unknown>,
): void {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  // eslint-disable-next-line no-console
  console.log(`[BatteryDiag] ${event}`, data ?? {});
}

/** Dev-only mode transition log. */
export function batteryDiagModeTransition(
  next: BatteryTrackingMode,
  reason: string,
): void {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  const prev = lastLoggedMode;
  if (prev === next) return;
  lastLoggedMode = next;
  // eslint-disable-next-line no-console
  console.log(
    `[BatteryDiag]\n${prev ?? "null"}\n→ ${next}\nreason=${reason}`,
  );
}

export type RaceCleanupSnapshot = {
  raceId: string | null;
  foregroundService: "STOPPED" | "RETURNED_TO_AUTO_TRACKING" | "UNKNOWN";
  raceSensorListener: "REMOVED" | "SHARED_WITH_AUTO_TRACKING" | "UNKNOWN";
  wakeLock: "RELEASED" | "HELD" | "UNKNOWN";
  racePusher: "UNSUBSCRIBED" | "UNKNOWN";
  raceApiTimer: "STOPPED" | "UNKNOWN";
  unlimitedTimer: "STOPPED" | "UNKNOWN";
  notificationTimer: "STOPPED" | "UNKNOWN";
  hcFastRetry: "STOPPED" | "UNKNOWN";
  remainingMode: BatteryTrackingMode;
};

/** Dev-only centralized race cleanup summary. */
export function logRaceCleanupVerification(snap: RaceCleanupSnapshot): void {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  const fail =
    snap.raceApiTimer !== "STOPPED" ||
    snap.racePusher !== "UNSUBSCRIBED" ||
    snap.wakeLock === "HELD";
  // eslint-disable-next-line no-console
  console.log(`
===== WALKCHAMP RACE CLEANUP =====
Race: ${snap.raceId ?? "none"}
Foreground Service:
${snap.foregroundService}
Race sensor listener:
${snap.raceSensorListener}
Wake lock:
${snap.wakeLock}
Race Pusher:
${snap.racePusher}
Race API timer:
${snap.raceApiTimer}
Unlimited timer:
${snap.unlimitedTimer}
Notification timer:
${snap.notificationTimer}
HC fast retry:
${snap.hcFastRetry}
Remaining mode:
${snap.remainingMode}
Cleanup result:
${fail ? "WARN" : "PASS"}
===================================
`);
  if (fail) {
    // eslint-disable-next-line no-console
    console.warn("[BatteryDiag] Race cleanup incomplete", snap);
  }
}
