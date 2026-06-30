/**
 * RaceContext — manages race lifecycle with real step tracking + simulation fallback.
 *
 * Real step tracking (when enabled & permission granted):
 *   iOS     — getStepsForTimeRange(raceStart, now) via HealthKit.
 *   Android — readStepsForRange(raceStart, now) via Health Connect (same model as iOS).
 *             Baseline = androidHCService.getCachedTodaySteps() at race start.
 *             Race steps = HC range query result (no delta math needed).
 *
 * The simulation is retained for smooth UI animation.
 * Backend receives REAL steps (when available) so results are accurate.
 *
 * Race recovery across app close/kill:
 *   On join/start: persist { raceId, raceStartTimeUTC } to AsyncStorage.
 *   On mount: detect pending race, fetch real historical steps, reconcile.
 *   Both iOS and Android now use authoritative range queries for recovery.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform, AppState } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { getValidSession } from "@/services/authService";
import { stepTracker } from "@/services/StepTrackingService";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import { stepPollingService, type RacePollingConfig } from "@/services/StepPollingService";
import { raceStepSyncService } from "@/services/RaceStepSyncService";
import { raceProgressNotificationService } from "@/services/raceProgressNotificationService";
import {
  clearActiveRaceProgress,
  deactivateRaceInStore,
  feedRaceStepsToStore,
  handleBackendProgressSynced,
  resetRaceStepBuffer,
  setActiveRaceProgress,
  setStepProgressUser,
} from "@/services/stepProgressCoordinator";
import { mergeRaceStepsWithNative } from "@/services/stepDisplayMerge";
import type { StepProgressSource } from "@/store/slices/raceProgressSlice";
import { setWalkBackendSyncPaused } from "@/services/walkSyncCoordinator";
import {
  postRaceProgress,
  postRaceReconcile,
} from "@/services/raceProgressApi";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { waitForAppStartupReady } from "@/services/appStartup";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";
import { STORAGE_KEYS, storageGet, storageSet, storageRemove } from "@/utils/storage";
import { timeoutSignal, API_TIMEOUT_MS } from "@/utils/authFetch";
import { subscribeToChannel, unsubscribeFromChannel } from "@/services/realtimeService";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

// ── API helpers ────────────────────────────────────────────────────────────────

async function fetchRaceStatus(raceId: string): Promise<{ status: string; startedAt?: string; completedAt?: string } | null> {
  try {
    const session = await getValidSession();
    if (!session) return null;
    const res = await fetch(`${API_BASE}/api/races/${raceId}`, {
      signal: timeoutSignal(API_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${session}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.race ?? null;
  } catch {
    return null;
  }
}

// ── Pending race state (persisted to AsyncStorage for recovery) ────────────────

interface PendingRace {
  raceId: string;
  raceStartTimeUTC: string;
  raceEndTimeUTC?: string;
  status: "in_progress" | "completed";
}

async function savePendingRace(r: PendingRace) {
  await storageSet(STORAGE_KEYS.PENDING_RACE, r);
}

async function clearPendingRace() {
  await storageRemove(STORAGE_KEYS.PENDING_RACE);
}

// ── Types ──────────────────────────────────────────────────────────────────────

export const RACE_DEFAULTS = {
  RACE_TARGET: 1000,
  // RACE_DURATION_SECONDS removed — races end by backend events only (goal
  // completion, all forfeit, scheduled end time). No client-side hard cutoff.
  WINNERS_POOL_RATIO: 0.7,
  PLATFORM_FEE_RATIO: 0.3,
  WINNER_SPLITS: [0.5, 0.3, 0.2],
  COUNTDOWN_SECONDS: 10,
};

export type RacePhase = "idle" | "matchmaking" | "countdown" | "in_race" | "finished";

export interface RaceParticipant {
  id: string;
  username: string;
  countryFlag: string;
  avatarColor: string;
  raceSteps: number;
  isFinished: boolean;
  finishRank?: number;
  isUser?: boolean;
  isSuspicious?: boolean;
  isHost?: boolean;
  isForfeited?: boolean;
}

export interface RaceResult {
  participant: RaceParticipant;
  rank: number;
  displayRank: number;
  prizeAmount: number;
  isTied: boolean;
  tieGroupSize: number;
  eligibleForPrize: boolean;
  status: "pending_verification" | "approved" | "under_review";
}

const BOT_PLAYERS: Omit<RaceParticipant, "raceSteps" | "isFinished">[] = [
  { id: "b1", username: "speedwalker_kai", countryFlag: "🇨🇳", avatarColor: "#00E676" },
  { id: "b2", username: "marathon_priya", countryFlag: "🇮🇳", avatarColor: "#00B4FF" },
  { id: "b3", username: "walker_james", countryFlag: "🇺🇸", avatarColor: "#06B6D4" },
  { id: "b4", username: "neon_stepper", countryFlag: "🇯🇵", avatarColor: "#FFD700" },
  { id: "b5", username: "swift_leo", countryFlag: "🇩🇪", avatarColor: "#FF6B35" },
  { id: "b6", username: "walk_queen_s", countryFlag: "🇫🇷", avatarColor: "#A855F7" },
  { id: "b7", username: "stepmaster_r", countryFlag: "🇮🇳", avatarColor: "#F472B6" },
  { id: "b8", username: "sunwalk_ko", countryFlag: "🇵🇱", avatarColor: "#34D399" },
  { id: "b9", username: "morningrun_oz", countryFlag: "🇦🇺", avatarColor: "#60A5FA" },
];

/** Returns how many prize places for a given player count.
 *  2  → 1 winner, 3 → 2 winners, 4+ → 3 winners */
function numWinnersForCount(playerCount: number): number {
  if (playerCount <= 2) return 1;
  if (playerCount === 3) return 2;
  return 3;
}

/** Per-position split ratios within the winners pool. */
function prizeSplitsForCount(playerCount: number): number[] {
  const w = numWinnersForCount(playerCount);
  if (w === 1) return [1.0];
  if (w === 2) return [0.7, 0.3];
  return [0.5, 0.3, 0.2];
}

function calculatePrizes(entryFee: number, numPlayers: number) {
  const totalPool = numPlayers * entryFee;
  const winnersPool = totalPool * RACE_DEFAULTS.WINNERS_POOL_RATIO;
  const platformFee = totalPool * RACE_DEFAULTS.PLATFORM_FEE_RATIO;
  const splits = prizeSplitsForCount(numPlayers);
  const prizes = splits.map((split) =>
    parseFloat((winnersPool * split).toFixed(2))
  );
  return { totalPool, winnersPool, platformFee, prizes };
}

interface RaceContextType {
  racePhase: RacePhase;
  raceEntryFee: number;
  raceMaxPlayers: number;
  playersJoined: number;
  participants: RaceParticipant[];
  countdown: number;
  raceTimerSeconds: number;
  userRaceSteps: number;
  /** Race steps shown on Walk tab — persists after race until a new race starts. */
  walkRaceStepsDisplay: number;
  results: RaceResult[];
  userFinishRank: number | null;
  totalPool: number;
  winnersPool: number;
  platformFee: number;
  prizeTiers: number[];
  isSuspicious: boolean;
  raceId: string | null;
  isHost: boolean;
  /** Server-authoritative race start time (UTC). Used for step reconciliation. */
  raceStartTimeUTC: Date | null;
  /** Target steps for the current race (from backend room data). */
  raceTargetSteps: number;
  setRaceTargetSteps: (steps: number) => void;
  joinRace: (entryFee: number, maxPlayers: number, hostMode?: boolean) => boolean;
  startRaceManually: () => void;
  /** Called when backend confirms race is in_progress. startedAt from server when available. */
  notifyRaceStarted: (realPlayerCount: number, startedAt?: Date) => void;
  /** Rejoin an in-progress race with server step count (no countdown). */
  resumeLiveRace: (realPlayerCount: number, startedAt: Date, initialUserSteps?: number) => void;
  cancelRace: () => void;
  resetRace: () => void;
  setActiveRace: (id: string | null, host: boolean) => void;
  /** Stop HC/pedometer polling and simulation ticks (e.g. when race completes on live-detail). */
  stopRaceStepTracking: (reason?: string) => void;
  /** Flush pending steps when leaving a screen — does not stop device polling. */
  pauseRaceStepTracking: () => void;
  /** Re-start race step polling after returning to live-detail (active race only). */
  resumeRaceStepTracking: () => void;
  /** Read device + merge server steps after background / screen rejoin. */
  catchUpLiveRaceSteps: (serverSteps?: number, force?: boolean) => Promise<void>;
  /** Persist final race steps on Walk tab after server-side race completion. */
  recordFinishedRaceStepsForWalk: (steps: number) => void;
}

const RaceContext = createContext<RaceContextType | null>(null);

// ── Step ranges per tick (900ms): [min, max] added each interval (simulation) ──
const BOT_STEP_RANGES: Record<string, [number, number]> = {
  b1: [20, 26],
  b2: [16, 22],
  b3: [13, 19],
  b4: [10, 15],
  b5: [11, 16],
  b6: [8, 13],
  b7: [12, 17],
  b8: [7, 11],
  b9: [9, 14],
};

export function RaceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  // Keep a ref to the latest user profile so race callbacks always see current data.
  const userProfileRef = useRef({
    username:    user?.username    ?? "you",
    countryFlag: user?.countryFlag ?? "🇺🇸",
    avatarColor: user?.avatarColor ?? "#00E676",
    userId:      user?.id          ?? "user",
  });

  const [racePhase, setRacePhase] = useState<RacePhase>("idle");
  const [raceEntryFee, setRaceEntryFee] = useState(1);
  const [raceMaxPlayers, setRaceMaxPlayers] = useState(10);
  const [playersJoined, setPlayersJoined] = useState(0);
  const [participants, setParticipants] = useState<RaceParticipant[]>([]);
  const [countdown, setCountdown] = useState(RACE_DEFAULTS.COUNTDOWN_SECONDS);
  const [raceTimerSeconds, setRaceTimerSeconds] = useState(0);
  const [userRaceSteps, setUserRaceSteps] = useState(0);
  const [walkRaceStepsDisplay, setWalkRaceStepsDisplay] = useState(0);
  const [results, setResults] = useState<RaceResult[]>([]);
  const [userFinishRank, setUserFinishRank] = useState<number | null>(null);
  const [isSuspicious, setIsSuspicious] = useState(false);
  const [prizeState, setPrizeState] = useState(() => calculatePrizes(1, 10));
  const [raceId, setRaceId] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [raceStartTimeUTC, setRaceStartTimeUTC] = useState<Date | null>(null);
  const [raceTargetSteps, _setRaceTargetSteps] = useState(RACE_DEFAULTS.RACE_TARGET);
  const racePhaseRef = useRef<RacePhase>("idle");

  const matchmakingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const raceStepRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const raceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const raceEndTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realStepPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const forfeitChannelRef = useRef<string | null>(null);
  const botStepsRef = useRef<Record<string, number>>({});
  const finishedCountRef = useRef(0);
  const userStepsRef = useRef(0);
  const prizesRef = useRef(prizeState.prizes);
  const participantsRef = useRef<RaceParticipant[]>([]);
  const raceEndedRef = useRef(false);
  const raceIdRef = useRef<string | null>(null);
  // subscriptionGenRef: incremented every time clearAllIntervals() is called (race end/forfeit).
  // Each startRace() closure captures the generation at creation time so stale CMPedometer
  // callbacks that fire after stopLiveTracking() can be detected and discarded.
  // This prevents old race steps from contaminating a new race started immediately after forfeit.
  const subscriptionGenRef = useRef(0);
  const raceStartTimeRef = useRef<Date | null>(null);
  const stepTickRef = useRef(0);
  const pendingBotsRef = useRef<Omit<RaceParticipant, "raceSteps" | "isFinished">[]>([]);
  const playersJoinedRef = useRef(0);
  const hostModeRef = useRef(false);
  const usingRealStepsRef = useRef(false);
  const racePollingConfigRef = useRef<RacePollingConfig | null>(null);
  const raceStepApplyRef = useRef<((steps: number) => void) | null>(null);
  /** Server-synced floor — never show fewer steps than backend already recorded. */
  const raceStepFloorRef = useRef(0);
  const raceDeviceBaselineRef = useRef(0);
  const goalFlushDoneRef = useRef(false);
  const catchUpInFlightRef = useRef(false);
  const lastCatchUpMsRef = useRef(0);
  // Mirrors raceTargetSteps state so callbacks always see the current target.
  const raceTargetStepsRef = useRef(RACE_DEFAULTS.RACE_TARGET);

  // Sync userProfileRef whenever the auth user changes.
  useEffect(() => {
    userProfileRef.current = {
      username:    user?.username    ?? "you",
      countryFlag: user?.countryFlag ?? "🇺🇸",
      avatarColor: user?.avatarColor ?? "#00E676",
      userId:      user?.id          ?? "user",
    };
    setStepProgressUser(user?.id ?? null, user?.username ?? null);
  }, [user?.username, user?.countryFlag, user?.avatarColor, user?.id]);

  useEffect(() => {
    racePhaseRef.current = racePhase;
  }, [racePhase]);

  // Real-time ring update: when the signed-in user changes their avatar color while
  // in an active race, update their own participant entry immediately.
  useEffect(() => {
    if (!user?.avatarColor) return;
    const newColor = user.avatarColor;
    setParticipants((prev) => {
      const hasUserEntry = prev.some((p) => p.isUser);
      if (!hasUserEntry) return prev;
      return prev.map((p) =>
        p.isUser ? { ...p, avatarColor: newColor } : p
      );
    });
  }, [user?.avatarColor]);

  // Keep raceTargetStepsRef in sync whenever the state setter is called.
  const setRaceTargetSteps = useCallback((steps: number) => {
    raceTargetStepsRef.current = steps;
    _setRaceTargetSteps(steps);
  }, []);

  const clearRaceJsTimers = () => {
    if (matchmakingRef.current) clearInterval(matchmakingRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (raceStepRef.current) clearInterval(raceStepRef.current);
    if (raceTimerRef.current) clearInterval(raceTimerRef.current);
    if (raceEndTimeoutRef.current) clearTimeout(raceEndTimeoutRef.current);
    if (realStepPollRef.current) clearInterval(realStepPollRef.current);
    matchmakingRef.current = null;
    countdownRef.current = null;
    raceStepRef.current = null;
    raceTimerRef.current = null;
    raceEndTimeoutRef.current = null;
    realStepPollRef.current = null;
    if (forfeitChannelRef.current) {
      unsubscribeFromChannel(forfeitChannelRef.current);
      forfeitChannelRef.current = null;
    }
    subscriptionGenRef.current++;
    stepTracker.stopLiveTracking();
    stepProviderManager.stopWatchingSteps();
    stepPollingService.stopPolling("race_ended");
    raceStepSyncService.cancelPending();
    racePollingConfigRef.current = null;
    raceStepFloorRef.current = 0;
    goalFlushDoneRef.current = false;
  };

  /** Stop JS timers only. Notification lifecycle is owned by stepProgressCoordinator. */
  const clearAllIntervals = () => {
    clearRaceJsTimers();
  };

  const stopRaceStepTracking = useCallback((reason = "race_tracking_stopped") => {
    raceEndedRef.current = true;
    raceStepApplyRef.current = null;
    if (raceStepRef.current) {
      clearInterval(raceStepRef.current);
      raceStepRef.current = null;
    }
    stepTracker.stopLiveTracking();
    stepProviderManager.stopWatchingSteps();
    stepPollingService.stopPolling(reason);
    if (raceIdRef.current && userStepsRef.current > 0) {
      void raceStepSyncService.flush(
        raceIdRef.current,
        userStepsRef.current,
        stepProviderManager.toRaceProgressSource(),
      );
    } else {
      raceStepSyncService.cancelPending();
    }
    subscriptionGenRef.current++;
    racePollingConfigRef.current = null;
    raceStepFloorRef.current = 0;
  }, []);

  const pauseRaceStepTracking = useCallback(() => {
    if (raceEndedRef.current) return;
    if (raceIdRef.current && userStepsRef.current > 0) {
      void raceStepSyncService.flush(
        raceIdRef.current,
        userStepsRef.current,
        stepProviderManager.toRaceProgressSource(),
      );
    }
  }, []);

  const resumeRaceStepTracking = useCallback(async (forceRestart = false) => {
    if (raceEndedRef.current || racePhaseRef.current !== "in_race") return;

    let cfg = racePollingConfigRef.current;
    const raceId = raceIdRef.current;
    const raceStart = raceStartTimeRef.current;
    const userId = userProfileRef.current.userId;

    if (!cfg && raceId && raceStart && userId && raceStepApplyRef.current) {
      const baseline = await stepProviderManager.ensureRaceBaseline(
        raceId,
        userId,
        userStepsRef.current > 0 ? userStepsRef.current : undefined,
      );
      const apply = raceStepApplyRef.current;
      const myGen = subscriptionGenRef.current;
      cfg = {
        raceId,
        raceStartTime: raceStart,
        userId,
        baseline,
        target: raceTargetStepsRef.current,
        onUpdate: (raceSteps, deviceTotal) => {
          if (subscriptionGenRef.current !== myGen || raceEndedRef.current) return;
          apply(raceSteps, deviceTotal);
        },
        onReadBlocked: () => {
          void stepProviderManager.switchToLegacyFallback("read_blocked_on_resume");
        },
      };
      racePollingConfigRef.current = cfg;
      usingRealStepsRef.current = true;
    }

    if (!cfg) return;

    if (!forceRestart && stepPollingService.isRacePolling(raceId ?? undefined)) {
      if (raceId && raceStart && userId && raceStepApplyRef.current) {
        const snap = await stepProviderManager.getRaceSteps(raceId, raceStart, userId);
        if (snap && !raceEndedRef.current) {
          const baseline = raceDeviceBaselineRef.current || cfg.baseline;
          raceStepApplyRef.current(snap.steps, Math.max(baseline, baseline + snap.steps));
        }
      }
      return;
    }

    stepPollingService.stopPolling("race_resume");
    stepPollingService.startPolling("race", cfg);

    if (raceId && raceStart && userId && raceStepApplyRef.current) {
      const snap = await stepProviderManager.getRaceSteps(raceId, raceStart, userId);
      if (snap && !raceEndedRef.current) {
        const baseline = raceDeviceBaselineRef.current || cfg.baseline;
        raceStepApplyRef.current(snap.steps, Math.max(baseline, baseline + snap.steps));
      }
    }
  }, []);

  const catchUpLiveRaceSteps = useCallback(async (serverSteps = 0, force = false) => {
    if (!raceIdRef.current || raceEndedRef.current || !raceStartTimeRef.current) return;
    if (racePhaseRef.current !== "in_race") return;

    const now = Date.now();
    if (!force && now - lastCatchUpMsRef.current < 2500) return;
    if (catchUpInFlightRef.current) return;
    catchUpInFlightRef.current = true;
    lastCatchUpMsRef.current = now;

    try {
      const raceId = raceIdRef.current;
      const raceStart = raceStartTimeRef.current;
      const userId = userProfileRef.current.userId;
      const safeServer = Math.max(0, Math.floor(serverSteps));
      const optimistic = Math.max(safeServer, userStepsRef.current);
      if (optimistic > 0) {
        raceStepFloorRef.current = Math.max(raceStepFloorRef.current, optimistic);
        userStepsRef.current = optimistic;
        setUserRaceSteps(optimistic);
      }

      let deviceSteps = 0;
      try {
        if (await stepProviderManager.isTrackingReady()) {
          const snap = await stepProviderManager.getRaceSteps(raceId, raceStart, userId);
          if (snap) deviceSteps = snap.steps;
        }
      } catch {
        /* non-fatal */
      }

      // Legacy sensor: realign baseline when server is ahead. HC uses time-range reads.
      if (
        safeServer > deviceSteps &&
        stepProviderManager.usesRaceBaseline()
      ) {
        await stepProviderManager.alignRaceBaselineToRaceSteps(raceId, userId, safeServer);
        const resnap = await stepProviderManager.getRaceSteps(raceId, raceStart, userId);
        if (resnap) deviceSteps = resnap.steps;
      }

      // Include any steps tracked by the native Android FGS while JS was asleep
      // (legacy sensor only — HC uses time-range reads and doesn't need this).
      const nativeMerged = await mergeRaceStepsWithNative(Math.max(deviceSteps, safeServer));
      let merged = Math.max(deviceSteps, safeServer, nativeMerged);

      // Reject single-step phantom bumps on refresh/catch-up when using verified sources.
      if (
        force &&
        merged > userStepsRef.current &&
        merged - userStepsRef.current <= STEP_SYNC_CONFIG.WALK_PHANTOM_STEP_BUMP &&
        stepProviderManager.usesVerifiedStepSource() &&
        !stepProviderManager.usesRaceBaseline()
      ) {
        if (__DEV__) {
          console.log(
            `[RaceStepsRealtime] ignored phantom race +${merged - userStepsRef.current} on catch-up`,
          );
        }
        merged = userStepsRef.current;
      }

      if (merged <= userStepsRef.current) {
        return;
      }

      raceStepFloorRef.current = merged;

      if (raceStepApplyRef.current) {
        raceStepApplyRef.current(merged);
      } else if (merged > 0) {
        userStepsRef.current = merged;
        setUserRaceSteps(merged);
        raceStepSyncService.seedSyncedSteps(merged);
        raceStepSyncService.notifyStepsUpdated(
          raceId,
          merged,
          stepProviderManager.toRaceProgressSource(),
        );
      }

      if (merged > 0) {
        raceStepSyncService.seedSyncedSteps(merged);
      }

      await resumeRaceStepTracking(false);
    } finally {
      catchUpInFlightRef.current = false;
    }
  }, [resumeRaceStepTracking]);

  const setActiveRace = useCallback((id: string | null, host: boolean) => {
    raceIdRef.current = id;
    setRaceId(id);
    setIsHost(host);
  }, []);

  // ── Race recovery on mount (after auth is ready) ─────────────────────────────

  useEffect(() => {
    if (!FEATURE_FLAGS.SERVER_TIME_RACE_VALIDATION_ENABLED) return;
    if (!user?.id) return;

    const recover = async () => {
      try {
        await waitForAppStartupReady();
        const pending = await storageGet<PendingRace>(STORAGE_KEYS.PENDING_RACE);
        if (!pending) return;

        const { raceId: pendingRaceId, raceStartTimeUTC: startStr } = pending;
        const raceStart = new Date(startStr);

        const raceData = await fetchRaceStatus(pendingRaceId);
        if (!raceData) {
          await clearPendingRace();
          return;
        }

        if (raceData.status === "in_progress") {
          if (Platform.OS === "ios") {
            const available = await stepTracker.isAvailable().catch(() => false);
            if (!available) return;
            const data = await stepTracker.getStepsForTimeRange(raceStart, new Date()).catch(() => null);
            if (__DEV__) console.log(`[RaceSteps] iOS recovery: device latest steps=${data?.steps ?? 0} raceStartedAt=${raceStart}`);
            if (data && data.steps > 0) {
              await postRaceProgress(pendingRaceId, data.steps, undefined, undefined, "healthkit");
            }
          } else {
            const uid = userProfileRef.current.userId;
            if (!uid || uid === "user") return;
            const raceData2 = await stepProviderManager.getRaceSteps(
              pendingRaceId,
              raceStart,
              uid,
            ).catch(() => null);
            if (__DEV__) console.log(`[RaceSteps] Android recovery: steps=${raceData2?.steps ?? 0}`);
            if (raceData2 && raceData2.steps > 0) {
              await postRaceProgress(
                pendingRaceId,
                raceData2.steps,
                undefined,
                undefined,
                stepProviderManager.toRaceProgressSource(),
              );
            }
          }
        } else if (raceData.status === "completed") {
          const raceEnd = raceData.completedAt ? new Date(raceData.completedAt) : new Date();

          if (Platform.OS === "ios") {
            const available = await stepTracker.isAvailable().catch(() => false);
            if (available) {
              const data = await stepTracker.getStepsForTimeRange(raceStart, raceEnd).catch(() => null);
              if (data && data.steps > 0) {
                await postRaceReconcile(pendingRaceId, data.steps, data.source);
              }
            }
          }
          await clearPendingRace();
        } else if (raceData.status === "cancelled" || raceData.status === "open") {
          await clearPendingRace();
        }
      } catch (err) {
        console.log("[Startup] race recovery failed", err);
      }
    };

    void recover();
  }, [user?.id]);

  // ── endRace ───────────────────────────────────────────────────────────────────

  const endRace = useCallback((finalParticipants: RaceParticipant[]) => {
    if (raceEndedRef.current) return;
    raceEndedRef.current = true;

    // Clear real step polling
    if (realStepPollRef.current) {
      clearInterval(realStepPollRef.current);
      realStepPollRef.current = null;
    }

    // Flush final steps to backend — use real steps if available, else simulated
    const userParticipant = finalParticipants.find((p) => p.isUser);
    const finalUserSteps = Math.max(
      userParticipant?.raceSteps ?? 0,
      userStepsRef.current,
    );
    if (finalUserSteps > 0) {
      setWalkRaceStepsDisplay(finalUserSteps);
    }

    // Mark race as finished in canonical store; coordinator stops notification.
    const finishedRaceId = raceIdRef.current;
    clearActiveRaceProgress("finished", {
      preserveWalkDisplay: finalUserSteps > 0 ? finalUserSteps : undefined,
      raceId: finishedRaceId ?? undefined,
    });

    if (raceIdRef.current && userParticipant) {
      void raceStepSyncService.flush(
        raceIdRef.current,
        userParticipant.raceSteps,
        stepProviderManager.toRaceProgressSource(),
      );
    }

    // Mark pending race as completed so recovery knows the end time
    if (raceIdRef.current) {
      savePendingRace({
        raceId: raceIdRef.current,
        raceStartTimeUTC: raceStartTimeRef.current?.toISOString() ?? new Date().toISOString(),
        raceEndTimeUTC: new Date().toISOString(),
        status: "completed",
      });
    }

    clearAllIntervals();
    setRacePhase("finished");
    setWalkBackendSyncPaused(false);

    const sorted = [...finalParticipants].sort((a, b) => {
      if (a.isFinished && b.isFinished) return (a.finishRank ?? 99) - (b.finishRank ?? 99);
      if (a.isFinished && !b.isFinished) return -1;
      if (!a.isFinished && b.isFinished) return 1;
      return b.raceSteps - a.raceSteps;
    });

    const currentPrizes = prizesRef.current;
    const raceResults: RaceResult[] = sorted.slice(0, 10).map((p, i) => {
      const rank = i + 1;
      const prizeAmount = (currentPrizes[rank - 1] ?? 0);
      return {
        participant: { ...p, finishRank: i + 1 },
        rank,
        displayRank: rank,
        prizeAmount,
        isTied: false,
        tieGroupSize: 1,
        eligibleForPrize: prizeAmount > 0,
        status: p.isUser && rank <= 3 ? "pending_verification" : "approved",
      };
    });

    const userResult = raceResults.find((r) => r.participant.isUser);
    if (userResult) setUserFinishRank(userResult.rank);

    setResults(raceResults);
    setParticipants(sorted.map((p, i) => ({ ...p, isFinished: true, finishRank: i + 1 })));

    // ── Authoritative backend fetch — replaces local estimates with tie-aware payouts ──
    const currentRaceId = raceIdRef.current;
    if (currentRaceId) {
      setTimeout(async () => {
        try {
          const session = await getValidSession();
          if (!session) return;
          const res = await fetch(`${API_BASE}/api/races/${currentRaceId}`, {
            signal: timeoutSignal(API_TIMEOUT_MS),
            headers: { Authorization: `Bearer ${session}` },
          });
          if (!res.ok) return;
          const data = await res.json() as {
            race: { tieRulesApplied: boolean };
            participants: Array<{
              userId: string;
              username: string;
              countryFlag: string | null;
              avatarColor: string | null;
              currentSteps: number;
              rank: number | null;
              displayRank: number | null;
              prizeAmount: number;
              isTied: boolean;
              tieGroupSize: number;
              eligibleForPrize: boolean;
              isCurrentUser: boolean;
              status: string | null;
            }>;
          };
          if (!data.participants || data.participants.length === 0) return;

          if (__DEV__) {
            if (__DEV__) console.log(`[RaceResults] tie_rules_applied: ${data.race.tieRulesApplied}`);
            if (__DEV__) console.log(`[RaceResults] tied participants: ${data.participants.filter((p) => p.isTied).length}`);
          }

          const authoritativeResults: RaceResult[] = data.participants.map((p) => {
            const result: RaceResult = {
              participant: {
                id: p.userId,
                username: p.username,
                countryFlag: p.countryFlag ?? "🏳️",
                avatarColor: p.avatarColor ?? "#00E676",
                raceSteps: p.currentSteps,
                isFinished: true,
                finishRank: p.rank ?? undefined,
                isUser: p.isCurrentUser,
                isForfeited: p.status === "forfeited",
              },
              rank: p.rank ?? 99,
              displayRank: p.displayRank ?? p.rank ?? 99,
              prizeAmount: p.prizeAmount,
              isTied: p.isTied,
              tieGroupSize: p.tieGroupSize,
              eligibleForPrize: p.eligibleForPrize,
              status: p.isCurrentUser && p.prizeAmount > 0 ? "pending_verification" : "approved",
            };
            if (__DEV__ && p.prizeAmount > 0) {
              if (__DEV__) console.log(`[RaceResults] payout displayed: ${p.username} rank=${p.displayRank ?? p.rank} prize=$${p.prizeAmount.toFixed(2)} tied=${p.isTied}`);
            }
            return result;
          });

          setResults(authoritativeResults);
          const authUserResult = authoritativeResults.find((r) => r.participant.isUser);
          if (authUserResult) setUserFinishRank(authUserResult.rank);
        } catch {
          // Fallback gracefully — local results remain shown
        }
      }, 3000);
    }
  }, []);

  // ── startRace ─────────────────────────────────────────────────────────────────

  const startRace = useCallback((allParticipants: RaceParticipant[], options?: { isRejoin?: boolean }) => {
    finishedCountRef.current = 0;
    const userFromList = allParticipants.find((p) => p.isUser);
    // Fresh races always begin at 0 — only an explicit rejoin may restore server steps.
    const bootSteps = options?.isRejoin
      ? Math.max(0, userFromList?.raceSteps ?? 0)
      : 0;
    raceEndedRef.current = false;
    goalFlushDoneRef.current = false;
    botStepsRef.current = {};
    BOT_PLAYERS.forEach((b) => { botStepsRef.current[b.id] = 0; });
    participantsRef.current = allParticipants;

    const raceStart = raceStartTimeRef.current;
    const useRealSteps = FEATURE_FLAGS.REAL_STEP_TRACKING_ENABLED && !!raceStart;

    if (useRealSteps) {
      userStepsRef.current = bootSteps;
      raceStepFloorRef.current = bootSteps;
      raceStepSyncService.reset();
      if (bootSteps > 0) {
        raceStepSyncService.seedSyncedSteps(bootSteps);
      }
    } else {
      userStepsRef.current = bootSteps;
      if (bootSteps === 0) {
        raceStepSyncService.reset();
      } else {
        raceStepSyncService.seedSyncedSteps(bootSteps);
      }
    }
    usingRealStepsRef.current = false;

    // Capture the generation at race-start time.  All step callbacks created in THIS
    // startRace() call will check this value before touching raceSteps state.
    // clearAllIntervals() (called on forfeit/end) increments subscriptionGenRef so any
    // late-firing callback from the previous race is silently discarded.
    const myGen = subscriptionGenRef.current;

    setRacePhase("in_race");
    setWalkBackendSyncPaused(true);
    setRaceTimerSeconds(0);
    setUserRaceSteps(bootSteps);

    // Register race in canonical store and start notification from coordinator.
    if (raceIdRef.current) {
      resetRaceStepBuffer();
      setActiveRaceProgress({
        raceId: raceIdRef.current,
        raceStartTime: raceStart?.toISOString() ?? new Date().toISOString(),
        userId: userProfileRef.current.userId,
        username: userProfileRef.current.username,
        goalSteps: raceTargetStepsRef.current,
        totalParticipants: Math.max(1, allParticipants.length),
        bootSteps,
        freshStart: !options?.isRejoin,
      });
    }

    raceTimerRef.current = setInterval(() => {
      setRaceTimerSeconds((s) => s + 1);
    }, 1000);

    // ── Real step tracking for race (iOS HealthKit / Android HC or legacy sensor) ──
    if (useRealSteps) {
      if (__DEV__) {
        if (__DEV__) console.log(`[RaceStepsRealtime] platform: ${Platform.OS}`);
        if (__DEV__) console.log(`[RaceStepsRealtime] sensor type: ${Platform.OS === "ios" ? "ios_pedometer (watchStepCount)" : "android_step_counter"}`);
        if (__DEV__) console.log(`[RaceStepsRealtime] race started: ${raceStart?.toISOString() ?? "unknown"}`);
      }

      // ── Helper: apply anti-regression + update UI ─────────────────────────
      // raceSteps = steps walked since THIS race started (isolated per race).
      // dailySteps / lifetimeSteps are tracked separately in WalkContext — never mixed here.
      const applyRealSteps = (rawSteps: number, deviceTotalSteps?: number) => {
        // Guard: if this callback belongs to a previous race (myGen is stale), discard it.
        if (subscriptionGenRef.current !== myGen) return;
        if (raceEndedRef.current) return;

        let steps = Math.max(0, rawSteps);
        const raceElapsedMs = raceStart ? Date.now() - raceStart.getTime() : 0;
        const MAX_FIRST_DELTA = 60;
        if (
          userStepsRef.current === 0 &&
          steps > MAX_FIRST_DELTA &&
          raceElapsedMs < 20_000
        ) {
          if (__DEV__) {
            console.log(
              `[RaceStepsRealtime] clamping first spike ${steps} → ${MAX_FIRST_DELTA}`,
            );
          }
          steps = MAX_FIRST_DELTA;
        }

        const antiReg = Math.max(userStepsRef.current, steps, raceStepFloorRef.current);
        const prevSteps = userStepsRef.current;
        if (__DEV__) {
          if (steps < prevSteps)
            if (__DEV__) console.log(`[RaceStepsRealtime] ignored lower value: ${steps} (keeping ${prevSteps})`);
          else if (steps > prevSteps)
            if (__DEV__) console.log(`[RaceStepsRealtime] calculated race_steps: ${steps} previous: ${prevSteps}`);
        }
        if (antiReg === prevSteps) {
          return;
        }
        userStepsRef.current = antiReg;
        raceStepFloorRef.current = Math.max(raceStepFloorRef.current, antiReg);
        setUserRaceSteps(antiReg);

        // Feed the canonical Redux store so live-detail and the notification
        // pipeline receive every validated step update without a duplicate
        // backend sync (RaceStepSyncBuffer drives that separately).
        feedRaceStepsToStore({
          raceSteps: antiReg,
          stepSource: stepProviderManager.toRaceProgressSource() as StepProgressSource,
          updatedAt: new Date().toISOString(),
        });

        if (__DEV__ && antiReg > prevSteps) {
          if (__DEV__) console.log(`[RaceStepsRealtime] local UI updated: ${antiReg}`);
        }

        const target = raceTargetStepsRef.current;
        setParticipants((prev) => {
          const updated = prev.map((p) => {
            if (!p.isUser) return p;
            if (antiReg >= target && !p.isFinished) {
              finishedCountRef.current += 1;
              return { ...p, raceSteps: antiReg, isFinished: true, finishRank: finishedCountRef.current };
            }
            return { ...p, raceSteps: antiReg };
          });
          participantsRef.current = updated;
          return updated;
        });

        // Backend sync — immediate flush when goal reached; otherwise interval batch.
        if (raceIdRef.current) {
          const source = stepProviderManager.toRaceProgressSource();
          const deviceTotal =
            deviceTotalSteps ??
            (raceDeviceBaselineRef.current > 0
              ? raceDeviceBaselineRef.current + antiReg
              : undefined);
          if (antiReg >= target) {
            if (!goalFlushDoneRef.current) {
              goalFlushDoneRef.current = true;
              void raceStepSyncService.flushGoal(
                raceIdRef.current,
                antiReg,
                source,
                deviceTotal,
              );
            } else {
              raceStepSyncService.notifyStepsUpdated(
                raceIdRef.current,
                antiReg,
                source,
                { deviceTotalSteps: deviceTotal },
              );
            }
          } else {
            raceStepSyncService.notifyStepsUpdated(
              raceIdRef.current,
              antiReg,
              source,
              { deviceTotalSteps: deviceTotal },
            );
          }
        }
      };
      raceStepApplyRef.current = applyRealSteps;

      const restartRacePolling = async (
        userId: string,
        baseline: number,
      ) => {
        const config: RacePollingConfig = {
          raceId: raceIdRef.current ?? "",
          raceStartTime: raceStart ?? new Date(),
          userId,
          baseline,
          target: raceTargetStepsRef.current,
          onUpdate: (raceSteps, deviceTotal) => applyRealSteps(raceSteps, deviceTotal),
          onReadBlocked: () => {
            void (async () => {
              const ok = await stepProviderManager.switchToLegacyFallback(
                "read_blocked",
              );
              if (
                !ok ||
                subscriptionGenRef.current !== myGen ||
                raceEndedRef.current
              ) {
                usingRealStepsRef.current = false;
                return;
              }
              const newBaseline = raceIdRef.current
                ? await stepProviderManager.ensureRaceBaseline(
                    raceIdRef.current,
                    userId,
                    userStepsRef.current > 0 ? userStepsRef.current : undefined,
                  )
                : 0;
              await restartRacePolling(userId, newBaseline);
            })();
          },
        };
        racePollingConfigRef.current = config;
        raceDeviceBaselineRef.current = baseline;
        stepPollingService.startPolling("race", config);
      };

      void (async () => {
        await stepProviderManager.initialize();
        const userId = userProfileRef.current.userId;

        if (!(await stepProviderManager.isTrackingReady())) {
          await stepProviderManager.requestStepPermission();
        }
        if (subscriptionGenRef.current !== myGen || raceEndedRef.current) return;

        if (!(await stepProviderManager.isTrackingReady())) {
          await stepProviderManager.switchToLegacyFallback("not_ready_at_race_start");
        }
        if (subscriptionGenRef.current !== myGen || raceEndedRef.current) return;
        if (!(await stepProviderManager.isTrackingReady())) {
          if (__DEV__) console.log("[RaceSteps] no step provider ready for race");
          return;
        }

        usingRealStepsRef.current = true;
        const providerId = stepProviderManager.getActiveProviderId();
        if (__DEV__) {
          console.log(
            `[RaceStepsRealtime] race provider: ${providerId} start=${raceStart?.toISOString() ?? "unknown"}`,
          );
        }

        const baseline =
          raceIdRef.current && userId
            ? await stepProviderManager.ensureRaceBaseline(
                raceIdRef.current,
                userId,
                bootSteps > 0 ? bootSteps : undefined,
              )
            : 0;

        if (providerId === "ios_healthkit") {
          // iOS race steps come from HealthKit range queries via stepPollingService only.
          // watchStepCount is daily-cumulative since subscription — not used for races.
        }

        if (raceIdRef.current && baseline > 0 && providerId === "android_health_connect") {
          raceStepSyncService.notifyStepsUpdated(
            raceIdRef.current,
            0,
            stepProviderManager.toRaceProgressSource(),
            { force: true, deviceTotalSteps: baseline },
          );
        }

        if (providerId === "ios_healthkit") {
          stepTracker.startLiveTracking((data) => {
            if (subscriptionGenRef.current !== myGen || raceEndedRef.current) return;
            applyRealSteps(data.steps);
          });
        }

        await restartRacePolling(userId, baseline);

        // Immediate read so UI shows 0+ steps without waiting for first poll tick.
        if (raceIdRef.current && raceStart) {
          const snap = await stepProviderManager.getRaceSteps(
            raceIdRef.current,
            raceStart,
            userId,
          );
          if (snap && subscriptionGenRef.current === myGen && !raceEndedRef.current) {
            applyRealSteps(Math.max(snap.steps, bootSteps, raceStepFloorRef.current));
          }
        }
      })();
    }

    // ── Fire an immediate 0-step "hello" sync so the server registers this
    // participant as connected, even if the step-tracking callbacks never fire
    // (e.g. async permission race or CMPedometer initialisation failure).
    // This ensures the no-progress safety-net on the server sees activity = false
    // quickly rather than waiting 3 min with total silence.
    const immediateRaceId = raceIdRef.current;
    if (immediateRaceId) {
      raceStepSyncService.notifyStepsUpdated(
        immediateRaceId,
        bootSteps,
        useRealSteps
          ? stepProviderManager.toRaceProgressSource()
          : bootSteps > 0
            ? stepProviderManager.toRaceProgressSource()
            : "race_start",
        { force: true },
      );
    }

    // Live server races: no bot simulation — steps come from HC/sensor + backend only.
    if (!raceIdRef.current) {
    // ── Bot simulation tick (offline/demo matchmaking only) ─────────────────
    const BOT_TICK_MS = 900;
    stepTickRef.current = 0;
    raceStepRef.current = setInterval(() => {
      setParticipants((prev) => {
        const target = raceTargetStepsRef.current;
        const updated = prev.map((p) => {
          if (p.isUser) {
            if (usingRealStepsRef.current) return p;
            return { ...p, raceSteps: userStepsRef.current };
          }
          const [lo, hi] = BOT_STEP_RANGES[p.id] ?? [10, 14];
          const add = Math.floor(Math.random() * (hi - lo + 1)) + lo;
          botStepsRef.current[p.id] = (botStepsRef.current[p.id] ?? 0) + add;
          const newSteps = botStepsRef.current[p.id];
          if (newSteps >= target && !p.isFinished) {
            finishedCountRef.current += 1;
            const rank = finishedCountRef.current;
            return { ...p, raceSteps: target, isFinished: true, finishRank: rank };
          }
          return { ...p, raceSteps: Math.min(newSteps, target) };
        });

        participantsRef.current = updated;
        return updated;
      });
    }, BOT_TICK_MS);
    }

    // No client-side hard-end timer. Race ends only when the backend broadcasts
    // race:completed (goal reached / all forfeited / scheduled end time).
    // raceEndTimeoutRef is kept in clearAllIntervals for safety but never set here.
  }, [endRace]);

  // ── Countdown ─────────────────────────────────────────────────────────────────

  const startCountdown = useCallback((allParticipants: RaceParticipant[]) => {
    setRacePhase("countdown");
    setCountdown(RACE_DEFAULTS.COUNTDOWN_SECONDS);

    let count = RACE_DEFAULTS.COUNTDOWN_SECONDS;
    countdownRef.current = setInterval(() => {
      count -= 1;
      setCountdown(count);
      if (count <= 0) {
        if (countdownRef.current) clearInterval(countdownRef.current);
        startRace(allParticipants);
      }
    }, 1000);
  }, [startRace]);

  // ── Host: start race manually ─────────────────────────────────────────────────

  const startRaceManually = useCallback(() => {
    if (matchmakingRef.current) {
      clearInterval(matchmakingRef.current);
      matchmakingRef.current = null;
    }

    // Capture race start time (host starts the race now)
    const startTime = new Date();
    raceStartTimeRef.current = startTime;
    setRaceStartTimeUTC(startTime);

    // Persist pending race for recovery
    if (raceIdRef.current) {
      savePendingRace({
        raceId: raceIdRef.current,
        raceStartTimeUTC: startTime.toISOString(),
        status: "in_progress",
      });
    }

    // Subscribe to forfeit events for this race
    if (raceIdRef.current) {
      const channelName = `public-live-race-${raceIdRef.current}`;
      forfeitChannelRef.current = channelName;
      const ch = subscribeToChannel(channelName);
      if (ch) {
        ch.bind("race:participant-forfeited", (data: { userId: string }) => {
          setParticipants((prev) => {
            const updated = prev.map((p) =>
              p.id === data.userId ? { ...p, isForfeited: true } : p
            );
            participantsRef.current = updated;
            return updated;
          });
        });
      }
    }

    const userParticipant: RaceParticipant = {
      id: userProfileRef.current.userId,
      username: userProfileRef.current.username,
      countryFlag: userProfileRef.current.countryFlag,
      avatarColor: userProfileRef.current.avatarColor,
      raceSteps: 0,
      isFinished: false,
      isUser: true,
      isHost: true,
    };

    const bots = pendingBotsRef.current.map((b) => ({
      ...b,
      raceSteps: 0,
      isFinished: false,
    }));

    // Reset step state before participants are set — same reason as notifyRaceStarted.
    setUserRaceSteps(0);
    userStepsRef.current = 0;
    raceStepFloorRef.current = 0;
    raceStepSyncService.reset();
    resetRaceStepBuffer();

    const all = [userParticipant, ...bots];
    setParticipants(all);
    startCountdown(all);
  }, [startCountdown]);

  // ── Non-host: race started by server ─────────────────────────────────────────

  const notifyRaceStarted = useCallback((realPlayerCount: number, startedAt?: Date) => {
    if (matchmakingRef.current) {
      clearInterval(matchmakingRef.current);
      matchmakingRef.current = null;
    }

    // Reset step state NOW — before setParticipants — so RunnerMarker mounts
    // with overrideSteps=0, not stale steps from a previous race.  Without this
    // the progressSV shared value is initialised at 1.0 (finish) and the
    // forward-only guard permanently pins the avatar to the top.
    setUserRaceSteps(0);
    userStepsRef.current = 0;
    setWalkRaceStepsDisplay(0);
    raceStepSyncService.reset();
    resetRaceStepBuffer();

    // Store server-authoritative race start time
    const startTime = startedAt ?? new Date();
    raceStartTimeRef.current = startTime;
    setRaceStartTimeUTC(startTime);

    // Persist pending race for recovery
    if (raceIdRef.current) {
      savePendingRace({
        raceId: raceIdRef.current,
        raceStartTimeUTC: startTime.toISOString(),
        status: "in_progress",
      });
    }

    // Subscribe to forfeit events for this race
    if (raceIdRef.current) {
      const channelName = `public-live-race-${raceIdRef.current}`;
      forfeitChannelRef.current = channelName;
      const ch = subscribeToChannel(channelName);
      if (ch) {
        ch.bind("race:participant-forfeited", (data: { userId: string }) => {
          setParticipants((prev) => {
            const updated = prev.map((p) =>
              p.id === data.userId ? { ...p, isForfeited: true } : p
            );
            participantsRef.current = updated;
            return updated;
          });
        });
      }
    }

    const userParticipant: RaceParticipant = {
      id: userProfileRef.current.userId,
      username: userProfileRef.current.username,
      countryFlag: userProfileRef.current.countryFlag,
      avatarColor: userProfileRef.current.avatarColor,
      raceSteps: 0, isFinished: false, isUser: true,
    };
    const botsNeeded = Math.max(0, realPlayerCount - 1);
    const bots = BOT_PLAYERS.slice(0, botsNeeded).map((b) => ({
      ...b, raceSteps: 0, isFinished: false,
    }));
    const all = [userParticipant, ...bots];
    setParticipants(all);
    startCountdown(all);
  }, [startCountdown]);

  const resumeLiveRace = useCallback((
    realPlayerCount: number,
    startedAt: Date,
    initialUserSteps = 0,
  ) => {
    if (matchmakingRef.current) {
      clearInterval(matchmakingRef.current);
      matchmakingRef.current = null;
    }

    const steps = Math.max(0, initialUserSteps);
    raceStartTimeRef.current = startedAt;
    setRaceStartTimeUTC(startedAt);
    raceEndedRef.current = false;

    if (raceIdRef.current) {
      savePendingRace({
        raceId: raceIdRef.current,
        raceStartTimeUTC: startedAt.toISOString(),
        status: "in_progress",
      });
    }

    if (raceIdRef.current) {
      const channelName = `public-live-race-${raceIdRef.current}`;
      if (forfeitChannelRef.current !== channelName) {
        forfeitChannelRef.current = channelName;
        const ch = subscribeToChannel(channelName);
        if (ch) {
          ch.bind("race:participant-forfeited", (data: { userId: string }) => {
            setParticipants((prev) => {
              const updated = prev.map((p) =>
                p.id === data.userId ? { ...p, isForfeited: true } : p,
              );
              participantsRef.current = updated;
              return updated;
            });
          });
        }
      }
    }

    const userParticipant: RaceParticipant = {
      id: userProfileRef.current.userId,
      username: userProfileRef.current.username,
      countryFlag: userProfileRef.current.countryFlag,
      avatarColor: userProfileRef.current.avatarColor,
      raceSteps: steps,
      isFinished: false,
      isUser: true,
    };
    const botsNeeded = Math.max(0, realPlayerCount - 1);
    const bots = BOT_PLAYERS.slice(0, botsNeeded).map((b) => ({
      ...b,
      raceSteps: 0,
      isFinished: false,
    }));

    if (racePhaseRef.current === "in_race" && raceIdRef.current) {
      const floor = Math.max(steps, userStepsRef.current);
      if (floor > 0) {
        raceStepFloorRef.current = Math.max(raceStepFloorRef.current, floor);
        userStepsRef.current = floor;
        setUserRaceSteps(floor);
      }
      void catchUpLiveRaceSteps(steps, true);
      return;
    }

    startRace([userParticipant, ...bots], { isRejoin: true });
  }, [startRace, catchUpLiveRaceSteps]);

  // ── Join race ─────────────────────────────────────────────────────────────────

  const joinRace = useCallback((entryFee: number, maxPlayers: number, hostMode = false): boolean => {
    const computed = calculatePrizes(entryFee, maxPlayers);
    setPrizeState(computed);
    prizesRef.current = computed.prizes;
    setRaceEntryFee(entryFee);
    setRaceMaxPlayers(maxPlayers);
    setRacePhase("matchmaking");
    setWalkRaceStepsDisplay(0);
    setUserRaceSteps(0);
    userStepsRef.current = 0;
    raceStepFloorRef.current = 0;
    raceStepSyncService.reset();
    resetRaceStepBuffer();
    setPlayersJoined(1);
    finishedCountRef.current = 0;
    hostModeRef.current = hostMode;
    pendingBotsRef.current = [];
    playersJoinedRef.current = 1;
    return true;
  }, []);

  // ── Cancel / Reset ────────────────────────────────────────────────────────────

  const cancelRace = useCallback(() => {
    clearAllIntervals();
    raceEndedRef.current = false;
    stepTickRef.current = 0;
    setWalkBackendSyncPaused(false);
    setRacePhase("idle");
    setPlayersJoined(0);
    setParticipants([]);
    setCountdown(RACE_DEFAULTS.COUNTDOWN_SECONDS);
    pendingBotsRef.current = [];
    playersJoinedRef.current = 0;

    // Clear race from canonical Redux store so screens don't show stale data.
    const cancelledRaceId = raceIdRef.current;
    clearActiveRaceProgress("cancelled", { raceId: cancelledRaceId ?? undefined });

    raceStartTimeRef.current = null;
    setRaceStartTimeUTC(null);
  }, []);

  const resetRace = useCallback(() => {
    clearAllIntervals();
    raceEndedRef.current = false;
    stepTickRef.current = 0;
    const resetRaceId = raceIdRef.current;
    raceIdRef.current = null;
    raceStartTimeRef.current = null;
    usingRealStepsRef.current = false;
    setWalkBackendSyncPaused(false);
    setRacePhase("idle");
    setPlayersJoined(0);
    setParticipants([]);
    setCountdown(RACE_DEFAULTS.COUNTDOWN_SECONDS);
    setRaceTimerSeconds(0);
    setUserRaceSteps(0);
    setResults([]);
    setUserFinishRank(null);
    setIsSuspicious(false);
    finishedCountRef.current = 0;
    userStepsRef.current = 0;
    participantsRef.current = [];
    pendingBotsRef.current = [];
    playersJoinedRef.current = 0;
    hostModeRef.current = false;
    setRaceStartTimeUTC(null);
    // Clear pending race from storage after reset (user saw results)
    clearPendingRace();
    if (resetRaceId) {
      void stepProviderManager.clearRaceBaseline(
        resetRaceId,
        userProfileRef.current.userId,
      );
    }
    stepProviderManager.stopWatchingSteps();

    deactivateRaceInStore("idle");
  }, []);

  const recordFinishedRaceStepsForWalk = useCallback((steps: number) => {
    const safe = Math.max(0, Math.floor(steps));
    if (safe > 0) setWalkRaceStepsDisplay(safe);
  }, []);

  // ── AppState listener: flush steps on background + on foreground resume ───────
  // Background flush lets other participants see step progress when this user closes
  // the app mid-race. Foreground flush catches up after OS throttled sync intervals.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (!raceIdRef.current || raceEndedRef.current) return;
      if (racePhaseRef.current !== "in_race") return;

      if (nextState === "active") {
        void catchUpLiveRaceSteps(userStepsRef.current, true);
        return;
      }

      if (nextState === "background" || nextState === "inactive") {
        if (raceIdRef.current && userStepsRef.current > 0) {
          void raceStepSyncService.flush(
            raceIdRef.current,
            userStepsRef.current,
            stepProviderManager.toRaceProgressSource(),
          );
        }
        return;
      }
    });
    return () => sub.remove();
  }, [catchUpLiveRaceSteps, pauseRaceStepTracking]);

  // Backend rank/steps → Android ongoing notification / iOS Live Activity
  useEffect(() => {
    raceProgressNotificationService.setHealthKitWakeHandler(() => {
      void catchUpLiveRaceSteps(userStepsRef.current, true);
    });
    raceStepSyncService.setProgressSyncedHandler((result) => {
      if (!result.ok || result.rank === undefined) return;
      handleBackendProgressSynced({
        ok: result.ok,
        raceId: result.raceId,
        acceptedSteps: result.acceptedSteps,
        rank: result.rank,
        totalParticipants: result.totalParticipants ?? participantsRef.current.length,
        goalSteps: result.goalSteps ?? raceTargetStepsRef.current,
        timeLeftSeconds: result.timeLeftSeconds ?? 0,
        username: result.username ?? userProfileRef.current.username,
        userId: result.userId ?? userProfileRef.current.userId,
        raceStatus: result.raceStatus ?? "in_progress",
      });
    });
    return () => {
      raceProgressNotificationService.setHealthKitWakeHandler(null);
      raceStepSyncService.setProgressSyncedHandler(null);
    };
  }, [catchUpLiveRaceSteps]);

  // App close / swipe from recents must NOT stop the native foreground service.
  // Native FGS keeps the notification alive; only explicit race end/cancel/logout stops it.
  useEffect(() => () => {
    clearRaceJsTimers();
  }, []);

  return (
    <RaceContext.Provider
      value={{
        racePhase, raceEntryFee, raceMaxPlayers,
        playersJoined, participants, countdown,
        raceTimerSeconds, userRaceSteps, walkRaceStepsDisplay, results, userFinishRank,
        totalPool: prizeState.totalPool,
        winnersPool: prizeState.winnersPool,
        platformFee: prizeState.platformFee,
        prizeTiers: prizeState.prizes,
        isSuspicious,
        raceId, isHost, raceStartTimeUTC,
        raceTargetSteps, setRaceTargetSteps,
        joinRace, startRaceManually, notifyRaceStarted, resumeLiveRace, cancelRace, resetRace, setActiveRace,
        stopRaceStepTracking, pauseRaceStepTracking, resumeRaceStepTracking, catchUpLiveRaceSteps,
        recordFinishedRaceStepsForWalk,
      }}
    >
      {children}
    </RaceContext.Provider>
  );
}

export function useRace(): RaceContextType {
  const ctx = useContext(RaceContext);
  if (!ctx) throw new Error("useRace must be used within RaceProvider");
  return ctx;
}
