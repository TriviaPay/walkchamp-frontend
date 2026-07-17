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
import { storageGet, storageSet, storageFlushDebounced } from "@/utils/storage";
import { stepsToCalories, stepsToDistance, getTodayKey } from "@/utils/format";
import { msUntilNextLocalMidnight } from "@/utils/timezone";
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
  getOngoingNotificationDeniedMessage,
  shouldShowOngoingNotificationDeniedMessage,
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
import { waitForAppStartupReady, isAppStartupReady } from "@/services/appStartup";
import { subscribeMidnightRollover } from "@/services/walkMidnightEvents";
import { isWalkBackendSyncPaused } from "@/services/walkSyncCoordinator";
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
  /** Activate tracking after wearable setup when permission may already be granted. */
  completeStepSetup: () => Promise<void>;
  /** Enable limited device sensor tracking (TYPE_STEP_COUNTER). Sets verificationLevel = limited. */
  enableLimitedSensorTracking: () => Promise<void>;
  /** Re-fetch today's rank + active minutes from the backend. Safe to call at any time. */
  refreshTodayRank: () => Promise<void>;
  /**
   * Force-push any unsynced step delta to the backend immediately.
   * Call this before reading leaderboard data so the server has the freshest step count.
   * Resolves when the sync completes (or fails silently). Never throws.
   */
  triggerSync: () => Promise<void>;
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
  if (id === "android_legacy_sensor") return "android_device_step_counter";
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
): Promise<{ activeMinutes?: number; dailyRank?: number | null } | null> {
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

    const res = await fetch(`${API_BASE}/api/walk/steps`, {
      method: "POST",
      signal: timeoutSignal(STEP_SYNC_TIMEOUT),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session}`,
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
  useEffect(() => {
    todayStepsRef.current = todaySteps;
    if (syncingFromReduxRef.current) return;
    if (!isAppStartupReady()) return;
    if (!stepsSourceReady && todaySteps === 0) return;
    const rawSource = stepProviderManager.toWalkSyncSource();
    const stepSource =
      rawSource === "android_health_connect"
        ? "health_connect"
        : rawSource === "ios_healthkit"
          ? "healthkit"
          : rawSource === "android_step_counter"
            ? "android_step_counter"
            : "backend";
    updateStepProgressFromRealSource({ todaySteps, stepSource });
  }, [todaySteps, stepsSourceReady]);

  useEffect(() => {
    todayDailyGoalRef.current = todayDailyGoal;
    store.dispatch(raceProgressActions.setDailyGoal(todayDailyGoal));
  }, [todayDailyGoal]);

  // Sync launcher icon whenever displayed steps or daily goal change (after hydration).
  useEffect(() => {
    if (!iconSyncReadyRef.current) return;
    const goal = todayDailyGoal > 0 ? todayDailyGoal : 10_000;
    dynamicIconService.notifyStepsChanged(todaySteps, goal, user?.id);
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
        let displaySteps = rolled ? 0 : await readDailyStepsForUserDate(user.id, today);
        if (rolled) {
          markFreshLocalDay(90_000);
          setTodaySteps(0);
          todayStepsRef.current = 0;
          savedDailyStepsRef.current = 0;
          lastSyncedStepsRef.current = 0;
          backendTodayStepsRef.current = 0;
        }
        const cachedAtStart = displaySteps;
        // Unblock Walk tab immediately; backend/provider reconcile continues below.
        setStepsHydrated(true);
        if (displaySteps > 0) {
          setTodaySteps(displaySteps);
          todayStepsRef.current = displaySteps;
          savedDailyStepsRef.current = displaySteps;
          backendTodayStepsRef.current = displaySteps;
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
            }
            const backendSteps = parsed?.todaySteps ?? 0;
            backendTodayStepsRef.current =
              rolled && backendSteps === 0 ? 0 : backendSteps;
            const localForFloor = rolled || isFreshLocalDay() ? 0 : localCached;
            const floor = Math.max(
              localForFloor,
              backendTodayStepsRef.current,
              todayStepsRef.current,
            );
            if (stepProviderManager.usesVerifiedStepSource()) {
              displaySteps = hydrateStepDisplayFromSources({
                providerSteps,
                backendSteps: backendTodayStepsRef.current,
                localCachedSteps: localForFloor,
                allowBackendCatchUp: false,
                previousProviderSteps: displaySteps,
              });
              displaySteps = Math.max(displaySteps, floor);
            } else {
              // Legacy sensor: on init trust backend + cache only — provider updates via watch.
              displaySteps = floor;
            }
            displaySteps = filterLegacyStepIncrease(floor, displaySteps, {
              backendSteps: backendTodayStepsRef.current,
            });
            if (rolled || isFreshLocalDay()) {
              displaySteps = Math.min(displaySteps, Math.max(providerSteps, backendTodayStepsRef.current));
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
        await writeDailyStepsForUserDate(user.id, today, displaySteps);
        setWeeklySteps(await readWeeklyStepsForUser(user.id));
        await captureProviderBindSnapshot();

        if (session) {
          try {
            if (stepProviderManager.usesVerifiedStepSource()) {
              const authoritative = await resolveAuthoritativeTodaySteps(user.id, {
                mergeNative: false,
              });
              if (authoritative > todayStepsRef.current) {
                setTodaySteps(authoritative);
                todayStepsRef.current = authoritative;
                savedDailyStepsRef.current = authoritative;
                await writeDailyStepsForUserDate(user.id, today, authoritative);
                updateStepProgressFromRealSource({
                  todaySteps: authoritative,
                  stepSource:
                    activeStepSourceRef.current === "ios_healthkit"
                      ? "healthkit"
                      : "android_health_connect",
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
            const res = await fetch(`${API_BASE}/api/profile/me`, {
              headers: { Authorization: `Bearer ${session}` },
              signal: timeoutSignal(API_TIMEOUT_MS),
            });
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

  const persistDailySteps = useCallback(async (steps: number) => {
    if (!user?.id) return;
    const today = getTodayKey();
    if (trackingDayRef.current !== today) {
      await handleMidnightRolloverIfNeeded();
      trackingDayRef.current = today;
    }
    await writeDailyStepsForUserDate(user.id, today, steps);
    await storageSet(stepScopedKeys(user.id, today).currentLocalDate, today);
  }, [user?.id]);

  const forceSetTodayStepDisplay = useCallback(
    async (steps: number) => {
      const displaySteps = Math.max(0, Math.floor(steps));
      const today = getTodayKey();
      setTodaySteps(displaySteps);
      todayStepsRef.current = displaySteps;
      savedDailyStepsRef.current = displaySteps;
      await persistDailySteps(displaySteps);
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
      }

      const backendSteps = parsed?.todaySteps ?? backendTodayStepsRef.current;
      if (parsed && parsed.todaySteps === 0 && localCached > 0) {
        if (isFreshLocalDay()) {
          stepEngineLog("Sync", `freshDay trustBackendZero=true ignoredLocal=${localCached}`);
        } else {
          stepEngineLog("Sync", `skippedStaleBackendZero=true backend=0 local=${localCached}`);
        }
      }
      backendTodayStepsRef.current = isFreshLocalDay() && parsed?.todaySteps === 0
        ? 0
        : backendSteps;
      const effectiveLocal = isFreshLocalDay() ? 0 : localCached;
      const mergedDisplay = hydrateStepDisplayFromSources({
        providerSteps,
        backendSteps: backendTodayStepsRef.current,
        localCachedSteps: effectiveLocal,
        allowBackendCatchUp:
          stepProviderManager.getActiveProviderId() === "android_legacy_sensor",
        previousProviderSteps: providerStepsAtBindRef.current || effectiveLocal,
      });
      const displaySteps = isFreshLocalDay()
        ? Math.max(mergedDisplay, todayStepsRef.current)
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
      const hydratedDisplay = isFreshLocalDay()
        ? Math.max(
            clampHydratedDisplaySteps(
              displaySteps,
              todayStepsRef.current,
              backendTodayStepsRef.current,
            ),
            todayStepsRef.current,
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
      if (applyDisplay && (isFreshLocalDay() || hydratedDisplay > todayStepsRef.current)) {
        if (isFreshLocalDay() && hydratedDisplay === 0) {
          await forceSetTodayStepDisplay(0);
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
    const syncTotal = capWalkStepsForSync(
      rawCurrent,
      providerSteps,
      undefined,
      backendTodayStepsRef.current,
    );
    // Cap applies to backend sync only — never regress on-screen step count.
    const current = syncTotal;
    if (syncTotal < rawCurrent) {
      stepEngineLog(
        "StepSync",
        `capped syncTotal=${syncTotal} ui=${rawCurrent} provider=${providerSteps ?? "n/a"} backend=${backendTodayStepsRef.current}`,
      );
    }
    const lastSynced = lastSyncedStepsRef.current;
    const delta = current - lastSynced;
    if (delta <= 0) {
      if (__DEV__ && opts?.force) {
        console.log(
          `[StepSync] force skipped delta=${delta} current=${current} lastSynced=${lastSynced}`,
        );
      }
      return;
    }

    const verified = stepProviderManager.usesVerifiedStepSource();
    const minDelta = opts?.force
      ? 1
      : verified
        ? STEP_SYNC_CONFIG.WALK_BACKEND_SYNC_MIN_DELTA_VERIFIED
        : STEP_SYNC_CONFIG.WALK_BACKEND_SYNC_MIN_DELTA_LEGACY;
    if (delta < minDelta) {
      if (__DEV__) {
        stepEngineLog(
          "StepSync",
          `skipped delta=${delta} below min=${minDelta} verified=${verified}`,
        );
      }
      return;
    }

    const distanceMeters = Math.round(stepsToDistance(delta));
    const calories = Math.round(stepsToCalories(delta));
    const activeMinutes = Math.ceil(current / 120);

    const source = stepProviderManager.toWalkSyncSource() ?? "unknown";

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

      const displaySteps = fromWatch
        ? stepProviderManager.usesVerifiedStepSource()
          ? safeReal
          : sanitizeLegacyProviderSteps(
              mergeLegacyStepUpdate(current, safeReal),
              backendFloor,
              current,
            )
        : safeReal;
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
    [checkMilestone, persistDailySteps, reconcileLegacyProviderSteps, syncDeltaToBackend, user?.id],
  );

  const resolveLiveDisplaySteps = useCallback(
    (providerSteps: number): number => {
      const fromProvider = computeAccountAwareDisplaySteps(providerSteps);
      const reduxSteps =
        store.getState().raceProgress.userId === user?.id
          ? store.getState().raceProgress.todaySteps
          : 0;
      return Math.max(fromProvider, reduxSteps, todayStepsRef.current);
    },
    [computeAccountAwareDisplaySteps, user?.id],
  );

  const mirrorCanonicalStepsToWalkUi = useCallback(
    async (coordinatorSteps: number, reason: string) => {
      if (!user?.id) return;
      const display = Math.max(0, Math.floor(coordinatorSteps));
      if (display <= todayStepsRef.current) return;

      stepEngineLog(
        "WalkScreen",
        `canonicalMirror reason=${reason} coordinator=${coordinatorSteps} display=${display}`,
      );
      const fromWatch = !stepProviderManager.usesVerifiedStepSource();
      await applyTodayStepCount(display, fromWatch);
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
    if (freshDay) markFreshLocalDay(90_000);

    let display: number;
    if (mergeNative && !freshDay) {
      display = await resolveAuthoritativeTodaySteps(user.id, { mergeNative: true });
      stepEngineLog(
        "Resume",
        `authoritativeTodaySteps=${display} renderedImmediately=${display > 0}`,
      );
    } else {
      const data = await stepProviderManager.getTodaySteps();
      const providerSteps = Math.max(0, data?.steps ?? 0);
      display = resolveLiveDisplaySteps(providerSteps);
      if (!freshDay) {
        display = Math.max(
          display,
          todayStepsRef.current,
          store.getState().raceProgress.todaySteps,
        );
      } else {
        display = Math.max(display, todayStepsRef.current);
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

    if (freshDay && display === 0) {
      await forceSetTodayStepDisplay(0);
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

    const finalSteps = freshDay
      ? Math.max(display, todayStepsRef.current)
      : mergeNative
        ? await resolveAuthoritativeTodaySteps(user.id, { mergeNative: true })
        : Math.max(display, todayStepsRef.current, store.getState().raceProgress.todaySteps);

    if (freshDay && finalSteps === 0) {
      await forceSetTodayStepDisplay(0);
      store.dispatch(walkActions.setTodaySteps(0));
      store.dispatch(
        raceProgressActions.resetDailyStepsForNewDay({
          todaySteps: 0,
          updatedAt: new Date().toISOString(),
        }),
      );
    } else if (finalSteps > todayStepsRef.current) {
      await applyTodayStepCount(finalSteps, false);
    }

    if (!freshDay && finalSteps > store.getState().raceProgress.todaySteps) {
      updateStepProgressFromRealSource({
        todaySteps: finalSteps,
        stepSource:
          stepProviderManager.getActiveProviderId() === "android_health_connect"
            ? "health_connect"
            : stepProviderManager.getActiveProviderId() === "ios_healthkit"
              ? "healthkit"
              : "android_step_counter",
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
    return store.subscribe(() => {
      if (syncingFromReduxRef.current) return;
      const rp = store.getState().raceProgress;
      if (rp.userId !== user.id) return;
      if (rp.todaySteps === lastReduxSteps) return;
      lastReduxSteps = rp.todaySteps;
      if (rp.todaySteps <= todayStepsRef.current) return;
      void mirrorCanonicalStepsToWalkUi(rp.todaySteps, "redux");
    });
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
        const display = resolveLiveDisplaySteps(result.steps);
        void applyTodayStepCount(display, true);
      });
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
        } else if (
          Platform.OS === "android" &&
          shouldShowOngoingNotificationDeniedMessage()
        ) {
          Alert.alert("Notifications Disabled", getOngoingNotificationDeniedMessage());
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
        // Release APK / EAS cold start: defer FGS only — provider poll already running.
        if (!__DEV__) {
          await new Promise((resolve) => setTimeout(resolve, 2500));
        } else {
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
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
        if (
          nextState === "background" &&
          user?.id &&
          (usingRealRef.current || stepPermissionStatus === "granted")
        ) {
          void tickWalkBackgroundStepPoll("background");
        }
        if (nextState === "background") {
          const goal =
            todayDailyGoalRef.current > 0 ? todayDailyGoalRef.current : 10_000;
          dynamicIconService.notifyStepsChanged(
            todayStepsRef.current,
            goal,
            user?.id,
          );
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

  const enableLimitedSensorTracking = useCallback(async () => {
    if (Platform.OS !== "android") return;
    if (verificationLevel === "verified") return;
    if (!user?.id) {
      Alert.alert("Sign In Required", "Please sign in to enable step tracking.");
      return;
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
          return;
        }
        if (result.activityRecognitionBlocked) {
          Alert.alert(
            "Permission Required",
            result.message ?? "Physical activity permission is required to track steps.",
          );
          return;
        }
        Alert.alert(
          "Step Tracking Unavailable",
          result.message ?? "Could not enable limited step tracking on this device.",
        );
        return;
      }

      setActiveStepSource("android_device_step_counter");
      setVerificationLevel("limited");
      setStepPermissionStatus("granted");
      await applyTrackingActivation(result.ongoingNotificationEnabled);
    } catch (e) {
      if (__DEV__) console.log("[WalkContext] enableLimitedSensorTracking error", e);
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
        // Soft reminder only — steps already tracking via poll/watch.
        if (
          result.notificationBlocked &&
          Platform.OS === "android" &&
          shouldShowOngoingNotificationDeniedMessage()
        ) {
          Alert.alert(
            "Notifications Disabled",
            result.message ?? getOngoingNotificationDeniedMessage(),
          );
        }
        return;
      }

      if (result.notificationBlocked) {
        Alert.alert(
          "Notifications Required",
          result.message ?? NOTIFICATION_STILL_DISABLED_MESSAGE,
        );
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
            : "Allow Steps access in Walk Champ or Health Connect to track your walks.",
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

  const completeStepSetup = useCallback(async () => {
    if (!user?.id) return;
    if (permissionRequestInFlightRef.current) return;

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
        providerStatus.providerId === "android_legacy_sensor" ||
        providerStatus.verificationLevel === "legacy";

      const result = await activateStepTracking({
        userId: user.id,
        username: user.username,
        requestPermission: false,
        limitedSensorOnly: isLegacy && Platform.OS === "android",
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

    timerIntervalRef.current = setInterval(() => {
      setSession((prev) => ({
        ...prev,
        durationSeconds: prev.durationSeconds + 1,
      }));
      setActiveDurationMinutes((prev) => prev + 1 / 60);
    }, 1000);
  }, []);

  // ── Stop all tracking intervals ───────────────────────────────────────────────

  const stopTracking = useCallback(() => {
    if (stepIntervalRef.current) clearInterval(stepIntervalRef.current);
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (autoPauseTimerRef.current) clearTimeout(autoPauseTimerRef.current);
    stepIntervalRef.current = null;
    timerIntervalRef.current = null;
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
  // If the app was killed between 30 s sync intervals, unsaved steps remain in
  // AsyncStorage but were never POSTed to the backend. On next launch, once
  // todaySteps is hydrated from storage and is above the last-synced count,
  // push the outstanding delta immediately (before the regular interval fires).
  // The backend uses GREATEST so there is no risk of double-counting.
  useEffect(() => {
    if (startupSyncFiredRef.current) return;
    if (todaySteps <= 0) return;
    if (todaySteps <= lastSyncedStepsRef.current) return;
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

  const value = useMemo(
    () => ({
      trackingStatus,
      isWalking,
      isPaused,
      session,
      todaySteps,
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
      trackingStatus, isWalking, isPaused, session, todaySteps, weeklySteps, allTimeSteps,
      currentStreak, activeDurationMinutes, milestoneReached, autoTrackingEnabled, usingRealTracking,
      stepPermissionStatus, hcAvailability, activeStepSource, verificationLevel, todayActiveMinutes,
      todayDailyRank, todayDailyGoal, setTrackingStatus, togglePause, clearMilestone,
      requestStepPermission, completeStepSetup, enableLimitedSensorTracking, fetchTodayFromBackend, refreshRealSteps,
      resumeStepWatching, syncDeltaToBackend, stepsHydrated, stepsSourceReady, authReady,
    ],
  );

  return (
    <WalkContext.Provider value={value}>
      {children}
    </WalkContext.Provider>
  );
}

export function useWalk(): WalkContextType {
  const ctx = useContext(WalkContext);
  if (!ctx) throw new Error("useWalk must be used inside WalkProvider");
  return ctx;
}

/** Alias kept for backwards compatibility with existing screen imports. */
export const useWalkContext = useWalk;
