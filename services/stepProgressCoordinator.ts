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
import { raceProgressNotificationService } from "@/services/raceProgressNotificationService";
import { stepTrackingNotificationService } from "@/services/stepTrackingNotificationService";
import { RACE_PROGRESS_NOTIFICATION_CONFIG } from "@/config/raceProgressNotificationConfig";
import { STEP_TRACKING_NOTIFICATION_CONFIG } from "@/config/stepTrackingNotificationConfig";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import { AppState, type AppStateStatus, Platform } from "react-native";
import { waitForAppStartupReady, isAppStartupReady } from "@/services/appStartup";
import { getLocalDateStr, isStepSnapshotFromBeforeToday, msUntilNextLocalMidnight } from "@/utils/timezone";
import { storageGet, storageRemove, storageSet, STORAGE_KEYS } from "@/utils/storage";
import { clearWalkStepsOutbox } from "@/services/walkStepsOutbox";
import { clearUserSessionQueryCache, queryClient } from "@/services/queryClient";
import {
  clearScopedStepStateForUser,
  deleteLegacyUnscopedStepKeys,
  stepScopedKeys,
  writeDailyStepsForUserDate,
} from "@/utils/stepScopedStorage";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import { mergeWalkStepsWithNative } from "@/services/stepDisplayMerge";
import { shouldIgnoreLegacyPhantomBump, sanitizeLegacyProviderSteps, stepEngineLog, resolveTodayDisplaySteps } from "@/utils/stepAccuracy";

let notificationTimer: ReturnType<typeof setTimeout> | null = null;
let pendingNotification = false;
let walkNotificationTimer: ReturnType<typeof setTimeout> | null = null;
let pendingWalkNotification = false;
let lastWalkNotificationSteps = -1;
let lastWalkNotificationPushMs = 0;
let lastKnownTrackingDate: string | null = null;
let midnightCheckTimer: ReturnType<typeof setTimeout> | null = null;

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
): boolean {
  if (incoming.userId && current.userId && incoming.userId !== current.userId) {
    if (__DEV__) {
      console.log("[StepStore] ignored update for previous user");
    }
    return false;
  }
  if (!incoming.updatedAt) return false;
  const incomingMs = new Date(incoming.updatedAt).getTime();
  const todayMs = current.todayStepsLastUpdatedAt
    ? new Date(current.todayStepsLastUpdatedAt).getTime()
    : 0;
  const raceMs = current.raceStepsLastUpdatedAt
    ? new Date(current.raceStepsLastUpdatedAt).getTime()
    : 0;
  if (incoming.todaySteps !== undefined && todayMs > 0 && incomingMs < todayMs) return false;
  if (incoming.raceSteps !== undefined && raceMs > 0 && incomingMs < raceMs) return false;
  if (
    incoming.todaySteps !== undefined &&
    incoming.todaySteps < current.todaySteps
  ) {
    return false;
  }
  if (
    incoming.raceSteps !== undefined &&
    incoming.raceSteps < current.raceSteps
  ) {
    return false;
  }
  return true;
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
  if (pendingWalkNotification && !force) return;
  pendingWalkNotification = true;

  if (walkNotificationTimer) clearTimeout(walkNotificationTimer);

  const delay = force ? 0 : STEP_TRACKING_NOTIFICATION_CONFIG.DEBOUNCE_MS;
  walkNotificationTimer = setTimeout(() => {
    pendingWalkNotification = false;
    walkNotificationTimer = null;
    void pushWalkNotificationFromCanonicalStore();
  }, delay);
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
    if (__DEV__) console.log("[OngoingNotification] push deferred — startup not ready");
    return;
  }
  const s = store.getState().raceProgress;
  const userId = userIdOverride ?? s.userId;
  if (!userId) {
    console.log("[OngoingNotification] push skipped — no userId in store");
    return;
  }

  const steps = Math.max(0, Math.floor(s.todaySteps));
  const now = Date.now();
  const cfg = STEP_TRACKING_NOTIFICATION_CONFIG;

  // Never push stale JS/Redux values over a higher native FGS sensor count for the same user.
  if (Platform.OS === "android") {
    const verifiedActive = stepProviderManager.usesVerifiedStepSource();
    const native = await stepTrackingNotificationService.getNativeStepState(userId);
    const today = getLocalDateStr();
    const nativeMatchesUser =
      !native?.userId || native.userId === userId;
    const nativeStale = !!(
      native?.localDate && native.localDate !== today
    );
    const nativeSteps = nativeMatchesUser ? native?.todaySteps ?? 0 : 0;
    const nativeUpdatedAt = native?.updatedAt ?? native?.lastUpdatedAt ?? 0;
    const jsUpdatedAt = s.todayStepsLastUpdatedAt
      ? new Date(s.todayStepsLastUpdatedAt).getTime()
      : 0;
    // Verified HC/HealthKit: native TYPE_STEP_COUNTER must never override provider reads.
    if (
      verifiedActive &&
      nativeMatchesUser &&
      nativeSteps > steps
    ) {
      console.log(
        `[StepSource] skipped native adopt verified=true native=${nativeSteps} canonical=${steps}`,
      );
    }
    if (!nativeMatchesUser && native?.userId && __DEV__) {
      console.log(
        `[OngoingNotification] native user mismatch native=${native.userId} active=${userId} — pushing canonical steps=${steps}`,
      );
    }
  }

  if (
    !force &&
    now - lastWalkNotificationPushMs < cfg.LOCAL_UPDATE_MS &&
    Math.abs(steps - lastWalkNotificationSteps) < cfg.MIN_STEP_DELTA_FOR_UPDATE
  ) {
    console.log(
      `[Notification] skipped throttle todaySteps=${steps} last=${lastWalkNotificationSteps}`,
    );
    return;
  }

  console.log(
    `[Notification] notifyUpdated id=91002 steps=${steps} source=${s.stepSource}`,
  );
  console.log(`[Notification] receivedTodaySteps=${steps}`);

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
  const syncedCount = await storageGet<number>(scopedKeys.lastSyncedStepsCount);

  let native: Awaited<ReturnType<typeof stepTrackingNotificationService.getNativeStepState>> = null;
  if (Platform.OS === "android") {
    try {
      native = await stepTrackingNotificationService.getNativeStepState();
    } catch (err) {
      console.log("[Startup] native step state read failed", err);
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

  const needsRollover =
    (trackingDate != null && trackingDate !== today) ||
    (nativeDate != null && nativeDate !== today) ||
    (lastKnownTrackingDate != null && lastKnownTrackingDate !== today) ||
    nativeStaleByTimestamp;

  if (__DEV__) {
    console.log(
      `[StepReset] currentUserId=${activeUserId ?? "none"} localDate=${today} previousLocalDate=${trackingDate ?? "none"} dayChanged=${needsRollover}`,
    );
  }
  stepEngineLog(
    "DayReset",
    `previousDate=${trackingDate ?? lastKnownTrackingDate ?? "none"} currentDate=${today} reset=${needsRollover}`,
  );

  if (!needsRollover) {
    if (trackingDate == null) {
      await storageSet(scopedKeys.currentLocalDate, today);
    }
    lastKnownTrackingDate = today;
    return false;
  }

  if (__DEV__) {
    console.log(
      `[StepReset] resetting daily steps currentUserId=${activeUserId ?? "none"} localDate=${today} previousLocalDate=${trackingDate ?? "n/a"} nativeDate=${nativeDate ?? "n/a"} lastKnown=${lastKnownTrackingDate ?? "n/a"} syncedCount=${syncedCount ?? 0}`,
    );
  }

  if (Platform.OS === "android") {
    await stepTrackingNotificationService.resetDailyStepsForNewDay();
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

  store.dispatch(
    raceProgressActions.resetDailyStepsForNewDay({
      todaySteps: 0,
      updatedAt: new Date().toISOString(),
    }),
  );
  store.dispatch(walkActions.setTodaySteps(0));

  lastWalkNotificationSteps = -1;

  await writeDailyStepsForUserDate(activeUserId, today, 0);
  await storageSet(stepScopedKeys(activeUserId, today).lastSyncedStepsCount, 0);
  await storageSet(stepScopedKeys(activeUserId, today).currentLocalDate, today);
  await deleteLegacyUnscopedStepKeys();

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
}): void {
  const source = input.stepSource ?? mapProviderSource();

  if (!source || source === "unknown") {
    if (__DEV__) {
      console.log("[StepEngine] rejected step update reason=unknown_source");
    }
    return;
  }

  if (input.isSimulated || input.isFake) {
    if (__DEV__) {
      console.log("[StepEngine] rejected fake/fallback step update reason=simulated");
    }
    return;
  }

  const current = store.getState().raceProgress;
  const updatedAt = input.updatedAt ?? new Date().toISOString();

  if (
    !shouldAcceptStepUpdate(
      {
        todaySteps: input.todaySteps,
        raceSteps: input.raceSteps,
        updatedAt,
      },
      current,
    )
  ) {
    if (__DEV__) {
      console.log("[StepEngine] rejected stale step update");
    }
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
      if (__DEV__) {
        console.log(
          `[StepEngine] rejected fake increment previous=${current.todaySteps} incoming=${next} reason=verified_source_priority`,
        );
      }
      return;
    }
    if (isDeviceSensorSource(source) && !stepProviderManager.usesVerifiedStepSource()) {
      next = sanitizeLegacyProviderSteps(
        next,
        current.todaySteps,
        current.todaySteps,
      );
    }
    if (shouldIgnoreLegacyPhantomBump(current.todaySteps, next)) {
      if (__DEV__) {
        console.log(
          `[StepEngine] rejected phantom bump previous=${current.todaySteps} incoming=${next} source=${source}`,
        );
      }
      return;
    }
    resolvedTodaySteps = next;
  }

  if (__DEV__) {
    console.log(
      `[StepSource] real update source=${source} todaySteps=${resolvedTodaySteps ?? current.todaySteps} raceSteps=${input.raceSteps ?? current.raceSteps}`,
    );
  }

  store.dispatch(
    raceProgressActions.updateFromDeviceSource({
      todaySteps: resolvedTodaySteps,
      raceSteps: input.raceSteps,
      stepSource: source,
      updatedAt,
    }),
  );

  const after = store.getState().raceProgress;
  if (resolvedTodaySteps !== undefined) {
    console.log(
      `[StepEngine] todaySteps=${after.todaySteps} emittedUpdateAt=${updatedAt}`,
    );
  }
  if (input.raceSteps !== undefined) {
    console.log(
      `[StepEngine] race update raceId=${after.raceId ?? "none"} raceSteps=${after.raceSteps}`,
    );
  }

  if (resolvedTodaySteps !== undefined) {
    const s = store.getState().raceProgress;
    store.dispatch(walkActions.setTodaySteps(s.todaySteps));
    scheduleWalkNotificationUpdate(false);
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
  };

  if (__DEV__) {
    console.log(
      `[AndroidNotification] update raceSteps=${payload.raceSteps} rank=${payload.rank} source=store`,
    );
  }

  await raceProgressNotificationService.onLocalRaceStepsUpdated(payload);
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
      } else if (stepTrackingNotificationService.isActive()) {
        await hydrateFromNativeStepState();
        startWalkBackgroundStepPoll();
        await tickWalkBackgroundStepPoll("resume");
      }
    }
    if (__DEV__) {
      const s = store.getState().raceProgress;
      console.log(
        `[AppResume] coordinator resume todaySteps=${s.todaySteps} raceSteps=${s.raceSteps} source=${s.stepSource}`,
      );
    }
  } catch (err) {
    console.log("[Startup] hydrateOnAppResume failed", err);
  }
}

export function initStepProgressCoordinator(): void {
  console.log("[Startup] step coordinator initializing");

  AppState.addEventListener("change", (next: AppStateStatus) => {
    if (next === "active") {
      void hydrateOnAppResume();
    }
  });

  void waitForAppStartupReady().then(async () => {
    try {
      const userId = await storageGet<string>(STORAGE_KEYS.LAST_STEP_USER_ID);
      lastKnownTrackingDate = userId
        ? (await storageGet<string>(stepScopedKeys(userId).currentLocalDate)) ?? null
        : null;
      initNativeStepEventListener();
      scheduleNextMidnightCheck();
      await handleMidnightRolloverIfNeeded();
    } catch (err) {
      console.log("[Startup] step coordinator native listener failed", err);
    }
    console.log("[Startup] step coordinator initialized");
  });
}

let nativeStepUnsubscribe: (() => void) | null = null;
let nativeWalkRefreshUnsubscribe: (() => void) | null = null;
let walkBackgroundPollTimer: ReturnType<typeof setInterval> | null = null;

function notificationBgLog(message: string): void {
  console.log(`[NotificationBG] ${message}`);
}

/**
 * Refresh daily steps from provider and push notification 91002.
 * Does NOT adopt raw native ahead of provider (anti-inflation preserved).
 */
export async function tickWalkBackgroundStepPoll(
  reason: "fgs_tick" | "interval" | "resume" | "background" = "interval",
): Promise<void> {
  if (!isAppStartupReady()) {
    notificationBgLog("skippedReason=startup_not_ready");
    return;
  }
  const s = store.getState().raceProgress;
  if (!s.userId) {
    notificationBgLog("skippedReason=no_userId");
    return;
  }
  if (s.raceStatus === "active" && s.activeRaceId) {
    notificationBgLog("skippedReason=active_race");
    return;
  }

  const appState = AppState.currentState;
  notificationBgLog(
    `serviceRunning=true source=${stepProviderManager.getActiveProviderId() ?? "none"} appState=${appState}`,
  );

  try {
    await stepProviderManager.initialize();
    const data = await stepProviderManager.getTodaySteps();
    if (!data) {
      notificationBgLog("skippedReason=no_provider_data");
      return;
    }

    let providerSteps = Math.max(0, data.steps);
    const current = s.todaySteps;

    if (
      reason === "fgs_tick" &&
      Platform.OS === "android" &&
      !stepProviderManager.usesVerifiedStepSource()
    ) {
      providerSteps = await mergeWalkStepsWithNative(providerSteps);
    }

    const display = resolveTodayDisplaySteps({
      providerSteps,
      backendSteps: current,
      previousProviderSteps: current,
    });

    stepEngineLog(
      "StepEngine",
      `providerSteps=${providerSteps} sanitizedSteps=${display} skippedNativeAdoptAhead=true`,
    );
    notificationBgLog(`canonicalTodaySteps=${current} sanitizedTodaySteps=${display}`);

    if (display > current) {
      updateStepProgressFromRealSource({
        todaySteps: display,
        stepSource: mapProviderSource(),
        updatedAt: new Date().toISOString(),
      });
    }

    await pushWalkNotificationFromCanonicalStore(true, s.userId);
    notificationBgLog(`notifyUpdated id=91002 steps=${Math.max(current, display)} reason=${reason}`);
  } catch (err) {
    notificationBgLog(`skippedReason=error err=${String(err)}`);
  }
}

export function startWalkBackgroundStepPoll(): void {
  if (walkBackgroundPollTimer) return;
  walkBackgroundPollTimer = setInterval(() => {
    void tickWalkBackgroundStepPoll("interval");
  }, STEP_SYNC_CONFIG.WALK_LOCAL_RECONCILE_POLL_MS);
  notificationBgLog("backgroundPollStarted=true");
}

export function stopWalkBackgroundStepPoll(): void {
  if (walkBackgroundPollTimer) {
    clearInterval(walkBackgroundPollTimer);
    walkBackgroundPollTimer = null;
    notificationBgLog("backgroundPollStopped=true");
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
        if (__DEV__) {
          console.log("[StepStore] ignored update for previous user");
        }
        return;
      }
      const raceActive =
        s.raceStatus === "active" &&
        !!s.activeRaceId &&
        (!state.activeRaceId || state.activeRaceId === s.activeRaceId);

      const updatedAt = new Date(
        state.updatedAt ?? state.lastUpdatedAt ?? Date.now(),
      ).toISOString();

      // During an active race, native sensor race steps update UI + notification immediately.
      if (raceActive && typeof state.raceSteps === "number") {
        if (stepProviderManager.usesVerifiedStepSource() && isDeviceSensorSource(source)) {
          if (__DEV__) {
            console.log("[StepStore] ignored native race sensor — verified source active");
          }
          return;
        }
        feedRaceStepsToStore({
          raceSteps: state.raceSteps,
          stepSource: mapNativeStepSource(source),
          updatedAt,
        });
        if (__DEV__) {
          console.log(
            `[LiveRaceUI] real step update raceSteps=${state.raceSteps} source=${source}`,
          );
        }
        return;
      }

      if (stepProviderManager.usesVerifiedStepSource() && isDeviceSensorSource(source)) {
        return;
      }
      const today = getLocalDateStr();
      if (!raceActive && state.localDate && state.localDate !== today) {
        if (__DEV__) {
          console.log("[StepStore] ignored native update — stale localDate");
        }
        return;
      }
      const nativeUpdatedAt = state.updatedAt ?? state.lastUpdatedAt ?? 0;
      if (
        !raceActive &&
        isStepSnapshotFromBeforeToday(nativeUpdatedAt, state.todaySteps ?? 0)
      ) {
        if (__DEV__) {
          console.log("[StepStore] ignored native update — stale snapshot");
        }
        return;
      }
      if (stepProviderManager.usesVerifiedStepSource() && isDeviceSensorSource(source)) {
        return;
      }
      const currentToday = s.todaySteps;
      const incomingToday = Math.max(0, Math.floor(state.todaySteps ?? 0));
      if (incomingToday <= currentToday) return;
      if (shouldIgnoreLegacyPhantomBump(currentToday, incomingToday)) {
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
    if (__DEV__) {
      console.log("[StepStore] ignored update for previous user");
    }
    return;
  }
  const today = getLocalDateStr();
  if (native.localDate && native.localDate !== today) {
    if (__DEV__) {
      console.log("[StepStore] skip native hydrate — stale localDate");
    }
    return;
  }
  const nativeUpdatedAtMs = native.updatedAt ?? native.lastUpdatedAt ?? 0;
  if (isStepSnapshotFromBeforeToday(nativeUpdatedAtMs, native.todaySteps ?? 0)) {
    if (__DEV__) {
      console.log("[StepStore] skip native hydrate — stale snapshot");
    }
    return;
  }
  const raceActive =
    current.raceStatus === "active" &&
    !!current.activeRaceId &&
    (!native.activeRaceId || native.activeRaceId === current.activeRaceId);

  if (
    isVerifiedSource(stepSource) &&
    stepProviderManager.usesVerifiedStepSource() &&
    !raceActive
  ) {
    if (__DEV__) {
      console.log("[StepStore] skip unified native hydrate — verified step source active");
    }
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
    if (__DEV__) {
      console.log("[AppResume] ignored stale JS/database state");
    }
    return;
  }

  if (raceActive && typeof native.raceSteps === "number") {
    feedRaceStepsToStore({
      raceSteps: native.raceSteps,
      stepSource: mapNativeStepSource(stepSource),
      updatedAt,
    });
    if (__DEV__) {
      console.log(
        `[AppResume] merged state source=native_service raceSteps=${native.raceSteps}`,
      );
    }
  }

  const nativeToday = Math.max(0, Math.floor(native.todaySteps ?? 0));
  const sanitizedToday = stepProviderManager.usesVerifiedStepSource()
    ? current.todaySteps
    : sanitizeLegacyProviderSteps(nativeToday, current.todaySteps, current.todaySteps);

  updateStepProgressFromRealSource({
    todaySteps: raceActive ? current.todaySteps : sanitizedToday,
    raceSteps:
      raceActive && typeof native.raceSteps === "number"
        ? native.raceSteps
        : undefined,
    stepSource: mapNativeStepSource(stepSource),
    updatedAt,
  });

  if (__DEV__) {
    console.log(
      `[AppResume] native state loaded todaySteps=${native.todaySteps} raceSteps=${native.raceSteps ?? 0}`,
    );
  }
}

async function hydrateFromNativeRaceService(): Promise<void> {
  const current = store.getState().raceProgress;
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
      if (__DEV__) {
        console.log(
          `[StepStore] skip native race hydrate — stale raceId native=${nativeWalk.activeRaceId} active=${current.activeRaceId}`,
        );
      }
      return;
    }
    if (!current.activeRaceId) {
      if (__DEV__) {
        console.log("[StepStore] skip native race hydrate — no active race in store");
      }
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
    if (__DEV__) {
      console.log(
        `[Login] hydrating step state userId=${current.userId} raceSteps=${nativeWalk.raceSteps} source=native_fgs`,
      );
    }
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
      if (__DEV__) {
        console.log(
          `[StepStore] skip native race hydrate — stale raceId native=${nativeRaceId} active=${current.activeRaceId}`,
        );
      }
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
      if (__DEV__) {
        console.log("[StepStore] skip native hydrate — verified step source");
      }
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
    if (__DEV__) {
      console.log(`[StepStore] hydrated from native FGS raceSteps=${raceSteps} rank=${rank}`);
    }
  } catch {
    /* non-fatal */
  }
}

export function setStepProgressUser(
  userId: string | null,
  username?: string | null,
): void {
  store.dispatch(raceProgressActions.setUserContext({ userId, username }));
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
}): void {
  const boot = Math.max(0, Math.floor(params.bootSteps ?? 0));
  const s = store.getState().raceProgress;

  if (
    s.raceStatus === "active" &&
    s.activeRaceId === params.raceId &&
    s.userId === params.userId
  ) {
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
    console.log(
      `[StepCoordinator] ensureActiveRaceInStore ok raceId=${params.raceId} raceSteps=${store.getState().raceProgress.raceSteps}`,
    );
    return;
  }

  setActiveRaceProgress({
    ...params,
    bootSteps: boot,
    freshStart: false,
  });
  console.log(
    `[StepCoordinator] ensureActiveRaceInStore activated raceId=${params.raceId} bootSteps=${boot}`,
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
}): void {
  const freshStart = params.freshStart !== false;
  const boot = freshStart ? 0 : Math.max(0, params.bootSteps ?? 0);
  raceStepSyncService.reset();
  if (!freshStart && boot > 0) {
    raceStepSyncService.seedSyncedSteps(boot);
  }
  store.dispatch(raceProgressActions.resetRaceStepBuffer());
  store.dispatch(raceProgressActions.setActiveRace({ ...params, bootSteps: boot }));
  void raceProgressNotificationService.start(
    {
      raceId: params.raceId,
      userId: params.userId,
      username: params.username,
      raceSteps: boot,
      rank: 1,
      totalParticipants: params.totalParticipants ?? 1,
      goalSteps: params.goalSteps,
      timeLeftSeconds: 0,
    },
    params.raceStartTime,
  );
  scheduleNotificationUpdate(true);
}

export function clearActiveRaceProgress(
  status: RaceProgressStatus,
  options?: { preserveWalkDisplay?: number; raceId?: string },
): void {
  const s = store.getState().raceProgress;
  const todaySteps = s.todaySteps;
  const raceIdToStop = options?.raceId ?? s.activeRaceId;

  store.dispatch(
    raceProgressActions.clearActiveRace({
      status,
      preserveWalkDisplay: options?.preserveWalkDisplay,
    }),
  );

  void (async () => {
    if (raceIdToStop) {
      await raceProgressNotificationService.stop(raceIdToStop, status, todaySteps);
      stepEngineLog(
        "RaceComplete",
        `dismissedNotification=true raceId=${raceIdToStop} status=${status}`,
      );
    }
    const walkSteps = Math.max(
      todaySteps,
      options?.preserveWalkDisplay ?? 0,
    );
    if (s.userId) {
      await switchDailyStepsNotification(walkSteps);
    }
  })();
}

/** Push daily-steps notification after race ends — does not stop the foreground service. */
export async function switchDailyStepsNotification(todaySteps: number): Promise<void> {
  const s = store.getState().raceProgress;
  if (!s.userId) return;
  store.dispatch(
    raceProgressActions.updateFromDeviceSource({
      todaySteps: Math.max(0, Math.floor(todaySteps)),
      updatedAt: new Date().toISOString(),
    }),
  );
  await pushWalkNotificationFromCanonicalStore(true);
  if (__DEV__) {
    console.log(`[NotificationMode] switch race_live -> daily_steps todaySteps=${todaySteps}`);
  }
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

  if (__DEV__) {
    console.log(`[RaceSync] send raceId=${s.activeRaceId} raceSteps=${s.raceSteps}`);
  }

  if (options?.atTarget) {
    void raceStepSyncService.flushGoal(
      s.activeRaceId,
      s.raceSteps,
      source,
      options.deviceTotalSteps,
    );
    return;
  }

  raceStepSyncService.notifyStepsUpdated(
    s.activeRaceId,
    s.raceSteps,
    source,
    {
      force: options?.force,
      deviceTotalSteps: options?.deviceTotalSteps,
    },
  );
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
  if (__DEV__) {
    console.log(`[StepStore] activateRaceInStore raceId=${params.raceId} bootSteps=${params.bootSteps ?? 0}`);
  }
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
    if (__DEV__) {
      console.log(`[StepCoordinator] skip feedRaceStepsToStore unchanged raceSteps=${next}`);
    }
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
    console.log(
      `[StepCoordinator] updateStepProgressFromSource raceId=${s.activeRaceId} raceSteps=${params.raceSteps} source=${source}`,
    );
    console.log(
      `[LiveRaceUI] canonical store raceSteps=${params.raceSteps}`,
    );
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
  store.dispatch(
    raceProgressActions.clearActiveRace({ status, preserveWalkDisplay }),
  );
  if (__DEV__) {
    console.log(`[StepStore] deactivateRaceInStore status=${status}`);
  }
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

/** Wipe step cache so another account cannot inherit counts. */
export async function clearLocalStepStorageForAccountSwitch(userId?: string): Promise<void> {
  stopWalkBackgroundStepPoll();
  nativeWalkRefreshUnsubscribe?.();
  nativeWalkRefreshUnsubscribe = null;
  lastKnownTrackingDate = null;
  lastWalkNotificationSteps = -1;
  lastWalkNotificationPushMs = 0;

  if (__DEV__) {
    console.log(`[AuthSwitch] clearing step state userId=${userId ?? "unknown"}`);
  }
  stepEngineLog("AuthSwitch", "clearedStepState=true");

  await Promise.all([
    userId ? clearScopedStepStateForUser(userId) : Promise.resolve(),
    deleteLegacyUnscopedStepKeys(),
    storageRemove(STORAGE_KEYS.PENDING_RACE),
    storageRemove(STORAGE_KEYS.LAST_STEP_USER_ID),
    clearWalkStepsOutbox(),
  ]);

  store.dispatch(raceProgressActions.resetStepStateForLogout());
  store.dispatch(raceProgressActions.clearRaceStepStateForAccountSwitch());
  store.dispatch(walkActions.setTodaySteps(0));
  store.dispatch(walkActions.setWeeklySteps(0));
  store.dispatch(walkActions.setAllTimeSteps(0));
  store.dispatch(walkActions.setCurrentStreak(0));

  if (Platform.OS === "android") {
    try {
      const {
        clearAndroidLegacySensorScopedState,
        setAndroidLegacySensorUserContext,
      } = await import("@/services/steps/providers/androidLegacySensorProvider");
      if (userId) await clearAndroidLegacySensorScopedState(userId);
      setAndroidLegacySensorUserContext(null);
    } catch {
      // non-fatal
    }
    try {
      const { androidHCService } = await import(
        "@/services/steps/androidHealthConnectService"
      );
      androidHCService.resetTodayStepCache();
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
): Promise<void> {
  if (__DEV__) {
    console.log(
      `[AuthSwitch] clearing old step state oldUserId=${oldUserId ?? "unknown"} reason=${reason}`,
    );
  }

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

  if (reason === "logout") {
    await raceProgressNotificationService.stopAll(0, "logout");
    if (Platform.OS === "android" && oldUserId) {
      if (__DEV__) console.log("[StepService] stopped for old user");
      await stepTrackingNotificationService.clearNativeStepStateForUser(oldUserId);
      await stepTrackingNotificationService.stop();
    }
  } else if (oldUserId) {
    await raceProgressNotificationService.stopAll(0, "account_switch");
    if (Platform.OS === "android") {
      if (__DEV__) console.log("[StepService] stopped for old user");
      await stepTrackingNotificationService.clearNativeStepStateForUser(oldUserId);
      await stepTrackingNotificationService.stop();
    }
  }

  await clearLocalStepStorageForAccountSwitch(oldUserId);
}

/**
 * Bind the local step cache to the signed-in user. Clears stale data when the
 * account changes (logout/login or direct account switch).
 */
export async function bindStepSessionToUser(userId: string): Promise<boolean> {
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
    if (__DEV__) {
      console.log(
        `[AuthSwitch] oldUserId=${lastUserId} newUserId=${userId}`,
      );
    }
    await clearUserSessionStepState(lastUserId, "account_switch");
  }
  await deleteLegacyUnscopedStepKeys();
  await storageSet(STORAGE_KEYS.LAST_STEP_USER_ID, userId);
  if (__DEV__) {
    console.log(`[StepService] started for new user userId=${userId}`);
  }
  store.dispatch(
    raceProgressActions.initializeStepsForUserDate({
      userId,
      localDate: getLocalDateStr(),
    }),
  );
  if (switched) {
    void pushWalkNotificationFromCanonicalStore(true, userId);
  }
  return switched;
}

/** Clear native + notification step session on logout so the next user cannot inherit counts. */
export async function clearStepSessionForLogout(userId: string | undefined): Promise<void> {
  if (__DEV__) {
    console.log(`[Logout] clearing step session userId=${userId ?? "unknown"}`);
  }
  await clearUserSessionStepState(userId, "logout");
}
