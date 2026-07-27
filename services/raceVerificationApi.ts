/**
 * Race verification + result-status API (funded-race hybrid pipeline).
 *
 * POST /api/races/:id/verify — Health Connect / HealthKit race-window totals
 * GET  /api/races/:id/result-status — authoritative settlement UI source
 *
 * Feature-detect: HTTP 404 → pipeline off for this environment; soft-skip
 * (never hard-fail). Existing reconcile-steps / live progress remain unchanged.
 */

import { authFetch, API_TIMEOUT_MS, STEP_SYNC_TIMEOUT } from "@/utils/authFetch";
import { logger } from "@/utils/logger";
import {
  resultStatusDisplayLabel,
  verificationStatusToReconciliation,
  type RaceVerificationStatusApi,
} from "@/services/raceVerificationStatusMap";

export type { RaceVerificationStatusApi };
export { resultStatusDisplayLabel, verificationStatusToReconciliation };

export type RaceVerifySource = "healthkit" | "health_connect";

export type RaceVerifyPayload = {
  verifiedCumulativeSteps: number;
  source: RaceVerifySource;
  measuredAtUtc: string;
  intervalStartUtc?: string;
  intervalEndUtc?: string;
  clientLiveCumulativeSteps?: number;
  verificationSessionId?: string;
};

export type RaceVerifyResult =
  | { ok: true; accepted: true; featureEnabled: true; raw?: Record<string, unknown> }
  | {
      ok: true;
      accepted: false;
      featureEnabled: true;
      reason?: string;
      raw?: Record<string, unknown>;
    }
  | { ok: false; featureEnabled: false; status: 404 }
  | { ok: false; featureEnabled: true; status: number; reason?: string };

export type RaceSettlementStatusApi =
  | "awaiting_verification"
  | "partially_verified"
  | "review_required"
  | "paid"
  | string;

export type RaceResultStatus = {
  raceStatus: string;
  settlementStatus: RaceSettlementStatusApi;
  verificationStatus: RaceVerificationStatusApi;
  /** Provisional live — never label as final. */
  liveSteps: number | null;
  /** Null unless finalized. */
  steps: number | null;
  rank: number | null;
  payoutCents: number | null;
  featureEnabled: boolean;
};

/** Process-lifetime: once 404, skip further verify/result-status calls. */
let _verifyFeatureEnabled: boolean | null = null;

export function isRaceVerifyFeatureEnabled(): boolean | null {
  return _verifyFeatureEnabled;
}

export function resetRaceVerifyFeatureCacheForTests(): void {
  _verifyFeatureEnabled = null;
}

function markFeatureOff(): void {
  _verifyFeatureEnabled = false;
  logger.debug("RaceVerify", "feature off (404) — skipping further verify/result-status");
}

function markFeatureOn(): void {
  if (_verifyFeatureEnabled !== false) _verifyFeatureEnabled = true;
}

/**
 * POST /api/races/:id/verify
 * Soft-skips when feature is known-off or returns 404.
 */
export async function postRaceVerify(
  raceId: string,
  payload: RaceVerifyPayload,
): Promise<RaceVerifyResult> {
  if (_verifyFeatureEnabled === false) {
    return { ok: false, featureEnabled: false, status: 404 };
  }

  try {
    const body: Record<string, unknown> = {
      verifiedCumulativeSteps: Math.max(
        0,
        Math.floor(payload.verifiedCumulativeSteps),
      ),
      source: payload.source,
      measuredAtUtc: payload.measuredAtUtc,
    };
    if (payload.intervalStartUtc) body.intervalStartUtc = payload.intervalStartUtc;
    if (payload.intervalEndUtc) body.intervalEndUtc = payload.intervalEndUtc;
    if (payload.clientLiveCumulativeSteps != null) {
      body.clientLiveCumulativeSteps = Math.max(
        0,
        Math.floor(payload.clientLiveCumulativeSteps),
      );
    }
    if (payload.verificationSessionId) {
      body.verificationSessionId = String(payload.verificationSessionId).slice(
        0,
        64,
      );
    }

    const res = await authFetch(`/api/races/${raceId}/verify`, {
      method: "POST",
      timeoutMs: STEP_SYNC_TIMEOUT,
      retryOnUnauthorized: false,
      body: JSON.stringify(body),
    });

    if (res.status === 404) {
      markFeatureOff();
      return { ok: false, featureEnabled: false, status: 404 };
    }

    markFeatureOn();
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (res.status === 409) {
      return {
        ok: false,
        featureEnabled: true,
        status: 409,
        reason:
          typeof json.reason === "string"
            ? json.reason
            : typeof json.message === "string"
              ? json.message
              : "window_closed",
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        featureEnabled: true,
        status: res.status,
        reason:
          typeof json.reason === "string"
            ? json.reason
            : typeof json.error === "string"
              ? json.error
              : undefined,
      };
    }

    const accepted = json.accepted !== false;
    if (!accepted) {
      return {
        ok: true,
        accepted: false,
        featureEnabled: true,
        reason:
          typeof json.reason === "string" ? json.reason : "stale_verification",
        raw: json,
      };
    }

    return { ok: true, accepted: true, featureEnabled: true, raw: json };
  } catch (err) {
    logger.debug("RaceVerify", `post failed: ${String(err)}`);
    return {
      ok: false,
      featureEnabled: _verifyFeatureEnabled !== false,
      status: 0,
      reason: "network_error",
    };
  }
}

function parseVerificationStatus(raw: unknown): RaceVerificationStatusApi {
  const s = typeof raw === "string" ? raw : "verification_pending";
  switch (s) {
    case "live":
    case "verification_pending":
    case "verification_delayed":
    case "review_required":
    case "verification_rejected":
    case "finalized":
      return s;
    default:
      return "verification_pending";
  }
}

/**
 * GET /api/races/:id/result-status
 * Authoritative for rank / verified steps / payout once finalized.
 */
export async function getRaceResultStatus(
  raceId: string,
): Promise<RaceResultStatus | null> {
  if (_verifyFeatureEnabled === false) {
    return {
      raceStatus: "unknown",
      settlementStatus: "awaiting_verification",
      verificationStatus: "live",
      liveSteps: null,
      steps: null,
      rank: null,
      payoutCents: null,
      featureEnabled: false,
    };
  }

  try {
    const res = await authFetch(`/api/races/${raceId}/result-status`, {
      method: "GET",
      timeoutMs: API_TIMEOUT_MS,
      retryOnUnauthorized: false,
    });

    if (res.status === 404) {
      markFeatureOff();
      return {
        raceStatus: "unknown",
        settlementStatus: "awaiting_verification",
        verificationStatus: "live",
        liveSteps: null,
        steps: null,
        rank: null,
        payoutCents: null,
        featureEnabled: false,
      };
    }

    if (!res.ok) return null;
    markFeatureOn();

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const verificationStatus = parseVerificationStatus(json.verificationStatus);
    const finalized = verificationStatus === "finalized";

    return {
      raceStatus:
        typeof json.raceStatus === "string" ? json.raceStatus : "unknown",
      settlementStatus:
        typeof json.settlementStatus === "string"
          ? json.settlementStatus
          : "awaiting_verification",
      verificationStatus,
      liveSteps:
        typeof json.liveSteps === "number" ? Math.floor(json.liveSteps) : null,
      steps:
        finalized && typeof json.steps === "number"
          ? Math.floor(json.steps)
          : null,
      rank:
        finalized && typeof json.rank === "number"
          ? Math.floor(json.rank)
          : null,
      payoutCents:
        finalized && typeof json.payoutCents === "number"
          ? Math.floor(json.payoutCents)
          : null,
      featureEnabled: true,
    };
  } catch (err) {
    logger.debug("RaceVerify", `result-status failed: ${String(err)}`);
    return null;
  }
}
