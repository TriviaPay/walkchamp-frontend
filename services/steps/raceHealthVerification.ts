/**
 * Periodic Health Connect / HealthKit verification during live races.
 * Does not drive the live race UI — sensor progress stays provisional until
 * existing reconciliation / winner logic runs.
 */

import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import { logger } from "@/utils/logger";

export type RaceVerificationStatus =
  | "matched"
  | "within_tolerance"
  | "verification_delayed"
  | "mismatch"
  | "provider_unavailable"
  | "permission_missing"
  | "temporary_error";

export type RaceVerificationResult = {
  liveRaceSteps: number;
  verifiedRaceSteps: number;
  difference: number;
  differencePercent: number;
  status: RaceVerificationStatus;
  verifiedAtUtc: string;
};

const TOLERANCE_STEPS = 75;
const TOLERANCE_PERCENT = 0.08;
const DELAY_FLOOR_STEPS = 40;

let _timer: ReturnType<typeof setInterval> | null = null;
let _raceId: string | null = null;
let _lastResult: RaceVerificationResult | null = null;
let _inFlight = false;

export function getLastRaceVerification(): RaceVerificationResult | null {
  return _lastResult;
}

export async function verifyRaceProgress(args: {
  raceId: string;
  startAtUtc: string;
  endAtUtc?: string;
  liveRaceSteps: number;
}): Promise<RaceVerificationResult> {
  const verifiedAtUtc = new Date().toISOString();
  try {
    const start = new Date(args.startAtUtc);
    const end = args.endAtUtc ? new Date(args.endAtUtc) : new Date();
    if (!Number.isFinite(start.getTime()) || end.getTime() <= start.getTime()) {
      return {
        liveRaceSteps: args.liveRaceSteps,
        verifiedRaceSteps: 0,
        difference: args.liveRaceSteps,
        differencePercent: 1,
        status: "temporary_error",
        verifiedAtUtc,
      };
    }

    // Always read from the daily verified provider (HC / HK), never the live sensor.
    const snap = await stepProviderManager.getStepsForRange(start, end);
    if (!snap) {
      const result: RaceVerificationResult = {
        liveRaceSteps: args.liveRaceSteps,
        verifiedRaceSteps: 0,
        difference: args.liveRaceSteps,
        differencePercent: args.liveRaceSteps > 0 ? 1 : 0,
        status: "provider_unavailable",
        verifiedAtUtc,
      };
      _lastResult = result;
      return result;
    }

    const verified = Math.max(0, Math.floor(snap.steps));
    const live = Math.max(0, Math.floor(args.liveRaceSteps));
    const difference = live - verified;
    const differencePercent =
      live <= 0 && verified <= 0
        ? 0
        : Math.abs(difference) / Math.max(live, verified, 1);

    let status: RaceVerificationStatus;
    if (difference === 0) {
      status = "matched";
    } else if (
      Math.abs(difference) <= TOLERANCE_STEPS ||
      differencePercent <= TOLERANCE_PERCENT
    ) {
      status = "within_tolerance";
    } else if (verified + DELAY_FLOOR_STEPS < live) {
      // Health stores often lag 2–5 minutes — never treat as automatic DQ.
      status = "verification_delayed";
    } else {
      status = "mismatch";
    }

    const result: RaceVerificationResult = {
      liveRaceSteps: live,
      verifiedRaceSteps: verified,
      difference,
      differencePercent,
      status,
      verifiedAtUtc,
    };
    _lastResult = result;
    if (__DEV__) {
      logger.debug(
        "LiveRaceVerify",
        `raceId=${args.raceId} live=${live} verified=${verified} status=${status}`,
      );
    }
    return result;
  } catch {
    const result: RaceVerificationResult = {
      liveRaceSteps: args.liveRaceSteps,
      verifiedRaceSteps: 0,
      difference: args.liveRaceSteps,
      differencePercent: 1,
      status: "temporary_error",
      verifiedAtUtc,
    };
    _lastResult = result;
    return result;
  }
}

export function startRaceHealthVerification(args: {
  raceId: string;
  startAtUtc: string;
  endAtUtc?: string | null;
  getLiveRaceSteps: () => number;
  onResult?: (result: RaceVerificationResult) => void;
}): void {
  stopRaceHealthVerification();
  _raceId = args.raceId;

  const tick = () => {
    if (_inFlight || _raceId !== args.raceId) return;
    _inFlight = true;
    void verifyRaceProgress({
      raceId: args.raceId,
      startAtUtc: args.startAtUtc,
      endAtUtc: args.endAtUtc ?? undefined,
      liveRaceSteps: args.getLiveRaceSteps(),
    })
      .then((result) => args.onResult?.(result))
      .finally(() => {
        _inFlight = false;
      });
  };

  tick();
  _timer = setInterval(tick, STEP_SYNC_CONFIG.RACE_HEALTH_VERIFICATION_MS);
}

export function stopRaceHealthVerification(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _raceId = null;
  _inFlight = false;
}
