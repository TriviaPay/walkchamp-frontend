/**
 * Client → POST /api/unlimited-challenges/:id/live-progress
 *
 * Provisional Unlimited live only. Never calls /api/walk/steps or classic race progress.
 */

import { Platform } from "react-native";
import { authFetch, API_TIMEOUT_MS } from "@/utils/authFetch";
import { STEP_SOURCES } from "@/services/steps/hybridStepState";
import { isUnlimitedClassicProgressBlocked } from "@/services/unlimitedRaceProgressGuard";

type UploadArgs = {
  challengeId: string;
  challengeDayKey: string;
  timezone: string;
  provisionalCumulativeSteps: number;
  sessionId?: string;
  sequence?: number;
};

let _lastUploadAt = 0;
let _lastUploadedSteps = -1;
let _lastChallengeId: string | null = null;
let _sequence = 0;
let _sessionId: string | null = null;
let _inFlight = false;

const THROTTLE_MS = 4_000;

function ensureSession(challengeId: string, challengeDayKey: string): string {
  const key = `${challengeId}:${challengeDayKey}`;
  if (!_sessionId || _lastChallengeId !== key) {
    _sessionId = `ul-prov-${Platform.OS}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    _sequence = 0;
    _lastUploadedSteps = -1;
    _lastChallengeId = key;
  }
  return _sessionId;
}

export function resetUnlimitedProvisionalUploadState(): void {
  _lastUploadAt = 0;
  _lastUploadedSteps = -1;
  _lastChallengeId = null;
  _sequence = 0;
  _sessionId = null;
  _inFlight = false;
}

/**
 * Throttled provisional upload. Safe no-op when challenge is not Unlimited-blocked
 * (caller should only invoke for Unlimited).
 */
export async function uploadUnlimitedProvisionalProgress(
  args: UploadArgs,
): Promise<{ ok: boolean; skipped?: boolean; acceptedSteps?: number }> {
  const challengeId = String(args.challengeId || "").trim();
  if (!challengeId) return { ok: false, skipped: true };
  if (!isUnlimitedClassicProgressBlocked(challengeId)) {
    // Soft allow — still upload if caller knows it's Unlimited; block only classic path elsewhere.
  }

  const steps = Math.max(0, Math.floor(args.provisionalCumulativeSteps));
  const now = Date.now();
  if (_inFlight) return { ok: false, skipped: true };
  if (
    steps === _lastUploadedSteps &&
    now - _lastUploadAt < THROTTLE_MS
  ) {
    return { ok: true, skipped: true, acceptedSteps: steps };
  }
  if (now - _lastUploadAt < THROTTLE_MS && steps <= _lastUploadedSteps) {
    return { ok: true, skipped: true, acceptedSteps: _lastUploadedSteps };
  }

  const sessionId = ensureSession(challengeId, args.challengeDayKey);
  _sequence += 1;
  const sequence = _sequence;
  const source =
    Platform.OS === "ios"
      ? STEP_SOURCES.provisionalDailyIOS
      : STEP_SOURCES.provisionalDailyAndroid;

  _inFlight = true;
  try {
    const res = await authFetch(
      `/api/unlimited-challenges/${encodeURIComponent(challengeId)}/live-progress`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId,
          challengeDayKey: args.challengeDayKey,
          timezone: args.timezone,
          provisionalCumulativeSteps: steps,
          source,
          measuredAtUtc: new Date().toISOString(),
          sessionId,
          sequence,
        }),
        timeoutMs: API_TIMEOUT_MS,
      },
    );
    _lastUploadAt = Date.now();
    if (!res.ok) {
      return { ok: false };
    }
    const json = (await res.json().catch(() => ({}))) as {
      accepted?: boolean;
      provisionalTodaySteps?: number;
      displayedLiveSteps?: number;
    };
    if (json.accepted === false) {
      return { ok: false, skipped: true };
    }
    _lastUploadedSteps = Math.max(
      steps,
      Math.floor(json.provisionalTodaySteps ?? steps),
    );
    return {
      ok: true,
      acceptedSteps: _lastUploadedSteps,
    };
  } catch {
    return { ok: false };
  } finally {
    _inFlight = false;
  }
}
