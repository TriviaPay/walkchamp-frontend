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
  useRef,
  useState,
} from "react";
import { AppState, AppStateStatus, Alert, Platform } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { STORAGE_KEYS, storageGet, storageSet } from "@/utils/storage";
import { stepsToCalories, stepsToDistance, getTodayKey } from "@/utils/format";
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
  hydrateOnAppResume,
  handleMidnightRolloverIfNeeded,
  pushWalkNotificationFromCanonicalStore,
  setStepProgressUser,
  updateStepProgressFromRealSource,
} from "@/services/stepProgressCoordinator";
import { activateStepTracking } from "@/services/stepTrackingStartup";
import { waitForAppStartupReady } from "@/services/appStartup";
import { mergeWalkStepsWithNative } from "@/services/stepDisplayMerge";
import { isWalkBackendSyncPaused } from "@/services/walkSyncCoordinator";
import {
  clearWalkStepsOutbox,
  loadWalkStepsOutbox,
  saveWalkStepsOutbox,
} from "@/services/walkStepsOutbox";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

export type TrackingStatus = "idle" | "walking" | "paused" | "syncing";

interface DailySteps {
  [dateKey: string]: number;
}

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
  refreshTodaySteps: () => Promise<void>;
  /** Resume legacy sensor watch + mirror ongoing notification after race. */
  resumeStepWatching: () => Promise<void>;
}

const WalkContext = createContext<WalkContextType | null>(null);

const MILESTONES = [1000, 2000, 5000, 10000, 15000, 20000];
/** How often (ms) iOS re-queries HealthKit for today's real steps. */
const REAL_STEP_POLL_MS = 15_000;
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
    if (source) body.source = source;
    // Include the client's local calendar date so the server stores steps under
    // the correct day for the user's timezone (server runs in UTC).
    body.localDate = getTodayKey();

    const res = await fetch(`${API_BASE}/api/walk/steps`, {
      method: "POST",
      signal: timeoutSignal(STEP_SYNC_TIMEOUT),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session}`,
      },
      body: JSON.stringify(body),
    });
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
  const { user, loading: authLoading } = useAuth();
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
  const savedDailyStepsRef = useRef<number>(0);
  const sessionRef = useRef<WalkSession>({
    steps: 0,
    distance: 0,
    calories: 0,
    durationSeconds: 0,
  });
  const todayStepsRef = useRef<number>(0);
  const todayDailyGoalRef = useRef<number>(10000);
  const allTimeStepsRef = useRef<number>(0);
  const lastSyncedStepsRef = useRef<number>(0);
  const usingRealRef = useRef(false);
  const sessionStartTimeRef = useRef<Date | null>(null);
  const activeStepSourceRef = useRef<AndroidStepSourceId | "ios_healthkit" | null>(
    null,
  );

  useEffect(() => {
    setStepProgressUser(user?.id ?? null, user?.username ?? null);
  }, [user?.id, user?.username]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    todayStepsRef.current = todaySteps;
    // Canonical store is the single writer; notification is updated from store only.
    updateStepProgressFromRealSource({ todaySteps });
  }, [todaySteps]);

  useEffect(() => {
    todayDailyGoalRef.current = todayDailyGoal;
  }, [todayDailyGoal]);
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
    const rolled = await handleMidnightRolloverIfNeeded();
    if (rolled) {
      setTodaySteps(0);
      savedDailyStepsRef.current = 0;
      lastSyncedStepsRef.current = 0;
    }
  }, []);

  // ── Load stored values on mount ──────────────────────────────────────────────

  useEffect(() => {
    const load = async () => {
      try {
        await waitForAppStartupReady();
        await handleMidnightRolloverIfNeeded();
      const daily = await storageGet<DailySteps>(STORAGE_KEYS.DAILY_STEPS);
      const allTime = await storageGet<number>(STORAGE_KEYS.TOTAL_STEPS);
      const streak = await storageGet<number>(STORAGE_KEYS.STREAK);
      const today = getTodayKey();

      if (daily) {
        const todayVal = daily[today] ?? 0;
        // On cold launch / JS restart, the native FGS may have accumulated steps while
        // the JS runtime was not alive.  Read the value persisted in native SharedPrefs
        // and use max(asyncStorage, native) so we never overwrite a higher FGS count with
        // a stale local value.  mergeWalkStepsWithNative calls getNativeWalkStepState()
        // (Android only) on the first call before in-memory lastSteps is populated.
        const mergedVal = await mergeWalkStepsWithNative(todayVal);
        if (__DEV__ && mergedVal > todayVal) {
          console.log(`[AppResume] StepStore hydrated source=native_service merged=${mergedVal} asyncStorage=${todayVal}`);
        }
        setTodaySteps(mergedVal);
        savedDailyStepsRef.current = mergedVal;
        const weekSteps = Object.entries(daily)
          .slice(-7)
          .reduce((sum, [, v]) => sum + v, 0);
        setWeeklySteps(weekSteps);
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
                await storageSet(STORAGE_KEYS.TOTAL_STEPS, stats.allTimeSteps);
              }
              if (stats?.dayStreak > 0 && !streak) {
                setCurrentStreak(stats.dayStreak);
                await storageSet(STORAGE_KEYS.STREAK, stats.dayStreak);
              }
            }
          }
        } catch {
          // non-critical — silently ignore
        }
      }

      const syncedDate = await storageGet<string>(
        STORAGE_KEYS.LAST_SYNCED_STEPS_DATE,
      );
      const syncedCount = await storageGet<number>(
        STORAGE_KEYS.LAST_SYNCED_STEPS_COUNT,
      );
      if (syncedDate === today && syncedCount !== null) {
        lastSyncedStepsRef.current = syncedCount;
      } else {
        lastSyncedStepsRef.current = 0;
        await storageSet(STORAGE_KEYS.LAST_SYNCED_STEPS_DATE, today);
        await storageSet(STORAGE_KEYS.LAST_SYNCED_STEPS_COUNT, 0);
      }

      await checkDayChange();
    } catch (err) {
      console.log("[Startup] WalkContext load failed", err);
    }
    };
    void load();
  }, [checkDayChange]);

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
    const daily =
      (await storageGet<DailySteps>(STORAGE_KEYS.DAILY_STEPS)) ?? {};
    daily[getTodayKey()] = steps;
    await storageSet(STORAGE_KEYS.DAILY_STEPS, daily);
  }, []);

  // ── Backend delta sync ────────────────────────────────────────────────────────

  const syncDeltaToBackend = useCallback(async () => {
    if (isWalkBackendSyncPaused()) return;
    const current = todayStepsRef.current;
    const lastSynced = lastSyncedStepsRef.current;
    const delta = current - lastSynced;
    if (delta <= 0) return;

    const distanceMeters = Math.round(stepsToDistance(delta));
    const calories = Math.round(stepsToCalories(delta));
    const activeMinutes = Math.ceil(current / 120);

    const source = stepProviderManager.toWalkSyncSource() ?? "unknown";

    const result = await submitStepsToBackend(
      delta,
      distanceMeters,
      calories,
      0,
      activeMinutes,
      current,
      source,
    );
    if (!result) {
      await saveWalkStepsOutbox({
        totalSteps: current,
        stepSource: source,
        localDate: getTodayKey(),
        updatedAt: new Date().toISOString(),
      });
      if (__DEV__) console.log("[BackendSync] walk retry queued — network failed");
      return;
    }

    await clearWalkStepsOutbox();
    if (result?.dailyRank !== undefined)
      setTodayDailyRank(result.dailyRank ?? null);
    if (result?.activeMinutes !== undefined && result.activeMinutes > 0) {
      setTodayActiveMinutes(result.activeMinutes);
    }

    lastSyncedStepsRef.current = current;
    const today = getTodayKey();
    await storageSet(STORAGE_KEYS.LAST_SYNCED_STEPS_DATE, today);
    await storageSet(STORAGE_KEYS.LAST_SYNCED_STEPS_COUNT, current);

    dynamicIconService.checkAndUpdate({
      steps: current,
      goal: todayDailyGoalRef.current,
    }).catch(() => {});

    if (__DEV__) console.log(`[BackendSync] daily sent steps=${current} source=${source}`);
  }, []);

  const flushWalkStepsOutbox = useCallback(async () => {
    const entry = await loadWalkStepsOutbox();
    if (!entry || entry.localDate !== getTodayKey()) {
      if (entry) await clearWalkStepsOutbox();
      return;
    }
    const pending = entry.totalSteps - lastSyncedStepsRef.current;
    if (pending <= 0) {
      await clearWalkStepsOutbox();
      return;
    }
    await syncDeltaToBackend();
  }, [syncDeltaToBackend]);

  const reconcileLegacyProviderSteps = useCallback(async (steps: number) => {
    if (stepProviderManager.getActiveProviderId() !== "android_legacy_sensor") return;
    const legacy = stepProviderManager.getActiveProvider() as
      | typeof import("@/services/steps/providers/androidLegacySensorProvider").androidLegacySensorProvider
      | null;
    if (legacy?.reconcileTodaySteps) {
      await legacy.reconcileTodaySteps(steps);
    }
  }, []);

  const applyTodayStepCount = useCallback(
    async (real: number, fromWatch = false) => {
      const safeReal = Math.max(0, Math.floor(real));
      const current = todayStepsRef.current;
      const delta = safeReal - current;

      // Health Connect / HealthKit often report a single phantom step on app open or
      // screen focus — ignore unless the watch callback confirms it or a second read matches.
      if (
        !fromWatch &&
        delta > 0 &&
        delta <= STEP_SYNC_CONFIG.WALK_PHANTOM_STEP_BUMP &&
        usingRealRef.current &&
        stepProviderManager.usesVerifiedStepSource()
      ) {
        if (__DEV__) {
          console.log(
            `[WalkContext] ignored phantom +${delta} on refresh current=${current} incoming=${safeReal}`,
          );
        }
        return;
      }

      const displaySteps = Math.max(current, safeReal);
      if (displaySteps === current) return;

      if (!fromWatch) {
        await reconcileLegacyProviderSteps(displaySteps);
      }

      setTodaySteps(displaySteps);
      todayStepsRef.current = displaySteps;
      savedDailyStepsRef.current = displaySteps;
      await persistDailySteps(displaySteps);
      checkMilestone(displaySteps);
      syncDeltaToBackend().catch(() => {});
    },
    [checkMilestone, persistDailySteps, reconcileLegacyProviderSteps, syncDeltaToBackend],
  );

  const refreshRealSteps = useCallback(async () => {
    const data = await stepProviderManager.getTodaySteps();
    if (!data) return;

    if (__DEV__) {
      console.log(
        `[WalkContext] refreshRealSteps provider=${data.providerId} steps=${data.steps} displayed=${Math.max(todayStepsRef.current, data.steps)}`,
      );
    }

    await applyTodayStepCount(data.steps, false);
  }, [applyTodayStepCount]);

  const startProviderWatching = useCallback(async () => {
    try {
      await reconcileLegacyProviderSteps(todayStepsRef.current);
      await stepProviderManager.startWatchingSteps((result) => {
        if (__DEV__) {
          console.log(
            `[WalkContext] liveSteps provider=${result.providerId} steps=${result.steps}`,
          );
        }
        void applyTodayStepCount(result.steps, true);
      });
    } catch (e) {
      if (__DEV__) console.log("[WalkContext] startProviderWatching error", e);
    }
  }, [applyTodayStepCount, reconcileLegacyProviderSteps]);

  const applyTrackingActivation = useCallback(
    async (ongoingNotificationEnabled: boolean) => {
      setUsingRealTracking(true);
      usingRealRef.current = true;
      setTrackingStatusState("walking");

      try {
        await refreshRealSteps();
        await fetchTodayFromBackend().catch(() => {});
        await refreshRealSteps();
        await startProviderWatching();
        startRealPollInterval();
        if (!backendSyncRef.current) {
          backendSyncRef.current = setInterval(
            syncDeltaToBackend,
            BACKEND_SYNC_INTERVAL_MS,
          );
        }
        if (ongoingNotificationEnabled) {
          void pushWalkNotificationFromCanonicalStore(true);
        } else if (
          Platform.OS === "android" &&
          shouldShowOngoingNotificationDeniedMessage()
        ) {
          Alert.alert("Notifications Disabled", getOngoingNotificationDeniedMessage());
        }
      } catch (e) {
        if (__DEV__) console.log("[WalkContext] applyTrackingActivation error", e);
      }
    },
    [
      refreshRealSteps,
      startProviderWatching,
      startRealPollInterval,
      syncDeltaToBackend,
    ],
  );

  const startRealPollInterval = useCallback(() => {
    if (realStepPollRef.current) clearInterval(realStepPollRef.current);
    realStepPollRef.current = setInterval(refreshRealSteps, REAL_STEP_POLL_MS);
  }, [refreshRealSteps]);

  const stopRealPollInterval = useCallback(() => {
    if (realStepPollRef.current) {
      clearInterval(realStepPollRef.current);
      realStepPollRef.current = null;
    }
  }, []);

  // ── Real tracking init ────────────────────────────────────────────────────────

  useEffect(() => {
    if (__DEV__) console.log(`[WalkContext] mounted — platform: ${Platform.OS}`);
    if (!FEATURE_FLAGS.REAL_STEP_TRACKING_ENABLED) return;
    if (authLoading || !user?.id) return;

    let mounted = true;
    const init = async () => {
      try {
        await waitForAppStartupReady();
        if (!mounted) return;
        if (__DEV__) console.log(`[WalkContext] platform path: ${Platform.OS}`);
      if (Platform.OS === "ios") {
        // ── iOS path (unchanged) ──────────────────────────────────────────────
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
        await refreshRealSteps();
        fetchTodayFromBackend().catch(() => {});
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

        await applyTrackingActivation(true);
      }
      } catch (err) {
        console.log("[Startup] WalkContext tracking init failed", err);
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
  }, [authLoading, refreshRealSteps, startRealPollInterval, syncDeltaToBackend, user?.id]);

  // ── AppState handler — refresh on foreground ──────────────────────────────────

  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      // Flush any unsaved steps immediately when leaving the app.
      // Prevents step loss when the OS kills the process between 30 s intervals.
      if (nextState === "background" || nextState === "inactive") {
        if (usingRealRef.current) syncDeltaToBackend().catch(() => {});
        return;
      }
      if (nextState !== "active") return;

      if (usingRealRef.current) {
        void (async () => {
          await hydrateOnAppResume();
          await checkDayChange();
          await refreshRealSteps();
          await flushWalkStepsOutbox();
          syncDeltaToBackend().catch(() => {});
          if (!stepProviderManager.usesVerifiedStepSource()) {
            const merged = await mergeWalkStepsWithNative(todayStepsRef.current);
            await applyTodayStepCount(merged, false);
          }
          await pushWalkNotificationFromCanonicalStore(false);
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
            await refreshRealSteps();
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
    flushWalkStepsOutbox,
    user?.id,
  ]);

  const resumeStepWatching = useCallback(async () => {
    if (!usingRealRef.current) return;
    await startProviderWatching();
    await refreshRealSteps();
    await pushWalkNotificationFromCanonicalStore(true);
  }, [refreshRealSteps]);

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

  const requestStepPermission = useCallback(async () => {
    if (__DEV__) console.log(`[WalkContext] requestStepPermission — platform: ${Platform.OS}`);

    if (!user?.id) {
      Alert.alert("Sign In Required", "Please sign in to enable step tracking.");
      return;
    }

    try {
      const result = await activateStepTracking({
        userId: user.id,
        username: user.username,
        requestPermission: true,
      });

      const status = result.permission as PermissionStatus;
      if (__DEV__) {
        console.log(
          `[WalkContext] Permission result: ${status} provider=${result.providerId ?? "none"}`,
        );
      }

      setStepPermissionStatus(status);
      setActiveStepSource(providerToActiveSource(result.providerId));
      setVerificationLevel(providerToVerification(result.providerId));

      if (result.success) {
        await applyTrackingActivation(result.ongoingNotificationEnabled);
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
    } catch (e) {
      if (__DEV__) console.log("[WalkContext] requestStepPermission error", e);
      Alert.alert(
        "Step Tracking Error",
        "Could not enable step tracking. Please try again.",
      );
    }
  }, [
    user?.id,
    user?.username,
    applyTrackingActivation,
  ]);

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
    const daily =
      (await storageGet<DailySteps>(STORAGE_KEYS.DAILY_STEPS)) ?? {};
    const today = getTodayKey();
    daily[today] = todayStepsRef.current;
    await storageSet(STORAGE_KEYS.DAILY_STEPS, daily);
    await storageSet(STORAGE_KEYS.TOTAL_STEPS, allTimeStepsRef.current);
    savedDailyStepsRef.current = todayStepsRef.current;
  }, []);

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

  const fetchTodayFromBackend = useCallback(async () => {
    const token = await getValidSession();
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/walk/today?localDate=${encodeURIComponent(getTodayKey())}`, {
        signal: timeoutSignal(API_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data.today?.dailyRank === "number")
        setTodayDailyRank(data.today.dailyRank);
      else if (data.today?.dailyRank === null) setTodayDailyRank(null);
      if (
        typeof data.today?.activeMinutes === "number" &&
        data.today.activeMinutes > 0
      ) {
        setTodayActiveMinutes(data.today.activeMinutes);
      }
      // Sync the user's saved daily goal from NeonDB into shared context
      if (typeof data.today?.goal === "number" && data.today.goal > 0) {
        setTodayDailyGoal(data.today.goal);
      }
      // Monotonically seed today's step count from the backend-confirmed value.
      // Critical for Android: this seeds the correct baseline before the first
      // Pedometer subscription event fires, and guards against a stale local
      // AsyncStorage value being lower than what the backend already confirmed.
      // The max() guard ensures we never decrease the displayed step count.
      if (typeof data.today?.steps === "number" && data.today.steps > 0) {
        const backendSteps = data.today.steps;
        const displaySteps = Math.max(todayStepsRef.current, backendSteps);
        if (__DEV__) {
          if (__DEV__) console.log(
            `[AndroidStep] backendToday: ${backendSteps}, asyncStorageToday: ${todayStepsRef.current}, finalDisplayedMax: ${displaySteps}`,
          );
        }
        if (displaySteps > todayStepsRef.current) {
          setTodaySteps(displaySteps);
          todayStepsRef.current = displaySteps;
          savedDailyStepsRef.current = displaySteps;
          persistDailySteps(displaySteps).catch(() => {});
        }
      }
    } catch {
      // Best-effort
    }
  }, [persistDailySteps]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      stopTracking();
      // HC is polling-based — no live subscription to tear down on unmount
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Always fetch rank on mount ────────────────────────────────────────────────

  useEffect(() => {
    fetchTodayFromBackend().catch(() => {});
  }, [fetchTodayFromBackend]);

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
    syncDeltaToBackend().catch(() => {});
  }, [todaySteps, syncDeltaToBackend]);

  // ── Periodic save ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const saveInterval = setInterval(saveDailySteps, 30000);
    return () => clearInterval(saveInterval);
  }, [saveDailySteps]);

  const isWalking = trackingStatus === "walking";
  const isPaused = trackingStatus === "paused";

  return (
    <WalkContext.Provider
      value={{
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
        enableLimitedSensorTracking,
        refreshTodayRank: fetchTodayFromBackend,
        refreshTodaySteps: refreshRealSteps,
        resumeStepWatching,
        triggerSync: syncDeltaToBackend,
      }}
    >
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
