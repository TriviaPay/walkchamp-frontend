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
import { AppState, AppStateStatus, Platform } from "react-native";
import { STORAGE_KEYS, storageGet, storageSet } from "@/utils/storage";
import { stepsToCalories, stepsToDistance, getTodayKey } from "@/utils/format";
import { getValidSession } from "@/services/authService";
import { timeoutSignal, STEP_SYNC_TIMEOUT, API_TIMEOUT_MS } from "@/utils/authFetch";
import { stepTracker, PermissionStatus } from "@/services/StepTrackingService";
import { androidHCService, isExpoGo, type HCAvailability } from "@/services/steps/androidHealthConnectService";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { dynamicIconService } from "@/services/dynamicIconService";

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
  /** Re-fetch today's rank + active minutes from the backend. Safe to call at any time. */
  refreshTodayRank: () => Promise<void>;
  /**
   * Force-push any unsynced step delta to the backend immediately.
   * Call this before reading leaderboard data so the server has the freshest step count.
   * Resolves when the sync completes (or fails silently). Never throws.
   */
  triggerSync: () => Promise<void>;
}

const WalkContext = createContext<WalkContextType | null>(null);

const MILESTONES = [1000, 2000, 5000, 10000, 15000, 20000];
/** How often (ms) iOS re-queries HealthKit for today's real steps. */
const REAL_STEP_POLL_MS = 15_000;
/** How often (ms) we push step deltas to the backend. */
const BACKEND_SYNC_INTERVAL_MS = 30_000;

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
  const allTimeStepsRef = useRef<number>(0);
  const lastSyncedStepsRef = useRef<number>(0);
  const usingRealRef = useRef(false);
  const sessionStartTimeRef = useRef<Date | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    todayStepsRef.current = todaySteps;
  }, [todaySteps]);
  useEffect(() => {
    allTimeStepsRef.current = allTimeSteps;
  }, [allTimeSteps]);
  useEffect(() => {
    usingRealRef.current = usingRealTracking;
  }, [usingRealTracking]);

  // ── Day-change detection ─────────────────────────────────────────────────────

  const checkDayChange = useCallback(async () => {
    const daily =
      (await storageGet<DailySteps>(STORAGE_KEYS.DAILY_STEPS)) ?? {};
    const today = getTodayKey();
    const storedDates = Object.keys(daily);
    const yesterday = storedDates.find((k) => k !== today && k < today);

    if (yesterday && !daily[today]) {
      setTodaySteps(0);
      savedDailyStepsRef.current = 0;
      lastSyncedStepsRef.current = 0;
      await storageSet(STORAGE_KEYS.LAST_SYNCED_STEPS_DATE, today);
      await storageSet(STORAGE_KEYS.LAST_SYNCED_STEPS_COUNT, 0);
    }
  }, []);

  // ── Load stored values on mount ──────────────────────────────────────────────

  useEffect(() => {
    const load = async () => {
      const daily = await storageGet<DailySteps>(STORAGE_KEYS.DAILY_STEPS);
      const allTime = await storageGet<number>(STORAGE_KEYS.TOTAL_STEPS);
      const streak = await storageGet<number>(STORAGE_KEYS.STREAK);
      const today = getTodayKey();

      if (daily) {
        const todayVal = daily[today] ?? 0;
        setTodaySteps(todayVal);
        savedDailyStepsRef.current = todayVal;
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
    };
    load();
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

  // ── Refresh today's real step count ─────────────────────────────────────────

  /**
   * Re-query the health data source for today's steps.
   * iOS: re-queries HealthKit (authoritative cumulative-since-midnight).
   * Android: reads the latest live subscription snapshot (monotonic max guard).
   */
  const refreshRealSteps = useCallback(async () => {
    if (Platform.OS === "ios") {
      const midnight = todayLocalMidnight();
      const now = new Date();
      const data = await stepTracker.getStepsForTimeRange(midnight, now);
      if (data === null) return;
      const real = data.steps;

      setTodaySteps(real);
      todayStepsRef.current = real;
      savedDailyStepsRef.current = real;
      await persistDailySteps(real);
      checkMilestone(real);
    } else if (Platform.OS === "android") {
      // Android HC path: cumulative range query midnight → now (same as iOS HealthKit).
      // Monotonic max guard ensures a zero result (HC temporarily unavailable) never
      // replaces a higher confirmed value shown in the UI.
      const data = await androidHCService.readTodaySteps();
      if (data.steps > 0) {
        const displaySteps = Math.max(todayStepsRef.current, data.steps);
        if (__DEV__) {
          if (__DEV__) console.log(
            `[AndroidHC] refreshRealSteps — HC: ${data.steps}, previousDisplayed: ${todayStepsRef.current}, final: ${displaySteps}`,
          );
        }
        if (displaySteps !== todayStepsRef.current) {
          setTodaySteps(displaySteps);
          todayStepsRef.current = displaySteps;
          savedDailyStepsRef.current = displaySteps;
          await persistDailySteps(displaySteps);
          checkMilestone(displaySteps);
        }
      }
    }
  }, [checkMilestone, persistDailySteps]);

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

  // ── Backend delta sync ────────────────────────────────────────────────────────

  const syncDeltaToBackend = useCallback(async () => {
    const current = todayStepsRef.current;
    const lastSynced = lastSyncedStepsRef.current;
    const delta = current - lastSynced;
    if (delta <= 0) return;

    const distanceMeters = Math.round(stepsToDistance(delta));
    const calories = Math.round(stepsToCalories(delta));
    const activeMinutes = Math.ceil(current / 120);

    // Determine step source for this platform (only send recognised sources)
    const VALID_SOURCES = [
      "ios_healthkit",
      "android_health_connect",
      "android_step_counter",
    ] as const;
    const rawSource: string =
      Platform.OS === "ios" ? "ios_healthkit" : "android_health_connect";
    const source = (VALID_SOURCES as readonly string[]).includes(rawSource)
      ? rawSource
      : undefined;

    // Pass `current` as the absolute daily total so backend never double-counts
    const result = await submitStepsToBackend(
      delta,
      distanceMeters,
      calories,
      0,
      activeMinutes,
      current,
      source,
    );
    if (result?.dailyRank !== undefined)
      setTodayDailyRank(result.dailyRank ?? null);
    if (result?.activeMinutes !== undefined && result.activeMinutes > 0) {
      setTodayActiveMinutes(result.activeMinutes);
    }

    lastSyncedStepsRef.current = current;
    const today = getTodayKey();
    await storageSet(STORAGE_KEYS.LAST_SYNCED_STEPS_DATE, today);
    await storageSet(STORAGE_KEYS.LAST_SYNCED_STEPS_COUNT, current);

    // Update dynamic app icon if the daily goal milestone changed after this sync.
    // Fire-and-forget — must never block or throw in the walk flow.
    dynamicIconService.checkAndUpdate().catch(() => {});
  }, []);

  // ── Real tracking init ────────────────────────────────────────────────────────

  useEffect(() => {
    if (__DEV__) console.log(`[WalkContext] mounted — platform: ${Platform.OS}`);
    if (!FEATURE_FLAGS.REAL_STEP_TRACKING_ENABLED) return;

    let mounted = true;
    const init = async () => {
      if (__DEV__) console.log(`[WalkContext] platform path: ${Platform.OS}`);
      if (Platform.OS === "ios") {
        // ── iOS path (unchanged) ──────────────────────────────────────────────
        const available = await stepTracker.isAvailable();
        if (!mounted || !available) return;

        const status = await stepTracker.getPermissionStatus();
        if (!mounted) return;
        setStepPermissionStatus(status);
        if (status !== "granted") return;

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
      } else if (Platform.OS === "android") {
        // ── Android path — Health Connect ─────────────────────────────────────

        if (isExpoGo()) {
          if (__DEV__)
            console.log(`[WalkContext] Android init — Expo Go detected, HC unavailable`);
          setStepPermissionStatus("unavailable");
          return;
        }

        const initResult = await androidHCService.initialize();
        if (!mounted) return;

        if (__DEV__)
          console.log(
            `[WalkContext] Android HC init — availability: ${initResult.availability}, permission: ${initResult.permission}`,
          );

        setHcAvailability(initResult.availability);

        if (initResult.availability !== "available") {
          // HC not installed, needs update, or device not supported
          setStepPermissionStatus("unavailable");
          return;
        }

        if (initResult.permission !== "granted") {
          // "unknown" → show Enable Step Tracking button
          // "denied"  → show Open Health Connect Settings button
          setStepPermissionStatus(initResult.permission as PermissionStatus);
          return;
        }

        setUsingRealTracking(true);
        usingRealRef.current = true;
        setTrackingStatusState("walking");

        // HC is range-based like iOS — safe to read immediately (no subscription
        // lag that could return 0 before the first event fires).
        fetchTodayFromBackend().catch(() => {});
        if (!mounted) return;

        await refreshRealSteps();
        startRealPollInterval();
        backendSyncRef.current = setInterval(syncDeltaToBackend, BACKEND_SYNC_INTERVAL_MS);
      }
    };

    init().catch(() => {
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
  }, []);

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
        refreshRealSteps();
        checkDayChange();
        if (Platform.OS === "android") {
          syncDeltaToBackend().catch(() => {});
        }
      } else if (
        Platform.OS === "android" &&
        FEATURE_FLAGS.REAL_STEP_TRACKING_ENABLED &&
        !isExpoGo()
      ) {
        // Not yet tracking on Android — user may have just granted HC permission
        // from the Health Connect app. Re-check and auto-start if now granted.
        androidHCService.getPermissionStatus().then((newStatus) => {
          if (__DEV__)
            console.log(`[WalkContext] AppState — Android HC permission re-check: ${newStatus}`);
          setStepPermissionStatus(newStatus as PermissionStatus);
          if (newStatus === "granted" && !usingRealRef.current) {
            androidHCService.initialize().then((initResult) => {
              if (!initResult.initialized) return;
              setHcAvailability(initResult.availability);
              setUsingRealTracking(true);
              usingRealRef.current = true;
              setTrackingStatusState("walking");
              refreshRealSteps().catch(() => {});
              startRealPollInterval();
              if (!backendSyncRef.current) {
                backendSyncRef.current = setInterval(syncDeltaToBackend, BACKEND_SYNC_INTERVAL_MS);
              }
              if (__DEV__)
                console.log(`[WalkContext] HC tracking auto-started after returning from Settings`);
            }).catch(() => {});
          }
        }).catch(() => {});
      }
    };
    const sub = AppState.addEventListener("change", handleAppState);
    return () => sub.remove();
  }, [
    refreshRealSteps,
    checkDayChange,
    syncDeltaToBackend,
    startRealPollInterval,
  ]);

  // ── Permission request helper ─────────────────────────────────────────────────

  const requestStepPermission = useCallback(async () => {
    if (__DEV__) console.log(`[WalkContext] requestStepPermission — platform: ${Platform.OS}`);
    
    let status: PermissionStatus;
    if (Platform.OS === "android") {
      // Initialize HC first (safe to call multiple times), then request permission.
      await androidHCService.initialize();
      const hcStatus = await androidHCService.requestPermission();
      status = hcStatus as PermissionStatus;
    } else {
      status = await stepTracker.requestPermission();
    }
    
    if (__DEV__) console.log(`[WalkContext] Permission result: ${status}`);
    setStepPermissionStatus(status);

    if (status === "granted") {
      setUsingRealTracking(true);
      usingRealRef.current = true;
      setTrackingStatusState("walking");
      await refreshRealSteps();
      fetchTodayFromBackend().catch(() => {});
      // Both iOS and Android use polling after permission is granted
      startRealPollInterval();
      if (!backendSyncRef.current) {
        backendSyncRef.current = setInterval(
          syncDeltaToBackend,
          BACKEND_SYNC_INTERVAL_MS,
        );
      }
    }
  }, [
    refreshRealSteps,
    startRealPollInterval,
    syncDeltaToBackend,
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
        todayActiveMinutes,
        todayDailyRank,
        todayDailyGoal,
        setTrackingStatus,
        togglePause,
        clearMilestone,
        requestStepPermission,
        refreshTodayRank: fetchTodayFromBackend,
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
