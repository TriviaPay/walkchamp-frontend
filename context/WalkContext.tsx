/**
 * WalkContext — step tracking with real health data.
 *
 * Both platforms now use range-based cumulative queries (no delta baseline math):
 *   iOS     — HealthKit via expo-sensors Pedometer.getStepCountAsync(midnight, now)
 *               polls every 15 s, syncs delta every 30 s
 *   Android — Health Connect via react-native-health-connect readRecords('Steps', range)
 *               polls every 15 s (same cadence as iOS), no subscription required
 *
 * The androidHCService (services/steps/androidHealthConnectService.ts) manages
 * HC initialization, permissions, range reads, and an in-memory step cache.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, AppStateStatus, Alert, Platform } from "react-native";
import { useAuth } from "@/context/AuthContext";
import {
  getWalkTodayStepsSnapshot,
  setWalkTodayStepsSnapshot,
} from "@/services/walkTodayStepsStore";
import {
  getWalkSessionStartedAtMs,
  setWalkSessionStartedAtMs,
} from "@/services/walkSessionElapsedStore";
import { storageGet, storageSet, storageFlushDebounced } from "@/utils/storage";
import { stepsToCalories, stepsToDistance, getTodayKey } from "@/utils/format";
import { msUntilNextLocalMidnight } from "@/utils/timezone";
import { getSelectedDailyGoal } from "@/utils/onboardingStorage";
import {
  readDailyStepsForUserDate,
  readWeeklyStepsForUser,
  stepScopedKeys,
  writeDailyStepsForUserDate,
} from "@/utils/stepScopedStorage";
import { getValidSession } from "@/services/authService";
import { timeoutSignal, STEP_SYNC_TIMEOUT, API_TIMEOUT_MS } from "@/utils/authFetch";
import { stepTracker, PermissionStatus } from "@/services/StepTrackingService";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import type { StepProviderId } from "@/services/steps/stepProviderTypes";
import { isExpoGo, type HCAvailability } from "@/services/steps/androidHealthConnectService";
import {
  getAndroidStepTrackingStatus,
  toHcAvailability,
} from "@/services/steps/androidStepTrackingStatus";
import {
  sourceToVerificationLevel,
  type VerificationLevel,
  type AndroidStepSourceId,
} from "@/services/steps/androidSourceDetection";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";
import { dynamicIconService } from "@/services/dynamicIconService";
import {
  stepTrackingNotificationService,
} from "@/services/stepTrackingNotificationService";
import {
  getNotificationPermissionStatus,
} from "@/services/permissions/notificationPermissionService";
import { hasOngoingNotificationAccess, NOTIFICATION_STILL_DISABLED_MESSAGE } from "@/services/permissions/notificationGate";
import {
  handleMidnightRolloverIfNeeded,
  pushWalkNotificationFromCanonicalStore,
  resolveAuthoritativeTodaySteps,
  setStepProgressUser,
  updateStepProgressFromRealSource,
  bindStepSessionToUser,
  startWalkBackgroundStepPoll,
  stopWalkBackgroundStepPoll,
  tickWalkBackgroundStepPoll,
} from "@/services/stepProgressCoordinator";
import { activateStepTracking, type StepTrackingEnableResult } from "@/services/stepTrackingStartup";
import { mergeWalkStepsWithNative } from "@/services/stepDisplayMerge";
import { waitForAppStartupReady } from "@/services/appStartup";
import { subscribeMidnightRollover } from "@/services/walkMidnightEvents";
import { isWalkBackendSyncPaused } from "@/services/walkSyncCoordinator";
import {
  isInflatedProvisionalVsVerified,
  resolveWalkNotificationSteps,
  shouldAcceptVerifiedZero,
} from "@/services/steps/walkDisplaySteps";
import {
  clearWalkStepsOutbox,
  loadWalkStepsOutbox,
  saveWalkStepsOutbox,
} from "@/services/walkStepsOutbox";
import { queryClient, stepsKeys } from "@/services/queryClient";
import { fetchTodayWalkFromApi } from "@/services/walkTodayApi";
import { raceProgressActions } from "@/store/slices/raceProgressSlice";
import { walkActions } from "@/store/slices/walkSlice";
import { store } from "@/store";
import {
  capWalkStepsForSync,
  logStepAccuracyAudit,
  mergeLegacyStepUpdate,
  resolveTodayDisplaySteps,
  hydrateStepDisplayFromSources,
  shouldIgnoreLegacyPhantomBump,
  filterLegacyStepIncrease,
  sanitizeLegacyProviderSteps,
  stepEngineLog,
  suppressLegacyStepBumps,
  markFreshLocalDay,
  isFreshLocalDay,
} from "@/utils/stepAccuracy";
import {
  assertVerifiedDailySyncSource,
  decideVerifiedDailySync,
  isProvisionalDailyStepSource,
  selectVerifiedTodayStepsForSync,
  STEP_SOURCES,
  type VerifiedDailyProviderQueryStatus,
} from "@/services/steps/hybridStepState";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

/** Reject provider-only +1/+N bumps on tab refresh/hydrate (same rules as applyTodayStepCount). */
function clampHydratedDisplaySteps(
  displaySteps: number,
  current: number,
  backendSteps: number,
): number {
  const target = Math.max(0, Math.floor(displaySteps));
  const cur = Math.max(0, Math.floor(current));
  const backend = Math.max(0, Math.floor(backendSteps));
  if (target <= cur) return cur > 0 ? cur : target;
  const delta = target - cur;
  if (
    shouldIgnoreLegacyPhantomBump(cur, target, { backendSteps: backend }) ||
    (!stepProviderManager.usesVerifiedStepSource() &&
      delta > 0 &&
      delta <= STEP_SYNC_CONFIG.WALK_PHANTOM_STEP_BUMP &&
      cur === backend &&
      target === backend + delta)
  ) {
    return cur;
  }
  return target;
}

export type TrackingStatus = "idle" | "walking" | "paused" | "syncing";

interface WalkSession {
  steps: number;
  distance: number;
  calories: number;
  durationSeconds: number;
}

interface WalkContextType {
  trackingStatus: TrackingStatus;
  isWalking: boolean;
  isPaused: boolean;
  session: WalkSession;
  /**
   * Display today steps. Prefer `useWalkTodaySteps()` in hot UI so step ticks
   * do not re-render every WalkContext consumer.
   */
  todaySteps: number;
  weeklySteps: number;
  allTimeSteps: number;
  currentStreak: number;
  activeDurationMinutes: number;
  milestoneReached: number | null;
  autoTrackingEnabled: boolean;
  /** Whether real pedometer tracking is active (vs no-data state). */
  usingRealTracking: boolean;
  /** Current permission status for step tracking. */
  stepPermissionStatus: PermissionStatus;
  /** Android Health Connect availability (null on iOS or before initialization). */
  hcAvailability: HCAvailability | null;
  /** Active step source identifier. ios_healthkit on iOS; android_* or null on Android. */
  activeStepSource: AndroidStepSourceId | "ios_healthkit" | null;
  /** Whether the active step source counts as verified (can join reward races). */
  verificationLevel: VerificationLevel;
  /** True when user can join cash/coins/sponsored reward races. Derived from verificationLevel. */
  canJoinRewardRaces: boolean;
  /** Backend-confirmed active minutes for today. */
  todayActiveMinutes: number;
  /** Today's rank among all users by step count. Null if no steps yet. */
  todayDailyRank: number | null;
  /** User's saved daily step goal from NeonDB (default 10,000 until loaded). */
  todayDailyGoal: number;
  setTrackingStatus: (status: TrackingStatus) => void;
  togglePause: () => void;
  clearMilestone: () => void;
  /** Request pedometer / Health Connect permission from the user. */
  requestStepPermission: () => Promise<void>;
  /** Activate tracking after wearable setup when permission may already be granted.
   *  allowAll: first HC setup — request notifications + activity (then Profile toggle later). */
  completeStepSetup: (opts?: { allowAll?: boolean }) => Promise<void>;
  /** Enable limited device sensor tracking (TYPE_STEP_COUNTER). Sets verificationLevel = limited. */
  enableLimitedSensorTracking: () => Promise<boolean>;
  /** Re-fetch today's rank + active minutes from the backend. Safe to call at any time. */
  refreshTodayRank: () => Promise<void>;
  /**
   * Force-push any unsynced step delta to the backend immediately.
   * Call this before reading leaderboard data so the server has the freshest step count.
   * Resolves when the sync completes (or fails silently). Never throws.
   */
  triggerSync: (opts?: { force?: boolean }) => Promise<void>;
  /** Re-query today's steps from the active health provider (HC / HealthKit / sensor). */
  refreshTodaySteps: (opts?: {
    rehydrateBackend?: boolean;
    mergeNative?: boolean;
    /** When false, refresh rank/backend metadata only — never bump displayed steps (tab focus). */
    applyDisplay?: boolean;
  }) => Promise<void>;
  /** Resume legacy sensor watch + mirror ongoing notification after race. */
  resumeStepWatching: () => Promise<void>;
  /** True once local step state has loaded for the current user. */
  stepsHydrated: boolean;
  /** True after the first provider poll for today (avoids showing permanent 0 while initializing). */
  stepsSourceReady: boolean;
  /** True when auth session restore is complete. */
  authReady: boolean;
}

const WalkContext = createContext<WalkContextType | null>(null);

const MILESTONES = [1000, 2000, 5000, 10000, 15000, 20000];
/** How often (ms) iOS re-queries HealthKit for today's real steps. */
const REAL_STEP_POLL_MS = STEP_SYNC_CONFIG.WALK_LOCAL_RECONCILE_POLL_MS;
/** How often (ms) we push step deltas to the backend. */
const BACKEND_SYNC_INTERVAL_MS = STEP_SYNC_CONFIG.WALK_BACKEND_SYNC_MS;

function providerToActiveSource(
  id: StepProviderId | null,
): AndroidStepSourceId | "ios_healthkit" | null {
  if (!id) return null;
  if (id === "ios_healthkit") return "ios_healthkit";
  if (id === "android_health_connect") return "android_health_connect";
  // Hybrid: TYPE_STEP_COUNTER is live-race only — never a daily Walk source.
  if (id === "android_legacy_sensor") {
    if (FEATURE_FLAGS.ENABLE_LIVE_RACE_DEVICE_SENSOR) return null;
    return "android_device_step_counter";
  }
  return null;
}

function providerToVerification(id: StepProviderId | null): VerificationLevel {
  return sourceToVerificationLevel(providerToActiveSource(id));
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayLocalMidnight(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── Backend sync ───────────────────────────────────────────────────────────────

async function submitStepsToBackend(
  steps: number,
  distanceMeters: number,
  caloriesBurned: number,
  durationSeconds: number,
  activeMinutes?: number,
  totalSteps?: number,
  source?: string,
  userId?: string,
): Promise<{
  activeMinutes?: number;
  dailyRank?: number | null;
  ignored?: boolean;
  unchanged?: boolean;
} | null> {
  if (steps <= 0) return null;
  const session = await getValidSession();
  if (!session) return null;
  try {
    const body: Record<string, unknown> = {
      steps,
      distanceMeters,
      caloriesBurned,
      durationSeconds,
    };
    if (activeMinutes !== undefined) body.activeMinutes = activeMinutes;
    if (totalSteps !== undefined) body.totalSteps = totalSteps;
    if (totalSteps !== undefined) body.dailySteps = totalSteps;
    if (source) body.source = source;
    if (userId) body.userId = userId;
    // Include the client's local calendar date so the server stores steps under
    // the correct day for the user's timezone (server runs in UTC).
    body.localDate = getTodayKey();
    body.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    body.timestampUtc = new Date().toISOString();

    if (__DEV__) {
      console.log(
        `[API] request started: /api/walk/steps delta=${steps} total=${totalSteps ?? "n/a"} source=${source ?? "n/a"}`,
      );
    }

    try {
      const { stepAudit } = require("@/utils/stepAudit") as typeof import("@/utils/stepAudit");
      stepAudit.noteSync({
        syncMode: typeof totalSteps === "number" ? "absolute" : "delta",
        delta: steps,
        totalSteps,
        providerId:
          source === "android_health_connect"
            ? "android_health_connect"
            : source === "android_step_counter"
              ? "android_legacy_sensor"
              : source === "ios_healthkit"
                ? "ios_healthkit"
                : null,
      });
    } catch {
      /* optional */
    }

    let deviceHeaders: Record<string, string> = {};
    try {
      const { buildSessionRequestHeaders } = await import(
        "@/services/sessionRequestHeaders"
      );
      deviceHeaders = await buildSessionRequestHeaders();
    } catch {
      /* optional — backend falls back to single-device totals without it */
    }
    const res = await fetch(`${API_BASE}/api/walk/steps`, {
      method: "POST",
      signal: timeoutSignal(STEP_SYNC_TIMEOUT),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session}`,
        ...deviceHeaders,
      },
      body: JSON.stringify(body),
    });
    if (__DEV__) {
      console.log(
        `[API] request completed: /api/walk/steps ${res.status} delta=${steps} total=${totalSteps ?? "n/a"} source=${source ?? "n/a"}`,
      );
    }
    if (!res.ok) return null;
    const data = await res.json();
    // Soft-handle unknown/fake sources and unchanged totals — not errors.
    if (data?.ignored === true || data?.unchanged === true) {
      if (__DEV__) {
        console.log(
          `[API] /api/walk/steps ${data.ignored ? "ignored" : "unchanged"} submitted=${data.submitted ?? "n/a"}`,
        );
      }
      return {
        activeMinutes: data.today?.activeMinutes,
        dailyRank: data.today?.dailyRank,
        ignored: data.ignored === true,
        unchanged: data.unchanged === true,
      };
    }
    return {
      activeMinutes: data.today?.activeMinutes,
      dailyRank: data.today?.dailyRank,
    };
  } catch {
    return null;
  }
}

export function WalkProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading, sessionToken } = useAuth();
  const authReady = !authLoading;
  const [trackingStatus, setTrackingStatusState] =
    useState<TrackingStatus>("idle");
  const [session, setSession] = useState<WalkSession>({
    steps: 0,
    distance: 0,
    calories: 0,
    durationSeconds: 0,
  });
  const [todaySteps, setTodaySteps] = useState(0);
  const [weeklySteps, setWeeklySteps] = useState(0);
  const [allTimeSteps, setAllTimeSteps] = useState(0);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [activeDurationMinutes, setActiveDurationMinutes] = useState(0);
  const [milestoneReached, setMilestoneReached] = useState<number | null>(null);
  const [autoTrackingEnabled] = useState(true);
  const [usingRealTracking, setUsingRealTracking] = useState(false);
  const [stepPermissionStatus, setStepPermissionStatus] =
    useState<PermissionStatus>("unknown");
  const [hcAvailability, setHcAvailability] = useState<HCAvailability | null>(null);
  const [activeStepSource, setActiveStepSource] = useState<AndroidStepSourceId | "ios_healthkit" | null>(null);
  const [verificationLevel, setVerificationLevel] = useState<VerificationLevel>("unsupported");
  const [todayActiveMinutes, setTodayActiveMinutes] = useState(0);
  const [todayDailyRank, setTodayDailyRank] = useState<number | null>(null);
  const [todayDailyGoal, setTodayDailyGoal] = useState(10000);

  const stepIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoPauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realStepPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backendSyncRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMilestoneRef = useRef<number>(0);
  const startupSyncFiredRef = useRef(false);
  const permissionRequestInFlightRef = useRef(false);
  const syncDeltaInFlightRef = useRef(false);
  const syncDeltaQueuedForceRef = useRef(false);
  const savedDailyStepsRef = useRef<number>(0);
  const sessionRef = useRef<WalkSession>({
    steps: 0,
    distance: 0,
    calories: 0,
    durationSeconds: 0,
  });
  const todayStepsRef = useRef<number>(0);
  /**
   * A single verified (HC/HK) read reporting a much lower total than what's
   * already confirmed (e.g. HC=125 vs already-shown 5,000) can be a transient
   * lagging/partial aggregate — not proof the previous total was a bad sensor
   * baseline. Require the same low reading to repeat before trusting it as a
   * genuine correction, so one bad read never instantly wipes real progress.
   * Cleared as soon as a reading no longer looks inflated.
   */
  const verifiedDownwardCandidateRef = useRef<{ value: number; at: number } | null>(null);
  const syncingFromReduxRef = useRef(false);
  const todayDailyGoalRef = useRef<number>(10000);
  const allTimeStepsRef = useRef<number>(0);
  const lastSyncedStepsRef = useRef<number>(0);
  const trackingDayRef = useRef<string>(getTodayKey());
  const usingRealRef = useRef(false);
  const sessionStartTimeRef = useRef<Date | null>(null);
  const activeStepSourceRef = useRef<AndroidStepSourceId | "ios_healthkit" | null>(
    null,
  );
  const iconSyncReadyRef = useRef(false);
  const [stepsHydrated, setStepsHydrated] = useState(false);
  const [stepsSourceReady, setStepsSourceReady] = useState(false);
  /** Backend-authoritative today total for the signed-in user (per account). */
  const backendTodayStepsRef = useRef(0);
  /** Provider/device reading captured when backend hydration completes for this user. */
  const providerStepsAtBindRef = useRef(0);
  /** Last accepted legacy provider poll — used to detect sudden sensor glitches. */
  const lastProviderPollRef = useRef(0);
  const stepBindUserIdRef = useRef<string | null>(null);
  const priorAuthUserIdRef = useRef<string | null>(null);
  const refreshRealStepsRef = useRef<
    (opts?: {
      rehydrateBackend?: boolean;
      mergeNative?: boolean;
      applyDisplay?: boolean;
      freshDay?: boolean;
    }) => Promise<void>
  >(async () => {});

  useEffect(() => {
    setStepProgressUser(user?.id ?? null, user?.username ?? null);
  }, [user?.id, user?.username]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const lastTrayMirrorStepsRef = useRef(-1);
  const lastTrayMirrorAtRef = useRef(0);
  useEffect(() => {
    todayStepsRef.current = todaySteps;
    setWalkTodayStepsSnapshot(todaySteps);
    if (syncingFromReduxRef.current) return;
    if (!stepsSourceReady && todaySteps === 0) return;
    let cancelled = false;
    void (async () => {
      // todaySteps may arrive before cold-start gate opens — wait, then sync so
      // Redux + Daily Walk tray catch the Walk screen total (not stay stuck at ~2).
      await waitForAppStartupReady();
      if (cancelled || syncingFromReduxRef.current) return;
      const rawSource = stepProviderManager.toWalkSyncSource();
      const stepSource =
        rawSource === "android_health_connect"
          ? "health_connect"
          : rawSource === "ios_healthkit"
            ? "healthkit"
            : rawSource === "android_step_counter"
              ? "android_step_counter"
              : stepProviderManager.usesVerifiedStepSource()
                ? "health_connect"
                : "backend";
      const verifiedLane =
        stepSource === "health_connect" || stepSource === "healthkit";
      updateStepProgressFromRealSource({
        todaySteps,
        stepSource,
        dailyLane: verifiedLane ? "verified" : undefined,
      });
      // Force tray when Walk UI is ahead of last mirror (race-end stale body / missed push).
      const now = Date.now();
      const aheadOfMirror = todaySteps > lastTrayMirrorStepsRef.current + 5;
      const mirrorStale = now - lastTrayMirrorAtRef.current > 5_000;
      if (todaySteps > 0 && (aheadOfMirror || (mirrorStale && todaySteps !== lastTrayMirrorStepsRef.current))) {
        await pushWalkNotificationFromCanonicalStore(true, user?.id);
        lastTrayMirrorStepsRef.current = todaySteps;
        lastTrayMirrorAtRef.current = now;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [todaySteps, stepsSourceReady, user?.id]);

  useEffect(() => {
    todayDailyGoalRef.current = todayDailyGoal;
    store.dispatch(raceProgressActions.setDailyGoal(todayDailyGoal));
  }, [todayDailyGoal]);

  // Launcher icon milestones use verified steps only (not provisional display).
  useEffect(() => {
    if (!iconSyncReadyRef.current) return;
    const goal = todayDailyGoal > 0 ? todayDailyGoal : 10_000;
    const verified = Math.max(
      0,
      store.getState().raceProgress.verifiedTodaySteps ?? 0,
    );
    dynamicIconService.notifyStepsChanged(verified, goal, user?.id);
  }, [todaySteps, todayDailyGoal, user?.id]);

  useEffect(() => {
    allTimeStepsRef.current = allTimeSteps;
  }, [allTimeSteps]);
  useEffect(() => {
    usingRealRef.current = usingRealTracking;
  }, [usingRealTracking]);
  useEffect(() => {
    activeStepSourceRef.current = activeStepSource;
  }, [activeStepSource]);

  // ── Day-change detection ─────────────────────────────────────────────────────

  const checkDayChange = useCallback(async () => {
    const userId = user?.id;
    if (!userId) return;
    const previousLocalDate = trackingDayRef.current;
    const rolled = await handleMidnightRolloverIfNeeded();
    const today = getTodayKey();
    const dayChanged = rolled || trackingDayRef.current !== today;
    if (dayChanged) {
      trackingDayRef.current = today;
      lastMilestoneRef.current = 0;
      backendTodayStepsRef.current = 0;
      providerStepsAtBindRef.current = 0;
      setTodaySteps(0);
      todayStepsRef.current = 0;
      savedDailyStepsRef.current = 0;
      lastSyncedStepsRef.current = 0;
      setMilestoneReached(null);
      markFreshLocalDay(90_000);
      setWeeklySteps(await readWeeklyStepsForUser(userId));
      await storageSet(stepScopedKeys(userId, today).currentLocalDate, today);
      stepEngineLog(
        "DayReset",
        `previousDate=${previousLocalDate} currentDate=${today} reset=true`,
      );
      dynamicIconService.notifyStepsChanged(
        0,
        todayDailyGoalRef.current > 0 ? todayDailyGoalRef.current : 10_000,
      );
      setStepsSourceReady(false);
      // Refresh sources but do not revive yesterday via Math.max(local/store).
      void refreshRealStepsRef.current({ rehydrateBackend: true, freshDay: true });
    }
  }, [user?.id]);

  const resetWalkUiForNewDay = useCallback(() => {
    trackingDayRef.current = getTodayKey();
    lastMilestoneRef.current = 0;
    setTodaySteps(0);
    todayStepsRef.current = 0;
    savedDailyStepsRef.current = 0;
    lastSyncedStepsRef.current = 0;
    backendTodayStepsRef.current = 0;
    markFreshLocalDay(90_000);
    setMilestoneReached(null);
    dynamicIconService.notifyStepsChanged(
      0,
      todayDailyGoalRef.current > 0 ? todayDailyGoalRef.current : 10_000,
    );
  }, []);

  const resetWalkUiForAccountSwitch = useCallback(() => {
    startupSyncFiredRef.current = false;
    trackingDayRef.current = getTodayKey();
    lastMilestoneRef.current = 0;
    backendTodayStepsRef.current = 0;
    providerStepsAtBindRef.current = 0;
    lastProviderPollRef.current = 0;
    stepBindUserIdRef.current = null;
    if (realStepPollRef.current) {
      clearInterval(realStepPollRef.current);
      realStepPollRef.current = null;
    }
    if (backendSyncRef.current) {
      clearInterval(backendSyncRef.current);
      backendSyncRef.current = null;
    }
    stepProviderManager.stopWatchingSteps?.();
    try {
      const { stopHybridLiveDailyDisplay } = require("@/services/steps/hybridLiveDailyDisplay") as typeof import("@/services/steps/hybridLiveDailyDisplay");
      stopHybridLiveDailyDisplay();
    } catch {
      /* optional */
    }
    void stepTrackingNotificationService.stop();
    stopWalkBackgroundStepPoll();
    setUsingRealTracking(false);
    usingRealRef.current = false;
    setTrackingStatusState("idle");
    setTodaySteps(0);
    todayStepsRef.current = 0;
    savedDailyStepsRef.current = 0;
    lastSyncedStepsRef.current = 0;
    setWeeklySteps(0);
    setAllTimeSteps(0);
    setCurrentStreak(0);
    setTodayActiveMinutes(0);
    setTodayDailyRank(null);
    setTodayDailyGoal(10000);
    setMilestoneReached(null);
    setStepsSourceReady(false);
    dynamicIconService.notifyStepsChanged(0, 10_000);
    stepEngineLog("AuthSwitch", "clearedStepState=true");
  }, []);

  useEffect(() => {
    if (!user?.id) {
      if (priorAuthUserIdRef.current) {
        resetWalkUiForAccountSwitch();
      }
      priorAuthUserIdRef.current = null;
      setStepsHydrated(true);
      return;
    }

    const prior = priorAuthUserIdRef.current;
    if (prior && prior !== user.id) {
      resetWalkUiForAccountSwitch();
      setStepsHydrated(false);
      iconSyncReadyRef.current = false;
      stepEngineLog("AuthSwitch", `accountSwitch from=${prior} to=${user.id}`);
    }
    priorAuthUserIdRef.current = user.id;
  }, [user?.id, resetWalkUiForAccountSwitch]);

  const captureProviderBindSnapshot = useCallback(async () => {
    if (!user?.id) return;
    try {
      const provider = await stepProviderManager.getTodaySteps();
      const providerSteps = Math.max(0, provider?.steps ?? 0);
      providerStepsAtBindRef.current = providerSteps;
      stepBindUserIdRef.current = user.id;
      stepEngineLog(
        "StepBaseline",
        `userId=${user.id} localDate=${getTodayKey()} baseline=${providerStepsAtBindRef.current} created=false`,
      );
    } catch {
      providerStepsAtBindRef.current = backendTodayStepsRef.current;
      stepBindUserIdRef.current = user.id;
    }
  }, [user?.id]);

  const computeAccountAwareDisplaySteps = useCallback(
    (providerSteps: number): number => {
      const provider = Math.max(0, Math.floor(providerSteps));
      if (!user?.id) return 0;
      if (stepBindUserIdRef.current !== user.id) {
        return backendTodayStepsRef.current;
      }
      // Account-switch isolation is only ever applied once, as the initial seed
      // during hydrate (see accountSwitched branch below). It must NOT be
      // consulted on every ongoing poll here: HC/HK aggregate reads can lag or
      // briefly under-report between polls, and re-deriving floor+delta fresh
      // from a raw (non-monotonic) reading each tick caused visible step-count
      // flicker (e.g. 55 -> 70 -> 55 -> 70) during live races. The monotonic
      // path below (backed by lastProviderPollRef) is always safe to use here.
      const display = resolveTodayDisplaySteps({
        providerSteps: provider,
        backendSteps: backendTodayStepsRef.current,
        allowBackendCatchUp:
          stepProviderManager.getActiveProviderId() === "android_legacy_sensor",
        previousProviderSteps: lastProviderPollRef.current || backendTodayStepsRef.current,
      });
      if (display >= lastProviderPollRef.current) {
        lastProviderPollRef.current = display;
      }
      logStepAccuracyAudit({
        surface: "walk",
        providerSteps: provider,
        backendSteps: backendTodayStepsRef.current,
        displaySteps: display,
        providerId: stepProviderManager.getActiveProviderId(),
      });
      return display;
    },
    [user?.id],
  );

  const readProviderTodaySteps = useCallback(async (opts?: { mergeNative?: boolean }): Promise<number> => {
    try {
      await stepProviderManager.initialize();
      const data = await stepProviderManager.getTodaySteps();
      let steps = Math.max(0, data?.steps ?? 0);
      if (
        opts?.mergeNative &&
        Platform.OS === "android" &&
        data &&
        !stepProviderManager.usesVerifiedStepSource()
      ) {
        steps = await mergeWalkStepsWithNative(steps);
      }
      stepEngineLog(
        "StepEngine",
        `healthTodaySteps=${steps} provider=${stepProviderManager.getActiveProviderId() ?? "none"}`,
      );
      return steps;
    } catch {
      return 0;
    }
  }, []);

  useEffect(() => {
    return subscribeMidnightRollover(() => {
      resetWalkUiForNewDay();
    });
  }, [resetWalkUiForNewDay]);

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id) return;
      const tick = () => {
        const today = getTodayKey();
        if (trackingDayRef.current !== today) {
          void checkDayChange();
        }
      };
      id = setInterval(tick, 10_000);
    };
    const stop = () => {
      if (id) {
        clearInterval(id);
        id = null;
      }
    };
    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void checkDayChange();
        start();
      } else {
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [checkDayChange]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleMidnight = () => {
      timer = setTimeout(() => {
        timer = null;
        void checkDayChange();
        scheduleMidnight();
      }, msUntilNextLocalMidnight(1_000));
    };
    scheduleMidnight();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [checkDayChange]);

  // ── Load stored values on mount ──────────────────────────────────────────────

  useEffect(() => {
    const load = async () => {
      if (!user?.id) {
        resetWalkUiForAccountSwitch();
        setStepsHydrated(true);
        return;
      }
      try {
        await waitForAppStartupReady();
        const accountSwitched = await bindStepSessionToUser(user.id);
        if (accountSwitched) {
          resetWalkUiForAccountSwitch();
        }
        const rolled = await handleMidnightRolloverIfNeeded();
        const today = getTodayKey();
        const keys = stepScopedKeys(user.id, today);
        const allTime = await storageGet<number>(keys.totalSteps);
        const streak = await storageGet<number>(keys.streak);

        // Show scoped local cache immediately — do not wait for backend/API.
        // Prefer verified Redux boot from bind (already scrubbed of FGS absolutes).
        const reduxBoot =
          store.getState().raceProgress.userId === user.id
            ? Math.max(
                0,
                Math.floor(
                  store.getState().raceProgress.verifiedTodaySteps ??
                    store.getState().raceProgress.todaySteps,
                ),
              )
            : 0;
        const localCachedBoot = await readDailyStepsForUserDate(user.id, today);
        let displaySteps = rolled
          ? 0
          : stepProviderManager.usesVerifiedStepSource()
            ? // Don't flash yesterday's AsyncStorage absolute before HC hydrate.
              reduxBoot
            : Math.max(localCachedBoot, reduxBoot);
        if (rolled) {
          markFreshLocalDay(90_000);
          setTodaySteps(0);
          todayStepsRef.current = 0;
          savedDailyStepsRef.current = 0;
          lastSyncedStepsRef.current = 0;
          backendTodayStepsRef.current = 0;
        }
        // Native FGS/notification already tracked today's total (monotonic floor,
        // persisted across app restarts) and answers instantly — Health Connect's
        // first cold read can take a while. Seed the Walk UI from it now so the
        // screen never sits at 0 for a minute+ while the notification already
        // shows the real count (same-day only; never adopt a stale native total).
        if (!rolled && Platform.OS === "android" && stepProviderManager.usesVerifiedStepSource()) {
          try {
            const native = await stepTrackingNotificationService.getNativeStepState(user.id);
            if (native && native.localDate === today) {
              const nativeToday = Math.max(0, Math.floor(native.todaySteps ?? 0));
              if (nativeToday > displaySteps) {
                displaySteps = nativeToday;
              }
            }
          } catch {
            /* optional — fall through to HC/backend hydrate below */
          }
        }

        const cachedAtStart = displaySteps;
        // Unblock Walk tab immediately; backend/provider reconcile continues below.
        setStepsHydrated(true);
        if (displaySteps > 0) {
          setTodaySteps(displaySteps);
          todayStepsRef.current = displaySteps;
          savedDailyStepsRef.current = displaySteps;
          // Do not treat a local/UI boot absolute as "backend" — that blocked
          // clearing yesterday when HC later reported a small today total.
          backendTodayStepsRef.current = 0;
          setStepsSourceReady(true);
          stepEngineLog(
            "StepEngine",
            `init userId=${user.id} localDate=${today} cachedTodaySteps=${displaySteps}`,
          );
        }

        const session = await getValidSession();
        if (session) {
          try {
            const localCached = displaySteps;
            const [providerSteps, parsed] = await Promise.all([
              readProviderTodaySteps(),
              queryClient
                .fetchQuery({
                  queryKey: stepsKeys.today(user.id, today),
                  queryFn: () => fetchTodayWalkFromApi(user.id, today),
                })
                .catch(() => null),
            ]);
            if (parsed?.dailyRank !== null && parsed?.dailyRank !== undefined) {
              setTodayDailyRank(parsed.dailyRank);
            }
            if (parsed && parsed.activeMinutes > 0) {
              setTodayActiveMinutes(parsed.activeMinutes);
            }
            if (parsed && parsed.goalSteps > 0) {
              setTodayDailyGoal(parsed.goalSteps);
            } else {
              // Prefer onboarding selection when profile has no goal yet.
              const onboardingGoal = await getSelectedDailyGoal();
              if (onboardingGoal > 0) setTodayDailyGoal(onboardingGoal);
            }
            const backendSteps = parsed?.todaySteps ?? 0;
            backendTodayStepsRef.current =
              rolled && backendSteps === 0 ? 0 : backendSteps;
            const verifiedActive = stepProviderManager.usesVerifiedStepSource();
            // With HC/HK, never floor from a stale local absolute when the
            // provider already answered 0 for today (yesterday revival).
            const localForFloor =
              rolled ||
              isFreshLocalDay() ||
              (verifiedActive &&
                providerSteps === 0 &&
                backendTodayStepsRef.current === 0)
                ? 0
                : localCached;
            const floor = Math.max(
              localForFloor,
              backendTodayStepsRef.current,
              verifiedActive && providerSteps === 0
                ? 0
                : todayStepsRef.current,
            );
            let usedAccountIsolation = false;
            if (verifiedActive) {
              let isolatedDisplay: number | null = null;
              try {
                const {
                  beginVerifiedAccountStepIsolation,
                } = require("@/services/steps/verifiedAccountStepIsolation") as typeof import("@/services/steps/verifiedAccountStepIsolation");
                // Account switch: never seed UI from shared device HC total.
                // This is a ONE-TIME seed only — isolation is never re-applied on
                // later polls (see computeAccountAwareDisplaySteps) since raw
                // floor+delta math isn't monotonic and caused step-count flicker.
                if (accountSwitched) {
                  const accountFloor = Math.max(0, backendTodayStepsRef.current);
                  beginVerifiedAccountStepIsolation({
                    userId: user.id,
                    localDate: today,
                    accountFloor,
                    providerBaseline: providerSteps,
                  });
                  isolatedDisplay = accountFloor;
                  usedAccountIsolation = true;
                  stepEngineLog(
                    "AuthSwitch",
                    `hydrateIsolation userId=${user.id} floor=${accountFloor} hcBaseline=${providerSteps}`,
                  );
                }
              } catch {
                isolatedDisplay = null;
              }
              if (isolatedDisplay != null) {
                displaySteps = isolatedDisplay;
              } else {
                displaySteps = hydrateStepDisplayFromSources({
                  providerSteps,
                  backendSteps: backendTodayStepsRef.current,
                  localCachedSteps: localForFloor,
                  allowBackendCatchUp: false,
                  previousProviderSteps: displaySteps,
                  verifiedSource: true,
                });
                // Only raise to floor when HC has real steps or backend agrees.
                if (
                  providerSteps > 0 ||
                  backendTodayStepsRef.current > 0
                ) {
                  displaySteps = Math.max(displaySteps, floor);
                }
              }
            } else {
              // Legacy sensor: on init trust backend + cache only — provider updates via watch.
              displaySteps = floor;
            }
            if (!usedAccountIsolation) {
              if (!verifiedActive) {
                displaySteps = filterLegacyStepIncrease(floor, displaySteps, {
                  backendSteps: backendTodayStepsRef.current,
                });
              }
              if (rolled || isFreshLocalDay() || verifiedActive) {
                displaySteps = Math.min(
                  displaySteps,
                  Math.max(providerSteps, backendTodayStepsRef.current),
                );
              }
            }
            lastProviderPollRef.current = displaySteps;
            // Prefer backend total as lastSynced — never mark provider-only steps as synced.
            lastSyncedStepsRef.current = Math.min(
              Math.max(0, parsed?.todaySteps ?? 0),
              displaySteps,
            );
            await storageSet(keys.lastSyncedStepsCount, lastSyncedStepsRef.current);
            await storageSet(keys.currentLocalDate, today);
            setStepsSourceReady(true);
            stepEngineLog(
              "StepEngine",
              `init userId=${user.id} localDate=${today} finalTodaySteps=${displaySteps} backendTodaySteps=${backendTodayStepsRef.current} healthTodaySteps=${providerSteps} rolled=${rolled}`,
            );
            if (__DEV__) {
              console.log(
                `[WalkContext] provider-first hydrate userId=${user.id} localDate=${today} steps=${displaySteps}`,
              );
            }
          } catch {
            const localCached = await readDailyStepsForUserDate(user.id, today);
            let providerSteps = 0;
            try {
              providerSteps = await readProviderTodaySteps();
            } catch {
              providerSteps = 0;
            }
            displaySteps = hydrateStepDisplayFromSources({
              providerSteps,
              backendSteps: backendTodayStepsRef.current,
              localCachedSteps: localCached,
              allowBackendCatchUp:
                stepProviderManager.getActiveProviderId() === "android_legacy_sensor",
              previousProviderSteps: localCached,
            });
            displaySteps = Math.max(
              displaySteps,
              cachedAtStart,
              todayStepsRef.current,
            );
            if (displaySteps <= 0 && todayStepsRef.current > 0) {
              displaySteps = todayStepsRef.current;
            }
            backendTodayStepsRef.current = Math.max(
              backendTodayStepsRef.current,
              displaySteps,
            );
            setStepsSourceReady(true);
            stepEngineLog(
              "StepEngine",
              `backendHydrateFailed fallback finalTodaySteps=${displaySteps} provider=${providerSteps} local=${localCached}`,
            );
          }
        } else if (!rolled && !accountSwitched) {
          const providerSteps = await readProviderTodaySteps();
          if (providerSteps > 0 || displaySteps > 0) {
            displaySteps = hydrateStepDisplayFromSources({
              providerSteps,
              backendSteps: displaySteps,
              localCachedSteps: displaySteps,
              allowBackendCatchUp:
                stepProviderManager.getActiveProviderId() === "android_legacy_sensor",
            });
          }
          setStepsSourceReady(true);
        }

        setTodaySteps(displaySteps);
        todayStepsRef.current = displaySteps;
        savedDailyStepsRef.current = displaySteps;
        // Persist 0 when HC/HK says today is empty so AsyncStorage cannot revive yesterday.
        const forceVerifiedZero =
          stepProviderManager.usesVerifiedStepSource() &&
          displaySteps === 0;
        if (displaySteps > 0 || rolled || forceVerifiedZero) {
          await writeDailyStepsForUserDate(
            user.id,
            today,
            displaySteps,
            rolled || forceVerifiedZero
              ? { forceZero: true, immediate: true }
              : undefined,
          );
        }
        if (forceVerifiedZero) {
          if (Platform.OS === "android") {
            try {
              const { stepTrackingNotificationService } = await import(
                "@/services/stepTrackingNotificationService"
              );
              await stepTrackingNotificationService.resetDailyStepsForNewDay();
            } catch {
              /* non-fatal */
            }
          }
          store.dispatch(walkActions.setTodaySteps(0));
          store.dispatch(
            raceProgressActions.resetDailyStepsForNewDay({
              todaySteps: 0,
              updatedAt: new Date().toISOString(),
            }),
          );
          try {
            await pushWalkNotificationFromCanonicalStore(true, user.id);
          } catch {
            /* non-fatal */
          }
          stepEngineLog(
            "StepEngine",
            `init forceVerifiedZero userId=${user.id} localDate=${today}`,
          );
        }
        setWeeklySteps(await readWeeklyStepsForUser(user.id));
        await captureProviderBindSnapshot();

        if (session) {
          try {
            if (stepProviderManager.usesVerifiedStepSource()) {
              const authoritative = await resolveAuthoritativeTodaySteps(user.id, {
                mergeNative: false,
              });
              // Allow authoritative to lower an inflated UI/cache total (incl. HC=8 vs UI=9953).
              if (
                authoritative !== todayStepsRef.current &&
                (authoritative > todayStepsRef.current ||
                  isInflatedProvisionalVsVerified(
                    authoritative,
                    todayStepsRef.current,
                  ))
              ) {
                setTodaySteps(authoritative);
                todayStepsRef.current = authoritative;
                savedDailyStepsRef.current = authoritative;
                backendTodayStepsRef.current = Math.min(
                  backendTodayStepsRef.current,
                  authoritative,
                );
                await writeDailyStepsForUserDate(user.id, today, authoritative, {
                  forceZero: authoritative === 0,
                  immediate: true,
                });
                if (
                  authoritative === 0 ||
                  isInflatedProvisionalVsVerified(
                    authoritative,
                    store.getState().raceProgress.todaySteps,
                  )
                ) {
                  store.dispatch(
                    raceProgressActions.resetDailyStepsForNewDay({
                      todaySteps: authoritative,
                      updatedAt: new Date().toISOString(),
                    }),
                  );
                }
                updateStepProgressFromRealSource({
                  todaySteps: authoritative,
                  stepSource:
                    activeStepSourceRef.current === "ios_healthkit"
                      ? "healthkit"
                      : "health_connect",
                  dailyLane: "verified",
                  updatedAt: new Date().toISOString(),
                });
                stepEngineLog(
                  "StepEngine",
                  `init authoritativeTodaySteps=${authoritative} userId=${user.id}`,
                );
              }
            }
          } catch {
            // non-fatal — cached display remains
          }
        }
      if (allTime) setAllTimeSteps(allTime);
      if (streak) setCurrentStreak(streak);

      // If local cache is empty, hydrate from the server so values aren't stuck at 0
      // (happens on first install, app re-install, or cleared storage)
      if (!allTime || !streak) {
        try {
          const session = await getValidSession();
          if (session) {
            const res = await fetch(
              `${API_BASE}/api/profile/me?localDate=${encodeURIComponent(getTodayKey())}`,
              {
              headers: { Authorization: `Bearer ${session}` },
              signal: timeoutSignal(API_TIMEOUT_MS),
              },
            );
            if (res.ok) {
              const json = await res.json();
              const stats = json.data?.stats;
              if (stats?.allTimeSteps > 0 && !allTime) {
                setAllTimeSteps(stats.allTimeSteps);
                await storageSet(keys.totalSteps, stats.allTimeSteps);
              }
              if (stats?.dayStreak > 0 && !streak) {
                setCurrentStreak(stats.dayStreak);
                await storageSet(keys.streak, stats.dayStreak);
              }
            }
          }
        } catch {
          // non-critical — silently ignore
        }
      }

      const syncedCount = await storageGet<number>(
        keys.lastSyncedStepsCount,
      );
      // lastSynced must never exceed what the backend already has — otherwise a
      // local-only reading (e.g. HC=1, API=0) permanently blocks /api/walk/steps.
      const backendFloor = Math.max(0, backendTodayStepsRef.current);
      if (syncedCount !== null) {
        lastSyncedStepsRef.current = Math.min(
          Math.max(0, syncedCount),
          backendFloor,
          todayStepsRef.current,
        );
      } else {
        lastSyncedStepsRef.current = Math.min(backendFloor, todayStepsRef.current);
      }
      if (__DEV__) {
        console.log(
          `[WalkContext] lastSynced=${lastSyncedStepsRef.current} backend=${backendFloor} ui=${todayStepsRef.current} storedSynced=${syncedCount ?? "null"}`,
        );
      }

      trackingDayRef.current = getTodayKey();
      await checkDayChange();
      iconSyncReadyRef.current = true;
      dynamicIconService.notifyStepsChanged(
        todayStepsRef.current,
        todayDailyGoalRef.current > 0 ? todayDailyGoalRef.current : 10_000,
        user?.id,
      );
      setStepsSourceReady(true);
      setStepsHydrated(true);
    } catch (err) {
      console.warn("[Startup] WalkContext load failed", err);
      setStepsSourceReady(true);
      setStepsHydrated(true);
    }
    };
    void load();
  }, [checkDayChange, captureProviderBindSnapshot, readProviderTodaySteps, resetWalkUiForAccountSwitch, user?.id]);

  // ── Milestone helper ─────────────────────────────────────────────────────────

  const checkMilestone = useCallback((steps: number) => {
    const next = MILESTONES.find(
      (m) => steps >= m && lastMilestoneRef.current < m,
    );
    if (next) {
      lastMilestoneRef.current = next;
      setMilestoneReached(next);
    }
  }, []);

  // ── Persist steps to local storage ──────────────────────────────────────────

  /**
   * Gate for accepting a nonzero verified (HC/HK) reading that looks like a
   * big downward "inflation correction" (e.g. HC now reads 125 after the UI
   * already confirmed 5,000). A single HC/HK aggregate query can legitimately
   * come back lower than the true total mid-day (record sync lag across data
   * sources) — that must not be confused with the original bug this
   * correction exists for (a stale/bad sensor baseline left over from before).
   * Require a second, corroborating low reading within a short window before
   * trusting the drop; a genuine midnight rollover or explicit verified-zero
   * bypasses this (already separately gated by isFreshLocalDay/shouldAcceptVerifiedZero).
   */
  const shouldTrustVerifiedDownwardCorrection = useCallback(
    (candidate: number): boolean => {
      if (candidate <= 0 || isFreshLocalDay()) return true;
      const pending = verifiedDownwardCandidateRef.current;
      const corroborated =
        pending != null &&
        Math.abs(pending.value - candidate) <= 50 &&
        Date.now() - pending.at < 5 * 60 * 1000;
      if (corroborated) {
        verifiedDownwardCandidateRef.current = null;
        return true;
      }
      verifiedDownwardCandidateRef.current = { value: candidate, at: Date.now() };
      return false;
    },
    [],
  );

  const persistDailySteps = useCallback(async (steps: number) => {
    if (!user?.id) return;
    const today = getTodayKey();
    if (trackingDayRef.current !== today) {
      await handleMidnightRolloverIfNeeded();
      trackingDayRef.current = today;
    }
    const value = Math.max(0, Math.floor(steps));
    // Verified HC/HK may legitimately persist 0 for a new local day — otherwise
    // AsyncStorage keeps yesterday's absolute and Walk resurrects it on reload.
    const allowZero =
      value === 0 && stepProviderManager.usesVerifiedStepSource();
    await writeDailyStepsForUserDate(
      user.id,
      today,
      value,
      allowZero ? { forceZero: true, immediate: true } : undefined,
    );
    await storageSet(stepScopedKeys(user.id, today).currentLocalDate, today);
  }, [user?.id]);

  const forceSetTodayStepDisplay = useCallback(
    async (steps: number) => {
      const displaySteps = Math.max(0, Math.floor(steps));
      const today = getTodayKey();
      const previous = todayStepsRef.current;
      setTodaySteps(displaySteps);
      todayStepsRef.current = displaySteps;
      savedDailyStepsRef.current = displaySteps;
      await persistDailySteps(displaySteps);
      const correctingInflation =
        stepProviderManager.usesVerifiedStepSource() &&
        (displaySteps === 0 ||
          isInflatedProvisionalVsVerified(displaySteps, previous));
      if (correctingInflation) {
        store.dispatch(walkActions.setTodaySteps(displaySteps));
        store.dispatch(
          raceProgressActions.resetDailyStepsForNewDay({
            todaySteps: displaySteps,
            updatedAt: new Date().toISOString(),
          }),
        );
        if (displaySteps > 0) {
          updateStepProgressFromRealSource({
            todaySteps: displaySteps,
            stepSource: "health_connect",
            dailyLane: "verified",
            updatedAt: new Date().toISOString(),
          });
        }
        try {
          await pushWalkNotificationFromCanonicalStore(true, user?.id);
        } catch {
          /* non-fatal */
        }
      }
      dynamicIconService.notifyStepsChanged(
        displaySteps,
        todayDailyGoalRef.current > 0 ? todayDailyGoalRef.current : 10_000,
        user?.id,
      );
      if (trackingDayRef.current !== today) {
        trackingDayRef.current = today;
      }
    },
    [persistDailySteps, user?.id],
  );

  const hydrateTodayStepsFromBackend = useCallback(async (opts?: {
    skipProviderRead?: boolean;
    applyDisplay?: boolean;
  }) => {
    const applyDisplay = opts?.applyDisplay !== false;
    if (!user?.id) return;
    if (!authReady || !sessionToken) {
      if (__DEV__) {
        console.log(
          `[WalkScreen] skipped fetch reason=missing userId/token/authReady authReady=${authReady} tokenExists=${!!sessionToken}`,
        );
      }
      return;
    }
    await handleMidnightRolloverIfNeeded();
    try {
      const todayKey = getTodayKey();
      const keys = stepScopedKeys(user.id, todayKey);
      if (__DEV__) {
        console.log(
          `[WalkScreen] initializing step state for userId=${user.id} localDate=${todayKey}`,
        );
      }
      const localCached = await readDailyStepsForUserDate(user.id, todayKey);
      const providerRead = opts?.skipProviderRead
        ? Promise.resolve(Math.max(0, lastProviderPollRef.current))
        : readProviderTodaySteps();
      const backendRead = queryClient
        .fetchQuery({
          queryKey: stepsKeys.today(user.id, todayKey),
          queryFn: () => fetchTodayWalkFromApi(user.id, todayKey),
        })
        .catch(() => null);
      const [providerSteps, parsed] = await Promise.all([providerRead, backendRead]);

      if (parsed?.dailyRank !== null && parsed?.dailyRank !== undefined) {
        setTodayDailyRank(parsed.dailyRank);
      } else if (parsed) {
        setTodayDailyRank(null);
      }
      if (parsed && parsed.activeMinutes > 0) {
        setTodayActiveMinutes(parsed.activeMinutes);
      }
      if (parsed && parsed.goalSteps > 0) {
        setTodayDailyGoal(parsed.goalSteps);
      } else {
        const onboardingGoal = await getSelectedDailyGoal();
        if (onboardingGoal > 0) setTodayDailyGoal(onboardingGoal);
      }

      const backendSteps = parsed?.todaySteps ?? backendTodayStepsRef.current;
      const verifiedActive = stepProviderManager.usesVerifiedStepSource();
      if (parsed && parsed.todaySteps === 0 && localCached > 0) {
        if (isFreshLocalDay() || verifiedActive) {
          stepEngineLog("Sync", `trustBackendZero=true ignoredLocal=${localCached}`);
        } else {
          stepEngineLog("Sync", `skippedStaleBackendZero=true backend=0 local=${localCached}`);
        }
      }
      backendTodayStepsRef.current =
        (isFreshLocalDay() || verifiedActive) && parsed?.todaySteps === 0
          ? 0
          : backendSteps;
      const effectiveLocal =
        isFreshLocalDay() ||
        (verifiedActive &&
          providerSteps === 0 &&
          backendTodayStepsRef.current === 0)
          ? 0
          : localCached;
      // Account-switch isolation is only ever seeded once (mount hydrate above);
      // it is never re-applied here on ongoing refresh cycles — raw floor+delta
      // math isn't monotonic against HC/HK's aggregate reads and caused visible
      // step-count flicker.
      const mergedDisplay = hydrateStepDisplayFromSources({
        providerSteps,
        backendSteps: backendTodayStepsRef.current,
        localCachedSteps: effectiveLocal,
        allowBackendCatchUp:
          stepProviderManager.getActiveProviderId() === "android_legacy_sensor",
        previousProviderSteps: providerStepsAtBindRef.current || effectiveLocal,
        verifiedSource: verifiedActive,
      });
      const displaySteps =
        isFreshLocalDay() || verifiedActive
          ? mergedDisplay
          : Math.max(mergedDisplay, todayStepsRef.current, localCached);
      if (displaySteps >= lastProviderPollRef.current) {
        lastProviderPollRef.current = displaySteps;
      }
      lastSyncedStepsRef.current = Math.min(
        Math.max(0, backendTodayStepsRef.current),
        displaySteps,
      );
      await storageSet(keys.lastSyncedStepsCount, lastSyncedStepsRef.current);
      await storageSet(keys.currentLocalDate, todayKey);
      const hydratedDisplay =
        isFreshLocalDay() || verifiedActive
          ? clampHydratedDisplaySteps(
              displaySteps,
              // Don't let an inflated Walk UI floor block HC=0.
              verifiedActive && displaySteps === 0 ? 0 : todayStepsRef.current,
              backendTodayStepsRef.current,
            )
          : Math.max(
              clampHydratedDisplaySteps(
                displaySteps,
                todayStepsRef.current,
                backendTodayStepsRef.current,
              ),
              todayStepsRef.current,
              localCached,
            );
      if (
        applyDisplay &&
        (isFreshLocalDay() ||
          hydratedDisplay > todayStepsRef.current ||
          (verifiedActive &&
            hydratedDisplay === 0 &&
            todayStepsRef.current > 250) ||
          (verifiedActive &&
            isInflatedProvisionalVsVerified(
              hydratedDisplay,
              todayStepsRef.current,
            )))
      ) {
        const isDownwardCorrection =
          (isFreshLocalDay() || verifiedActive) &&
          (hydratedDisplay === 0 ||
            isInflatedProvisionalVsVerified(
              hydratedDisplay,
              todayStepsRef.current,
            ));
        if (isDownwardCorrection) {
          if (shouldTrustVerifiedDownwardCorrection(hydratedDisplay)) {
            await forceSetTodayStepDisplay(hydratedDisplay);
          } else {
            stepEngineLog(
              "WalkScreen",
              `deferredInflationCorrection previous=${todayStepsRef.current} candidate=${hydratedDisplay} awaitingConfirmation=true`,
            );
          }
        } else if (hydratedDisplay > todayStepsRef.current) {
          await forceSetTodayStepDisplay(hydratedDisplay);
        }
      }
      await captureProviderBindSnapshot();
      setStepsSourceReady(true);
      stepEngineLog(
        "WalkScreen",
        `renderedTodaySteps=${hydratedDisplay} backend=${backendSteps} provider=${providerSteps}`,
      );
      logStepAccuracyAudit({
        surface: "hydrate",
        providerSteps,
        backendSteps,
        displaySteps,
        lastSynced: lastSyncedStepsRef.current,
      });
      if (iconSyncReadyRef.current) {
        dynamicIconService.notifyStepsChanged(
          todayStepsRef.current,
          todayDailyGoalRef.current > 0 ? todayDailyGoalRef.current : 10_000,
          user.id,
        );
      }
    } catch {
      const todayKey = getTodayKey();
      const localCached = user?.id
        ? await readDailyStepsForUserDate(user.id, todayKey)
        : 0;
      let providerSteps = 0;
      try {
        providerSteps = await readProviderTodaySteps();
      } catch {
        providerSteps = 0;
      }
      const displaySteps = hydrateStepDisplayFromSources({
        providerSteps,
        backendSteps: backendTodayStepsRef.current,
        localCachedSteps: localCached,
        allowBackendCatchUp:
          stepProviderManager.getActiveProviderId() === "android_legacy_sensor",
        previousProviderSteps: localCached || todayStepsRef.current,
      });
      const finalDisplay =
        displaySteps > 0
          ? displaySteps
          : Math.max(todayStepsRef.current, localCached);
      stepEngineLog(
        "StepEngine",
        `backendHydrateFailed fallback finalTodaySteps=${finalDisplay} provider=${providerSteps} local=${localCached}`,
      );
      if (applyDisplay && finalDisplay > 0) {
        backendTodayStepsRef.current = Math.max(
          backendTodayStepsRef.current,
          finalDisplay,
        );
        await forceSetTodayStepDisplay(finalDisplay);
      } else if (finalDisplay > 0) {
        backendTodayStepsRef.current = Math.max(
          backendTodayStepsRef.current,
          finalDisplay,
        );
      }
      await captureProviderBindSnapshot();
      setStepsSourceReady(true);
    }
  }, [
    authReady,
    captureProviderBindSnapshot,
    forceSetTodayStepDisplay,
    readProviderTodaySteps,
    sessionToken,
    shouldTrustVerifiedDownwardCorrection,
    user?.id,
  ]);

  // ── Backend delta sync ────────────────────────────────────────────────────────

  const syncDeltaToBackend = useCallback(async (opts?: { force?: boolean }) => {
    if (!user?.id) return;
    if (isWalkBackendSyncPaused()) return;
    if (syncDeltaInFlightRef.current) {
      if (opts?.force) syncDeltaQueuedForceRef.current = true;
      return;
    }
    syncDeltaInFlightRef.current = true;
    try {
    const rawCurrent = todayStepsRef.current;
    const providerSteps = await readProviderTodaySteps();
    const verifiedLane = Math.max(
      0,
      store.getState().raceProgress.verifiedTodaySteps ?? 0,
    );
    // Never fall back to display/provisional when verified lane is 0.
    const selectedVerified = selectVerifiedTodayStepsForSync({
      verifiedTodaySteps: verifiedLane,
      displayTodaySteps: rawCurrent,
      lastHcProviderSteps: providerSteps,
    });
    const syncTotal = capWalkStepsForSync(
      selectedVerified,
      providerSteps,
      true,
      backendTodayStepsRef.current,
    );
    if (syncTotal < rawCurrent) {
      stepEngineLog(
        "StepSync",
        `capped syncTotal=${syncTotal} ui=${rawCurrent} provider=${providerSteps ?? "n/a"} backend=${backendTodayStepsRef.current}`,
      );
    }

    const usesVerified = stepProviderManager.usesVerifiedStepSource();
    const minDelta = opts?.force
      ? 1
      : usesVerified
        ? STEP_SYNC_CONFIG.WALK_BACKEND_SYNC_MIN_DELTA_VERIFIED
        : STEP_SYNC_CONFIG.WALK_BACKEND_SYNC_MIN_DELTA_LEGACY;

    let providerQueryStatus: VerifiedDailyProviderQueryStatus = "unknown";
    if (providerSteps == null) {
      providerQueryStatus = "temporary_error";
    } else if (providerSteps <= 0) {
      providerQueryStatus = "empty";
    } else {
      providerQueryStatus = "ok";
    }

    const decision = decideVerifiedDailySync({
      authenticated: Boolean(user?.id),
      localDateValid: Boolean(getTodayKey()),
      trackingComplete: usesVerified || selectedVerified > 0,
      verifiedTodaySteps: verifiedLane,
      displayTodaySteps: rawCurrent,
      lastHcProviderSteps: providerSteps,
      providerQueryStatus,
      backendTodaySteps: backendTodayStepsRef.current,
      lastSyncedSteps: lastSyncedStepsRef.current,
      syncTotalAfterCap: syncTotal,
      platform: Platform.OS,
      minDelta,
    });

    if (decision.action === "preserve_backend") {
      stepEngineLog(
        "StepSync",
        `preserve_backend reason=${decision.reason} verified=${verifiedLane} ui=${rawCurrent}`,
      );
      return;
    }
    if (decision.action === "skip") {
      if (__DEV__ && opts?.force) {
        console.log(
          `[StepSync] force skipped reason=${decision.reason} syncTotal=${syncTotal} lastSynced=${lastSyncedStepsRef.current}`,
        );
      }
      return;
    }

    const current = decision.steps;
    const lastSynced = lastSyncedStepsRef.current;
    const delta = current - lastSynced;
    if (delta <= 0) return;

    const distanceMeters = Math.round(stepsToDistance(delta));
    const calories = Math.round(stepsToCalories(delta));
    const activeMinutes = Math.ceil(current / 120);

    const rawSource = stepProviderManager.toWalkSyncSource();
    if (isProvisionalDailyStepSource(rawSource)) {
      stepEngineLog(
        "StepSync",
        `blocked provisional walk sync source=${rawSource}`,
      );
      return;
    }
    const source =
      decision.source === "healthkit"
        ? STEP_SOURCES.verifiedDailyIOS
        : STEP_SOURCES.verifiedDailyAndroid;
    assertVerifiedDailySyncSource(source);

    stepEngineLog(
      "StepSync",
      `payload steps=${delta} totalSteps=${current} source=${source} localDate=${getTodayKey()}`,
    );

    const result = await submitStepsToBackend(
      delta,
      distanceMeters,
      calories,
      0,
      activeMinutes,
      current,
      source,
      user.id,
    );
    if (!result) {
      await saveWalkStepsOutbox({
        userId: user.id,
        totalSteps: current,
        stepSource: source,
        localDate: getTodayKey(),
        updatedAt: new Date().toISOString(),
      });
      stepEngineLog("StepSync", "serverResponse=queued_offline");
      return;
    }

    stepEngineLog("StepSync", `serverResponse=ok todaySteps=${current}`);

    const today = getTodayKey();
    await clearWalkStepsOutbox(user.id, today);
    if (result?.dailyRank !== undefined)
      setTodayDailyRank(result.dailyRank ?? null);
    if (result?.activeMinutes !== undefined && result.activeMinutes > 0) {
      setTodayActiveMinutes(result.activeMinutes);
    }

    backendTodayStepsRef.current = Math.max(backendTodayStepsRef.current, current);
    lastSyncedStepsRef.current = current;
    await storageSet(stepScopedKeys(user.id, today).lastSyncedStepsCount, current);

    dynamicIconService.notifyStepsChanged(
      current,
      todayDailyGoalRef.current > 0 ? todayDailyGoalRef.current : 10_000,
    );
    } finally {
      syncDeltaInFlightRef.current = false;
      if (syncDeltaQueuedForceRef.current) {
        syncDeltaQueuedForceRef.current = false;
        void syncDeltaToBackend({ force: true }).catch(() => {});
      }
    }
  }, [readProviderTodaySteps, user?.id]);

  const flushWalkStepsOutbox = useCallback(async () => {
    if (!user?.id) return;
    const today = getTodayKey();
    const entry = await loadWalkStepsOutbox(user.id, today);
    if (!entry || entry.localDate !== today || entry.userId !== user.id) {
      if (entry) await clearWalkStepsOutbox(user.id, today);
      return;
    }
    const pending = entry.totalSteps - lastSyncedStepsRef.current;
    if (pending <= 0) {
      await clearWalkStepsOutbox(user.id, today);
      return;
    }
    await syncDeltaToBackend();
  }, [syncDeltaToBackend, user?.id]);

  const reconcileLegacyProviderSteps = useCallback(async (steps: number) => {
    if (stepProviderManager.getActiveProviderId() !== "android_legacy_sensor") return;
    const legacy = stepProviderManager.getActiveProvider() as
      | typeof import("@/services/steps/providers/androidLegacySensorProvider").androidLegacySensorProvider
      | null;
    if (legacy?.reconcileTodaySteps) {
      await legacy.reconcileTodaySteps(steps);
    }
  }, []);

  const suppressStartupStepBumps = useCallback((durationMs = 5_000) => {
    suppressLegacyStepBumps(durationMs);
  }, []);

  const applyTodayStepCount = useCallback(
    async (real: number, fromWatch = false) => {
      const safeReal = Math.max(0, Math.floor(real));
      const today = getTodayKey();

      if (trackingDayRef.current !== today) {
        await handleMidnightRolloverIfNeeded();
        trackingDayRef.current = today;
        lastMilestoneRef.current = 0;
        setTodaySteps(0);
        todayStepsRef.current = 0;
        savedDailyStepsRef.current = 0;
        lastSyncedStepsRef.current = 0;
        if (user?.id) {
          await storageSet(stepScopedKeys(user.id, today).currentLocalDate, today);
        }
      }

      const current = todayStepsRef.current;
      const delta = safeReal - current;
      const backendFloor = backendTodayStepsRef.current;

      if (
        shouldIgnoreLegacyPhantomBump(current, safeReal, {
          backendSteps: backendFloor,
          fromWatch,
        })
      ) {
        if (__DEV__) {
          console.log(
            `[WalkContext] ignored phantom +${delta} from=${fromWatch ? "watch" : "poll"} current=${current} incoming=${safeReal}`,
          );
        }
        try {
          const { stepAudit } = require("@/utils/stepAudit") as typeof import("@/utils/stepAudit");
          stepAudit.notePhantom({
            eventOrigin: fromWatch ? "watch" : "poll",
            previousDailySteps: current,
            calculatedDailySteps: safeReal,
            reason: "WalkContext.shouldIgnoreLegacyPhantomBump",
          });
        } catch {
          /* optional */
        }
        if (
          delta > 0 &&
          delta <= STEP_SYNC_CONFIG.WALK_PHANTOM_STEP_BUMP &&
          current === backendFloor
        ) {
          const legacy = stepProviderManager.getActiveProvider() as
            | { discardPhantomTodayBump?: (n: number) => Promise<void> }
            | null;
          void legacy?.discardPhantomTodayBump?.(backendFloor);
        }
        return;
      }

      // Provider reads are often +1 ahead of backend on tab focus/reload — not real steps.
      if (
        !fromWatch &&
        delta > 0 &&
        delta <= STEP_SYNC_CONFIG.WALK_PHANTOM_STEP_BUMP &&
        current === backendFloor &&
        safeReal === backendFloor + delta
      ) {
        if (__DEV__) {
          console.log(
            `[WalkContext] ignored provider-only +${delta} on refresh backend=${backendFloor} incoming=${safeReal}`,
          );
        }
        const legacy = stepProviderManager.getActiveProvider() as
          | { discardPhantomTodayBump?: (n: number) => Promise<void> }
          | null;
        void legacy?.discardPhantomTodayBump?.(backendFloor);
        return;
      }

      let displaySteps: number;
      if (stepProviderManager.usesVerifiedStepSource()) {
        // Drop yesterday-style absolutes only. Live sensor/HC growth must keep
        // updating Walk + the ongoing notification (same as before).
        // Empty mid-day HC polls (0 records) must not zero a known total.
        if (
          isInflatedProvisionalVsVerified(safeReal, current) &&
          shouldAcceptVerifiedZero({
            incomingSteps: safeReal,
            previousSteps: current,
            freshLocalDay: isFreshLocalDay(),
          })
        ) {
          if (!shouldTrustVerifiedDownwardCorrection(safeReal)) {
            stepEngineLog(
              "WalkScreen",
              `deferredInflationCorrection previous=${current} candidate=${safeReal} awaitingConfirmation=true`,
            );
            return;
          }
          displaySteps = safeReal;
          stepEngineLog(
            "WalkScreen",
            `clearedInflatedDisplay previous=${current} hc=${safeReal} backendFloor=${backendFloor}`,
          );
        } else {
          verifiedDownwardCandidateRef.current = null;
          displaySteps = Math.max(safeReal, current);
        }
      } else if (fromWatch) {
        displaySteps = sanitizeLegacyProviderSteps(
          mergeLegacyStepUpdate(current, safeReal),
          backendFloor,
          current,
        );
      } else {
        displaySteps = safeReal;
      }
      if (displaySteps === current) return;

      if (!fromWatch) {
        await reconcileLegacyProviderSteps(displaySteps);
      }

      setTodaySteps(displaySteps);
      todayStepsRef.current = displaySteps;
      savedDailyStepsRef.current = displaySteps;
      stepEngineLog(
        "WalkScreen",
        `receivedTodaySteps=${displaySteps} renderedTodaySteps=${displaySteps} watch=${fromWatch}`,
      );
      try {
        const { stepAudit } = require("@/utils/stepAudit") as typeof import("@/utils/stepAudit");
        stepAudit.noteSensorTick({
          providerId: stepProviderManager.getActiveProviderId(),
          calculatedDailySteps: displaySteps,
          eventOrigin: fromWatch ? "watch" : "poll",
          phantomEventDetected: false,
        });
      } catch {
        /* optional */
      }
      await persistDailySteps(displaySteps);
      checkMilestone(displaySteps);
      dynamicIconService.notifyStepsChanged(
        displaySteps,
        todayDailyGoalRef.current > 0 ? todayDailyGoalRef.current : 10_000,
        user?.id,
      );
      syncDeltaToBackend().catch(() => {});
    },
    [
      checkMilestone,
      persistDailySteps,
      reconcileLegacyProviderSteps,
      shouldTrustVerifiedDownwardCorrection,
      syncDeltaToBackend,
      user?.id,
    ],
  );

  const resolveLiveDisplaySteps = useCallback(
    (providerSteps: number): number => {
      const fromProvider = computeAccountAwareDisplaySteps(providerSteps);
      const rp = store.getState().raceProgress;
      const reduxSteps =
        rp.userId === user?.id ? Math.max(0, Math.floor(rp.todaySteps)) : 0;
      if (stepProviderManager.usesVerifiedStepSource()) {
        return resolveWalkNotificationSteps({
          verifiedTodaySteps: Math.max(
            fromProvider,
            Math.max(0, Math.floor(rp.verifiedTodaySteps ?? 0)),
          ),
          provisionalSensorTodaySteps: rp.provisionalSensorTodaySteps,
          todaySteps: reduxSteps,
          raceActive: rp.raceStatus === "active" || !!rp.companionRaceId,
        });
      }
      return Math.max(fromProvider, reduxSteps, todayStepsRef.current);
    },
    [computeAccountAwareDisplaySteps, user?.id],
  );

  const mirrorCanonicalStepsToWalkUi = useCallback(
    async (coordinatorSteps: number, reason: string) => {
      if (!user?.id) return;
      const display = Math.max(0, Math.floor(coordinatorSteps));
      if (display <= todayStepsRef.current) return;
      if (stepProviderManager.usesVerifiedStepSource()) {
        const verified = Math.max(
          0,
          Math.floor(store.getState().raceProgress.verifiedTodaySteps ?? 0),
        );
        if (isInflatedProvisionalVsVerified(verified, display)) {
          stepEngineLog(
            "WalkScreen",
            `canonicalMirror skipped inflated reason=${reason} coordinator=${coordinatorSteps} verified=${verified}`,
          );
          return;
        }
      }

      stepEngineLog(
        "WalkScreen",
        `canonicalMirror reason=${reason} coordinator=${coordinatorSteps} display=${display}`,
      );
      // Redux/FGS advances are live display ticks (same feed as the ongoing
      // notification). Always treat as fromWatch so HC poll phantom guards do
      // not drop single-step updates while the notification keeps moving.
      await applyTodayStepCount(display, true);
    },
    [applyTodayStepCount, user?.id],
  );

  const refreshRealSteps = useCallback(async (opts?: {
    rehydrateBackend?: boolean;
    mergeNative?: boolean;
    applyDisplay?: boolean;
    freshDay?: boolean;
  }) => {
    if (!user?.id) return;
    const rehydrateBackend = opts?.rehydrateBackend ?? true;
    const mergeNative = opts?.mergeNative === true;
    const applyDisplay = opts?.applyDisplay !== false;
    const freshDay = opts?.freshDay === true || isFreshLocalDay();
    const resumeStartedAt = Date.now();
    stepEngineLog("Resume", `refreshStarted=true applyDisplay=${applyDisplay} freshDay=${freshDay}`);
    await checkDayChange();
    const needsBind = stepBindUserIdRef.current !== user.id;

    if (!applyDisplay) {
      suppressStartupStepBumps(8_000);
      if (rehydrateBackend || needsBind) {
        await hydrateTodayStepsFromBackend({
          skipProviderRead: true,
          applyDisplay: false,
        });
      }
      setStepsSourceReady(true);
      return;
    }

    suppressStartupStepBumps(mergeNative ? 5_000 : 8_000);
    // Do NOT renew markFreshLocalDay here — that extended the midnight window forever
    // on every poll and let HC=0 wipe the Walk UI.

    const verifiedActive = stepProviderManager.usesVerifiedStepSource();
    let display: number;
    if (mergeNative && !freshDay) {
      display = await resolveAuthoritativeTodaySteps(user.id, {
        mergeNative: !verifiedActive,
      });
      stepEngineLog(
        "Resume",
        `authoritativeTodaySteps=${display} renderedImmediately=${display > 0}`,
      );
    } else {
      const data = await stepProviderManager.getTodaySteps();
      const providerSteps = Math.max(0, data?.steps ?? 0);
      display = resolveLiveDisplaySteps(providerSteps);
      if (!verifiedActive) {
        // Legacy only — verified HC/HK must not Math.max with yesterday's UI/FGS.
        display = Math.max(
          display,
          todayStepsRef.current,
          store.getState().raceProgress.todaySteps,
        );
      } else if (
        isInflatedProvisionalVsVerified(display, todayStepsRef.current)
      ) {
        stepEngineLog(
          "Resume",
          `dropInflatedUi previous=${todayStepsRef.current} hc=${display}`,
        );
      }
    }

    setStepsSourceReady(true);
    stepEngineLog(
      "WalkScreen",
      `renderedTodaySteps=${display} poll=true mergeNative=${mergeNative} freshDay=${freshDay}`,
    );
    stepEngineLog(
      "Resume",
      `sourceRefreshMs=${Date.now() - resumeStartedAt} renderedImmediately=${display > todayStepsRef.current}`,
    );

    const displayIsDownwardCorrection =
      verifiedActive &&
      display > 0 &&
      isInflatedProvisionalVsVerified(display, todayStepsRef.current);
    if (freshDay && display === 0) {
      await forceSetTodayStepDisplay(display);
    } else if (displayIsDownwardCorrection) {
      if (shouldTrustVerifiedDownwardCorrection(display)) {
        await forceSetTodayStepDisplay(display);
      } else {
        stepEngineLog(
          "Resume",
          `deferredInflationCorrection previous=${todayStepsRef.current} candidate=${display} awaitingConfirmation=true`,
        );
      }
    } else if (display > todayStepsRef.current) {
      await applyTodayStepCount(display, false);
    }
    if (display >= lastProviderPollRef.current) {
      lastProviderPollRef.current = display;
    }

    if (rehydrateBackend || needsBind) {
      const backendStartedAt = Date.now();
      await hydrateTodayStepsFromBackend({
        skipProviderRead: mergeNative && !freshDay,
        applyDisplay: true,
      });
      stepEngineLog(
        "Resume",
        `backendRefreshMs=${Date.now() - backendStartedAt}`,
      );
    }

    const rp = store.getState().raceProgress;
    const reduxToday =
      rp.userId === user.id ? Math.max(0, Math.floor(rp.todaySteps)) : 0;
    const verifiedLane = Math.max(0, Math.floor(rp.verifiedTodaySteps ?? 0));
    const finalSteps = freshDay
      ? Math.max(display, verifiedActive ? 0 : todayStepsRef.current)
      : mergeNative
        ? await resolveAuthoritativeTodaySteps(user.id, {
            mergeNative: !verifiedActive,
          })
        : verifiedActive
          ? resolveWalkNotificationSteps({
              // Never poison "verified" with stale Walk UI / Redux display.
              verifiedTodaySteps: Math.max(display, verifiedLane),
              provisionalSensorTodaySteps: rp.provisionalSensorTodaySteps,
              todaySteps: reduxToday,
              raceActive: rp.raceStatus === "active" || !!rp.companionRaceId,
            })
          : Math.max(display, todayStepsRef.current, reduxToday);

    const finalIsDownwardCorrection =
      verifiedActive &&
      finalSteps > 0 &&
      isInflatedProvisionalVsVerified(finalSteps, todayStepsRef.current);
    if (freshDay && finalSteps === 0) {
      await forceSetTodayStepDisplay(finalSteps);
      store.dispatch(walkActions.setTodaySteps(finalSteps));
      store.dispatch(
        raceProgressActions.resetDailyStepsForNewDay({
          todaySteps: finalSteps,
          updatedAt: new Date().toISOString(),
        }),
      );
    } else if (finalIsDownwardCorrection) {
      if (shouldTrustVerifiedDownwardCorrection(finalSteps)) {
        await forceSetTodayStepDisplay(finalSteps);
        store.dispatch(walkActions.setTodaySteps(finalSteps));
        store.dispatch(
          raceProgressActions.resetDailyStepsForNewDay({
            todaySteps: finalSteps,
            updatedAt: new Date().toISOString(),
          }),
        );
      } else {
        stepEngineLog(
          "Resume",
          `deferredInflationCorrection previous=${todayStepsRef.current} candidate=${finalSteps} awaitingConfirmation=true`,
        );
      }
    } else if (finalSteps > todayStepsRef.current) {
      await applyTodayStepCount(finalSteps, false);
    }

    // Only push true HC/HK into the verified lane — never a Math.max'd UI total.
    // Empty mid-day HC polls must not write verified=0.
    if (
      !freshDay &&
      verifiedActive &&
      finalSteps > 0 &&
      finalSteps !== store.getState().raceProgress.verifiedTodaySteps
    ) {
      updateStepProgressFromRealSource({
        todaySteps: finalSteps,
        stepSource:
          stepProviderManager.getActiveProviderId() === "ios_healthkit"
            ? "healthkit"
            : "health_connect",
        dailyLane: "verified",
        updatedAt: new Date().toISOString(),
      });
    } else if (
      !freshDay &&
      !verifiedActive &&
      finalSteps > store.getState().raceProgress.todaySteps
    ) {
      updateStepProgressFromRealSource({
        todaySteps: finalSteps,
        stepSource: "android_step_counter",
        updatedAt: new Date().toISOString(),
      });
    }

    await pushWalkNotificationFromCanonicalStore(true, user.id);
  }, [
    applyTodayStepCount,
    checkDayChange,
    forceSetTodayStepDisplay,
    hydrateTodayStepsFromBackend,
    mirrorCanonicalStepsToWalkUi,
    readProviderTodaySteps,
    resolveLiveDisplaySteps,
    user?.id,
  ]);

  useEffect(() => {
    refreshRealStepsRef.current = refreshRealSteps;
  }, [refreshRealSteps]);

  // Bridge canonical Redux step store → Walk screen (native FGS / coordinator updates).
  useEffect(() => {
    if (!user?.id) return;
    let lastReduxSteps = store.getState().raceProgress.todaySteps;
    const pullFromRedux = (reason: string) => {
      if (syncingFromReduxRef.current) return;
      const rp = store.getState().raceProgress;
      if (rp.userId !== user.id) return;
      if (rp.todaySteps === lastReduxSteps && reason === "redux") return;
      lastReduxSteps = rp.todaySteps;
      if (rp.todaySteps <= todayStepsRef.current) return;
      void mirrorCanonicalStepsToWalkUi(rp.todaySteps, reason);
    };
    // Immediate catch-up after bind/re-login (don't wait for the next FGS tick).
    pullFromRedux("redux-bind");
    return store.subscribe(() => pullFromRedux("redux"));
  }, [user?.id, mirrorCanonicalStepsToWalkUi]);

  const startProviderWatching = useCallback(async () => {
    try {
      suppressStartupStepBumps();
      await reconcileLegacyProviderSteps(todayStepsRef.current);
      await stepProviderManager.startWatchingSteps((result) => {
        if (__DEV__) {
          console.log(
            `[WalkContext] liveSteps provider=${result.providerId} steps=${result.steps}`,
          );
        }
        if (
          stepProviderManager.usesVerifiedStepSource() &&
          !shouldAcceptVerifiedZero({
            incomingSteps: result.steps,
            previousSteps: todayStepsRef.current,
            freshLocalDay: isFreshLocalDay(),
          })
        ) {
          return;
        }
        const display = resolveLiveDisplaySteps(result.steps);
        void applyTodayStepCount(display, true);
      });
      // Hybrid Android: HC often returns 0 — sensor keeps Walk + Redux moving
      // (same hardware path the ongoing notification uses).
      if (
        Platform.OS === "android" &&
        FEATURE_FLAGS.ENABLE_LIVE_RACE_DEVICE_SENSOR &&
        stepProviderManager.usesVerifiedStepSource()
      ) {
        const { startHybridLiveDailyDisplay } = await import(
          "@/services/steps/hybridLiveDailyDisplay"
        );
        await startHybridLiveDailyDisplay();
      }
    } catch (e) {
      if (__DEV__) console.log("[WalkContext] startProviderWatching error", e);
    }
  }, [applyTodayStepCount, reconcileLegacyProviderSteps, resolveLiveDisplaySteps, suppressStartupStepBumps]);

  const startRealPollInterval = useCallback(() => {
    startWalkBackgroundStepPoll();
  }, []);

  const stopRealPollInterval = useCallback(() => {
    // Coordinator-owned poll survives Walk tab unmount; stopped on logout/account switch.
  }, []);

  const applyTrackingActivation = useCallback(
    async (ongoingNotificationEnabled: boolean) => {
      setUsingRealTracking(true);
      usingRealRef.current = true;
      setTrackingStatusState("walking");

      try {
        suppressStartupStepBumps();
        // Physical activity + notification OS sheets are requested once during
        // activateStepTracking / setup — do not re-prompt on every Walk activation.
        await hydrateTodayStepsFromBackend();
        await refreshRealSteps({ rehydrateBackend: false });
        await startProviderWatching();
        startRealPollInterval();
        if (!backendSyncRef.current) {
          backendSyncRef.current = setInterval(
            () => {
              void syncDeltaToBackend();
            },
            BACKEND_SYNC_INTERVAL_MS,
          );
        }
        if (__DEV__) {
          console.log(
            `[WalkContext] poll+sync started provider=${stepProviderManager.getActiveProviderId() ?? "none"} ui=${todayStepsRef.current} lastSynced=${lastSyncedStepsRef.current}`,
          );
        }
        // Catch up backend immediately after enable (even small deltas).
        startupSyncFiredRef.current = false;
        void syncDeltaToBackend({ force: true });
        void tickWalkBackgroundStepPoll("resume");
        // Start ongoing notification only when OS access is on AND user preference allows.
        // Do not re-prompt or force-enable if the user turned notifications off.
        if (ongoingNotificationEnabled && user?.id) {
          try {
            setStepProgressUser(user.id, user.username ?? null);
            const started = await stepTrackingNotificationService.start({
              userId: user.id,
              todaySteps: todayStepsRef.current,
              dailyGoal: todayDailyGoalRef.current,
            });
            if (!started) {
              if (__DEV__) {
                console.log("[OngoingNotification] direct start returned false");
              }
            }
            void pushWalkNotificationFromCanonicalStore(true, user.id);
          } catch (notifErr) {
            console.warn("[OngoingNotification] notification start error", notifErr);
          }
        } else if (__DEV__ && Platform.OS === "android") {
          console.log(
            "[Steps] ongoing notification left off — OS denied or Profile preference off",
          );
        }
      } catch (e) {
        console.warn("[WalkContext] applyTrackingActivation error", e);
      }
    },
    [
      refreshRealSteps,
      hydrateTodayStepsFromBackend,
      startProviderWatching,
      startRealPollInterval,
      suppressStartupStepBumps,
      syncDeltaToBackend,
      user?.id,
      user?.username,
    ],
  );

  // ── Real tracking init ────────────────────────────────────────────────────────

  useEffect(() => {
    if (__DEV__) console.log(`[WalkContext] mounted — platform: ${Platform.OS}`);
    if (!FEATURE_FLAGS.REAL_STEP_TRACKING_ENABLED) return;
    if (authLoading || !user?.id || !sessionToken) return;

    let mounted = true;
    const init = async () => {
      try {
        await waitForAppStartupReady();
        if (!mounted) return;
        if (__DEV__) console.log(`[WalkContext] platform path: ${Platform.OS}`);
        if (Platform.OS === "ios") {
        // ── iOS path ──────────────────────────────────────────────
        const available = await stepTracker.isAvailable();
        if (!mounted || !available) return;

        const status = await stepTracker.getPermissionStatus();
        if (!mounted) return;
        setStepPermissionStatus(status);
        if (status !== "granted") return;

        setActiveStepSource("ios_healthkit");
        setVerificationLevel("verified");
        setUsingRealTracking(true);
        usingRealRef.current = true;
        setTrackingStatusState("walking");
        await refreshRealSteps({ rehydrateBackend: false });
        if (!mounted) return;

        startRealPollInterval();
        backendSyncRef.current = setInterval(
          syncDeltaToBackend,
          BACKEND_SYNC_INTERVAL_MS,
        );
        void pushWalkNotificationFromCanonicalStore(true);
      } else if (Platform.OS === "android") {
        const tracking = await getAndroidStepTrackingStatus();
        if (!mounted) return;
        setHcAvailability(toHcAvailability(tracking.status));

        const providerStatus = await stepProviderManager.initialize();
        if (!mounted) return;

        // Hybrid: daily Walk is Health Connect only — never activate sensor as todaySteps.
        if (
          FEATURE_FLAGS.ENABLE_LIVE_RACE_DEVICE_SENSOR &&
          !stepProviderManager.usesVerifiedStepSource()
        ) {
          setActiveStepSource(null);
          setVerificationLevel("unsupported");
          setStepPermissionStatus(
            (providerStatus.permission === "granted"
              ? "unknown"
              : providerStatus.permission) as PermissionStatus,
          );
          if (__DEV__) {
            console.log(
              "[WalkContext] hybrid cold start — waiting for Health Connect (sensor is live-race only)",
            );
          }
          return;
        }

        setStepPermissionStatus(providerStatus.permission as PermissionStatus);
        setActiveStepSource(providerToActiveSource(providerStatus.providerId));
        setVerificationLevel(providerToVerification(providerStatus.providerId));

        if (providerStatus.permission !== "granted") return;

        setStepProgressUser(user.id, user.username ?? null);
        setUsingRealTracking(true);
        usingRealRef.current = true;
        setTrackingStatusState("walking");
        await refreshRealSteps({ rehydrateBackend: false });
        await startProviderWatching();
        startRealPollInterval();
        if (!backendSyncRef.current) {
          backendSyncRef.current = setInterval(
            syncDeltaToBackend,
            BACKEND_SYNC_INTERVAL_MS,
          );
        }

        const notifOk = await hasOngoingNotificationAccess();
        if (!notifOk) {
          if (__DEV__) {
            console.log(
              "[Steps] notifications disabled — polling steps without foreground service",
            );
          }
          return;
        }
        // Show ongoing notification immediately with current steps (no artificial delay).
        if (!mounted) return;
        try {
          const started = await stepTrackingNotificationService.start({
            userId: user.id,
            todaySteps: todayStepsRef.current,
            dailyGoal: todayDailyGoalRef.current,
          });
          if (!started && __DEV__) {
            console.log("[OngoingNotification] direct start returned false");
          }
          // Force tray to match canonical steps right away (fixes stale 0 / encoding).
          void pushWalkNotificationFromCanonicalStore(true, user.id);
        } catch (notifErr) {
          console.warn("[OngoingNotification] notification start error", notifErr);
        }
      }
      } catch (err) {
        console.warn("[Startup] WalkContext tracking init failed", err);
      }
    };

    void init().catch(() => {
      // Real tracking unavailable — context stays in "idle" state.
    });

    return () => {
      mounted = false;
      stopRealPollInterval();
      // Both platforms use polling — no subscription to tear down
      if (backendSyncRef.current) {
        clearInterval(backendSyncRef.current);
        backendSyncRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, refreshRealSteps, sessionToken, startRealPollInterval, syncDeltaToBackend, user?.id, applyTrackingActivation]);

  // ── AppState handler — refresh on foreground ──────────────────────────────────

  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      stepEngineLog("Lifecycle", `appState=${nextState}`);
      // Flush any unsaved steps immediately when leaving the app.
      // Prevents step loss when the OS kills the process between 30 s intervals.
      if (nextState === "background" || nextState === "inactive") {
        if (user?.id && todayStepsRef.current > 0) {
          void persistDailySteps(todayStepsRef.current);
        }
        void storageFlushDebounced();
        if (usingRealRef.current || stepPermissionStatus === "granted") {
          syncDeltaToBackend().catch(() => {});
        }
        // Ensure native FGS + sensor on inactive (Android start window) AND background.
        // Hybrid Pedometer only lives in the foreground; tray must match open-app live updates.
        if (
          user?.id &&
          (usingRealRef.current || stepPermissionStatus === "granted")
        ) {
          if (nextState === "background") {
            void tickWalkBackgroundStepPoll("background");
          }
          void (async () => {
            try {
              setStepProgressUser(user.id, user.username ?? null);
              const started = await stepTrackingNotificationService.start(
                {
                  userId: user.id,
                  todaySteps: todayStepsRef.current,
                  dailyGoal:
                    todayDailyGoalRef.current > 0
                      ? todayDailyGoalRef.current
                      : 10_000,
                },
                { forceRestart: true },
              );
              if (started) {
                void pushWalkNotificationFromCanonicalStore(true, user.id);
              }
            } catch (err) {
              if (__DEV__) {
                console.warn("[OngoingNotification] background FGS ensure failed", err);
              }
            }
          })();
        }
        if (nextState === "background") {
          const goal =
            todayDailyGoalRef.current > 0 ? todayDailyGoalRef.current : 10_000;
          dynamicIconService.notifyStepsChanged(
            todayStepsRef.current,
            goal,
            user?.id,
          );
          dynamicIconService.flushAndroidIconIfBackground();
        }
        return;
      }
      if (nextState !== "active") return;

      const shouldRefreshSteps =
        usingRealRef.current ||
        stepPermissionStatus === "granted" ||
        activeStepSourceRef.current != null;

      if (shouldRefreshSteps && user?.id) {
        void (async () => {
          suppressStartupStepBumps(5_000);
          await refreshRealSteps({ rehydrateBackend: true, mergeNative: true });
          if (!usingRealRef.current && stepPermissionStatus === "granted") {
            await startProviderWatching();
            startRealPollInterval();
            if (!backendSyncRef.current) {
              backendSyncRef.current = setInterval(
                syncDeltaToBackend,
                BACKEND_SYNC_INTERVAL_MS,
              );
            }
            setUsingRealTracking(true);
            usingRealRef.current = true;
            setTrackingStatusState("walking");
          } else if (usingRealRef.current) {
            // Re-arm HC watch + hybrid sensor display after resume.
            await startProviderWatching();
          }
          await flushWalkStepsOutbox();
          syncDeltaToBackend().catch(() => {});
        })();
      } else if (
        Platform.OS === "android" &&
        FEATURE_FLAGS.REAL_STEP_TRACKING_ENABLED &&
        !!user?.id
      ) {
        void stepProviderManager.initialize(true).then(async (status) => {
          setStepPermissionStatus(status.permission as PermissionStatus);
          setActiveStepSource(providerToActiveSource(status.providerId));
          setVerificationLevel(providerToVerification(status.providerId));
          if (status.permission === "granted" && !usingRealRef.current) {
            setUsingRealTracking(true);
            usingRealRef.current = true;
            setTrackingStatusState("walking");
            await startProviderWatching();
            await refreshRealSteps({ rehydrateBackend: true, mergeNative: true });
            fetchTodayFromBackend().catch(() => {});
            startRealPollInterval();
            if (!backendSyncRef.current) {
              backendSyncRef.current = setInterval(
                syncDeltaToBackend,
                BACKEND_SYNC_INTERVAL_MS,
              );
            }
          }
        });
      }
    };
    const sub = AppState.addEventListener("change", handleAppState);
    return () => sub.remove();
  }, [
    refreshRealSteps,
    checkDayChange,
    syncDeltaToBackend,
    startRealPollInterval,
    startProviderWatching,
    flushWalkStepsOutbox,
    suppressStartupStepBumps,
    persistDailySteps,
    stepPermissionStatus,
    user?.id,
  ]);

  const resumeStepWatching = useCallback(async () => {
    if (!usingRealRef.current) return;
    suppressStartupStepBumps(5_000);
    await startProviderWatching();
  }, [startProviderWatching, suppressStartupStepBumps]);

  useEffect(() => {
    if (!user?.id) {
      void stepTrackingNotificationService.stop();
    }
  }, [user?.id]);

  // ── Limited sensor tracking enable ───────────────────────────────────────────

  const enableLimitedSensorTracking = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== "android") return false;
    // Hybrid: daily Walk requires Health Connect — do not show a new Alert or
    // silent-bypass; WearableSetupModal guides install/setup instead.
    if (FEATURE_FLAGS.ENABLE_LIVE_RACE_DEVICE_SENSOR) {
      return false;
    }
    if (verificationLevel === "verified") return true;
    if (!user?.id) {
      Alert.alert("Sign In Required", "Please sign in to enable step tracking.");
      return false;
    }

    try {
      const result = await activateStepTracking({
        userId: user.id,
        username: user.username,
        limitedSensorOnly: true,
      });
      if (!result.success) {
        if (result.notificationBlocked) {
          Alert.alert(
            "Notifications Required",
            result.message ?? NOTIFICATION_STILL_DISABLED_MESSAGE,
          );
          return false;
        }
        if (result.activityRecognitionBlocked) {
          Alert.alert(
            "Permission Required",
            result.message ?? "Physical activity permission is required to track steps.",
          );
          return false;
        }
        Alert.alert(
          "Step Tracking Unavailable",
          result.message ?? "Could not enable limited step tracking on this device.",
        );
        return false;
      }

      setActiveStepSource("android_device_step_counter");
      setVerificationLevel("limited");
      setStepPermissionStatus("granted");
      await applyTrackingActivation(result.ongoingNotificationEnabled);
      return true;
    } catch (e) {
      if (__DEV__) console.log("[WalkContext] enableLimitedSensorTracking error", e);
      return false;
    }
  }, [verificationLevel, user?.id, user?.username, applyTrackingActivation]);

  // ── Permission request helper ─────────────────────────────────────────────────

  const handleStepActivationResult = useCallback(
    async (result: StepTrackingEnableResult) => {
      const status = result.permission as PermissionStatus;
      if (__DEV__) {
        console.log(
          `[WalkContext] Permission result: ${status} provider=${result.providerId ?? "none"} success=${result.success}`,
        );
      }

      setStepPermissionStatus(status);
      setActiveStepSource(providerToActiveSource(result.providerId));
      setVerificationLevel(providerToVerification(result.providerId));

      if (result.success) {
        await applyTrackingActivation(result.ongoingNotificationEnabled);
        // Respect user choice: no "Enable Notifications" nag when preference/OS is off.
        return;
      }

      if (result.notificationBlocked) {
        // Preference/OS off — steps still track; Profile toggle can re-enable later.
        if (__DEV__) {
          console.log("[Steps] activation continued without notifications");
        }
      } else if (result.activityRecognitionBlocked) {
        Alert.alert(
          "Permission Required",
          result.message ?? "Physical activity permission is required to track steps.",
        );
      } else if (status === "denied") {
        Alert.alert(
          "Permission Required",
          Platform.OS === "ios"
            ? "Allow Steps access in Apple Health to track your walks."
            : "Allow Steps access in WalkChamp or Health Connect to track your walks.",
        );
      } else if (status === "unavailable") {
        Alert.alert(
          "Step Tracking Unavailable",
          result.message ?? "Step tracking is not available on this device.",
        );
      }
    },
    [applyTrackingActivation],
  );

  const requestStepPermission = useCallback(async () => {
    if (permissionRequestInFlightRef.current) {
      if (__DEV__) {
        console.log("[WalkContext] requestStepPermission skipped — already in flight");
      }
      return;
    }
    if (__DEV__) console.log(`[WalkContext] requestStepPermission — platform: ${Platform.OS}`);

    if (!user?.id) {
      Alert.alert("Sign In Required", "Please sign in to enable step tracking.");
      return;
    }

    permissionRequestInFlightRef.current = true;
    try {
      let needPrompt = true;
      if (Platform.OS === "android") {
        const current = await stepProviderManager.refreshStatus();
        needPrompt = current.permission !== "granted";
      } else {
        const available = await stepTracker.isAvailable();
        if (available) {
          const status = await stepTracker.getPermissionStatus();
          needPrompt = status !== "granted";
        }
      }

      const result = await activateStepTracking({
        userId: user.id,
        username: user.username,
        requestPermission: needPrompt,
      });

      await handleStepActivationResult(result);
    } catch (e) {
      if (__DEV__) console.log("[WalkContext] requestStepPermission error", e);
      Alert.alert(
        "Step Tracking Error",
        "Could not enable step tracking. Please try again.",
      );
    } finally {
      permissionRequestInFlightRef.current = false;
    }
  }, [
    user?.id,
    user?.username,
    handleStepActivationResult,
  ]);

  const completeStepSetup = useCallback(async (opts?: { allowAll?: boolean }) => {
    if (!user?.id) return;
    if (permissionRequestInFlightRef.current) return;

    const allowAll = opts?.allowAll !== false;

    permissionRequestInFlightRef.current = true;
    try {
      await stepProviderManager.initialize(true);
      const providerStatus = await stepProviderManager.refreshStatus();

      if (providerStatus.permission !== "granted") {
        permissionRequestInFlightRef.current = false;
        await requestStepPermission();
        return;
      }

      const isLegacy =
        !FEATURE_FLAGS.ENABLE_LIVE_RACE_DEVICE_SENSOR &&
        (providerStatus.providerId === "android_legacy_sensor" ||
          providerStatus.verificationLevel === "legacy");

      // Initial HC setup: ask notifications + physical activity together ("allow all").
      // Later on/off is Profile → Push Notifications only.
      const result = await activateStepTracking({
        userId: user.id,
        username: user.username,
        requestPermission: false,
        limitedSensorOnly: isLegacy && Platform.OS === "android",
        skipOngoingNotificationPermission: false,
        firstSetupAllowAll: allowAll,
      });
      await handleStepActivationResult(result);
    } catch (e) {
      if (__DEV__) console.log("[WalkContext] completeStepSetup error", e);
      permissionRequestInFlightRef.current = false;
      await requestStepPermission();
    } finally {
      permissionRequestInFlightRef.current = false;
    }
  }, [user?.id, user?.username, handleStepActivationResult, requestStepPermission]);

  // ── Real session tracking ─────────────────────────────────────────────────────

  const startRealSession = useCallback(() => {
    sessionStartTimeRef.current = new Date();

    if (Platform.OS === "ios") {
      const pollSession = async () => {
        if (!sessionStartTimeRef.current) return;
        const data = await stepTracker.getStepsForTimeRange(
          sessionStartTimeRef.current,
          new Date(),
        );
        if (!data) return;
        const sSteps = data.steps;
        setSession({
          steps: sSteps,
          distance: stepsToDistance(sSteps),
          calories: stepsToCalories(sSteps),
          durationSeconds: sessionRef.current.durationSeconds,
        });
      };
      stepIntervalRef.current = setInterval(pollSession, 3000);
    } else {
      // Android: use todayStepsRef for live session display
      stepIntervalRef.current = setInterval(() => {
        const current = todayStepsRef.current;
        setSession((prev) => ({
          steps: current,
          distance: stepsToDistance(current),
          calories: stepsToCalories(current),
          durationSeconds: prev.durationSeconds,
        }));
      }, 2000);
    }

    // Elapsed session time is derived from sessionStartTimeRef via
    // useWalkSessionElapsed — do not tick duration into provider (1Hz fan-out).
    // Refresh activeDurationMinutes on a slower cadence for streak/stats only.
    const startedAt = sessionStartTimeRef.current?.getTime() ?? Date.now();
    setWalkSessionStartedAtMs(startedAt);
    timerIntervalRef.current = setInterval(() => {
      const start = sessionStartTimeRef.current?.getTime();
      if (start == null) return;
      const elapsedSec = Math.max(0, Math.floor((Date.now() - start) / 1000));
      sessionRef.current = {
        ...sessionRef.current,
        durationSeconds: elapsedSec,
      };
      // ~1/min provider update instead of 1Hz
      if (elapsedSec > 0 && elapsedSec % 60 === 0) {
        setActiveDurationMinutes(elapsedSec / 60);
      }
    }, 1000);
  }, []);

  // ── Stop all tracking intervals ───────────────────────────────────────────────

  const stopTracking = useCallback(() => {
    if (stepIntervalRef.current) clearInterval(stepIntervalRef.current);
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (autoPauseTimerRef.current) clearTimeout(autoPauseTimerRef.current);
    stepIntervalRef.current = null;
    timerIntervalRef.current = null;
    setWalkSessionStartedAtMs(null);
  }, []);

  // ── Save daily steps ──────────────────────────────────────────────────────────

  const saveDailySteps = useCallback(async () => {
    if (!user?.id) return;
    const today = getTodayKey();
    if (trackingDayRef.current !== today) {
      await checkDayChange();
    }
    const keys = stepScopedKeys(user.id, today);
    await writeDailyStepsForUserDate(user.id, today, todayStepsRef.current);
    await storageSet(keys.currentLocalDate, today);
    await storageSet(keys.totalSteps, allTimeStepsRef.current);
    savedDailyStepsRef.current = todayStepsRef.current;
  }, [checkDayChange, user?.id]);

  // ── Submit session to backend ─────────────────────────────────────────────────

  const submitAndResetSession = useCallback(async () => {
    const s = sessionRef.current;
    if (s.steps > 0) {
      await saveDailySteps();
      if (usingRealRef.current) {
        await syncDeltaToBackend();
      }
      setSession({ steps: 0, distance: 0, calories: 0, durationSeconds: 0 });
      sessionStartTimeRef.current = null;
    }
  }, [saveDailySteps, syncDeltaToBackend]);

  // ── Tracking status handler ───────────────────────────────────────────────────

  const setTrackingStatus = useCallback(
    (status: TrackingStatus) => {
      setTrackingStatusState(status);
      if (status === "walking") {
        stopTracking();
        if (usingRealRef.current) {
          startRealSession();
        }
      } else if (status === "paused" || status === "idle") {
        stopTracking();
        submitAndResetSession();
      }
    },
    [startRealSession, stopTracking, submitAndResetSession],
  );

  const togglePause = useCallback(() => {
    if (!usingRealRef.current) return;
    setTrackingStatusState((prev) => {
      if (prev === "walking") {
        stopTracking();
        submitAndResetSession();
        return "paused";
      } else if (prev === "paused") {
        startRealSession();
        return "walking";
      }
      return prev;
    });
  }, [startRealSession, stopTracking, submitAndResetSession]);

  const clearMilestone = useCallback(() => setMilestoneReached(null), []);

  // ── Fetch today's rank + active minutes from backend ─────────────────────────

  const fetchTodayFromBackend = hydrateTodayStepsFromBackend;

  // ── Cleanup on unmount ────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      stopTracking();
      // HC is polling-based — no live subscription to tear down on unmount
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // fetchTodayFromBackend runs inside load() and refreshRealSteps — no duplicate hydrate on mount.

  // ── Startup catch-up sync ─────────────────────────────────────────────────────
  // Gate on verifiedTodaySteps only — never force-sync provisional display inflation.
  useEffect(() => {
    if (startupSyncFiredRef.current) return;
    const verified = Math.max(
      0,
      store.getState().raceProgress.verifiedTodaySteps ?? 0,
    );
    if (verified <= 0) return;
    if (verified <= lastSyncedStepsRef.current) return;
    startupSyncFiredRef.current = true;
    syncDeltaToBackend({ force: true }).catch(() => {});
  }, [todaySteps, syncDeltaToBackend]);

  // ── Periodic save ─────────────────────────────────────────────────────────────

  useEffect(() => {
    let saveInterval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (saveInterval) return;
      saveInterval = setInterval(saveDailySteps, 30000);
    };
    const stop = () => {
      if (saveInterval) {
        clearInterval(saveInterval);
        saveInterval = null;
      }
    };
    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") start();
      else {
        stop();
        void saveDailySteps();
        void storageFlushDebounced();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [saveDailySteps]);

  const isWalking = trackingStatus === "walking";
  const isPaused = trackingStatus === "paused";

  // Omit todaySteps from memo deps — high-frequency ticks must not rebuild the
  // provider value (and re-render Profile / Live / Wearable consumers). Hot UI
  // should use useWalkTodaySteps(); useWalk() still exposes a snapshot field.
  const value = useMemo(
    () => ({
      trackingStatus,
      isWalking,
      isPaused,
      session,
      weeklySteps,
      allTimeSteps,
      currentStreak,
      activeDurationMinutes,
      milestoneReached,
      autoTrackingEnabled,
      usingRealTracking,
      stepPermissionStatus,
      hcAvailability,
      activeStepSource,
      verificationLevel,
      canJoinRewardRaces: verificationLevel === "verified",
      todayActiveMinutes,
      todayDailyRank,
      todayDailyGoal,
      setTrackingStatus,
      togglePause,
      clearMilestone,
      requestStepPermission,
      completeStepSetup,
      enableLimitedSensorTracking,
      refreshTodayRank: fetchTodayFromBackend,
      refreshTodaySteps: refreshRealSteps,
      resumeStepWatching,
      triggerSync: syncDeltaToBackend,
      stepsHydrated,
      stepsSourceReady,
      authReady,
    }),
    [
      trackingStatus, isWalking, isPaused, session, weeklySteps, allTimeSteps,
      currentStreak, activeDurationMinutes, milestoneReached, autoTrackingEnabled, usingRealTracking,
      stepPermissionStatus, hcAvailability, activeStepSource, verificationLevel, todayActiveMinutes,
      todayDailyRank, todayDailyGoal, setTrackingStatus, togglePause, clearMilestone,
      requestStepPermission, completeStepSetup, enableLimitedSensorTracking, fetchTodayFromBackend, refreshRealSteps,
      resumeStepWatching, syncDeltaToBackend, stepsHydrated, stepsSourceReady, authReady,
    ],
  );

  return (
    <WalkContext.Provider value={value as WalkContextType}>
      {children}
    </WalkContext.Provider>
  );
}

export function useWalk(): WalkContextType {
  const ctx = useContext(WalkContext);
  if (!ctx) throw new Error("useWalk must be used inside WalkProvider");
  // Snapshot only — does not subscribe to step/timer ticks.
  const startMs = getWalkSessionStartedAtMs();
  const durationSeconds =
    startMs != null
      ? Math.max(0, Math.floor((Date.now() - startMs) / 1000))
      : ctx.session.durationSeconds;
  return {
    ...ctx,
    todaySteps: getWalkTodayStepsSnapshot(),
    session: {
      ...ctx.session,
      durationSeconds,
    },
  };
}

/** Alias kept for backwards compatibility with existing screen imports. */
export const useWalkContext = useWalk;

export { useWalkTodaySteps } from "@/services/walkTodayStepsStore";
export { useWalkSessionStartedAtMs } from "@/services/walkSessionElapsedStore";
export { useElapsedSeconds as useWalkSessionElapsed } from "@/hooks/useElapsedSeconds";
