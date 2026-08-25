/**
 * Protected-verification API client.
 *
 * POST /api/races/:raceId/protected-verification/session
 * POST /api/races/:raceId/protected-verification/preflight
 * POST /api/races/:raceId/protected-verification/heartbeat
 * GET  /api/races/:raceId/protected-verification/status
 * POST /api/races/:raceId/protected-verification/final-challenge
 * POST /api/races/:raceId/protected-verification/final-evidence
 *
 * Soft-skip on 404 (feature off). Does not replace /progress.
 */

import { authFetch, API_TIMEOUT_MS, STEP_SYNC_TIMEOUT } from "@/utils/authFetch";
import { logger } from "@/utils/logger";
import type {
  HealthPermissionStatus,
  ProtectedApprovedSource,
  ProtectedIntegrityBinding,
  ProtectedSourceEvidence,
  ProtectedVerificationSession,
} from "./raceVerificationTypes";

let _featureEnabled: boolean | null = null;

export function isProtectedVerificationFeatureEnabled(): boolean | null {
  return _featureEnabled;
}

export function resetPrizeVerificationApiCacheForTests(): void {
  _featureEnabled = null;
}

type ApiErr = {
  ok: false;
  featureEnabled: boolean;
  status: number;
  code?: string;
  error?: string;
};

function parseErr(json: Record<string, unknown>, status: number): ApiErr {
  const code = typeof json.code === "string" ? json.code : undefined;
  const error =
    typeof json.error === "string"
      ? json.error
      : typeof json.message === "string"
        ? json.message
        : undefined;
  return {
    ok: false,
    featureEnabled: status !== 404,
    status,
    code,
    error,
  };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export type CreateProtectedSessionResult =
  | { ok: true; featureEnabled: true; session: ProtectedVerificationSession }
  | ApiErr;

export async function createProtectedVerificationSession(
  raceId: string,
  platform: "android" | "ios",
): Promise<CreateProtectedSessionResult> {
  if (_featureEnabled === false) {
    return { ok: false, featureEnabled: false, status: 404 };
  }
  try {
    const res = await authFetch(
      `/api/races/${raceId}/protected-verification/session`,
      {
        method: "POST",
        timeoutMs: API_TIMEOUT_MS,
        retryOnUnauthorized: false,
        body: JSON.stringify({ platform }),
      },
    );
    const json = await readJson(res);
    if (res.status === 404) {
      _featureEnabled = false;
      return parseErr(json, 404);
    }
    _featureEnabled = true;
    if (!res.ok) return parseErr(json, res.status);

    const session: ProtectedVerificationSession = {
      verificationSessionId: String(json.verificationSessionId ?? ""),
      registeredDeviceId: String(json.registeredDeviceId ?? ""),
      approvedHealthPlatform:
        json.approvedHealthPlatform === "healthkit"
          ? "healthkit"
          : "health_connect",
      approvedSource:
        json.approvedSource === "healthkit" ? "healthkit" : "health_connect",
      integrityProvider:
        json.integrityProvider === "ios_app_attest"
          ? "ios_app_attest"
          : "android_play_integrity",
      challengeId: String(json.challengeId ?? ""),
      serverChallenge: String(json.serverChallenge ?? ""),
      expiresAt: String(json.expiresAt ?? ""),
    };
    if (
      !session.verificationSessionId ||
      !session.serverChallenge ||
      !session.challengeId
    ) {
      return {
        ok: false,
        featureEnabled: true,
        status: 422,
        code: "invalid_session_payload",
        error: "Invalid verification session payload",
      };
    }
    return { ok: true, featureEnabled: true, session };
  } catch (err) {
    logger.debug("PrizeVerify", `session failed: ${String(err)}`);
    return {
      ok: false,
      featureEnabled: true,
      status: 0,
      code: "network_error",
      error: "network_error",
    };
  }
}

export type SubmitPreflightResult =
  | { ok: true; verified: boolean; verificationSessionId: string }
  | ApiErr;

export async function submitProtectedPreflight(
  raceId: string,
  body: {
    verificationSessionId: string;
    challengeId: string;
    serverChallenge: string;
    approvedSource: ProtectedApprovedSource;
    permissionStatus: HealthPermissionStatus;
    integrity: ProtectedIntegrityBinding;
  },
): Promise<SubmitPreflightResult> {
  if (_featureEnabled === false) {
    return { ok: false, featureEnabled: false, status: 404 };
  }
  try {
    const res = await authFetch(
      `/api/races/${raceId}/protected-verification/preflight`,
      {
        method: "POST",
        timeoutMs: STEP_SYNC_TIMEOUT,
        retryOnUnauthorized: false,
        body: JSON.stringify(body),
      },
    );
    const json = await readJson(res);
    if (res.status === 404) {
      _featureEnabled = false;
      return parseErr(json, 404);
    }
    _featureEnabled = true;
    if (!res.ok) return parseErr(json, res.status);
    return {
      ok: true,
      verified: json.verified !== false,
      verificationSessionId: String(json.verificationSessionId ?? body.verificationSessionId),
    };
  } catch (err) {
    logger.debug("PrizeVerify", `preflight failed: ${String(err)}`);
    return {
      ok: false,
      featureEnabled: true,
      status: 0,
      code: "network_error",
      error: "network_error",
    };
  }
}

export async function postProtectedHeartbeat(
  raceId: string,
  body: {
    verificationSessionId: string;
    approvedSource: ProtectedApprovedSource;
    permissionStatus: HealthPermissionStatus;
  },
): Promise<{ accepted: boolean; serverTime?: string } | null> {
  try {
    const res = await authFetch(
      `/api/races/${raceId}/protected-verification/heartbeat`,
      {
        method: "POST",
        timeoutMs: API_TIMEOUT_MS,
        retryOnUnauthorized: false,
        body: JSON.stringify(body),
      },
    );
    if (res.status === 404) return null;
    const json = await readJson(res);
    if (!res.ok) return null;
    return {
      accepted: json.accepted !== false,
      serverTime: typeof json.serverTime === "string" ? json.serverTime : undefined,
    };
  } catch {
    return null;
  }
}

export type ProtectedStatusResponse = {
  raceStatus: string;
  adjudicationStatus: string | null;
  settlementStatus: string | null;
  serverStartAt: string | null;
  serverEndAt: string | null;
  verificationSessionId: string | null;
  integrityStatus: string | null;
  continuityStatus: string | null;
  reviewReasons: string[];
  evidenceSubmittedAt: string | null;
  qualifyingSteps: number | null;
  provisionalSteps: number | null;
};

export async function getProtectedVerificationStatus(
  raceId: string,
): Promise<ProtectedStatusResponse | null> {
  try {
    const res = await authFetch(
      `/api/races/${raceId}/protected-verification/status`,
      {
        method: "GET",
        timeoutMs: API_TIMEOUT_MS,
        retryOnUnauthorized: false,
      },
    );
    if (!res.ok) return null;
    const json = await readJson(res);
    return {
      raceStatus: typeof json.raceStatus === "string" ? json.raceStatus : "unknown",
      adjudicationStatus:
        typeof json.adjudicationStatus === "string" ? json.adjudicationStatus : null,
      settlementStatus:
        typeof json.settlementStatus === "string" ? json.settlementStatus : null,
      serverStartAt:
        typeof json.serverStartAt === "string" ? json.serverStartAt : null,
      serverEndAt: typeof json.serverEndAt === "string" ? json.serverEndAt : null,
      verificationSessionId:
        typeof json.verificationSessionId === "string"
          ? json.verificationSessionId
          : null,
      integrityStatus:
        typeof json.integrityStatus === "string" ? json.integrityStatus : null,
      continuityStatus:
        typeof json.continuityStatus === "string" ? json.continuityStatus : null,
      reviewReasons: Array.isArray(json.reviewReasons)
        ? (json.reviewReasons as unknown[]).filter(
            (x): x is string => typeof x === "string",
          )
        : [],
      evidenceSubmittedAt:
        typeof json.evidenceSubmittedAt === "string"
          ? json.evidenceSubmittedAt
          : null,
      qualifyingSteps:
        typeof json.qualifyingSteps === "number" ? json.qualifyingSteps : null,
      provisionalSteps:
        typeof json.provisionalSteps === "number" ? json.provisionalSteps : null,
    };
  } catch {
    return null;
  }
}

export type FinalChallengeResult =
  | {
      ok: true;
      challengeId: string;
      serverChallenge: string;
      expiresAt: string;
    }
  | ApiErr;

export async function requestProtectedFinalChallenge(
  raceId: string,
  verificationSessionId: string,
): Promise<FinalChallengeResult> {
  try {
    const res = await authFetch(
      `/api/races/${raceId}/protected-verification/final-challenge`,
      {
        method: "POST",
        timeoutMs: API_TIMEOUT_MS,
        retryOnUnauthorized: false,
        body: JSON.stringify({ verificationSessionId }),
      },
    );
    const json = await readJson(res);
    if (!res.ok) return parseErr(json, res.status);
    return {
      ok: true,
      challengeId: String(json.challengeId ?? ""),
      serverChallenge: String(json.serverChallenge ?? ""),
      expiresAt: String(json.expiresAt ?? ""),
    };
  } catch {
    return {
      ok: false,
      featureEnabled: true,
      status: 0,
      code: "network_error",
      error: "network_error",
    };
  }
}

export type SubmitFinalEvidenceResult =
  | {
      ok: true;
      accepted: boolean;
      replayed?: boolean;
      evidenceId?: string;
      adjudication?: {
        ready: boolean;
        status: string;
        reasons: string[];
      };
    }
  | ApiErr;

export async function submitProtectedFinalEvidence(
  raceId: string,
  body: {
    verificationSessionId: string;
    challengeId: string;
    serverChallenge: string;
    registeredDeviceId: string;
    serverStartAt: string;
    serverEndAt: string;
    approvedSource: ProtectedApprovedSource;
    qualifyingSteps: number;
    provisionalSteps: number;
    verificationReadAt: string;
    evidenceHash: string;
    sourceEvidence: ProtectedSourceEvidence;
    integrity: ProtectedIntegrityBinding;
  },
): Promise<SubmitFinalEvidenceResult> {
  try {
    const res = await authFetch(
      `/api/races/${raceId}/protected-verification/final-evidence`,
      {
        method: "POST",
        timeoutMs: STEP_SYNC_TIMEOUT,
        retryOnUnauthorized: false,
        body: JSON.stringify(body),
      },
    );
    const json = await readJson(res);
    if (!res.ok) return parseErr(json, res.status);
    const adj = json.adjudication as Record<string, unknown> | undefined;
    return {
      ok: true,
      accepted: json.accepted !== false,
      replayed: json.replayed === true,
      evidenceId: typeof json.evidenceId === "string" ? json.evidenceId : undefined,
      adjudication: adj
        ? {
            ready: adj.ready === true,
            status: typeof adj.status === "string" ? adj.status : "pending_verification",
            reasons: Array.isArray(adj.reasons)
              ? (adj.reasons as unknown[]).filter(
                  (x): x is string => typeof x === "string",
                )
              : [],
          }
        : undefined,
    };
  } catch {
    return {
      ok: false,
      featureEnabled: true,
      status: 0,
      code: "network_error",
      error: "network_error",
    };
  }
}

export type RaceDetailProtectedContext = {
  protectedRace: boolean;
  participantId: string | null;
  serverStartAt: string | null;
  serverEndAt: string | null;
  adjudicationStatus: string | null;
  settlementStatus: string | null;
  isSponsored: boolean;
  challengeType: string | null;
  entryType: string | null;
};

export async function fetchRaceProtectedContext(
  raceId: string,
): Promise<RaceDetailProtectedContext | null> {
  try {
    const res = await authFetch(`/api/races/${raceId}`, {
      method: "GET",
      timeoutMs: API_TIMEOUT_MS,
      retryOnUnauthorized: false,
    });
    if (!res.ok) return null;
    const json = await readJson(res);
    const race = (
      json.race && typeof json.race === "object"
        ? json.race
        : json
    ) as Record<string, unknown>;
    const participants = (json.participants ??
      race.participants ??
      []) as Array<Record<string, unknown>>;
    const me = participants.find((p) => p.isCurrentUser === true);
    const challengeType =
      typeof race.challengeType === "string"
        ? race.challengeType
        : typeof race.challenge_type === "string"
          ? race.challenge_type
          : null;
    const entryType =
      typeof race.entryType === "string" ? race.entryType : null;
    return {
      protectedRace: race.protectedRace === true,
      participantId: me && typeof me.id === "string" ? me.id : null,
      serverStartAt:
        typeof race.serverStartAt === "string" ? race.serverStartAt : null,
      serverEndAt: typeof race.serverEndAt === "string" ? race.serverEndAt : null,
      adjudicationStatus:
        typeof race.adjudicationStatus === "string"
          ? race.adjudicationStatus
          : null,
      settlementStatus:
        typeof race.settlementStatus === "string" ? race.settlementStatus : null,
      isSponsored:
        race.isSponsored === true ||
        race.roomType === "sponsored" ||
        challengeType === "sponsored",
      challengeType,
      entryType,
    };
  } catch {
    return null;
  }
}

/** @deprecated */
export const createPrizeVerificationSession = createProtectedVerificationSession;
export const submitPrizeVerificationEvidence = submitProtectedFinalEvidence;
export const reportPrizeContinuityEvent = async (
  _raceId?: string,
  _body?: unknown,
) => {};
export function isPrizeVerificationSessionFeatureEnabled(): boolean | null {
  return _featureEnabled;
}
export function isPrizeEvidenceFeatureEnabled(): boolean | null {
  return _featureEnabled;
}
