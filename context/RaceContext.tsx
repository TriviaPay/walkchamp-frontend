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
import {
  postRaceProgress,
  postRaceReconcile,
} from "@/services/raceProgressApi";
import { FEATURE_FLAGS } from "@/config/featureFlags";
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
  cancelRace: () => void;
  resetRace: () => void;
  setActiveRace: (id: string | null, host: boolean) => void;
  /** Stop HC/pedometer polling and simulation ticks (e.g. when race completes on live-detail). */
  stopRaceStepTracking: (reason?: string) => void;
  /** Pause step reads when leaving live-detail — flushes backend, no fake steps. */
  pauseRaceStepTracking: () => void;
  /** Re-start race step polling after returning to live-detail (active race only). */
  resumeRaceStepTracking: () => void;
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
  const [results, setResults] = useState<RaceResult[]>([]);
  const [userFinishRank, setUserFinishRank] = useState<number | null>(null);
  const [isSuspicious, setIsSuspicious] = useState(false);
  const [prizeState, setPrizeState] = useState(() => calculatePrizes(1, 10));
  const [raceId, setRaceId] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [raceStartTimeUTC, setRaceStartTimeUTC] = useState<Date | null>(null);
  const [raceTargetSteps, _setRaceTargetSteps] = useState(RACE_DEFAULTS.RACE_TARGET);

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
  }, [user?.username, user?.countryFlag, user?.avatarColor, user?.id]);

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

  const clearAllIntervals = () => {
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
    // Unsubscribe from forfeit Pusher channel
    if (forfeitChannelRef.current) {
      unsubscribeFromChannel(forfeitChannelRef.current);
      forfeitChannelRef.current = null;
    }
    // Invalidate all step-tracking callbacks created by the current startRace() closure.
    // Any CMPedometer or HC callback that fires after this point will see a different
    // generation number and discard its payload, preventing step carry-over to a new race.
    subscriptionGenRef.current++;
    // Stop iOS live step subscription (Android HC is polling-based, no subscription to stop)
    stepTracker.stopLiveTracking();
    stepProviderManager.stopWatchingSteps();
    // Stop the centralized polling safety-net
    stepPollingService.stopPolling("race_ended");
    raceStepSyncService.cancelPending();
    racePollingConfigRef.current = null;
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
  }, []);

  const pauseRaceStepTracking = useCallback(() => {
    if (raceEndedRef.current) return;
    stepPollingService.stopPolling("race_paused");
    stepProviderManager.stopWatchingSteps();
    if (raceIdRef.current && userStepsRef.current > 0) {
      void raceStepSyncService.flush(
        raceIdRef.current,
        userStepsRef.current,
        stepProviderManager.toRaceProgressSource(),
      );
    }
  }, []);

  const resumeRaceStepTracking = useCallback(() => {
    if (raceEndedRef.current || racePhase !== "in_race") return;
    const cfg = racePollingConfigRef.current;
    if (!cfg || !usingRealStepsRef.current) return;

    const providerId = stepProviderManager.getActiveProviderId();
    if (
      (providerId === "ios_healthkit" || providerId === "android_legacy_sensor") &&
      raceStepApplyRef.current
    ) {
      const apply = raceStepApplyRef.current;
      void stepProviderManager.startWatchingSteps((result) => {
        void stepProviderManager
          .getRaceSteps(cfg.raceId, cfg.raceStartTime, cfg.userId)
          .then((raceResult) => {
            if (raceResult) apply(raceResult.steps);
          });
      });
    }

    stepPollingService.startPolling("race", cfg);
  }, [racePhase]);

  const setActiveRace = useCallback((id: string | null, host: boolean) => {
    raceIdRef.current = id;
    setRaceId(id);
    setIsHost(host);
  }, []);

  // ── Race recovery on mount ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!FEATURE_FLAGS.SERVER_TIME_RACE_VALIDATION_ENABLED) return;

    const recover = async () => {
      const pending = await storageGet<PendingRace>(STORAGE_KEYS.PENDING_RACE);
      if (!pending) return;

      const { raceId: pendingRaceId, raceStartTimeUTC: startStr, status } = pending;
      const raceStart = new Date(startStr);

      // Fetch current race status from backend
      const raceData = await fetchRaceStatus(pendingRaceId);
      if (!raceData) {
        // Race not found — clear pending state
        await clearPendingRace();
        return;
      }

      if (raceData.status === "in_progress") {
        if (Platform.OS === "ios") {
          // iOS: recover exact historical steps from HealthKit for the race window.
          const data = await stepTracker.getStepsForTimeRange(raceStart, new Date());
          if (__DEV__) console.log(`[RaceSteps] iOS recovery: device latest steps=${data?.steps ?? 0} raceStartedAt=${raceStart}`);
          if (data && data.steps > 0) {
            await postRaceProgress(pendingRaceId, data.steps, undefined, undefined, "healthkit");
          }
        } else {
          const uid = userProfileRef.current.userId;
          const raceData2 = await stepProviderManager.getRaceSteps(
            pendingRaceId,
            raceStart,
            uid,
          );
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
        // Leave pending race in storage so we can reconcile when it completes
      } else if (raceData.status === "completed") {
        const raceEnd = raceData.completedAt ? new Date(raceData.completedAt) : new Date();

        if (Platform.OS === "ios") {
          // iOS: recover exact steps from HealthKit for the race window
          const data = await stepTracker.getStepsForTimeRange(raceStart, raceEnd);
          if (data && data.steps > 0) {
            await postRaceReconcile(pendingRaceId, data.steps, data.source);
          }
        }
        // Android or unavailable: steps could not be verified — just clear
        await clearPendingRace();
      } else if (raceData.status === "cancelled" || raceData.status === "open") {
        await clearPendingRace();
      }
    };

    recover();
  }, []);

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

  const startRace = useCallback((allParticipants: RaceParticipant[]) => {
    finishedCountRef.current = 0;
    userStepsRef.current = 0;
    raceEndedRef.current = false;
    botStepsRef.current = {};
    BOT_PLAYERS.forEach((b) => { botStepsRef.current[b.id] = 0; });
    participantsRef.current = allParticipants;
    usingRealStepsRef.current = false;
    raceStepSyncService.reset();

    // Capture the generation at race-start time.  All step callbacks created in THIS
    // startRace() call will check this value before touching raceSteps state.
    // clearAllIntervals() (called on forfeit/end) increments subscriptionGenRef so any
    // late-firing callback from the previous race is silently discarded.
    const myGen = subscriptionGenRef.current;

    setRacePhase("in_race");
    setRaceTimerSeconds(0);
    setUserRaceSteps(0);

    raceTimerRef.current = setInterval(() => {
      setRaceTimerSeconds((s) => s + 1);
    }, 1000);

    // ── Real step tracking for race (iOS: periodic query, Android: watchStepCount) ──
    const raceStart = raceStartTimeRef.current;
    const useRealSteps = FEATURE_FLAGS.REAL_STEP_TRACKING_ENABLED && !!raceStart;

    if (useRealSteps) {
      if (__DEV__) {
        if (__DEV__) console.log(`[RaceStepsRealtime] platform: ${Platform.OS}`);
        if (__DEV__) console.log(`[RaceStepsRealtime] sensor type: ${Platform.OS === "ios" ? "ios_pedometer (watchStepCount)" : "android_step_counter"}`);
        if (__DEV__) console.log(`[RaceStepsRealtime] race started: ${raceStart?.toISOString() ?? "unknown"}`);
      }

      // ── Helper: apply anti-regression + update UI ─────────────────────────
      // raceSteps = steps walked since THIS race started (isolated per race).
      // dailySteps / lifetimeSteps are tracked separately in WalkContext — never mixed here.
      const applyRealSteps = (rawSteps: number) => {
        // Guard: if this callback belongs to a previous race (myGen is stale), discard it.
        // This is the primary defence against step carry-over when a user forfeits race A
        // and immediately joins race B — the old CMPedometer callback fires one last time
        // with race A's cumulative steps, and this check prevents them from crediting race B.
        if (subscriptionGenRef.current !== myGen) return;
        if (raceEndedRef.current) return;
        const antiReg = Math.max(userStepsRef.current, rawSteps);
        if (__DEV__) {
          if (rawSteps < userStepsRef.current)
            if (__DEV__) console.log(`[RaceStepsRealtime] ignored lower value: ${rawSteps} (keeping ${userStepsRef.current})`);
          else
            if (__DEV__) console.log(`[RaceStepsRealtime] calculated race_steps: ${rawSteps} previous: ${userStepsRef.current}`);
        }
        userStepsRef.current = antiReg;
        setUserRaceSteps(antiReg);
        if (__DEV__) console.log(`[RaceStepsRealtime] local UI updated: ${antiReg}`);

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

        // Batch backend sync — local UI already updated above.
        if (raceIdRef.current) {
          raceStepSyncService.notifyStepsUpdated(
            raceIdRef.current,
            antiReg,
            stepProviderManager.toRaceProgressSource(),
            { atTarget: antiReg >= target },
          );
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
          onUpdate: (raceSteps) => applyRealSteps(raceSteps),
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
                ? await stepProviderManager.createRaceBaseline(
                    raceIdRef.current,
                    userId,
                  )
                : 0;
              await restartRacePolling(userId, newBaseline);
            })();
          },
        };
        racePollingConfigRef.current = config;
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
            ? await stepProviderManager.createRaceBaseline(
                raceIdRef.current,
                userId,
              )
            : 0;

        if (providerId === "ios_healthkit") {
          await stepProviderManager.startWatchingSteps((result) => {
            applyRealSteps(result.steps);
          });
        }

        if (raceIdRef.current && baseline > 0 && providerId === "android_health_connect") {
          raceStepSyncService.notifyStepsUpdated(
            raceIdRef.current,
            0,
            stepProviderManager.toRaceProgressSource(),
            { force: true, deviceTotalSteps: baseline },
          );
        }

        await restartRacePolling(userId, baseline);
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
        0,
        "race_start",
        { force: true },
      );
    }

    // ── Bot simulation tick (bots only — no fake user steps) ─────────────────
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
    raceStepSyncService.reset();

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

  // ── Join race ─────────────────────────────────────────────────────────────────

  const joinRace = useCallback((entryFee: number, maxPlayers: number, hostMode = false): boolean => {
    const computed = calculatePrizes(entryFee, maxPlayers);
    setPrizeState(computed);
    prizesRef.current = computed.prizes;
    setRaceEntryFee(entryFee);
    setRaceMaxPlayers(maxPlayers);
    setRacePhase("matchmaking");
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
    setRacePhase("idle");
    setPlayersJoined(0);
    setParticipants([]);
    setCountdown(RACE_DEFAULTS.COUNTDOWN_SECONDS);
    pendingBotsRef.current = [];
    playersJoinedRef.current = 0;
    raceStartTimeRef.current = null;
    setRaceStartTimeUTC(null);
  }, []);

  const resetRace = useCallback(() => {
    clearAllIntervals();
    raceEndedRef.current = false;
    stepTickRef.current = 0;
    raceIdRef.current = null;
    raceStartTimeRef.current = null;
    usingRealStepsRef.current = false;
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
    if (raceIdRef.current) {
      void stepProviderManager.clearRaceBaseline(
        raceIdRef.current,
        userProfileRef.current.userId,
      );
    }
    stepProviderManager.stopWatchingSteps();
  }, []);

  // ── AppState listener: sync steps immediately when app comes to foreground ────
  // Covers the case where the OS throttled/suspended the step-sync interval while
  // the app was in the background. On resume, push the current step count so the
  // backend is up-to-date before any UI refresh fetches participant data.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && raceIdRef.current && !raceEndedRef.current) {
        const steps = userStepsRef.current;
        if (steps > 0) {
          void raceStepSyncService.flush(
            raceIdRef.current,
            steps,
            stepProviderManager.toRaceProgressSource(),
          );
        }
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => () => {
    clearAllIntervals();
  }, []);

  return (
    <RaceContext.Provider
      value={{
        racePhase, raceEntryFee, raceMaxPlayers,
        playersJoined, participants, countdown,
        raceTimerSeconds, userRaceSteps, results, userFinishRank,
        totalPool: prizeState.totalPool,
        winnersPool: prizeState.winnersPool,
        platformFee: prizeState.platformFee,
        prizeTiers: prizeState.prizes,
        isSuspicious,
        raceId, isHost, raceStartTimeUTC,
        raceTargetSteps, setRaceTargetSteps,
        joinRace, startRaceManually, notifyRaceStarted, cancelRace, resetRace, setActiveRace,
        stopRaceStepTracking, pauseRaceStepTracking, resumeRaceStepTracking,
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
