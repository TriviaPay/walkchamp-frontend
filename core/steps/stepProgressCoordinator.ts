/**
 * Single writer / subscriber hub for live step + race progress.
 * All device reads, backend rank responses, and notification updates flow through here.
 */

import { store } from "@/store";
import {
  raceProgressActions,
  type RaceProgressStatus,
  type StepProgressSource,
} from "@/store/slices/raceProgressSlice";
import { walkActions } from "@/store/slices/walkSlice";
import { notifyMidnightRollover } from "@/services/walkMidnightEvents";
import { raceStepSyncService } from "@/services/RaceStepSyncService";
import { postRaceProgress } from "@/services/raceProgressApi";
import { activeChallengeSync } from "@/services/activeChallengeSync";
import { raceProgressNotificationService } from "@/services/raceProgressNotificationService";
import { stepTrackingNotificationService } from "@/services/stepTrackingNotificationService";
import { RACE_PROGRESS_NOTIFICATION_CONFIG } from "@/config/raceProgressNotificationConfig";
import { STEP_TRACKING_NOTIFICATION_CONFIG } from "@/config/stepTrackingNotificationConfig";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import { isJsAuthoritativeStepSession } from "@/services/steps/jsStepOwnership";
import {
  resolveWalkNotificationSteps,
  isInflatedProvisionalVsVerified,
  looksLikeSinceBootCounter,
} from "@/services/steps/walkDisplaySteps";
import { AppState, type AppStateStatus, Platform } from "react-native";
import { waitForAppStartupReady, isAppStartupReady } from "@/services/appStartup";
import { getLocalDateStr, isStepSnapshotFromBeforeToday, msUntilNextLocalMidnight } from "@/utils/timezone";
import { storageGet, storageRemove, storageSet, STORAGE_KEYS } from "@/utils/storage";
import { clearWalkStepsOutbox } from "@/services/walkStepsOutbox";
import { clearUserSessionQueryCache, queryClient } from "@/services/queryClient";
import {
  clearScopedStepStateForUser,
  deleteLegacyUnscopedStepKeys,
  readDailyStepsForUserDate,
  stepScopedKeys,
  writeDailyStepsForUserDate,
} from "@/utils/stepScopedStorage";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";
import { logger } from "@/utils/logger";
import { mergeWalkStepsWithNative } from "@/services/stepDisplayMerge";
import { shouldIgnoreLegacyPhantomBump, sanitizeLegacyProviderSteps, stepEngineLog, stepDebugVerboseLog, resolveTodayDisplaySteps, filterLegacyStepIncrease, suppressLegacyStepBumps, markFreshLocalDay, isFreshLocalDay } from "@/utils/stepAccuracy";
import { shouldAcceptStepUpdateCore } from "@/utils/stepAccuracyCore";
import {
  isAcceptedLiveRaceSource,
} from "@/services/steps/liveRaceSources";
import { findEligibleLiveRaceParticipant } from "@/utils/raceNotificationEligibility";
import { resolveRaceNotificationTypeHint } from "@/utils/raceNotificationType";
import { postWalkDailyTotal } from "@/services/postWalkDailySteps";

let notificationTimer: ReturnType<typeof setTimeout> | null = null;
let pendingNotification = false;
/** Throttle companion multi-race POSTs (primary race uses raceStepSyncBuffer). */
let lastCompanionSyncMs = 0;
const COMPANION_SYNC_MIN_MS = 10_000;
let walkNotificationTimer: ReturnType<typeof setTimeout> | null = null;
let pendingWalkNotification = false;
let lastWalkNotificationSteps = -1;
let lastWalkNotificationPushMs = 0;
let lastKnownTrackingDate: string | null = null;
let midnightCheckTimer: ReturnType<typeof setTimeout> | null = null;
/** Avoid hammering POST /walk/steps on every midnight-check poll. */
let flushedHistoryDateKey: string | null = null;

function shiftLocalDateKey(isoDate: string, days: number): string {
  const parts = isoDate.split("-").map((p) => Number(p));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return isoDate;
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  dt.setDate(dt.getDate() + days);
  return (
    `${dt.getFullYear()}-` +
    `${String(dt.getMonth() + 1).padStart(2, "0")}-` +
    `${String(dt.getDate()).padStart(2, "0")}`
  );
}

async function persistLocalDayToWalkHistory(
  userId: string,
  localDate: string,
  extraSteps = 0,
): Promise<void> {
  if (localDate === getLocalDateStr()) {
    // Today is written only by verified HC/HK walk sync — never leftover race totals.
    return;
  }
  const stored = await readDailyStepsForUserDate(userId, localDate);
  const lastSynced =
    (await storageGet<number>(
      stepScopedKeys(userId, localDate).lastSyncedStepsCount,
    )) ?? 0;
  const total = Math.max(0, stored, lastSynced, extraSteps);
  if (total <= 0) {
    flushedHistoryDateKey = `${userId}:${localDate}`;
    return;
  }
  const ok = await postWalkDailyTotal({ totalSteps: total, localDate });
  if (ok) flushedHistoryDateKey = `${userId}:${localDate}`;
}
/**
 * Consecutive-zero counter for the "drop polluted verified lane" guard in
 * resolveAuthoritativeTodaySteps. A single Health Connect / HealthKit read
 * can transiently fail (rate limit, native bridge hiccup) and the provider
 * silently returns an empty 0-step result rather than throwing — under rapid
 * re-polling (e.g. an active Unlimited race refreshing on every roster/Pusher
 * update) a lone glitchy 0 must never wipe out an already-confirmed daily
 * total. Require the same fresh 0 reading twice in a row before trusting it.
 */
let consecutiveZeroProviderReads = 0;

function mapProviderSource(): StepProgressSource {
  switch (stepProviderManager.getActiveProviderId()) {
    case "ios_healthkit":
      return "healthkit";
    case "android_health_connect":
      return "health_connect";
    case "android_legacy_sensor":
      return "android_step_counter";
    default:
      return "unknown";
  }
}

export function mapVerificationTier(): "verified" | "limited" | "unsupported" {
  const level = stepProviderManager.getVerificationLevel();
  if (level === "verified") return "verified";
  if (level === "legacy") return "limited";
  return "unsupported";
}

function mapNativeStepSource(source: string): StepProgressSource {
  const s = source.toLowerCase();
  if (s === "android_step_counter" || s === "sensor" || s === "limited_sensor") {
    return "android_step_counter";
  }
  if (s === "health_connect" || s === "android_health_connect") return "health_connect";
  if (s === "healthkit" || s === "ios_healthkit") return "healthkit";
  if (s === "backend") return "backend";
  return mapProviderSource();
}

function isDeviceSensorSource(source: string): boolean {
  const s = source.toLowerCase();
  return (
    s === "sensor" ||
    s === "android_step_counter" ||
    s === "limited_sensor" ||
    s === "android_legacy_sensor"
  );
}

/** Reject stale JS/database values that would overwrite newer native sensor state. */
export function shouldAcceptStepUpdate(
  incoming: {
    userId?: string;
    todaySteps?: number;
    raceSteps?: number;
    updatedAt?: string;
  },
  current: {
    userId: string | null;
    todaySteps: number;
    raceSteps: number;
    todayStepsLastUpdatedAt: string | null;
    raceStepsLastUpdatedAt: string | null;
  },
  opts?: { allowTodayDecrease?: boolean },
): boolean {
  const accepted = shouldAcceptStepUpdateCore(incoming, current, opts);
  if (!accepted && incoming.userId && current.userId && incoming.userId !== current.userId) {
    logger.debug("StepStore", "ignored update for previous user");
  }
  return accepted;
}

function isVerifiedSource(source: StepProgressSource | string | undefined): boolean {
  if (!source) return false;
  const s = source.toLowerCase();
  return (
    s === "health_connect" ||
    s === "android_health_connect" ||
    s === "healthkit" ||
    s === "ios_healthkit"
  );
}

function scheduleWalkNotificationUpdate(force = false): void {
  if (!isAppStartupReady()) return;
  // Trailing-edge coalesce: always reschedule so the latest Redux total is pushed.
  if (walkNotificationTimer) clearTimeout(walkNotificationTimer);
  pendingWalkNotification = true;

  const delay = force ? 0 : STEP_TRACKING_NOTIFICATION_CONFIG.DEBOUNCE_MS;
  const pushForced = force;
  walkNotificationTimer = setTimeout(() => {
    pendingWalkNotification = false;
    walkNotificationTimer = null;
    void pushWalkNotificationFromCanonicalStore(pushForced);
  }, delay);
}

let lastNativeRebaselineMs = 0;

/** Drop since-boot / prior-session FGS absolutes before enabling Daily Walk. */
export async function scrubStaleNativeDailyBeforeEnable(
  userId: string,
  knownTodaySteps: number,
): Promise<void> {
  if (!userId || Platform.OS !== "android") return;
  const known = Math.max(0, Math.floor(knownTodaySteps));
  try {
    const native = await stepTrackingNotificationService.getNativeStepState(userId);
    if (!native) return;
    const today = getLocalDateStr();
    const nativeToday = Math.max(0, Math.floor(native.todaySteps ?? 0));
    const userMismatch = !!native.userId && native.userId !== userId;
    const staleDay = !!native.localDate && native.localDate !== today;
    const sinceBoot = looksLikeSinceBootCounter({
      todaySteps: nativeToday,
      sensorTotal: native.sensorTotal,
      dailyBaseline: native.dailyBaseline,
    });
    if (!userMismatch && !staleDay && !sinceBoot) return;
    await stepTrackingNotificationService.resetDailyStepsForNewDay();
    stepEngineLog(
      "StepEngine",
      `scrubNativeDaily userId=${userId} nativeToday=${nativeToday} known=${known} userMismatch=${userMismatch} staleDay=${staleDay} sinceBoot=${sinceBoot}`,
    );
  } catch {
    /* non-fatal */
  }
}

/** Reset poisoned FGS today absolute and restart tray from verified HC total. */
async function rebaselineInflatedNativeDaily(
  userId: string | null,
  verifiedSteps: number,
): Promise<void> {
  if (!userId || Platform.OS !== "android") return;
  const now = Date.now();
  if (now - lastNativeRebaselineMs < 15_000) return;
  lastNativeRebaselineMs = now;
  const steps = Math.max(0, Math.floor(verifiedSteps));
  try {
    await stepTrackingNotificationService.resetDailyStepsForNewDay();
  } catch {
    /* non-fatal */
  }
  store.dispatch(
    raceProgressActions.resetDailyStepsForNewDay({
      todaySteps: steps,
      updatedAt: new Date().toISOString(),
    }),
  );
  // Restore verified lane after reset (reset clears to the payload value).
  if (steps > 0) {
    updateStepProgressFromRealSource({
      todaySteps: steps,
      stepSource: "health_connect",
      dailyLane: "verified",
      updatedAt: new Date().toISOString(),
    });
  }
  try {
    await stepTrackingNotificationService.handOffToNativeBackground({
      userId,
      todaySteps: steps,
      dailyGoal:
        store.getState().raceProgress.dailyGoal > 0
          ? store.getState().raceProgress.dailyGoal
          : 10_000,
    });
  } catch {
    /* non-fatal */
  }
  void pushWalkNotificationFromCanonicalStore(true, userId);
  stepEngineLog(
    "OngoingNotification",
    `rebaselined native todaySteps=${steps} userId=${userId}`,
  );
}

/**
 * Resolve display today steps for Walk UI catch-up (provider + provisional + cache).
 * NOT for verified backend sync — use selectVerifiedTodayStepsForSync / verifiedTodaySteps.
 */
export async function resolveAuthoritativeTodaySteps(
  userId: string,
  opts?: { mergeNative?: boolean; ignoreProvider?: boolean },
): Promise<number> {
  const today = getLocalDateStr();
  const rp = store.getState().raceProgress;
  const verifiedActive = stepProviderManager.usesVerifiedStepSource();
  const backendSynced =
    (await storageGet<number>(stepScopedKeys(userId, today).lastSyncedStepsCount)) ?? 0;
  const localCached = await readDailyStepsForUserDate(userId, today);

  // Verified HC/HK: never seed the day total from FGS/sensor absolutes or an
  // inflated AsyncStorage cache (classic "yesterday still showing" after reload).
  if (verifiedActive) {
    let providerSteps = 0;
    // Track whether we actually got a fresh reading vs skipped/failed — a
    // transient native read failure must never be treated the same as HC
    // genuinely reporting 0 for today (see "Drop a polluted verified lane"
    // below), otherwise a single flaky call during rapid re-polling (e.g. an
    // active Unlimited race refreshing on every roster update) wipes out an
    // already-confirmed daily total and the UI flickers between 0 and the
    // real count.
    let providerReadOk = false;
    if (!opts?.ignoreProvider) {
      try {
        const data = await stepProviderManager.getTodayStepsForBackgroundPoll();
        // `null` means "couldn't read right now" (provider re-initializing,
        // permission cache momentarily stale, etc.) — not a genuine HC/HK 0.
        if (data) {
          providerSteps = Math.max(0, data.steps ?? 0);
          providerReadOk = true;
        }
      } catch {
        providerSteps = 0;
        providerReadOk = false;
      }
    }
    const verifiedLane = Math.max(0, Math.floor(rp.verifiedTodaySteps ?? 0));
    // HC is authority when it actually returns today's total. An empty mid-day
    // poll must not discard same-day cache / lastSynced (logout → login).
    let accepted = Math.max(providerSteps, verifiedLane);
    const emptyMidDayPoll =
      providerReadOk && providerSteps === 0 && !isFreshLocalDay();
    if (
      backendSynced > 0 &&
      (emptyMidDayPoll || backendSynced <= providerSteps + 250)
    ) {
      accepted = Math.max(accepted, backendSynced);
    }
    if (
      localCached > 0 &&
      (emptyMidDayPoll ||
        localCached <= Math.max(providerSteps, accepted) + 250)
    ) {
      accepted = Math.max(accepted, localCached);
    } else if (
      localCached > Math.max(providerSteps, accepted) + 250 &&
      (providerSteps > 0 || isFreshLocalDay())
    ) {
      stepEngineLog(
        "StepEngine",
        `canonical dropInflatedLocal=${localCached} provider=${providerSteps} lastSynced=${backendSynced}`,
      );
    }
    // Drop a polluted verified lane that looks like a leftover sensor absolute —
    // only when HC/HK genuinely reported 0 for a fresh read, never on a skipped
    // or failed read, and only once confirmed twice in a row (a lone glitchy 0
    // must never zero out a real, already-confirmed total on a transient hiccup).
    // Mid-day Samsung/HC empty polls (records=0) are NOT a genuine zero.
    if (providerReadOk && providerSteps === 0 && verifiedLane > 250 && !isFreshLocalDay()) {
      providerReadOk = false;
    }
    if (providerReadOk && providerSteps === 0 && verifiedLane > 250) {
      consecutiveZeroProviderReads += 1;
      if (consecutiveZeroProviderReads >= 2) {
        accepted = providerSteps;
      }
    } else if (providerReadOk && providerSteps > 0) {
      consecutiveZeroProviderReads = 0;
    }
    stepEngineLog(
      "StepEngine",
      `canonicalTodaySteps=${accepted} verified=${verifiedLane} provider=${providerSteps} userId=${userId} localDate=${today}`,
    );
    return accepted;
  }

  // Legacy sensor path — seed from display lane, then merge cache/native.
  let accepted = Math.max(
    0,
    rp.verifiedTodaySteps ?? 0,
    rp.todaySteps ?? 0,
  );
  accepted = filterLegacyStepIncrease(accepted, localCached, {
    backendSteps: backendSynced,
  });

  if (Platform.OS === "android" && opts?.mergeNative !== false) {
    const native = await stepTrackingNotificationService.getNativeStepState(userId);
    // Strict: native must be tagged for this user. Missing userId = previous session leak.
    const nativeMatchesUser = !!native?.userId && native.userId === userId;
    const nativeStale = !!(native?.localDate && native.localDate !== today);
    if (nativeMatchesUser && !nativeStale) {
      accepted = filterLegacyStepIncrease(
        accepted,
        native?.todaySteps ?? 0,
        { backendSteps: backendSynced },
      );
    }
  }

  if (!opts?.ignoreProvider) {
    try {
      const data = await stepProviderManager.getTodayStepsForBackgroundPoll();
      if (data) {
        let providerSteps = Math.max(0, data.steps);
        if (
          opts?.mergeNative !== false &&
          Platform.OS === "android"
        ) {
          providerSteps = await mergeWalkStepsWithNative(providerSteps);
        }
        const resolved = resolveTodayDisplaySteps({
          providerSteps,
          backendSteps: accepted,
          previousProviderSteps: accepted,
        });
        accepted = filterLegacyStepIncrease(accepted, resolved, {
          backendSteps: backendSynced,
        });
      }
    } catch {
      // keep accumulated steps
    }
  }

  stepEngineLog(
    "StepEngine",
    `canonicalTodaySteps=${accepted} verified=${rp.verifiedTodaySteps ?? 0} userId=${userId} localDate=${today}`,
  );
  return accepted;
}

/**
 * Push the daily-steps notification from the canonical Redux store only.
 * The notification must never generate or increment steps independently.
 */
export async function pushWalkNotificationFromCanonicalStore(
  force = false,
  userIdOverride?: string | null,
): Promise<void> {
  if (!isAppStartupReady()) {
    logger.debug("OngoingNotification", "push deferred — startup not ready");
    return;
  }
  const s = store.getState().raceProgress;
  const userId = userIdOverride ?? s.userId;
  if (!userId) {
    stepCoordDebug("[OngoingNotification] push skipped — no userId in store");
    return;
  }

  const raceProgressNow = store.getState().raceProgress;
  let steps = resolveWalkNotificationSteps({
    verifiedTodaySteps: raceProgressNow.verifiedTodaySteps ?? 0,
    provisionalSensorTodaySteps: raceProgressNow.provisionalSensorTodaySteps,
    todaySteps: raceProgressNow.todaySteps,
    raceActive:
      raceProgressNow.raceStatus === "active" || !!raceProgressNow.companionRaceId,
  });
  const now = Date.now();
  const cfg = STEP_TRACKING_NOTIFICATION_CONFIG;
  const verifiedNow = Math.max(
    0,
    Math.floor(store.getState().raceProgress.verifiedTodaySteps ?? 0),
  );

  // Allow regression when correcting an inflated tray down to HC/HK (incl. 0).
  const correctingInflatedTray =
    lastWalkNotificationSteps >= 0 &&
    lastWalkNotificationSteps > steps + 250 &&
    steps === verifiedNow;
  if (
    lastWalkNotificationSteps >= 0 &&
    steps < lastWalkNotificationSteps &&
    !correctingInflatedTray
  ) {
    stepEngineLog(
      "Notification",
      `skippedReason=regression incoming=${steps} last=${lastWalkNotificationSteps}`,
    );
    return;
  }

  // Same-step throttle only applies to unforced pushes. After race→walk switch,
  // native may have overwritten the tray with a stale low count while JS still
  // thinks lastWalkNotificationSteps matches — force must always re-poke native.
  if (
    !force &&
    steps === lastWalkNotificationSteps &&
    now - lastWalkNotificationPushMs < cfg.LOCAL_UPDATE_MS
  ) {
    return;
  }

  if (
    !force &&
    now - lastWalkNotificationPushMs < cfg.LOCAL_UPDATE_MS &&
    Math.abs(steps - lastWalkNotificationSteps) < cfg.MIN_STEP_DELTA_FOR_UPDATE
  ) {
    stepCoordDebug(
      `[Notification] skipped throttle todaySteps=${steps} last=${lastWalkNotificationSteps}`,
    );
    return;
  }

  stepCoordDebug(
    `[Notification] notifyUpdated id=91002 steps=${steps} source=${s.stepSource}`,
  );
  if (steps !== lastWalkNotificationSteps) {
    stepCoordDebug(`[Notification] receivedTodaySteps=${steps}`);
  }

  await stepTrackingNotificationService.mirrorWalkScreen({
    userId,
    todaySteps: steps,
    dailyGoal: s.dailyGoal > 0 ? s.dailyGoal : 10_000,
  });

  lastWalkNotificationSteps = steps;
  lastWalkNotificationPushMs = now;
}

/**
 * Detect local-midnight rollover and reset daily steps in Redux, storage, native FGS,
 * and the ongoing notification. Safe to call repeatedly (idempotent per calendar day).
 */
export async function handleMidnightRolloverIfNeeded(): Promise<boolean> {
  const today = getLocalDateStr();
  const activeUserId =
    store.getState().raceProgress.userId ??
    (await storageGet<string>(STORAGE_KEYS.LAST_STEP_USER_ID));
  if (!activeUserId) {
    lastKnownTrackingDate = today;
    return false;
  }
  const scopedKeys = stepScopedKeys(activeUserId, today);
  const trackingDate = await storageGet<string>(scopedKeys.currentLocalDate);
  const lastMidnightResetDate = await storageGet<string>(
    scopedKeys.lastMidnightResetDate,
  );
  const syncedCount = await storageGet<number>(scopedKeys.lastSyncedStepsCount);

  let native: Awaited<ReturnType<typeof stepTrackingNotificationService.getNativeStepState>> = null;
  if (Platform.OS === "android") {
    try {
      native = await stepTrackingNotificationService.getNativeStepState();
    } catch (err) {
      logger.warn("Startup", "native step state read failed", err);
    }
  }

  const nativeMatchesUser =
    !activeUserId || !native?.userId || native.userId === activeUserId;
  const nativeDate = nativeMatchesUser ? native?.localDate ?? null : null;
  const nativeSteps = nativeMatchesUser ? native?.todaySteps ?? 0 : 0;
  const nativeUpdatedAt = native?.updatedAt ?? native?.lastUpdatedAt ?? 0;
  const nativeStaleByTimestamp = isStepSnapshotFromBeforeToday(
    nativeUpdatedAt,
    nativeSteps,
  );

  // Redux may still hold yesterday's absolute after a partial date-key write
  // (storage already says "today" but lanes were never zeroed). Treat a
  // pre-midnight verified/today timestamp as a forced rollover.
  const rpNow = store.getState().raceProgress;
  const reduxUpdatedRaw =
    rpNow.verifiedTodayStepsAt ?? rpNow.todayStepsLastUpdatedAt ?? 0;
  const reduxUpdatedMs =
    typeof reduxUpdatedRaw === "string"
      ? new Date(reduxUpdatedRaw).getTime()
      : Number(reduxUpdatedRaw);
  const reduxStaleByTimestamp =
    Number.isFinite(reduxUpdatedMs) &&
    isStepSnapshotFromBeforeToday(
      reduxUpdatedMs,
      Math.max(rpNow.verifiedTodaySteps ?? 0, rpNow.todaySteps ?? 0),
    );

  const needsRollover =
    lastMidnightResetDate !== today ||
    (trackingDate != null && trackingDate !== today) ||
    (nativeDate != null && nativeDate !== today) ||
    (lastKnownTrackingDate != null && lastKnownTrackingDate !== today) ||
    nativeStaleByTimestamp ||
    reduxStaleByTimestamp;

  stepDebugVerboseLog(
    "StepReset",
    `currentUserId=${activeUserId ?? "none"} localDate=${today} previousLocalDate=${trackingDate ?? "none"} dayChanged=${needsRollover} reduxStale=${reduxStaleByTimestamp}`,
  );
  stepEngineLog(
    "DayReset",
    `previousDate=${trackingDate ?? lastKnownTrackingDate ?? "none"} currentDate=${today} reset=${needsRollover} reduxStale=${reduxStaleByTimestamp}`,
  );

  if (!needsRollover) {
    if (trackingDate == null) {
      await storageSet(scopedKeys.currentLocalDate, today);
    }
    if (lastMidnightResetDate !== today) {
      await storageSet(scopedKeys.lastMidnightResetDate, today);
    }
    lastKnownTrackingDate = today;
    const yesterday = shiftLocalDateKey(today, -1);
    if (flushedHistoryDateKey !== `${activeUserId}:${yesterday}`) {
      await persistLocalDayToWalkHistory(activeUserId, yesterday);
    }
    return false;
  }

  const previousDate =
    trackingDate && trackingDate !== today
      ? trackingDate
      : lastKnownTrackingDate && lastKnownTrackingDate !== today
        ? lastKnownTrackingDate
        : shiftLocalDateKey(today, -1);
  const verifiedBeforeReset = Math.max(
    0,
    Math.floor(store.getState().raceProgress.verifiedTodaySteps ?? 0),
  );
  await persistLocalDayToWalkHistory(
    activeUserId,
    previousDate,
    verifiedBeforeReset,
  );

  stepDebugVerboseLog(
    "StepReset",
    `resetting daily steps currentUserId=${activeUserId ?? "none"} localDate=${today} previousLocalDate=${trackingDate ?? "n/a"} nativeDate=${nativeDate ?? "n/a"} lastKnown=${lastKnownTrackingDate ?? "n/a"} syncedCount=${syncedCount ?? 0}`,
  );

  if (Platform.OS === "android") {
    const nativeAlreadyRolled =
      nativeDate === today && !nativeStaleByTimestamp;
    // If native FGS already re-baselined at midnight, do not wipe morning steps.
    if (!nativeAlreadyRolled) {
      await stepTrackingNotificationService.resetDailyStepsForNewDay();
    }
    try {
      const { androidHCService } = await import(
        "@/services/steps/androidHealthConnectService"
      );
      androidHCService.resetTodayStepCache();
    } catch {
      // non-fatal
    }
    try {
      const { androidLegacySensorProvider } = await import(
        "@/services/steps/providers/androidLegacySensorProvider"
      );
      await androidLegacySensorProvider.resetForNewLocalDay?.();
    } catch {
      // non-fatal
    }
  }

  const nativeSeed =
    nativeDate === today && !nativeStaleByTimestamp
      ? Math.max(0, Math.floor(nativeSteps))
      : 0;

  store.dispatch(
    raceProgressActions.resetDailyStepsForNewDay({
      todaySteps: nativeSeed,
      updatedAt: new Date().toISOString(),
    }),
  );
  store.dispatch(walkActions.setTodaySteps(nativeSeed));

  lastWalkNotificationSteps = -1;
  markFreshLocalDay(90_000);
  try {
    const { clearVerifiedAccountStepIsolation } = await import(
      "@/services/steps/verifiedAccountStepIsolation"
    );
    clearVerifiedAccountStepIsolation();
  } catch {
    /* optional */
  }

  await writeDailyStepsForUserDate(activeUserId, today, 0, { forceZero: true });
  await storageSet(stepScopedKeys(activeUserId, today).lastSyncedStepsCount, 0);
  await storageSet(stepScopedKeys(activeUserId, today).currentLocalDate, today);
  await storageSet(stepScopedKeys(activeUserId, today).lastMidnightResetDate, today);
  await deleteLegacyUnscopedStepKeys();

  // Drop cached API rows for the new local day so hydrate doesn't merge stale totals.
  try {
    queryClient.removeQueries({ queryKey: ["todaySteps", activeUserId] });
    queryClient.removeQueries({ queryKey: ["walkStats", activeUserId] });
    queryClient.removeQueries({ queryKey: ["stepProgress", activeUserId] });
  } catch {
    // non-fatal
  }

  lastKnownTrackingDate = today;
  await pushWalkNotificationFromCanonicalStore(true);
  notifyMidnightRollover();
  return true;
}

function scheduleNextMidnightCheck(): void {
  if (midnightCheckTimer) clearTimeout(midnightCheckTimer);
  const delayMs = msUntilNextLocalMidnight(1_000);
  midnightCheckTimer = setTimeout(() => {
    midnightCheckTimer = null;
    void handleMidnightRolloverIfNeeded();
    scheduleNextMidnightCheck();
  }, delayMs);
}

/**
 * Single entry point for real step reads from Health Connect, HealthKit, or
 * legacy sensor. Rejects unknown/simulated sources and updates the canonical store.
 */
export function updateStepProgressFromRealSource(input: {
  todaySteps?: number;
  raceSteps?: number;
  stepSource?: StepProgressSource;
  updatedAt?: string;
  deviceTotalSteps?: number;
  atTarget?: boolean;
  isSimulated?: boolean;
  isFake?: boolean;
  /** Live sensor / FGS tick — skip poll-only phantom guards. */
  fromWatch?: boolean;
  /** Explicit daily lane — provisional never becomes verified sync authority. */
  dailyLane?: "verified" | "provisional" | "auto";
}): void {
  const source = input.stepSource ?? mapProviderSource();

  if (!source || source === "unknown") {
    logger.debug("StepEngine", "rejected step update reason=unknown_source");
    return;
  }

  if (input.isSimulated || input.isFake) {
    logger.debug("StepEngine", "rejected fake/fallback step update reason=simulated");
    return;
  }

  const current = store.getState().raceProgress;
  const updatedAt = input.updatedAt ?? new Date().toISOString();

  const dailyLane =
    input.dailyLane ??
    (stepProviderManager.usesVerifiedStepSource() && isDeviceSensorSource(source)
      ? "provisional"
      : isVerifiedSource(source)
        ? "verified"
        : "auto");
  const allowTodayDecrease =
    dailyLane === "verified" ||
    (dailyLane === "auto" && isVerifiedSource(source));

  if (
    !shouldAcceptStepUpdate(
      {
        todaySteps: input.todaySteps,
        raceSteps: input.raceSteps,
        updatedAt,
      },
      current,
      { allowTodayDecrease },
    )
  ) {
    logger.debug("StepEngine", "rejected stale step update");
    return;
  }

  let resolvedTodaySteps = input.todaySteps;
  if (resolvedTodaySteps !== undefined) {
    let next = Math.max(0, Math.floor(resolvedTodaySteps));
    const delta = next - current.todaySteps;
    // Reject suspicious small fixed jumps from native_service when verified source is active.
    if (
      delta > 0 &&
      delta <= 15 &&
      !isVerifiedSource(source) &&
      stepProviderManager.usesVerifiedStepSource() &&
      source === "sensor"
    ) {
      logger.debug("StepEngine", `rejected fake increment previous=${current.todaySteps} incoming=${next} reason=verified_source_priority`);
      return;
    }
    if (isDeviceSensorSource(source) && !stepProviderManager.usesVerifiedStepSource()) {
      next = sanitizeLegacyProviderSteps(
        next,
        current.todaySteps,
        current.todaySteps,
      );
    }
    if (shouldIgnoreLegacyPhantomBump(current.todaySteps, next, { fromWatch: input.fromWatch })) {
      logger.debug("StepEngine", `rejected phantom bump previous=${current.todaySteps} incoming=${next} source=${source}`);
      return;
    }
    resolvedTodaySteps = next;
  }

  stepCoordDebug(
    `[StepSource] real update source=${source} lane=${dailyLane} todaySteps=${resolvedTodaySteps ?? current.todaySteps} raceSteps=${input.raceSteps ?? current.raceSteps}`,
  );

  store.dispatch(
    raceProgressActions.updateFromDeviceSource({
      todaySteps: resolvedTodaySteps,
      raceSteps: input.raceSteps,
      stepSource: source,
      updatedAt,
      dailyLane,
    }),
  );

  const after = store.getState().raceProgress;
  if (resolvedTodaySteps !== undefined) {
    stepCoordDebug(
      `[StepEngine] todaySteps=${after.todaySteps} verified=${after.verifiedTodaySteps} provisional=${after.provisionalSensorTodaySteps ?? "null"} emittedUpdateAt=${updatedAt}`,
    );
  }
  if (input.raceSteps !== undefined) {
    stepCoordDebug(
      `[StepEngine] race update raceId=${after.activeRaceId ?? "none"} raceSteps=${after.raceSteps}`,
    );
  }

  if (resolvedTodaySteps !== undefined) {
    const s = store.getState().raceProgress;
    store.dispatch(walkActions.setTodaySteps(s.todaySteps));
    // Verified HC/HK catch-up (or large jumps) must force the tray — debounce-only
    // pushes were skipping after race-end when lastSteps already matched Redux.
    const jump =
      lastWalkNotificationSteps >= 0
        ? Math.abs(s.todaySteps - lastWalkNotificationSteps)
        : s.todaySteps;
    scheduleWalkNotificationUpdate(
      dailyLane === "verified" || jump >= 25 || allowTodayDecrease,
    );
  }

  if (input.raceSteps !== undefined) {
    scheduleNotificationUpdate(true);
    void syncRaceProgressToBackend({
      deviceTotalSteps: input.deviceTotalSteps,
      atTarget: input.atTarget,
      force: input.atTarget,
    });
  }
}

function scheduleNotificationUpdate(force = false): void {
  if (pendingNotification && !force) return;
  pendingNotification = true;

  if (notificationTimer) clearTimeout(notificationTimer);

  const delay = force ? 0 : RACE_PROGRESS_NOTIFICATION_CONFIG.LOCAL_UPDATE_MS;
  notificationTimer = setTimeout(() => {
    pendingNotification = false;
    notificationTimer = null;
    void pushNotificationFromStore();
  }, delay);
}

async function pushNotificationFromStore(): Promise<void> {
  const s = store.getState().raceProgress;
  if (s.raceStatus !== "active" || !s.activeRaceId || !s.userId) return;

  const payload = {
    raceId: s.activeRaceId,
    userId: s.userId,
    username: s.username ?? "Runner",
    raceSteps: s.raceSteps,
    rank: s.rank ?? 1,
    totalParticipants: s.totalParticipants ?? 1,
    goalSteps: s.goalSteps ?? 0,
    timeLeftSeconds: s.timeLeftSeconds ?? 0,
    raceStatus: "in_progress",
    lastSyncedAt: s.lastBackendSyncedAt ?? undefined,
    isSponsored: s.activeRaceIsSponsored === true,
    raceType:
      s.activeRaceType ??
      (s.activeRaceIsSponsored === true ? "sponsored" : "free"),
  };

  logger.debug("AndroidNotification", `update raceSteps=${payload.raceSteps} rank=${payload.rank} source=store`);

  await raceProgressNotificationService.onLocalRaceStepsUpdated(payload);
  // Keep companion race tray (id 1002) in sync with device today steps.
  if (s.companionRaceId) {
    const companionToday = resolveWalkNotificationSteps({
      verifiedTodaySteps: s.verifiedTodaySteps ?? 0,
      provisionalSensorTodaySteps: s.provisionalSensorTodaySteps,
      todaySteps: s.todaySteps,
      raceActive: true,
    });
    await raceProgressNotificationService.onCompanionDeviceStepsUpdated(companionToday);
  }
  store.dispatch(raceProgressActions.markNotificationUpdated());
}

/** Called on app resume — native hydrate + race outbox; WalkContext handles provider refresh. */
export async function hydrateOnAppResume(): Promise<void> {
  try {
    await handleMidnightRolloverIfNeeded();
    if (Platform.OS === "android") {
      await stepTrackingNotificationService.flushRaceSyncOutbox();
      const raceActive = store.getState().raceProgress.raceStatus === "active";
      if (raceActive) {
        await hydrateFromNativeRaceService();
      } else {
        // Kill stale native race_live leftovers when JS has no active race.
        try {
          const raw = await raceProgressNotificationService.getNativeRaceState();
          if (raw) {
            const json = JSON.parse(raw) as Record<string, unknown>;
            const nativeRaceId = typeof json.raceId === "string" ? json.raceId : null;
            if (nativeRaceId) {
              await suppressLiveRaceNotification(nativeRaceId, "resume_orphan_race_live");
            }
          }
        } catch {
          /* non-fatal */
        }
        if (stepTrackingNotificationService.isActive()) {
          await hydrateFromNativeStepState();
          startWalkBackgroundStepPoll();
          await tickWalkBackgroundStepPoll("resume");
        }
      }
    }
    {
      const s = store.getState().raceProgress;
      logger.debug("AppResume", `coordinator resume todaySteps=${s.todaySteps} raceSteps=${s.raceSteps} source=${s.stepSource}`);
    }
  } catch (err) {
    logger.warn("Startup", "hydrateOnAppResume failed", err);
  }
}

export function initStepProgressCoordinator(): void {
  stepCoordDebug("[Startup] step coordinator initializing");

  AppState.addEventListener("change", (next: AppStateStatus) => {
    stepEngineLog("Lifecycle", `appState=${next}`);
    if (next === "active") {
      void hydrateOnAppResume();
      return;
    }
    if (next === "background" || next === "inactive") {
      // Hand continuous step delivery to native FGS BEFORE JS is suspended.
      // Background/closed updates must not depend on JS timers or HC polls.
      void handOffStepTrackingToNative(next);
    }
  });

  void waitForAppStartupReady().then(async () => {
    try {
      suppressLegacyStepBumps(12_000);
      const userId = await storageGet<string>(STORAGE_KEYS.LAST_STEP_USER_ID);
      lastKnownTrackingDate = userId
        ? (await storageGet<string>(stepScopedKeys(userId).currentLocalDate)) ?? null
        : null;
      initNativeStepEventListener();
      scheduleNextMidnightCheck();
      await handleMidnightRolloverIfNeeded();
      if (userId && stepTrackingNotificationService.isActive()) {
        const today = getLocalDateStr();
        const bootSteps = await readDailyStepsForUserDate(userId, today);
        let seedSteps = bootSteps;
        try {
          seedSteps = await resolveAuthoritativeTodaySteps(userId, { mergeNative: false });
        } catch {
          seedSteps = bootSteps;
        }
        store.dispatch(
          raceProgressActions.initializeStepsForUserDate({
            userId,
            localDate: today,
            bootTodaySteps: seedSteps,
          }),
        );
        lastWalkNotificationSteps = store.getState().raceProgress.todaySteps;
        startWalkBackgroundStepPoll();
        void tickWalkBackgroundStepPoll("resume");
        stepEngineLog(
          "Notification",
          `serviceRunning=true backgroundPollStarted=true userId=${userId}`,
        );
      }
    } catch (err) {
      logger.warn("Startup", "step coordinator native listener failed", err);
    }
    stepCoordDebug("[Startup] step coordinator initialized");
  });
}

let nativeStepUnsubscribe: (() => void) | null = null;
let nativeWalkRefreshUnsubscribe: (() => void) | null = null;
let walkBackgroundPollTimer: ReturnType<typeof setInterval> | null = null;

function notificationBgLog(message: string): void {
  const important =
    message.startsWith("notifyUpdated") ||
    message.startsWith("skippedReason=error");
  if (!important && !STEP_SYNC_CONFIG.STEP_DEBUG_VERBOSE) return;
  logger.debug("NotificationBG", message);
}

function stepCoordDebug(message: string): void {
  if (!STEP_SYNC_CONFIG.STEP_DEBUG_VERBOSE) return;
  logger.debug("StepCoordinator", message);
}

/**
 * AppState → background/inactive: seed native FGS then let it own walk + race
 * step counting while the UI process is suspended or swiped away.
 */
async function handOffStepTrackingToNative(
  reason: "background" | "inactive",
): Promise<void> {
  try {
    const s = store.getState().raceProgress;
    const raceLive = s.raceStatus === "active" && !!s.activeRaceId && !!s.userId;

    // Force-revive live race FGS with last known totals before JS suspends.
    if (raceLive) {
      await raceProgressNotificationService.start(
        {
          raceId: s.activeRaceId!,
          userId: s.userId!,
          username: s.username ?? "Runner",
          raceSteps: s.raceSteps,
          rank: s.rank ?? 1,
          totalParticipants: s.totalParticipants ?? 1,
          goalSteps: s.goalSteps ?? 0,
          timeLeftSeconds: s.timeLeftSeconds ?? 0,
          raceStatus: "in_progress",
          isSponsored: s.activeRaceIsSponsored === true,
        },
        s.raceStartTime ?? undefined,
      );
    } else {
      await pushNotificationFromStore();
    }

    if (s.userId && Platform.OS === "android") {
      const steps = resolveWalkNotificationSteps({
        verifiedTodaySteps: s.verifiedTodaySteps ?? 0,
        provisionalSensorTodaySteps: s.provisionalSensorTodaySteps,
        todaySteps: s.todaySteps,
        raceActive: s.raceStatus === "active" || !!s.companionRaceId,
      });
      if (stepTrackingNotificationService.isActive()) {
        // Revive walk FGS + sensor ownership (also keeps sensor alive during a race).
        await stepTrackingNotificationService.handOffToNativeBackground({
          userId: s.userId,
          todaySteps: steps,
          dailyGoal: s.dailyGoal > 0 ? s.dailyGoal : 10_000,
        });
      } else {
        // JS `active` can be false after reload while native walk_active/race still
        // persists — always poke FGS so swipe-close keep-alive is armed.
        try {
          const native = await stepTrackingNotificationService.getNativeStepState(
            s.userId,
          );
          const nativeWantsWalk =
            !!native &&
            (native.walkActive === true ||
              native.notificationMode === "daily_steps" ||
              native.notificationMode === "total_steps" ||
              native.notificationMode === "race_live");
          if (nativeWantsWalk || raceLive) {
            if (nativeWantsWalk && !raceLive) {
              // Never Math.max with a stale FGS absolute (yesterday's 9k+) when
              // verified HC/HK already owns the day total — that re-poisons Walk.
              const nativeToday = Math.max(0, Math.floor(native?.todaySteps ?? 0));
              const handOffSteps =
                stepProviderManager.usesVerifiedStepSource() &&
                isInflatedProvisionalVsVerified(steps, nativeToday)
                  ? steps
                  : Math.max(steps, nativeToday);
              await stepTrackingNotificationService.handOffToNativeBackground({
                userId: s.userId,
                todaySteps: handOffSteps,
                dailyGoal: s.dailyGoal > 0 ? s.dailyGoal : 10_000,
              });
            } else {
              await stepTrackingNotificationService.ensureNativeBackgroundTracking();
            }
          }
        } catch {
          if (raceLive) {
            await stepTrackingNotificationService.ensureNativeBackgroundTracking();
          }
        }
      }
    }

    // Best-effort last HC merge while JS can still run (non-blocking for native).
    if (reason === "background" && !raceLive) {
      void tickWalkBackgroundStepPoll("background");
    }
    stepEngineLog("Lifecycle", `nativeHandOff reason=${reason}`);
  } catch (err) {
    logger.warn("Lifecycle", "native step handoff failed", err);
  }
}

/**
 * Refresh daily steps from provider and push notification 91002.
 * Does NOT adopt raw native ahead of provider (anti-inflation preserved).
 */
export async function tickWalkBackgroundStepPoll(
  reason: "fgs_tick" | "interval" | "resume" | "background" = "interval",
): Promise<void> {
  if (!isAppStartupReady()) {
    return;
  }
  const s = store.getState().raceProgress;
  if (!s.userId) {
    return;
  }
  if (s.raceStatus === "active" && s.activeRaceId) {
    return;
  }

  try {
    const data = await stepProviderManager.getTodayStepsForBackgroundPoll();
    const hcSteps = Math.max(0, data?.steps ?? 0);
    const current = s.todaySteps;
    const verifiedMode = stepProviderManager.usesVerifiedStepSource();

    if (Platform.OS === "android" && verifiedMode) {
      // Lane 1: Health Connect → verifiedTodaySteps only
      if (hcSteps > 0) {
        updateStepProgressFromRealSource({
          todaySteps: hcSteps,
          stepSource: mapProviderSource(),
          dailyLane: "verified",
          updatedAt: new Date().toISOString(),
          fromWatch: false,
        });
      } else if (isInflatedProvisionalVsVerified(
        Math.max(0, Math.floor(s.verifiedTodaySteps ?? 0)),
        current,
      )) {
        // HC empty but Redux/native still hold a since-boot absolute — rebaseline
        // to the account verified floor (GET /api/walk/today), not hard 0.
        const accountFloor = Math.max(0, Math.floor(s.verifiedTodaySteps ?? 0));
        stepEngineLog(
          "StepEngine",
          `backgroundPoll dropPoisonedDaily current=${current} hc=0 keepAccount=${accountFloor}`,
        );
        await rebaselineInflatedNativeDaily(s.userId, accountFloor);
      }
      // Lane 2: FGS sensor → provisional display only
      const native = await stepTrackingNotificationService.getNativeStepState(
        s.userId ?? undefined,
      );
      const nativeToday =
        native && typeof native.todaySteps === "number"
          ? Math.max(0, Math.floor(native.todaySteps))
          : null;
      const today = getLocalDateStr();
      const nativeOk =
        nativeToday != null &&
        (!native?.userId || !s.userId || native.userId === s.userId) &&
        (!native?.localDate || native.localDate === today) &&
        !isStepSnapshotFromBeforeToday(
          native?.updatedAt ?? native?.lastUpdatedAt,
          nativeToday,
        );
      if (
        nativeOk &&
        nativeToday > 0 &&
        !looksLikeSinceBootCounter({
          todaySteps: nativeToday,
          sensorTotal: native?.sensorTotal,
          dailyBaseline: native?.dailyBaseline,
        })
      ) {
        updateStepProgressFromRealSource({
          todaySteps: nativeToday,
          stepSource: "android_step_counter",
          dailyLane: "provisional",
          updatedAt: new Date().toISOString(),
          fromWatch: reason === "fgs_tick" || reason === "interval",
        });
      }
      const stepsAfter = store.getState().raceProgress.todaySteps;
      if (stepsAfter !== current) {
        stepEngineLog(
          "StepEngine",
          `canonicalTodaySteps=${stepsAfter} backgroundPoll reason=${reason} verified=${store.getState().raceProgress.verifiedTodaySteps} provisional=${store.getState().raceProgress.provisionalSensorTodaySteps ?? "null"}`,
        );
      }
      // fall through to notification push below
    } else {
      let providerSteps = hcSteps;
      if (
        reason === "fgs_tick" &&
        Platform.OS === "android" &&
        !verifiedMode
      ) {
        providerSteps = await mergeWalkStepsWithNative(providerSteps);
      } else if (!data) {
        return;
      }

      const display = resolveTodayDisplaySteps({
        providerSteps,
        backendSteps: current,
        previousProviderSteps: current,
      });

      const stepsBefore = store.getState().raceProgress.todaySteps;
      if (display > stepsBefore) {
        updateStepProgressFromRealSource({
          todaySteps: display,
          stepSource: mapProviderSource(),
          updatedAt: new Date().toISOString(),
          fromWatch: reason === "fgs_tick" || reason === "interval",
        });
        stepEngineLog(
          "StepEngine",
          `canonicalTodaySteps=${display} backgroundPoll reason=${reason}`,
        );
      }
    }

    const stepsBeforeNotify = current;
    const stepsAfter = store.getState().raceProgress.todaySteps;
    if (stepsAfter > stepsBeforeNotify) {
      try {
        const { stepAudit } = require("@/utils/stepAudit") as typeof import("@/utils/stepAudit");
        stepAudit.noteSensorTick({
          providerId: stepProviderManager.getActiveProviderId(),
          calculatedDailySteps: stepsAfter,
          eventOrigin:
            reason === "fgs_tick"
              ? "fgs"
              : reason === "resume"
                ? "resume"
                : "poll",
        });
      } catch {
        /* optional */
      }
      await pushWalkNotificationFromCanonicalStore(true, s.userId);
      notificationBgLog(`notifyUpdated id=91002 steps=${stepsAfter} reason=${reason}`);
    }
  } catch (err) {
    notificationBgLog(`skippedReason=error err=${String(err)}`);
  }
}

export function startWalkBackgroundStepPoll(): void {
  if (walkBackgroundPollTimer) return;
  walkBackgroundPollTimer = setInterval(() => {
    void tickWalkBackgroundStepPoll("interval");
  }, STEP_SYNC_CONFIG.WALK_LOCAL_RECONCILE_POLL_MS);
  if (STEP_SYNC_CONFIG.STEP_DEBUG_VERBOSE) {
    notificationBgLog("backgroundPollStarted=true");
  }
}

export function stopWalkBackgroundStepPoll(): void {
  if (walkBackgroundPollTimer) {
    clearInterval(walkBackgroundPollTimer);
    walkBackgroundPollTimer = null;
    if (STEP_SYNC_CONFIG.STEP_DEBUG_VERBOSE) {
      notificationBgLog("backgroundPollStopped=true");
    }
  }
}

function initNativeStepEventListener(): void {
  if (Platform.OS !== "android") return;
  nativeStepUnsubscribe?.();
  nativeStepUnsubscribe = stepTrackingNotificationService.subscribeNativeStepUpdates(
    (state) => {
      const source = state.stepSource ?? "android_step_counter";
      const s = store.getState().raceProgress;
      if (state.userId && s.userId && state.userId !== s.userId) {
        logger.debug("StepStore", "ignored update for previous user");
        return;
      }
      const raceActive =
        s.raceStatus === "active" &&
        !!s.activeRaceId &&
        (!state.activeRaceId || state.activeRaceId === s.activeRaceId);

      const updatedAt = new Date(
        state.updatedAt ?? state.lastUpdatedAt ?? Date.now(),
      ).toISOString();

      // Hybrid live race: FGS TYPE_STEP_COUNTER owns raceSteps while daily is HC.
      // Feed native raceSteps into Redux (do not drop when verified daily).
      if (raceActive && typeof state.raceSteps === "number") {
        if (
          isDeviceSensorSource(source) ||
          stepProviderManager.usesRaceBaseline()
        ) {
          if (
            isJsAuthoritativeStepSession() &&
            stepProviderManager.isLiveRaceWatchHealthy()
          ) {
            // JS live watch is primary (and has a recent proof-of-life tick);
            // FGS still updates the race notification natively.
            logger.debug(
              "StepStore",
              "ignored native race sensor — JS live race watch owns Redux",
            );
            return;
          }
          // JS watch missing or stale (zombie Pedometer subscription — a known
          // Android issue where watchStepCount silently stops delivering
          // callbacks while the handle stays non-null) — fall through and let
          // the native FGS reading (a separate, still-working sensor read)
          // update Redux instead of leaving Live Race steps frozen until the
          // whole app is killed and relaunched.
          feedRaceStepsToStore({
            raceSteps: state.raceSteps,
            stepSource: "android_step_counter",
            updatedAt,
          });
          logger.debug(
            "LiveRaceUI",
            `real step update raceSteps=${state.raceSteps} source=${source}`,
          );
          return;
        }
        feedRaceStepsToStore({
          raceSteps: state.raceSteps,
          stepSource: mapNativeStepSource(source),
          updatedAt,
        });
        return;
      }

      // Daily Walk (no active race): mirror FGS todaySteps into Redux so the Walk
      // screen matches the ongoing notification. Hybrid verified daily still uses
      // TYPE_STEP_COUNTER for live display while HC/HK remain the sync source —
      // accept sensor-labeled emits too, but keep Redux stepSource as HC/HK.
      const today = getLocalDateStr();
      if (!raceActive && state.localDate && state.localDate !== today) {
        logger.debug("StepStore", "ignored native update — stale localDate");
        return;
      }
      const nativeUpdatedAt = state.updatedAt ?? state.lastUpdatedAt ?? 0;
      if (
        !raceActive &&
        isStepSnapshotFromBeforeToday(nativeUpdatedAt, state.todaySteps ?? 0)
      ) {
        logger.debug("StepStore", "ignored native update — stale snapshot");
        return;
      }

      const currentToday = s.todaySteps;
      const incomingToday = Math.max(0, Math.floor(state.todaySteps ?? 0));
      if (incomingToday < currentToday) {
        // Native re-baselined at local midnight — do not keep yesterday's floor.
        const nativeDay = state.localDate ?? today;
        if (nativeDay === today && currentToday - incomingToday > 50) {
          store.dispatch(
            raceProgressActions.resetDailyStepsForNewDay({
              todaySteps: incomingToday,
              updatedAt,
            }),
          );
          store.dispatch(walkActions.setTodaySteps(incomingToday));
        }
        return;
      }
      if (incomingToday <= currentToday) return;

      const sinceBoot = looksLikeSinceBootCounter({
        todaySteps: incomingToday,
        sensorTotal: state.sensorTotal,
        dailyBaseline: state.dailyBaseline,
      });
      if (sinceBoot) {
        const floor = stepProviderManager.usesVerifiedStepSource()
          ? Math.max(0, Math.floor(s.verifiedTodaySteps ?? 0))
          : 0;
        logger.debug(
          "StepStore",
          `rebaseline native since-boot incoming=${incomingToday} sensorTotal=${state.sensorTotal ?? "n/a"} floor=${floor}`,
        );
        void rebaselineInflatedNativeDaily(s.userId, floor);
        return;
      }

      if (stepProviderManager.usesVerifiedStepSource()) {
        const verified = Math.max(0, Math.floor(s.verifiedTodaySteps ?? 0));
        // Yesterday-style FGS absolute — re-baseline native so the tray can track
        // live steps again from today's verified total (like a fresh day start).
        if (isInflatedProvisionalVsVerified(verified, incomingToday)) {
          logger.debug(
            "StepStore",
            `rebaseline native inflate incoming=${incomingToday} verified=${verified}`,
          );
          void rebaselineInflatedNativeDaily(s.userId, verified);
          return;
        }
        updateStepProgressFromRealSource({
          todaySteps: incomingToday,
          raceSteps: typeof state.raceSteps === "number" ? state.raceSteps : undefined,
          stepSource: "android_step_counter",
          dailyLane: "provisional",
          updatedAt,
          fromWatch: true,
        });
        return;
      }

      // Legacy sensor daily: JS live session owns Redux; FGS is notification-only.
      if (isJsAuthoritativeStepSession() && isDeviceSensorSource(source)) {
        return;
      }
      if (shouldIgnoreLegacyPhantomBump(currentToday, incomingToday, { fromWatch: true })) {
        stepEngineLog(
          "StepEngine",
          `rejected native phantom todaySteps incoming=${incomingToday} current=${currentToday}`,
        );
        return;
      }
      const sanitized = sanitizeLegacyProviderSteps(
        incomingToday,
        currentToday,
        currentToday,
      );
      if (sanitized <= currentToday) return;
      updateStepProgressFromRealSource({
        todaySteps: sanitized,
        raceSteps: typeof state.raceSteps === "number" ? state.raceSteps : undefined,
        stepSource: mapNativeStepSource(source),
        updatedAt,
        fromWatch: true,
      });
    },
  );

  nativeWalkRefreshUnsubscribe?.();
  nativeWalkRefreshUnsubscribe =
    stepTrackingNotificationService.subscribeWalkStepRefreshRequests(() => {
      void tickWalkBackgroundStepPoll("fgs_tick");
    });
}

async function hydrateFromNativeStepState(): Promise<void> {
  const current = store.getState().raceProgress;
  const native = await stepTrackingNotificationService.getNativeStepState(
    current.userId ?? undefined,
  );
  if (!native) return;

  const stepSource = native.stepSource ?? "";
  if (native.userId && current.userId && native.userId !== current.userId) {
    logger.debug("StepStore", "ignored update for previous user");
    return;
  }
  const today = getLocalDateStr();
  if (native.localDate && native.localDate !== today) {
    logger.debug("StepStore", "skip native hydrate — stale localDate");
    return;
  }
  const nativeUpdatedAtMs = native.updatedAt ?? native.lastUpdatedAt ?? 0;
  if (isStepSnapshotFromBeforeToday(nativeUpdatedAtMs, native.todaySteps ?? 0)) {
    logger.debug("StepStore", "skip native hydrate — stale snapshot");
    return;
  }
  const raceActive =
    current.raceStatus === "active" &&
    !!current.activeRaceId &&
    (!native.activeRaceId || native.activeRaceId === current.activeRaceId);

  const nativeToday = Math.max(0, Math.floor(native.todaySteps ?? 0));
  if (
    looksLikeSinceBootCounter({
      todaySteps: nativeToday,
      sensorTotal: native.sensorTotal,
      dailyBaseline: native.dailyBaseline,
    })
  ) {
    logger.debug(
      "AppResume",
      `skip native hydrate — since-boot todaySteps=${nativeToday} sensorTotal=${native.sensorTotal ?? "n/a"}`,
    );
    const floor = stepProviderManager.usesVerifiedStepSource()
      ? Math.max(0, Math.floor(current.verifiedTodaySteps ?? 0))
      : 0;
    void rebaselineInflatedNativeDaily(current.userId, floor);
    return;
  }

  // HC / HealthKit remain the verified sync source, but FGS TYPE_STEP_COUNTER
  // advances live display while HC lags (Samsung often returns records=0).
  // This value is still the on-device sensor's count, not an HC-confirmed read —
  // tag it `provisional` explicitly so it can never masquerade as a verified
  // total (which would otherwise let a stale/phantom sensor tick permanently
  // inflate the number that gets synced to the backend as "real" steps).
  if (stepProviderManager.usesVerifiedStepSource()) {
    const verified = Math.max(0, Math.floor(current.verifiedTodaySteps ?? 0));
    if (
      nativeToday > current.todaySteps &&
      !isInflatedProvisionalVsVerified(verified, nativeToday)
    ) {
      const updatedAt = new Date(
        native.updatedAt ?? native.lastUpdatedAt ?? Date.now(),
      ).toISOString();
      updateStepProgressFromRealSource({
        todaySteps: nativeToday,
        stepSource: mapNativeStepSource(
          stepProviderManager.getActiveProviderId() === "ios_healthkit"
            ? "healthkit"
            : "health_connect",
        ),
        updatedAt,
        fromWatch: true,
        dailyLane: "provisional",
      });
      logger.debug(
        "AppResume",
        `merged native display ahead todaySteps=${nativeToday} (kept provisional — not HC-verified)`,
      );
    } else {
      logger.debug(
        "AppResume",
        "skip native hydrate inflate — since-boot absolute rejected",
      );
    }
    return;
  }

  if (
    isVerifiedSource(stepSource) &&
    !raceActive
  ) {
    logger.debug("StepStore", "skip unified native hydrate — verified step source active");
    return;
  }
  if (stepSource === "unsupported" || native.sensorSupported === false) return;

  const updatedAt = new Date(
    native.updatedAt ?? native.lastUpdatedAt ?? Date.now(),
  ).toISOString();
  if (
    !shouldAcceptStepUpdate(
      {
        userId: native.userId ?? undefined,
        todaySteps: native.todaySteps,
        raceSteps: native.raceSteps,
        updatedAt,
      },
      current,
    )
  ) {
    logger.debug("AppResume", "ignored stale JS/database state");
    return;
  }

  if (raceActive && typeof native.raceSteps === "number") {
    feedRaceStepsToStore({
      raceSteps: native.raceSteps,
      stepSource: mapNativeStepSource(stepSource),
      updatedAt,
    });
    logger.debug("AppResume", `merged state source=native_service raceSteps=${native.raceSteps}`);
  }

  const sanitizedToday = sanitizeLegacyProviderSteps(
    nativeToday,
    current.todaySteps,
    current.todaySteps,
  );

  updateStepProgressFromRealSource({
    todaySteps: raceActive ? current.todaySteps : sanitizedToday,
    raceSteps:
      raceActive && typeof native.raceSteps === "number"
        ? native.raceSteps
        : undefined,
    stepSource: mapNativeStepSource(stepSource),
    updatedAt,
  });

  logger.debug("AppResume", `native state loaded todaySteps=${native.todaySteps} raceSteps=${native.raceSteps ?? 0}`);
}

async function hydrateFromNativeRaceService(): Promise<void> {
  const current = store.getState().raceProgress;
  // Verified providers must not inherit FGS sensor race counts on open/reload.
  if (stepProviderManager.usesVerifiedStepSource()) {
    logger.debug("StepStore", "skip native race hydrate — verified step source owns UI");
    return;
  }
  const nativeWalk = await stepTrackingNotificationService.getNativeStepState();
  if (
    nativeWalk?.notificationMode === "race_live" &&
    typeof nativeWalk.raceSteps === "number"
  ) {
    if (
      nativeWalk.userId &&
      current.userId &&
      nativeWalk.userId !== current.userId
    ) {
      return;
    }
    // Never hydrate steps from a previous race into a new active race.
    if (
      current.activeRaceId &&
      nativeWalk.activeRaceId &&
      nativeWalk.activeRaceId !== current.activeRaceId
    ) {
      logger.debug("StepStore", `skip native race hydrate — stale raceId native=${nativeWalk.activeRaceId} active=${current.activeRaceId}`);
      return;
    }
    if (!current.activeRaceId) {
      logger.debug("StepStore", "skip native race hydrate — no active race in store");
      return;
    }
    const updatedAt = new Date(
      nativeWalk.updatedAt ?? nativeWalk.lastUpdatedAt ?? Date.now(),
    ).toISOString();
    feedRaceStepsToStore({
      raceSteps: nativeWalk.raceSteps,
      stepSource: "sensor",
      updatedAt,
    });
    logger.debug("Login", `hydrating step state userId=${current.userId} raceSteps=${nativeWalk.raceSteps} source=native_fgs`);
    return;
  }

  const raw = await raceProgressNotificationService.getNativeRaceState();
  if (!raw) return;
  try {
    const json = JSON.parse(raw) as Record<string, unknown>;
    const nativeRaceId = typeof json.raceId === "string" ? json.raceId : null;
    if (
      current.activeRaceId &&
      nativeRaceId &&
      nativeRaceId !== current.activeRaceId
    ) {
      logger.debug("StepStore", `skip native race hydrate — stale raceId native=${nativeRaceId} active=${current.activeRaceId}`);
      return;
    }
    if (!current.activeRaceId) return;
    const stepSource = typeof json.stepSource === "string" ? json.stepSource : "";
    const isVerified =
      stepSource === "health_connect" ||
      stepSource === "android_health_connect" ||
      stepSource === "healthkit" ||
      stepSource === "ios_healthkit";
    // Native FGS may hold stale counts for verified sources when not in race_live mode.
    if (isVerified) {
      logger.debug("StepStore", "skip native hydrate — verified step source");
      return;
    }
    const raceSteps = typeof json.raceSteps === "number" ? json.raceSteps : undefined;
    const rank = typeof json.rank === "number" ? json.rank : undefined;
    const totalParticipants =
      typeof json.totalParticipants === "number" ? json.totalParticipants : undefined;
    const goalSteps = typeof json.goalSteps === "number" ? json.goalSteps : undefined;
    const timeLeftSeconds =
      typeof json.timeLeftSeconds === "number" ? json.timeLeftSeconds : undefined;
    if (raceSteps !== undefined) {
      hydrateRaceSteps(raceSteps);
    }
    if (rank !== undefined) {
      updateRankFromBackend({
        raceSteps,
        rank,
        totalParticipants,
        goalSteps,
        timeLeftSeconds,
        syncedAt: new Date().toISOString(),
      });
    }
    logger.debug("StepStore", `hydrated from native FGS raceSteps=${raceSteps} rank=${rank}`);
  } catch {
    /* non-fatal */
  }
}

export function setStepProgressUser(
  userId: string | null,
  username?: string | null,
): void {
  store.dispatch(raceProgressActions.setUserContext({ userId, username }));
  if (userId) {
    startWalkBackgroundStepPoll();
  }
}

/**
 * Ensure Redux has an active race entry so feedRaceStepsToStore updates Live UI.
 * Safe to call on every live-screen focus / re-enter / resume.
 */
export function ensureActiveRaceInStore(params: {
  raceId: string;
  raceStartTime: string;
  userId: string;
  username: string;
  goalSteps: number;
  totalParticipants?: number;
  bootSteps?: number;
  /**
   * Required for live race progress notification.
   * Callers must pass true only after confirming race_participants membership.
   */
  participantConfirmed: boolean;
  /** Keep previous activeRaceId as companion for sponsored dual-race sync. */
  preserveAsCompanion?: boolean;
  isSponsored?: boolean;
  /** free / coins_battle / cash / sponsored / unlimited_goal */
  raceType?: string | null;
  /** Sponsored / timed races — seeds native countdown chronometer. */
  challengeEndAt?: string | number | null;
  /** Unlimited Daily Goal — live-race tray notification without classic progress POSTs. */
  unlimitedDailyMode?: boolean;
}): void {
  if (!params.participantConfirmed) {
    stepCoordDebug(
      `[StepCoordinator] ensureActiveRaceInStore blocked — not a confirmed participant raceId=${params.raceId}`,
    );
    void suppressLiveRaceNotification(params.raceId, "not_confirmed_participant");
    return;
  }
  const boot = Math.max(0, Math.floor(params.bootSteps ?? 0));
  const s = store.getState().raceProgress;

  if (
    s.raceStatus === "active" &&
    s.activeRaceId === params.raceId &&
    s.userId === params.userId
  ) {
    const nextGoal =
      typeof params.goalSteps === "number" && params.goalSteps > 0
        ? params.goalSteps
        : null;
    const resolvedSponsored =
      params.isSponsored === true || s.activeRaceIsSponsored === true;
    const needSponsoredFix =
      resolvedSponsored && s.activeRaceIsSponsored !== true;
    const needGoalFix = nextGoal != null && nextGoal !== s.goalSteps;
    const incomingType = String(params.raceType ?? "").trim().toLowerCase();
    const storedType = String(s.activeRaceType ?? "").trim().toLowerCase();
    const resolvedType =
      incomingType ||
      storedType ||
      (resolvedSponsored ? "sponsored" : "free");
    const needTypeFix = !!incomingType && incomingType !== storedType;
    const incomingEndIso = (() => {
      if (params.challengeEndAt == null || params.challengeEndAt === "") return null;
      const iso =
        typeof params.challengeEndAt === "number"
          ? new Date(params.challengeEndAt).toISOString()
          : String(params.challengeEndAt);
      return Number.isNaN(new Date(iso).getTime()) ? null : iso;
    })();
    const needEndFix = !!incomingEndIso && incomingEndIso !== s.challengeEndAt;
    const challengeEndAt = incomingEndIso ?? undefined;

    if (needGoalFix || needSponsoredFix || needTypeFix || needEndFix) {
      store.dispatch(
        raceProgressActions.updateFromBackend({
          ...(needGoalFix && nextGoal != null ? { goalSteps: nextGoal } : {}),
          ...(needSponsoredFix ? { isSponsored: true } : {}),
          ...(needTypeFix ? { raceType: incomingType } : {}),
          ...(needEndFix && incomingEndIso ? { challengeEndAt: incomingEndIso } : {}),
          syncedAt: new Date().toISOString(),
        }),
      );
      void raceProgressNotificationService.onLocalRaceStepsUpdated(
        {
          raceId: params.raceId,
          userId: params.userId,
          username: params.username,
          raceSteps: Math.max(boot, s.raceSteps),
          rank: s.rank ?? 1,
          totalParticipants: params.totalParticipants ?? s.totalParticipants ?? 1,
          goalSteps: nextGoal ?? s.goalSteps ?? 0,
          timeLeftSeconds: s.timeLeftSeconds ?? 0,
          isSponsored: resolvedSponsored,
          raceType: resolvedType,
          ...(params.unlimitedDailyMode === true ? { unlimitedDailyMode: true } : {}),
          ...(challengeEndAt != null ? { challengeEndAt } : {}),
        },
        true,
      );
    } else if (challengeEndAt != null && resolvedSponsored) {
      // Re-seed native countdown/title anchors even when Redux already knows sponsored.
      void raceProgressNotificationService.onLocalRaceStepsUpdated(
        {
          raceId: params.raceId,
          userId: params.userId,
          username: params.username,
          raceSteps: Math.max(boot, s.raceSteps),
          rank: s.rank ?? 1,
          totalParticipants: params.totalParticipants ?? s.totalParticipants ?? 1,
          goalSteps: s.goalSteps ?? nextGoal ?? 0,
          timeLeftSeconds: s.timeLeftSeconds ?? 0,
          isSponsored: true,
          raceType: resolvedType,
          challengeEndAt,
        },
        true,
      );
    }
    if (boot > s.raceSteps) {
      store.dispatch(
        raceProgressActions.updateFromDeviceSource({
          raceSteps: boot,
          stepSource: mapProviderSource(),
          updatedAt: new Date().toISOString(),
        }),
      );
      scheduleNotificationUpdate(true);
    }

    // Redux says active but the notification service may have lost its session
    // (JS remount / deferred start never flushed). Restart rather than update-only.
    const notifActiveId = raceProgressNotificationService.getActiveRaceId();
    if (notifActiveId !== params.raceId) {
      const challengeEndAtRestart =
        params.challengeEndAt != null && params.challengeEndAt !== ""
          ? params.challengeEndAt
          : undefined;
      void raceProgressNotificationService.start(
        {
          raceId: params.raceId,
          userId: params.userId,
          username: params.username,
          raceSteps: Math.max(boot, store.getState().raceProgress.raceSteps),
          rank: store.getState().raceProgress.rank ?? 1,
          totalParticipants:
            params.totalParticipants ??
            store.getState().raceProgress.totalParticipants ??
            1,
          goalSteps:
            store.getState().raceProgress.goalSteps ?? nextGoal ?? 0,
          timeLeftSeconds: store.getState().raceProgress.timeLeftSeconds ?? 0,
          isSponsored: resolvedSponsored,
          raceType: resolvedType,
          ...(params.unlimitedDailyMode === true ? { unlimitedDailyMode: true } : {}),
          ...(challengeEndAtRestart != null
            ? { challengeEndAt: challengeEndAtRestart }
            : {}),
        },
        params.raceStartTime,
      );
      stepCoordDebug(
        `[StepCoordinator] ensureActiveRaceInStore restartNotif raceId=${params.raceId}`,
      );
    }

    stepCoordDebug(
      `[StepCoordinator] ensureActiveRaceInStore ok raceId=${params.raceId} raceSteps=${store.getState().raceProgress.raceSteps} goal=${store.getState().raceProgress.goalSteps} sponsored=${store.getState().raceProgress.activeRaceIsSponsored}`,
    );
    return;
  }

  setActiveRaceProgress({
    ...params,
    bootSteps: boot,
    freshStart: false,
    participantConfirmed: true,
    unlimitedDailyMode: params.unlimitedDailyMode === true,
  });
  stepCoordDebug(
    `[StepCoordinator] ensureActiveRaceInStore activated raceId=${params.raceId} bootSteps=${boot} unlimitedDailyMode=${params.unlimitedDailyMode === true}`,
  );
}

export function setActiveRaceProgress(params: {
  raceId: string;
  raceStartTime: string;
  userId: string;
  username: string;
  goalSteps: number;
  totalParticipants?: number;
  bootSteps?: number;
  /** When true (default), stale race steps from a previous match are discarded. */
  freshStart?: boolean;
  /**
   * Required for live race progress notification.
   * Must be true only for confirmed race_participants.
   */
  participantConfirmed: boolean;
  preserveAsCompanion?: boolean;
  isSponsored?: boolean;
  raceType?: string | null;
  challengeEndAt?: string | number | null;
  /**
   * Unlimited Daily Goal Challenge: start the same live-race ongoing notification
   * as classic/sponsored, while classic /api/races/:id/progress stays blocked.
   */
  unlimitedDailyMode?: boolean;
}): void {
  if (!params.participantConfirmed) {
    stepCoordDebug(
      `[StepCoordinator] setActiveRaceProgress blocked — not a confirmed participant raceId=${params.raceId}`,
    );
    void suppressLiveRaceNotification(params.raceId, "not_confirmed_participant");
    return;
  }
  // Unlimited challenge IDs are allowed to own the live-race ongoing notification
  // (same tray as classic / sponsored once the challenge starts). Classic sensor
  // progress POSTs remain blocked separately in raceProgressApi + RaceContext.
  try {
    const { registerUnlimitedClassicProgressBlock } = require(
      "@/services/unlimitedRaceProgressGuard",
    ) as typeof import("@/services/unlimitedRaceProgressGuard");
    // Keep the progress-POST block registered whenever this id is Unlimited-owned.
    // (No-op for classic races — callers only pass Unlimited ids through the
    // Unlimited live-detail path.)
    if (params.unlimitedDailyMode === true) {
      // Preserve any day/timezone context already registered (matchmaking / live-detail).
      registerUnlimitedClassicProgressBlock(params.raceId);
    }
  } catch {
    /* optional */
  }
  const freshStart = params.freshStart !== false;
  const prev = store.getState().raceProgress;
  const prevActiveId = prev.activeRaceId;
  // Same-race rejoin/continuation: never boot below an already-tracked floor for this user.
  const continuedFloor =
    !freshStart &&
    prevActiveId === params.raceId &&
    prev.userId === params.userId &&
    typeof prev.raceSteps === "number"
      ? Math.max(0, Math.floor(prev.raceSteps))
      : 0;
  const boot = freshStart
    ? 0
    : Math.max(0, params.bootSteps ?? 0, continuedFloor);
  // Prefer an already-known goal for the same race over RaceContext's default 1000
  // when resume/start races the notification before targetSteps was synced.
  let resolvedGoal = Math.max(0, params.goalSteps || 0);
  let resolvedSponsored = params.isSponsored === true;
  if (
    prevActiveId === params.raceId &&
    prev.raceStatus === "active" &&
    typeof prev.goalSteps === "number" &&
    prev.goalSteps > 0
  ) {
    if (resolvedGoal <= 0) {
      resolvedGoal = prev.goalSteps;
    } else if (resolvedGoal === 1000 && prev.goalSteps !== 1000) {
      resolvedGoal = prev.goalSteps;
    }
  }
  // Never let RaceContext rejoin wipe sponsored → live title.
  if (
    prevActiveId === params.raceId &&
    prev.raceStatus === "active" &&
    prev.activeRaceIsSponsored
  ) {
    resolvedSponsored = true;
  }
  // Avoid flashing a hard-coded "1 participant" placeholder in the ongoing
  // notification while the real roster count is still loading. When this is
  // the same race resuming (app relaunch, screen remount), the last known
  // count is almost always still accurate and far better than "1"; the very
  // next backend/roster update (onLocalRaceStepsUpdated / updateRankFromBackend)
  // corrects it either way, so this only smooths the brief startup flash.
  const resolvedTotalParticipants =
    params.totalParticipants ??
    (prevActiveId === params.raceId && (prev.totalParticipants ?? 0) > 1
      ? prev.totalParticipants
      : undefined) ??
    1;
  const prevCompanionSnapshot =
    params.preserveAsCompanion &&
    prevActiveId &&
    prevActiveId !== params.raceId &&
    prev.raceStatus === "active"
      ? {
          raceId: prevActiveId,
          userId: prev.userId ?? params.userId,
          username: prev.username ?? params.username,
          raceSteps: prev.raceSteps,
          rank: prev.rank ?? 1,
          totalParticipants: prev.totalParticipants ?? 1,
          goalSteps: prev.goalSteps && prev.goalSteps > 0 ? prev.goalSteps : resolvedGoal,
          timeLeftSeconds: prev.timeLeftSeconds ?? 0,
          raceStartTime: prev.raceStartTime,
          isSponsored: prev.activeRaceIsSponsored === true,
          raceType: prev.activeRaceType ?? undefined,
          challengeEndAt: undefined as string | number | undefined,
        }
      : null;

  raceStepSyncService.reset();
  if (!freshStart && boot > 0) {
    raceStepSyncService.seedSyncedSteps(boot);
  }
  store.dispatch(raceProgressActions.resetRaceStepBuffer());
  store.dispatch(
    raceProgressActions.setActiveRace({
      ...params,
      goalSteps: resolvedGoal,
      bootSteps: boot,
      preserveAsCompanion: params.preserveAsCompanion === true,
      isSponsored: resolvedSponsored,
    }),
  );
  activeChallengeSync.register(params.raceId);
  if (params.preserveAsCompanion) {
    const companionId = store.getState().raceProgress.companionRaceId;
    if (companionId) activeChallengeSync.register(companionId);
  }

  const challengeEndAt =
    params.challengeEndAt != null && params.challengeEndAt !== ""
      ? params.challengeEndAt
      : undefined;

  void raceProgressNotificationService.start(
    {
      raceId: params.raceId,
      userId: params.userId,
      username: params.username,
      raceSteps: boot,
      rank: 1,
      totalParticipants: resolvedTotalParticipants,
      goalSteps: resolvedGoal,
      timeLeftSeconds: 0,
      isSponsored: resolvedSponsored,
      ...(params.raceType ? { raceType: params.raceType } : {}),
      ...(params.unlimitedDailyMode === true ? { unlimitedDailyMode: true } : {}),
      ...(challengeEndAt != null ? { challengeEndAt } : {}),
    },
    params.raceStartTime,
  );

  // Demoted previous race keeps an ongoing tray notification (id 1002).
  if (prevCompanionSnapshot) {
    void raceProgressNotificationService.startParallel(
      {
        raceId: prevCompanionSnapshot.raceId,
        userId: prevCompanionSnapshot.userId,
        username: prevCompanionSnapshot.username,
        raceSteps: prevCompanionSnapshot.raceSteps,
        rank: prevCompanionSnapshot.rank,
        totalParticipants: prevCompanionSnapshot.totalParticipants,
        goalSteps: prevCompanionSnapshot.goalSteps,
        timeLeftSeconds: prevCompanionSnapshot.timeLeftSeconds,
        isSponsored: prevCompanionSnapshot.isSponsored,
        ...(prevCompanionSnapshot.raceType
          ? { raceType: prevCompanionSnapshot.raceType }
          : {}),
        ...(prevCompanionSnapshot.challengeEndAt != null
          ? { challengeEndAt: prevCompanionSnapshot.challengeEndAt }
          : {}),
      },
      prevCompanionSnapshot.raceStartTime ?? undefined,
    );
  }

  scheduleNotificationUpdate(true);
}

/**
 * Force-stop the local live-race notification for a race (and clear Redux if it owns that race).
 * Used for spectators and stale native FGS race_live leftovers.
 */
export async function suppressLiveRaceNotification(
  raceId: string | null | undefined,
  reason = "suppress",
): Promise<void> {
  if (!raceId) return;
  const s = store.getState().raceProgress;
  const todaySteps = s.todaySteps;
  if (s.activeRaceId === raceId) {
    store.dispatch(
      raceProgressActions.clearActiveRace({
        status: "cancelled",
      }),
    );
  }
  try {
    await raceProgressNotificationService.stop(raceId, reason, todaySteps);
    stepCoordDebug(
      `[StepCoordinator] suppressLiveRaceNotification raceId=${raceId} reason=${reason}`,
    );
  } catch (err) {
    logger.warn("StepCoordinator", "suppressLiveRaceNotification failed", err);
  }
}

/**
 * Spectator opened a race: stop notification for that race, and clear any orphan
 * native race_live if the user is not currently an active participant in Redux.
 * Does not clear a different race the user is actually racing.
 */
export async function suppressSpectatorLiveRaceNotifications(
  viewedRaceId: string,
): Promise<void> {
  await suppressLiveRaceNotification(viewedRaceId, "spectator_view");
  const s = store.getState().raceProgress;
  if (s.raceStatus === "active" && s.activeRaceId && s.activeRaceId !== viewedRaceId) {
    return;
  }
  try {
    const raw = await raceProgressNotificationService.getNativeRaceState();
    if (!raw) return;
    const json = JSON.parse(raw) as Record<string, unknown>;
    const nativeRaceId = typeof json.raceId === "string" ? json.raceId : null;
    if (nativeRaceId && nativeRaceId !== s.activeRaceId) {
      await suppressLiveRaceNotification(nativeRaceId, "spectator_orphan_native");
      if (s.userId) {
        await switchDailyStepsNotification(Math.max(0, s.todaySteps));
      }
    }
  } catch {
    /* non-fatal */
  }
}

/** Stop any native race_live notification when the user has no active race participation. */
export async function suppressOrphanLiveRaceNotification(
  reason = "orphan_native_race",
): Promise<void> {
  const s = store.getState().raceProgress;
  const todaySteps = s.todaySteps;
  try {
    const raw = await raceProgressNotificationService.getNativeRaceState();
    if (raw) {
      const json = JSON.parse(raw) as Record<string, unknown>;
      const nativeRaceId = typeof json.raceId === "string" ? json.raceId : null;
      if (nativeRaceId) {
        await raceProgressNotificationService.stop(nativeRaceId, reason, todaySteps);
      }
    }
  } catch {
    /* non-fatal */
  }
  if (s.activeRaceId) {
    store.dispatch(
      raceProgressActions.clearActiveRace({
        status: "cancelled",
      }),
    );
    await raceProgressNotificationService.stop(s.activeRaceId, reason, todaySteps);
  } else {
    await raceProgressNotificationService.stopAll(todaySteps, reason);
  }
  if (s.userId) {
    await switchDailyStepsNotification(Math.max(0, todaySteps));
  }
}

export function clearActiveRaceProgress(
  status: RaceProgressStatus,
  options?: { preserveWalkDisplay?: number; raceId?: string },
): void {
  const s = store.getState().raceProgress;
  const raceIdToStop = options?.raceId ?? s.activeRaceId;
  const companionId = s.companionRaceId;
  const walkFloor = resolveWalkNotificationSteps({
    verifiedTodaySteps: s.verifiedTodaySteps ?? 0,
    provisionalSensorTodaySteps: s.provisionalSensorTodaySteps,
    todaySteps: Math.max(s.todaySteps, options?.preserveWalkDisplay ?? 0),
  });

  store.dispatch(
    raceProgressActions.clearActiveRace({
      status,
      preserveWalkDisplay: options?.preserveWalkDisplay,
    }),
  );
  if (raceIdToStop) activeChallengeSync.unregister(raceIdToStop);
  if (companionId) activeChallengeSync.unregister(companionId);

  void (async () => {
    // Re-read at stop time — Walk/HC may have advanced while the race was ending.
    const latest = store.getState().raceProgress;
    const walkSteps = resolveWalkNotificationSteps({
      verifiedTodaySteps: latest.verifiedTodaySteps ?? 0,
      provisionalSensorTodaySteps: latest.provisionalSensorTodaySteps,
      todaySteps: Math.max(
        latest.todaySteps,
        walkFloor,
        options?.preserveWalkDisplay ?? 0,
      ),
    });
    if (companionId) {
      await raceProgressNotificationService.stopParallel(companionId);
    }
    if (raceIdToStop) {
      await raceProgressNotificationService.stop(raceIdToStop, status, walkSteps);
      stepEngineLog(
        "RaceComplete",
        `dismissedNotification=true raceId=${raceIdToStop} status=${status}`,
      );
    }
    if (s.userId) {
      await switchDailyStepsNotification(walkSteps);
    }
  })();
}

/**
 * Push daily-steps notification after race ends — does not stop the foreground service.
 *
 * `dailyGoalOverride` lets an active Unlimited Daily Goal Challenge show ITS OWN
 * per-day goal (which can differ from the user's general Walk profile goal in
 * `raceProgress.dailyGoal`) so the ongoing tray notification reads "X / challenge
 * goal" instead of silently substituting an unrelated personal target.
 */
export async function switchDailyStepsNotification(
  todaySteps?: number,
  dailyGoalOverride?: number,
): Promise<void> {
  const s = store.getState().raceProgress;
  if (!s.userId) return;
  // Prefer live resolved total (verified + provisional). Optional todaySteps arg is
  // only a floor when callers captured a higher Walk-UI value before Redux caught up.
  const resolved = resolveWalkNotificationSteps({
    verifiedTodaySteps: s.verifiedTodaySteps ?? 0,
    provisionalSensorTodaySteps: s.provisionalSensorTodaySteps,
    todaySteps: Math.max(
      s.todaySteps,
      Math.max(0, Math.floor(todaySteps ?? 0)),
    ),
    raceActive: s.raceStatus === "active" || !!s.companionRaceId,
  });
  const goal =
    typeof dailyGoalOverride === "number" && dailyGoalOverride > 0
      ? Math.floor(dailyGoalOverride)
      : s.dailyGoal > 0
        ? s.dailyGoal
        : 10_000;
  // Invalidate same-step throttle so we always re-sync native after race teardown
  // (native SWITCH_TO_WALK may have briefly written a stale low body).
  lastWalkNotificationSteps = -1;
  await stepTrackingNotificationService.mirrorWalkScreen({
    userId: s.userId,
    todaySteps: resolved,
    dailyGoal: goal,
  });
  lastWalkNotificationSteps = resolved;
  lastWalkNotificationPushMs = Date.now();
  logger.debug(
    "NotificationMode",
    `switch race_live -> daily_steps todaySteps=${resolved} goal=${goal}`,
  );
}

export function updateStepProgressFromSource(params: {
  todaySteps?: number;
  raceSteps?: number;
  stepSource?: StepProgressSource;
  updatedAt?: string;
  deviceTotalSteps?: number;
  atTarget?: boolean;
}): void {
  updateStepProgressFromRealSource(params);
}

export function updateRankFromBackend(params: {
  raceSteps?: number;
  rank?: number;
  totalParticipants?: number;
  goalSteps?: number;
  timeLeftSeconds?: number;
  syncedAt?: string;
}): void {
  store.dispatch(raceProgressActions.updateFromBackend(params));
  scheduleNotificationUpdate(true);
}

export function resetRaceStepBuffer(): void {
  store.dispatch(raceProgressActions.resetRaceStepBuffer());
}

export function hydrateRaceSteps(raceSteps: number, updatedAt?: string): void {
  store.dispatch(
    raceProgressActions.hydrateRaceSteps({ raceSteps, updatedAt }),
  );
  scheduleNotificationUpdate(true);
  void syncRaceProgressToBackend({ force: true });
}

export function setWalkRaceStepsDisplay(steps: number): void {
  store.dispatch(raceProgressActions.setWalkRaceStepsDisplay(steps));
}

export function syncRaceProgressToBackend(options?: {
  force?: boolean;
  atTarget?: boolean;
  deviceTotalSteps?: number;
}): void {
  const s = store.getState().raceProgress;
  if (!s.activeRaceId || s.raceStatus !== "active") {
    stepEngineLog(
      "Sync",
      `skippedCompletedRace=true raceId=${s.activeRaceId ?? "none"} status=${s.raceStatus}`,
    );
    return;
  }

  store.dispatch(raceProgressActions.setSyncing(true));

  const source =
    s.stepSource === "health_connect" || s.stepSource === "android_health_connect"
      ? "health_connect"
      : s.stepSource === "healthkit" || s.stepSource === "ios_healthkit"
        ? "healthkit"
        : s.stepSource === "sensor" || s.stepSource === "android_step_counter"
          ? "android_step_counter"
          : stepProviderManager.toRaceProgressSource();

  const resolveCompanionDeviceTotal = (explicit?: number): number => {
    if (explicit != null && Number.isFinite(explicit) && explicit > 0) {
      return Math.floor(explicit);
    }
    // Never default to display merge (max verified/provisional).
    if (isAcceptedLiveRaceSource(source)) {
      const provisional = s.provisionalSensorTodaySteps;
      if (provisional != null && provisional > 0) {
        return Math.floor(provisional);
      }
    }
    return Math.max(0, Math.floor(s.verifiedTodaySteps ?? 0));
  };

  logger.debug("RaceSync", `send raceId=${s.activeRaceId} raceSteps=${s.raceSteps}`);

  if (options?.atTarget) {
    void raceStepSyncService.flushGoal(
      s.activeRaceId,
      s.raceSteps,
      source,
      options.deviceTotalSteps,
    );
    const companionIds = new Set<string>(activeChallengeSync.getRaceIds());
    if (s.companionRaceId) companionIds.add(s.companionRaceId);
    companionIds.delete(s.activeRaceId);
    const deviceTotal = resolveCompanionDeviceTotal(options.deviceTotalSteps);
    if (deviceTotal > 0) {
      for (const raceId of companionIds) {
        void postRaceProgress(raceId, 0, undefined, deviceTotal, source).catch(() => {});
      }
    }
    return;
  }

  raceStepSyncService.notifyStepsUpdated(
    s.activeRaceId,
    s.raceSteps,
    source,
    {
      force: options?.force,
      deviceTotalSteps: options?.deviceTotalSteps,
      trackingSessionId: s.liveRaceSessionId ?? undefined,
    },
  );

  // Dual / multi-challenge: mirror device totals into every other active
  // participation (sponsored + free/coins + multi-day). Primary race already
  // went through raceStepSyncBuffer above. Backend derives each room's
  // race-relative steps from raceBaselineSteps + deviceTotalSteps.
  const companionIds = new Set<string>(activeChallengeSync.getRaceIds());
  if (s.companionRaceId) companionIds.add(s.companionRaceId);
  companionIds.delete(s.activeRaceId);
  const deviceTotal = resolveCompanionDeviceTotal(options?.deviceTotalSteps);
  const nowMs = Date.now();
  const companionDue =
    options?.force === true || nowMs - lastCompanionSyncMs >= COMPANION_SYNC_MIN_MS;
  if (deviceTotal > 0 && companionIds.size > 0 && companionDue) {
    lastCompanionSyncMs = nowMs;
    for (const raceId of companionIds) {
      void postRaceProgress(raceId, 0, undefined, deviceTotal, source).catch(() => {});
    }
  }
}

export function getRaceProgressState() {
  return store.getState().raceProgress;
}

// ── Lightweight helpers for RaceContext ────────────────────────────────────────
// These helpers let RaceContext feed the canonical Redux store without triggering
// the notification-start or backend-sync side-effects that the full coordinator
// functions include. RaceContext owns those responsibilities itself.

/**
 * Register a race in the canonical Redux store.
 * Does NOT start the notification or seed the sync service — RaceContext already
 * does both of those. This just keeps Redux in sync so live-detail and any
 * Redux consumer always has the latest race metadata.
 */
export function activateRaceInStore(params: {
  raceId: string;
  raceStartTime: string;
  userId: string;
  username: string;
  goalSteps: number;
  totalParticipants?: number;
  bootSteps?: number;
}): void {
  store.dispatch(raceProgressActions.setActiveRace(params));
  logger.debug("StepStore", `activateRaceInStore raceId=${params.raceId} bootSteps=${params.bootSteps ?? 0}`);
}

/**
 * Push a live race step value into the canonical Redux store and schedule a
 * throttled notification update.  Does NOT trigger a backend sync — RaceContext
 * drives that via RaceStepSyncBuffer so there is no double-send.
 */
export function feedRaceStepsToStore(params: {
  raceSteps: number;
  stepSource?: StepProgressSource;
  updatedAt?: string;
}): void {
  const s = store.getState().raceProgress;
  const next = Math.max(0, Math.floor(params.raceSteps));
  if (next === s.raceSteps) {
    logger.debug("StepCoordinator", `skip feedRaceStepsToStore unchanged raceSteps=${next}`);
    return;
  }
  const source = params.stepSource ?? mapProviderSource();
  const updatedAt = params.updatedAt ?? new Date().toISOString();
  store.dispatch(
    raceProgressActions.updateFromDeviceSource({
      todaySteps: s.todaySteps,
      raceSteps: params.raceSteps,
      stepSource: source,
      updatedAt,
    }),
  );
  if (__DEV__) {
    logger.debug("StepCoordinator", `updateStepProgressFromSource raceId=${s.activeRaceId} raceSteps=${params.raceSteps} source=${source}`);
    logger.debug("LiveRaceUI", `canonical store raceSteps=${params.raceSteps}`);
  }
  scheduleNotificationUpdate(false);
}

/**
 * Clear the active race from the canonical Redux store.
 * Does NOT touch the notification services — RaceContext (or the
 * raceStepSyncService.setProgressSyncedHandler path) is responsible for
 * stopping / switching notifications.
 */
export function deactivateRaceInStore(
  status: RaceProgressStatus,
  preserveWalkDisplay?: number,
): void {
  const prevId = store.getState().raceProgress.activeRaceId;
  store.dispatch(
    raceProgressActions.clearActiveRace({ status, preserveWalkDisplay }),
  );
  if (prevId) activeChallengeSync.unregister(prevId);
  logger.debug("StepStore", `deactivateRaceInStore status=${status}`);
}

export function handleBackendProgressSynced(result: {
  ok: boolean;
  raceId: string;
  acceptedSteps: number;
  rank?: number;
  totalParticipants?: number;
  goalSteps?: number;
  timeLeftSeconds?: number;
  username?: string;
  userId?: string;
  raceStatus?: string;
}): void {
  if (!result.ok || result.rank === undefined) {
    store.dispatch(raceProgressActions.setSyncing(false));
    return;
  }

  updateRankFromBackend({
    raceSteps: result.acceptedSteps,
    rank: result.rank,
    totalParticipants: result.totalParticipants,
    goalSteps: result.goalSteps,
    timeLeftSeconds: result.timeLeftSeconds,
    syncedAt: new Date().toISOString(),
  });

  const s = store.getState().raceProgress;
  void raceProgressNotificationService.onBackendProgressSynced({
    raceId: result.raceId,
    userId: result.userId ?? s.userId ?? "",
    username: result.username ?? s.username ?? "Runner",
    raceSteps: s.raceSteps,
    rank: result.rank,
    totalParticipants: result.totalParticipants ?? s.totalParticipants ?? 1,
    goalSteps: result.goalSteps ?? s.goalSteps ?? 0,
    timeLeftSeconds: result.timeLeftSeconds ?? s.timeLeftSeconds ?? 0,
    raceStatus: result.raceStatus ?? "in_progress",
    lastSyncedAt: new Date().toISOString(),
  });
}

/**
 * Session epoch — login bumps this so an in-flight logout clear cannot wipe
 * Redux / LAST_STEP_USER_ID after the new session has already rebound.
 */
let _stepSessionEpoch = 0;

export function bumpStepSessionEpoch(): number {
  _stepSessionEpoch += 1;
  return _stepSessionEpoch;
}

export function getStepSessionEpoch(): number {
  return _stepSessionEpoch;
}

/** Wipe step cache so another account cannot inherit counts. */
export async function clearLocalStepStorageForAccountSwitch(
  userId?: string,
  opts?: { reason?: "logout" | "account_switch"; epoch?: number },
): Promise<void> {
  const epoch = opts?.epoch;
  const stillCurrent = () =>
    epoch == null || epoch === getStepSessionEpoch();

  stopWalkBackgroundStepPoll();
  nativeWalkRefreshUnsubscribe?.();
  nativeWalkRefreshUnsubscribe = null;
  lastKnownTrackingDate = null;
  lastWalkNotificationSteps = -1;
  lastWalkNotificationPushMs = 0;

  const reason = opts?.reason ?? "account_switch";
  // Keep today's scoped daily steps for this userId on both logout and account_switch.
  // Race/session keys are still wiped. The next bind for THIS user can restore Walk
  // from steps:{userId}:{date}. The OTHER account never reads these keys.
  const preserveDailyProgress = !!userId;

  logger.debug(
    "AuthSwitch",
    `clearing step state userId=${userId ?? "unknown"} reason=${reason} preserveDaily=${preserveDailyProgress}`,
  );
  stepEngineLog("AuthSwitch", "clearedStepState=true");

  if (!stillCurrent()) {
    logger.debug("AuthSwitch", "aborted storage clear — newer step session");
    return;
  }

  await Promise.all([
    userId
      ? clearScopedStepStateForUser(userId, { preserveDailyProgress })
      : Promise.resolve(),
    deleteLegacyUnscopedStepKeys(),
    storageRemove(STORAGE_KEYS.PENDING_RACE),
    userId
      ? storageRemove(`${STORAGE_KEYS.PENDING_RACE}:${userId}`)
      : Promise.resolve(),
    // Keep LAST_STEP_USER_ID on logout so the next login can detect same-user
    // re-login vs account switch. Clearing it made the next user inherit native
    // daily totals (~1.6K) via mergeNative. Only clear on true account_switch
    // after the new user id is already known (bindStepSessionToUser handles that).
    reason === "account_switch" && stillCurrent()
      ? storageRemove(STORAGE_KEYS.LAST_STEP_USER_ID)
      : Promise.resolve(),
    clearWalkStepsOutbox(),
  ]);

  if (!stillCurrent()) {
    logger.debug("AuthSwitch", "aborted redux reset — newer step session");
    return;
  }

  store.dispatch(raceProgressActions.resetStepStateForLogout());
  store.dispatch(raceProgressActions.clearRaceStepStateForAccountSwitch());
  store.dispatch(walkActions.setTodaySteps(0));
  store.dispatch(walkActions.setWeeklySteps(0));
  store.dispatch(walkActions.setAllTimeSteps(0));
  store.dispatch(walkActions.setCurrentStreak(0));

  try {
    const { stopHybridLiveDailyDisplay } = await import(
      "@/services/steps/hybridLiveDailyDisplay"
    );
    stopHybridLiveDailyDisplay();
  } catch {
    /* optional */
  }
  try {
    const { resetUnlimitedProvisionalUploadState } = await import(
      "@/services/unlimitedProvisionalProgressApi"
    );
    resetUnlimitedProvisionalUploadState();
  } catch {
    /* optional */
  }
  try {
    const { clearUnlimitedClassicProgressBlocks } = await import(
      "@/services/unlimitedRaceProgressGuard"
    );
    clearUnlimitedClassicProgressBlocks();
  } catch {
    /* optional */
  }

  if (Platform.OS === "android") {
    try {
      const {
        clearAndroidLegacySensorScopedState,
        setAndroidLegacySensorUserContext,
      } = await import("@/services/steps/providers/androidLegacySensorProvider");
      // Don't wipe legacy sensor daily totals on same-user logout — Walk needs them.
      if (userId && !preserveDailyProgress) {
        await clearAndroidLegacySensorScopedState(userId);
      }
      if (stillCurrent()) {
        setAndroidLegacySensorUserContext(null);
      }
    } catch {
      // non-fatal
    }
    try {
      const { androidHCService } = await import(
        "@/services/steps/androidHealthConnectService"
      );
      // Keep HC in-memory cache on logout so re-login doesn't flash 0 while HC reloads.
      if (!preserveDailyProgress) {
        androidHCService.resetTodayStepCache();
      }
    } catch {
      // non-fatal
    }
  }
}

/**
 * Centralized cleanup when logging out or switching accounts.
 * Stops native services, cancels in-flight requests, clears caches for the old user.
 */
export async function clearUserSessionStepState(
  oldUserId: string | undefined,
  reason: "logout" | "account_switch" = "account_switch",
  opts?: { epoch?: number },
): Promise<void> {
  const epoch = opts?.epoch;
  const stillCurrent = () =>
    epoch == null || epoch === getStepSessionEpoch();

  logger.debug("AuthSwitch", `clearing old step state oldUserId=${oldUserId ?? "unknown"} reason=${reason}`);

  try {
    const { stepPollingService } = await import("@/services/StepPollingService");
    stepPollingService.stopPolling(reason);
  } catch {
    // non-fatal
  }

  try {
    const { raceStepSyncService } = await import("@/services/RaceStepSyncService");
    raceStepSyncService.cancelPending();
  } catch {
    // non-fatal
  }

  await queryClient.cancelQueries();
  clearUserSessionQueryCache(oldUserId);

  if (!stillCurrent()) {
    logger.debug("AuthSwitch", "aborted session clear — newer step session");
    return;
  }

  if (reason === "logout") {
    await raceProgressNotificationService.stopAll(0, "logout");
    if (Platform.OS === "android" && oldUserId) {
      logger.debug("StepService", "stopped for old user");
      // Same-user logout: stop FGS/notif but keep native daily totals so Walk
      // can restore immediately on re-login (notif already had live counts).
      await stepTrackingNotificationService.stop();
    }
  } else if (oldUserId) {
    await raceProgressNotificationService.stopAll(0, "account_switch");
    if (Platform.OS === "android") {
      logger.debug("StepService", "stopped for old user");
      await stepTrackingNotificationService.clearNativeStepStateForUser(oldUserId);
      await stepTrackingNotificationService.stop();
    }
  }

  if (!stillCurrent()) {
    logger.debug("AuthSwitch", "aborted after native stop — newer step session");
    return;
  }

  await clearLocalStepStorageForAccountSwitch(oldUserId, { reason, epoch });
}

/**
 * Bind the local step cache to the signed-in user. Clears stale data when the
 * account changes (logout/login or direct account switch).
 */
export async function bindStepSessionToUser(userId: string): Promise<boolean> {
  // Invalidate any in-flight logout clear so it cannot wipe Redux after hydrate.
  bumpStepSessionEpoch();

  try {
    const {
      clearSignedOutLegacySensorState,
      setAndroidLegacySensorUserContext,
    } = await import(
      "@/services/steps/providers/androidLegacySensorProvider"
    );
    await clearSignedOutLegacySensorState();
    setAndroidLegacySensorUserContext(userId);
  } catch {
    // non-fatal
  }

  const lastUserId = await storageGet<string>(STORAGE_KEYS.LAST_STEP_USER_ID);
  const switched = !!lastUserId && lastUserId !== userId;
  if (switched) {
    logger.debug("AuthSwitch", `oldUserId=${lastUserId} newUserId=${userId}`);
    await clearUserSessionStepState(lastUserId, "account_switch");
    if (Platform.OS === "android") {
      try {
        const { androidHCService } = await import(
          "@/services/steps/androidHealthConnectService"
        );
        const { invalidateAndroidStepTrackingStatusCache } = await import(
          "@/services/steps/androidStepTrackingStatus"
        );
        androidHCService.invalidatePermissionCache();
        stepProviderManager.invalidateStatusCache();
        invalidateAndroidStepTrackingStatusCache();
      } catch {
        /* non-fatal */
      }
      try {
        await scrubStaleNativeDailyBeforeEnable(userId, 0);
      } catch {
        /* non-fatal */
      }
    }
  } else if (!lastUserId && Platform.OS === "android") {
    // Fresh bind after a session gap — drop untagged native totals so Account B
    // cannot inherit Account A's FGS daily count.
    try {
      const native = await stepTrackingNotificationService.getNativeStepState();
      if (native && (!native.userId || native.userId !== userId)) {
        await stepTrackingNotificationService.clearNativeStepStateForUser(
          native.userId || "unknown",
        );
        await stepTrackingNotificationService.stop();
      } else if (native) {
        await scrubStaleNativeDailyBeforeEnable(userId, 0);
      }
    } catch {
      /* non-fatal */
    }
  }
  await deleteLegacyUnscopedStepKeys();
  await storageSet(STORAGE_KEYS.LAST_STEP_USER_ID, userId);
  logger.debug("StepService", `started for new user userId=${userId}`);
  const today = getLocalDateStr();
  suppressLegacyStepBumps(12_000);

  const {
    beginVerifiedAccountStepIsolation,
    clearVerifiedAccountStepIsolation,
  } = await import("@/services/steps/verifiedAccountStepIsolation");
  // Same-user re-login: HC stays authoritative. Account switch: isolate.
  clearVerifiedAccountStepIsolation();

  // Always prefer THIS account's durable daily cache (keyed by userId).
  // Never force 0 on account switch — that wiped restored totals after A→B→A.
  // mergeNative only when same-user re-login (avoid inheriting prior account FGS).
  let cachedBoot = await readDailyStepsForUserDate(userId, today).catch(() => 0);
  const scoped = stepScopedKeys(userId, today);
  const lastSynced =
    (await storageGet<number>(scoped.lastSyncedStepsCount).catch(() => 0)) ?? 0;
  let bootSteps = cachedBoot;

  if (switched && stepProviderManager.usesVerifiedStepSource()) {
    // Device HC/HK is shared across logins on one phone. Never boot the new
    // account from the live device total — only from what THIS account already
    // synced. Post-bind walking is attributed as a delta from the HC baseline.
    let providerBaseline = 0;
    try {
      const data = await stepProviderManager.getTodayStepsForBackgroundPoll();
      providerBaseline = Math.max(0, data?.steps ?? 0);
    } catch {
      providerBaseline = 0;
    }
    // Trust backend watermark only. Local cache may contain the previous
    // account's device HC total written under this userId by older builds.
    bootSteps = Math.max(0, lastSynced);
    if (cachedBoot !== bootSteps) {
      await writeDailyStepsForUserDate(userId, today, bootSteps, {
        forceZero: bootSteps === 0,
        immediate: true,
      }).catch(() => {});
    }
    beginVerifiedAccountStepIsolation({
      userId,
      localDate: today,
      accountFloor: bootSteps,
      providerBaseline,
    });
    stepEngineLog(
      "AuthSwitch",
      `verifiedIsolation userId=${userId} floor=${bootSteps} hcBaseline=${providerBaseline} lastSynced=${lastSynced}`,
    );
  } else if (stepProviderManager.usesVerifiedStepSource()) {
    bootSteps = await resolveAuthoritativeTodaySteps(userId, {
      mergeNative: false,
      ignoreProvider: false,
    }).catch(() => 0);
    // Only drop a huge local absolute after midnight — never on a same-day
    // re-login when Health Connect briefly returns 0.
    if (
      bootSteps === 0 &&
      isFreshLocalDay() &&
      (cachedBoot > 250 || lastSynced > 250)
    ) {
      await writeDailyStepsForUserDate(userId, today, 0, {
        forceZero: true,
        immediate: true,
      }).catch(() => {});
      await storageSet(scoped.lastSyncedStepsCount, 0).catch(() => {});
      if (Platform.OS === "android") {
        try {
          await stepTrackingNotificationService.resetDailyStepsForNewDay();
        } catch {
          /* non-fatal */
        }
      }
      stepEngineLog(
        "StepEngine",
        `bind clearedInflatedCache local=${cachedBoot} lastSynced=${lastSynced} userId=${userId} localDate=${today}`,
      );
    }
  } else {
    bootSteps = Math.max(
      cachedBoot,
      await resolveAuthoritativeTodaySteps(userId, {
        mergeNative: !switched,
        ignoreProvider: false,
      }).catch(() => cachedBoot),
    );
  }
  // Ensure Redux is empty of any prior account before boot (logout may race).
  if (switched || store.getState().raceProgress.userId !== userId) {
    store.dispatch(raceProgressActions.resetStepStateForLogout());
  } else if (
    stepProviderManager.usesVerifiedStepSource() &&
    bootSteps === 0 &&
    Math.max(
      store.getState().raceProgress.todaySteps,
      store.getState().raceProgress.verifiedTodaySteps,
    ) > 250
  ) {
    // Same user, fresh HC day — drop a polluted sensor absolute left in Redux.
    store.dispatch(
      raceProgressActions.resetDailyStepsForNewDay({
        todaySteps: 0,
        updatedAt: new Date().toISOString(),
      }),
    );
  }
  store.dispatch(
    raceProgressActions.initializeStepsForUserDate({
      userId,
      localDate: today,
      bootTodaySteps: bootSteps,
    }),
  );
  if (switched) {
    // If the new account is in a live race, RaceContext restores the race
    // notification immediately after reset — skip daily walk notif flash.
    const live = await fetchMyActiveInProgressRace(userId);
    if (!live) {
      void pushWalkNotificationFromCanonicalStore(true, userId);
    } else logger.debug("AuthSwitch", `new user has live race raceId=${live.id} — deferring walk notif for race restore`);
  }
  return switched;
}

export type MyActiveInProgressRace = {
  id: string;
  status: string;
  startedAt: string | null;
  scheduledStartAt?: string | null;
  targetSteps: number;
  currentPlayers: number;
  isHost?: boolean;
  title?: string;
  type?: string;
  entryType?: string;
  entryAmountCents?: number;
  challengeType?: string;
  capacityMode?: string;
  challengeEndAt?: string | null;
};

/** Fetch the signed-in user's newest in-progress race (participant only). */
export async function fetchMyActiveInProgressRace(
  userId: string,
): Promise<MyActiveInProgressRace | null> {
  const races = await fetchMyActiveInProgressRaces(userId);
  return races[0] ?? null;
}

function isClassicLiveRaceRow(r: MyActiveInProgressRace): boolean {
  const entry = String(r.entryType ?? "").toLowerCase();
  const challenge = String(r.challengeType ?? "").toLowerCase();
  const capacity = String(r.capacityMode ?? "").toLowerCase();
  if (entry === "unlimited_goal" || challenge === "unlimited_goal" || capacity === "unlimited") {
    return false;
  }
  return !!(r?.id && r.status === "in_progress");
}

/** All concurrent in-progress classic races (sponsored + free/coins/cash). Unlimited excluded. */
export async function fetchMyActiveInProgressRaces(
  userId: string,
): Promise<MyActiveInProgressRace[]> {
  if (!userId) return [];
  try {
    const { authFetch } = await import("@/utils/authFetch");
    const res = await authFetch("/api/races/my-active");
    if (!res.ok) return [];
    const body = (await res.json()) as {
      race?: MyActiveInProgressRace | null;
      races?: MyActiveInProgressRace[];
    };
    const list =
      Array.isArray(body.races) && body.races.length > 0
        ? body.races
        : body.race
          ? [body.race]
          : [];
    // Never restore Unlimited into classic RaceContext (wrong write path + 404 spam).
    return list.filter(isClassicLiveRaceRow);
  } catch {
    return [];
  }
}

/**
 * When Walk tab discovers a second live race (e.g. sponsored) while another is
 * already FGS-primary, show the companion as parallel tray notification (1002).
 */
export async function ensureCompanionRaceNotification(params: {
  raceId: string;
  userId: string;
  username?: string;
}): Promise<void> {
  const { raceId, userId } = params;
  if (!raceId || !userId) return;
  const s = store.getState().raceProgress;
  if (s.activeRaceId === raceId) return;
  if (raceProgressNotificationService.getParallelRaceId() === raceId) return;

  try {
    await waitForAppStartupReady();
    const { authFetch } = await import("@/utils/authFetch");
    const detailRes = await authFetch(`/api/races/${raceId}`);
    if (!detailRes.ok) return;
    const detail = (await detailRes.json()) as {
      race?: {
        startedAt?: string | null;
        targetSteps?: number;
        currentPlayers?: number;
        type?: string;
        challengeEndAt?: string | null;
      };
      participants?: Array<{
        userId: string;
        username?: string;
        currentSteps: number;
        status?: string | null;
      }>;
    };
    const me = findEligibleLiveRaceParticipant(detail.participants ?? [], {
      id: userId,
    });
    if (!me) return;

    const bootSteps = Math.max(0, Math.floor(me.currentSteps ?? 0));
    const race = detail.race;
    const goalSteps =
      typeof race?.targetSteps === "number" && race.targetSteps > 0
        ? race.targetSteps
        : null;
    if (goalSteps == null) {
              logger.warn("StepCoordinator", `ensureCompanionRaceNotification skip — missing targetSteps raceId=${raceId}`);
      return;
    }
    const challengeEndAt =
      race?.type === "sponsored"
        ? race.challengeEndAt ??
          (race.startedAt
            ? new Date(new Date(race.startedAt).getTime() + 3 * 60 * 60 * 1000).toISOString()
            : undefined)
        : race?.challengeEndAt ?? undefined;

    store.dispatch(raceProgressActions.setCompanionRaceId(raceId));
    store.dispatch(
      raceProgressActions.setCompanionRaceMeta({
        raceId,
        isSponsored: race?.type === "sponsored",
      }),
    );
    activeChallengeSync.register(raceId);
    if (s.activeRaceId) activeChallengeSync.register(s.activeRaceId);

    await raceProgressNotificationService.startParallel(
      {
        raceId,
        userId,
        username:
          params.username ??
          me.username ??
          s.username ??
          store.getState().auth.user?.username ??
          "Runner",
        raceSteps: bootSteps,
        rank: 1,
        totalParticipants: Math.max(1, race?.currentPlayers ?? 1),
        goalSteps,
        timeLeftSeconds: 0,
        isSponsored: race?.type === "sponsored",
        raceType: resolveRaceNotificationTypeHint({
          type: race?.type,
          isSponsored: race?.type === "sponsored",
        }),
        ...(challengeEndAt ? { challengeEndAt } : {}),
      },
      race?.startedAt
        ? new Date(race.startedAt).toISOString()
        : undefined,
    );
    logger.debug("StepCoordinator", `companion parallel notif raceId=${raceId}`);
  } catch (err) {
          logger.warn("StepCoordinator", "ensureCompanionRaceNotification failed", err);
  }
}

/**
 * After account switch / login: if the user is an active participant in a live
 * race, start the ongoing race notification immediately (do not wait for
 * live-detail open). Returns boot steps for RaceContext resume.
 */
export async function restoreActiveLiveRaceNotificationForUser(
  userId: string,
  username?: string,
): Promise<{ race: MyActiveInProgressRace; bootSteps: number } | null> {
  if (!userId) return null;
  try {
    await waitForAppStartupReady();
    const races = await fetchMyActiveInProgressRaces(userId);
    if (races.length === 0) return null;

    // Prefer non-sponsored as FGS primary so free/coins keep the sticky service slot.
    const primary =
      races.find((r) => r.type !== "sponsored") ?? races[0]!;
    const secondaries = races.filter((r) => r.id !== primary.id);

    const { authFetch } = await import("@/utils/authFetch");
    const hydrateOne = async (race: MyActiveInProgressRace) => {
      let bootSteps = 0;
      let challengeEndAt: string | number | null | undefined;
      let raceType: string | undefined = race.type;
      const fetchDetail = async () => {
        const detailRes = await authFetch(`/api/races/${race.id}`);
        if (!detailRes.ok) return false as const;
        const detail = (await detailRes.json()) as {
          race?: {
            type?: string;
            challengeEndAt?: string | null;
            startedAt?: string | null;
            targetSteps?: number;
            currentPlayers?: number;
          };
          participants?: Array<{
            userId: string;
            username?: string;
            currentSteps: number;
            status?: string | null;
          }>;
        };
        const me = findEligibleLiveRaceParticipant(detail.participants ?? [], {
          id: userId,
        });
        if (!me) return null;
        bootSteps = Math.max(0, Math.floor(me.currentSteps ?? 0));
        // Continue from the highest known floor: server, durable seed, native FGS, Redux.
        // Prevents close/open or logout/login from resetting race steps to 0 when local
        // progress existed but the server detail briefly lags or was not yet synced.
        try {
          const { getRaceStepSeed } = await import(
            "@/services/steps/raceBaselineStorage"
          );
          const seed = await getRaceStepSeed(race.id, userId);
          if (typeof seed === "number" && seed > 0) {
            bootSteps = Math.max(bootSteps, seed);
          }
        } catch {
          /* non-fatal */
        }
        try {
          const raw = await raceProgressNotificationService.getNativeRaceState();
          if (raw) {
            const json = JSON.parse(raw) as {
              raceId?: string;
              activeRaceId?: string;
              raceSteps?: number;
            };
            const nativeRaceId = json.raceId ?? json.activeRaceId;
            if (
              nativeRaceId === race.id &&
              typeof json.raceSteps === "number" &&
              json.raceSteps > 0
            ) {
              bootSteps = Math.max(bootSteps, Math.floor(json.raceSteps));
            }
          }
        } catch {
          /* non-fatal */
        }
        const rp = store.getState().raceProgress;
        if (
          rp.activeRaceId === race.id &&
          rp.userId === userId &&
          typeof rp.raceSteps === "number"
        ) {
          bootSteps = Math.max(bootSteps, Math.floor(rp.raceSteps));
        }
        raceType = resolveRaceNotificationTypeHint({
          type: detail.race?.type ?? race.type,
          entryType: race.entryType,
          challengeType: race.challengeType,
          isSponsored: (detail.race?.type ?? race.type) === "sponsored",
        });
        challengeEndAt =
          detail.race?.challengeEndAt ??
          (raceType === "sponsored" && (detail.race?.startedAt ?? race.startedAt)
            ? new Date(
                new Date(detail.race?.startedAt ?? race.startedAt!).getTime() +
                  3 * 60 * 60 * 1000,
              ).toISOString()
            : undefined);
        if (detail.race?.targetSteps) {
          race.targetSteps = detail.race.targetSteps;
        }
        if (detail.race?.currentPlayers) {
          race.currentPlayers = detail.race.currentPlayers;
        }
        return true as const;
      };

      let detailResult = await fetchDetail().catch(() => false as const);
      if (detailResult === null) return null;
      if (!detailResult) {
        await new Promise((r) => setTimeout(r, 600));
        detailResult = await fetchDetail().catch(() => false as const);
        if (detailResult === null) return null;
      }
      if (detailResult !== true) return null;

      try {
        const { setRaceStepSeed } = await import(
          "@/services/steps/raceBaselineStorage"
        );
        await setRaceStepSeed(race.id, userId, bootSteps);
        if (stepProviderManager.usesRaceBaseline()) {
          await stepProviderManager.ensureRaceBaseline(race.id, userId, bootSteps);
          await stepProviderManager.alignRaceBaselineToRaceSteps(
            race.id,
            userId,
            bootSteps,
          );
        }
      } catch {
        /* non-fatal */
      }

      return { bootSteps, challengeEndAt, raceType };
    };

    const primaryHydrated = await hydrateOne(primary);
    if (!primaryHydrated) {
              logger.warn("AuthSwitch", `race detail unavailable raceId=${primary.id} — skip restore until live-detail hydrate`);
      return null;
    }

    const displayName =
      username ??
      store.getState().auth.user?.username ??
      "Runner";

    ensureActiveRaceInStore({
      raceId: primary.id,
      raceStartTime: new Date(primary.startedAt ?? Date.now()).toISOString(),
      userId,
      username: displayName,
      goalSteps:
        typeof primary.targetSteps === "number" && primary.targetSteps > 0
          ? primary.targetSteps
          : 0,
      totalParticipants: Math.max(1, primary.currentPlayers ?? 1),
      bootSteps: primaryHydrated.bootSteps,
      participantConfirmed: true,
      isSponsored: primaryHydrated.raceType === "sponsored",
      raceType: primaryHydrated.raceType,
      challengeEndAt: primaryHydrated.challengeEndAt,
    });

    for (const secondary of secondaries) {
      const hydrated = await hydrateOne(secondary);
      if (!hydrated) continue;
      const secondaryGoal =
        typeof secondary.targetSteps === "number" && secondary.targetSteps > 0
          ? secondary.targetSteps
          : null;
      if (secondaryGoal == null) continue;
      store.dispatch(raceProgressActions.setCompanionRaceId(secondary.id));
      store.dispatch(
        raceProgressActions.setCompanionRaceMeta({
          raceId: secondary.id,
          isSponsored: hydrated.raceType === "sponsored",
        }),
      );
      activeChallengeSync.register(secondary.id);
      await raceProgressNotificationService.startParallel(
        {
          raceId: secondary.id,
          userId,
          username: displayName,
          raceSteps: hydrated.bootSteps,
          rank: 1,
          totalParticipants: Math.max(1, secondary.currentPlayers ?? 1),
          goalSteps: secondaryGoal,
          timeLeftSeconds: 0,
          isSponsored: hydrated.raceType === "sponsored",
          ...(hydrated.challengeEndAt
            ? { challengeEndAt: hydrated.challengeEndAt }
            : {}),
        },
        secondary.startedAt
          ? new Date(secondary.startedAt).toISOString()
          : undefined,
      );
    }

    await storageSet(`${STORAGE_KEYS.PENDING_RACE}:${userId}`, {
      raceId: primary.id,
      raceStartTimeUTC: new Date(primary.startedAt ?? Date.now()).toISOString(),
      status: "in_progress",
      userId,
    });
    await storageRemove(STORAGE_KEYS.PENDING_RACE);

    logger.debug("AuthSwitch", `restored live race notification raceId=${primary.id} bootSteps=${primaryHydrated.bootSteps} companions=${secondaries.length}`);
    return { race: primary, bootSteps: primaryHydrated.bootSteps };
  } catch (err) {
          logger.warn("AuthSwitch", "restore live race notification failed", err);
    return null;
  }
}

/** Clear native + notification step session on logout so the next user cannot inherit counts. */
export async function clearStepSessionForLogout(userId: string | undefined): Promise<void> {
  const epoch = bumpStepSessionEpoch();
  logger.debug("Logout", `clearing step session userId=${userId ?? "unknown"} epoch=${epoch}`);
  try {
    const { clearVerifiedAccountStepIsolation } = await import(
      "@/services/steps/verifiedAccountStepIsolation"
    );
    clearVerifiedAccountStepIsolation();
  } catch {
    /* optional */
  }
  await clearUserSessionStepState(userId, "logout", { epoch });
  if (epoch !== getStepSessionEpoch()) {
    logger.debug("Logout", `aborted post-clear — newer session epoch=${getStepSessionEpoch()}`);
  }
}

