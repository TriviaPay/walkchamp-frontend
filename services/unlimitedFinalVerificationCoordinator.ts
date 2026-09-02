/**
 * Global authenticated lifecycle for Streak final-verification.
 * Screens observe; this coordinator is the primary submitter.
 */

import { AppState, type AppStateStatus } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { isUnlimitedGoalFrontendEnabled } from "@/config/featureFlags";
import { fetchMyOpenUnlimitedChallenges } from "@/features/unlimited/api/unlimitedChallengesListApi";
import { fetchUnlimitedDailyHistory } from "@/features/unlimited/api/unlimitedResultsApi";
import {
  isUnlimitedFinalVerificationRequested,
  nextUnlimitedFinalVerificationRetryMs,
  normalizeUnlimitedFinalVerificationStatus,
} from "@/features/unlimited/mappers/unlimitedFinalVerification";
import { canPublishFinalResult } from "@/features/unlimited/mappers/unlimitedResults";
import { submitRequestedUnlimitedFinalVerification } from "@/services/unlimitedFinalVerification";
import {
  CHANNELS,
  onPusherReconnected,
  subscribeToChannel,
  unsubscribeFromChannel,
} from "@/services/realtimeService";
import { addCrashBreadcrumb, captureMessage } from "@/services/monitoring/sentry";
import { logger } from "@/utils/logger";

const POLL_MS = 20_000;
const STUCK_MS = 15 * 60_000;

type TrackedChallenge = {
  id: string;
  resultsStatus: string | null;
  finalStatus: string | null;
  unsub: (() => void) | null;
  inFlight: boolean;
  attempt: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  requestedSince: number | null;
  submittedSince: number | null;
  stuckEmitted: boolean;
};

let _userId: string | null = null;
let _started = false;
let _pollTimer: ReturnType<typeof setInterval> | null = null;
let _tracked = new Map<string, TrackedChallenge>();
let _appSub: { remove: () => void } | null = null;
let _netUnsub: (() => void) | null = null;
let _pusherUnsub: (() => void) | null = null;
let _syncing = false;

function telemetryStuck(kind: "requested" | "submitted", challengeId: string): void {
  addCrashBreadcrumb(`stuck_${kind}`, "unlimited_final_verification", { challengeId });
  captureMessage(`unlimited_final_verification:stuck_${kind}`, "warning");
  logger.warn("UnlimitedFinalVerify", `stuck_${kind}`, { challengeId });
}

function clearRetry(entry: TrackedChallenge): void {
  if (entry.retryTimer) {
    clearTimeout(entry.retryTimer);
    entry.retryTimer = null;
  }
}

function untrack(id: string): void {
  const entry = _tracked.get(id);
  if (!entry) return;
  clearRetry(entry);
  entry.unsub?.();
  _tracked.delete(id);
}

function subscribeChallenge(id: string, entry: TrackedChallenge): void {
  entry.unsub?.();
  const names = [CHANNELS.unlimitedChallenge(id), CHANNELS.liveRace(id)];
  const channels = names.map((name) => subscribeToChannel(name));
  const onEvent = () => {
    void syncUnlimitedFinalVerification(id);
  };
  for (const ch of channels) {
    ch?.bind("final_verification_requested", onEvent);
    ch?.bind("final_verification_updated", onEvent);
    ch?.bind("results_status_changed", onEvent);
    ch?.bind("results_ready", onEvent);
    ch?.bind("challenge_completed", onEvent);
    ch?.bind("race:final-verification-requested", onEvent);
    ch?.bind("race:final-verification-updated", onEvent);
    ch?.bind("race:results_ready", onEvent);
    ch?.bind("race:completed", onEvent);
  }
  entry.unsub = () => {
    for (let i = 0; i < channels.length; i++) {
      const ch = channels[i];
      const name = names[i]!;
      ch?.unbind("final_verification_requested", onEvent);
      ch?.unbind("final_verification_updated", onEvent);
      ch?.unbind("results_status_changed", onEvent);
      ch?.unbind("results_ready", onEvent);
      ch?.unbind("challenge_completed", onEvent);
      ch?.unbind("race:final-verification-requested", onEvent);
      ch?.unbind("race:final-verification-updated", onEvent);
      ch?.unbind("race:results_ready", onEvent);
      ch?.unbind("race:completed", onEvent);
      unsubscribeFromChannel(name);
    }
  };
}

function scheduleRetry(entry: TrackedChallenge): void {
  clearRetry(entry);
  const delay = nextUnlimitedFinalVerificationRetryMs(entry.attempt);
  entry.attempt += 1;
  entry.retryTimer = setTimeout(() => {
    void syncUnlimitedFinalVerification(entry.id);
  }, delay);
}

async function syncOne(id: string): Promise<void> {
  const entry = _tracked.get(id);
  if (!entry || entry.inFlight) return;
  entry.inFlight = true;
  try {
    const history = await fetchUnlimitedDailyHistory(id);
    const resultsStatus = history?.resultsStatus ?? entry.resultsStatus;
    const finalStatus =
      normalizeUnlimitedFinalVerificationStatus(history?.finalVerificationStatus) ??
      entry.finalStatus;
    entry.resultsStatus = resultsStatus ?? null;
    entry.finalStatus = finalStatus;

    if (canPublishFinalResult(resultsStatus)) {
      clearRetry(entry);
      return;
    }

    const now = Date.now();
    if (finalStatus === "requested") {
      entry.requestedSince = entry.requestedSince ?? now;
      if (!entry.stuckEmitted && now - entry.requestedSince > STUCK_MS) {
        entry.stuckEmitted = true;
        telemetryStuck("requested", id);
      }
    } else if (finalStatus === "submitted") {
      entry.submittedSince = entry.submittedSince ?? now;
      if (!entry.stuckEmitted && now - entry.submittedSince > STUCK_MS) {
        entry.stuckEmitted = true;
        telemetryStuck("submitted", id);
      }
    } else {
      entry.requestedSince = null;
      entry.submittedSince = null;
      entry.stuckEmitted = false;
    }

    if (!isUnlimitedFinalVerificationRequested(history)) return;

    const result = await submitRequestedUnlimitedFinalVerification(id, { history });
    if (result.ok) {
      clearRetry(entry);
      entry.attempt = 0;
      return;
    }
    if (result.skipped) {
      if (result.reason === "permission" || result.reason === "read_error") {
        scheduleRetry(entry);
      }
      return;
    }
    if (result.retry === "stop") return;
    if (result.retry === "refetch" || result.retry === "retry" || result.retry === "wait") {
      scheduleRetry(entry);
    }
  } catch (err) {
    logger.debug("UnlimitedFinalVerify", `sync failed ${id}: ${String(err)}`);
    scheduleRetry(entry);
  } finally {
    entry.inFlight = false;
  }
}

export async function syncUnlimitedFinalVerification(challengeId?: string): Promise<void> {
  if (!isUnlimitedGoalFrontendEnabled() || !_userId) return;
  if (challengeId) {
    if (!_tracked.has(challengeId)) {
      const entry: TrackedChallenge = {
        id: challengeId,
        resultsStatus: null,
        finalStatus: null,
        unsub: null,
        inFlight: false,
        attempt: 0,
        retryTimer: null,
        requestedSince: null,
        submittedSince: null,
        stuckEmitted: false,
      };
      _tracked.set(challengeId, entry);
      subscribeChallenge(challengeId, entry);
    }
    await syncOne(challengeId);
    return;
  }

  if (_syncing) return;
  _syncing = true;
  try {
    const rooms = await fetchMyOpenUnlimitedChallenges({ viewerUserId: _userId });
    const ids = new Set(rooms.map((r) => r.room_id).filter(Boolean));
    for (const id of [..._tracked.keys()]) {
      if (!ids.has(id)) untrack(id);
    }
    for (const id of ids) {
      if (!_tracked.has(id)) {
        const entry: TrackedChallenge = {
          id,
          resultsStatus: null,
          finalStatus: null,
          unsub: null,
          inFlight: false,
          attempt: 0,
          retryTimer: null,
          requestedSince: null,
          submittedSince: null,
          stuckEmitted: false,
        };
        _tracked.set(id, entry);
        subscribeChallenge(id, entry);
      }
      await syncOne(id);
    }
  } finally {
    _syncing = false;
  }
}

function startPolling(): void {
  if (_pollTimer) return;
  _pollTimer = setInterval(() => {
    const pending = [..._tracked.values()].some(
      (e) => !canPublishFinalResult(e.resultsStatus),
    );
    if (pending) void syncUnlimitedFinalVerification();
  }, POLL_MS);
}

export function startUnlimitedFinalVerificationCoordinator(userId: string): void {
  if (!isUnlimitedGoalFrontendEnabled()) return;
  _userId = userId;
  if (_started) {
    void syncUnlimitedFinalVerification();
    return;
  }
  _started = true;
  startPolling();
  _appSub = AppState.addEventListener("change", (next: AppStateStatus) => {
    if (next === "active") void syncUnlimitedFinalVerification();
  });
  _netUnsub = NetInfo.addEventListener((state) => {
    if (state.isConnected && AppState.currentState === "active") {
      void syncUnlimitedFinalVerification();
    }
  });
  _pusherUnsub = onPusherReconnected(() => {
    void syncUnlimitedFinalVerification();
  });
  void syncUnlimitedFinalVerification();
}

export function stopUnlimitedFinalVerificationCoordinator(): void {
  _started = false;
  _userId = null;
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
  _appSub?.remove();
  _appSub = null;
  _netUnsub?.();
  _netUnsub = null;
  _pusherUnsub?.();
  _pusherUnsub = null;
  for (const id of [..._tracked.keys()]) untrack(id);
}

export function notifyUnlimitedFinalVerificationPush(challengeId?: string | null): void {
  if (challengeId) void syncUnlimitedFinalVerification(challengeId);
  else void syncUnlimitedFinalVerification();
}
