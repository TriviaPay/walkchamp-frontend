import { authFetch, STEP_SYNC_TIMEOUT, API_TIMEOUT_MS } from "@/utils/authFetch";
import { logger } from "@/utils/logger";
import {
  isAcceptedVerifiedSource,
  isLegacyStepSourceId,
} from "@/services/steps/verifiedStepSources";
// liveRaceSources used inside postRaceProgress (dynamic require avoids cycles)

export type RaceProgressSource =
  | "healthkit"
  | "health_connect"
  | "simulation"
  | "race_start"
  | string;

export interface RaceProgressResult {
  ok: boolean;
  acceptedSteps: number;
  skipped: boolean;
  rank?: number;
  totalParticipants?: number;
  goalSteps?: number;
  timeLeftSeconds?: number;
  username?: string;
  raceStatus?: string;
  userId?: string;
  raceId?: string;
  /** Present when backend / client rejects non-verified sources. */
  code?: string;
}

function parseRaceProgressResult(
  json: Record<string, unknown>,
  fallbackSteps: number,
): Omit<RaceProgressResult, "ok"> {
  const acceptedSteps =
    typeof json.steps === "number"
      ? json.steps
      : typeof json.raceSteps === "number"
        ? json.raceSteps
        : fallbackSteps;
  const skipped = json.skipped === true || typeof json.skipped === "string";
  return {
    acceptedSteps,
    skipped,
    rank: typeof json.rank === "number" ? json.rank : undefined,
    totalParticipants:
      typeof json.totalParticipants === "number" ? json.totalParticipants : undefined,
    goalSteps: typeof json.goalSteps === "number" ? json.goalSteps : undefined,
    timeLeftSeconds:
      typeof json.timeLeftSeconds === "number" ? json.timeLeftSeconds : undefined,
    username: typeof json.username === "string" ? json.username : undefined,
    raceStatus:
      typeof json.raceStatus === "string"
        ? json.raceStatus
        : typeof json.race_status === "string"
          ? json.race_status
          : undefined,
    userId: typeof json.userId === "string" ? json.userId : undefined,
    raceId: typeof json.raceId === "string" ? json.raceId : undefined,
  };
}

/**
 * POST /api/races/:id/progress
 *
 * Uses authFetch for session headers + token attach, but disables 401 body retry
 * so a refreshed token cannot duplicate a non-idempotent progress write.
 * The race sync buffer retries on the next tick with a fresh session.
 */
export async function postRaceProgress(
  raceId: string,
  steps: number,
  sequenceId?: number,
  deviceTotalSteps?: number,
  stepSource?: RaceProgressSource,
  trackingSessionId?: string,
): Promise<RaceProgressResult> {
  try {
    // Allow verified health-store sources OR live device-sensor sources.
    // Reject unknown / other legacy aliases that are not live-race approved.
    if (stepSource != null) {
      const { isAcceptedRaceProgressSource } = require(
        "@/services/steps/liveRaceSources",
      ) as typeof import("@/services/steps/liveRaceSources");
      if (!isAcceptedRaceProgressSource(String(stepSource))) {
        logger.debug(
          "RaceSteps",
          `rejected unsupported stepSource=${stepSource}`,
        );
        return {
          ok: false,
          acceptedSteps: 0,
          skipped: true,
          code: "VERIFIED_STEP_SOURCE_REQUIRED",
        };
      }
    }

    // Live race uploads must not use health sources as the live lane.
    if (
      typeof __DEV__ !== "undefined" &&
      __DEV__ &&
      stepSource &&
      isAcceptedVerifiedSource(String(stepSource)) &&
      !["simulation", "race_start"].includes(String(stepSource))
    ) {
      const { isAcceptedLiveRaceSource } = require(
        "@/services/steps/liveRaceSources",
      ) as typeof import("@/services/steps/liveRaceSources");
      if (!isAcceptedLiveRaceSource(String(stepSource))) {
        console.warn(
          "[HybridSteps] race live upload should not use health source as live source",
        );
      }
    }

    const body: Record<string, unknown> = {
      steps,
      deviceTime: new Date().toISOString(),
    };
    if (sequenceId !== undefined) body.sequenceId = sequenceId;
    if (deviceTotalSteps !== undefined) body.deviceTotalSteps = deviceTotalSteps;
    if (stepSource !== undefined) body.stepSource = stepSource;
    // Tracking session identity (restart/reboot/resume). Backend may ignore until
    // contract is updated — still send for forward compatibility.
    if (trackingSessionId) {
      body.sessionId = trackingSessionId;
      body.trackingSessionId = trackingSessionId;
    }

    logger.debug(
      "RaceSteps",
      `sending sync raceId=${raceId} steps=${steps} source=${stepSource ?? "unknown"} seq=${sequenceId ?? "n/a"} session=${trackingSessionId ?? "n/a"} deviceTotal=${deviceTotalSteps ?? "n/a"}`,
    );

    const res = await authFetch(`/api/races/${raceId}/progress`, {
      method: "POST",
      timeoutMs: STEP_SYNC_TIMEOUT,
      retryOnUnauthorized: false,
      body: JSON.stringify(body),
    });

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = parseRaceProgressResult(json, steps);
    logger.debug(
      "RaceSteps",
      `sync response HTTP ${res.status} progress:${parsed.acceptedSteps} skipped=${parsed.skipped}`,
    );
    if (!res.ok) {
      const code =
        typeof json.code === "string" ? json.code : undefined;
      return {
        ok: false,
        acceptedSteps: 0,
        skipped: false,
        ...(code ? { code } : {}),
      };
    }
    return { ok: true, ...parsed };
  } catch (err) {
    logger.debug("RaceSteps", `sync failed: ${String(err)}`);
    return { ok: false, acceptedSteps: 0, skipped: false };
  }
}

export async function postRaceReconcile(
  raceId: string,
  steps: number,
  source: string,
): Promise<void> {
  try {
    await authFetch(`/api/races/${raceId}/reconcile-steps`, {
      method: "POST",
      timeoutMs: API_TIMEOUT_MS,
      retryOnUnauthorized: false,
      body: JSON.stringify({ steps, source }),
    });
  } catch {
    /* best-effort */
  }
}

export async function registerLiveActivityToken(
  raceId: string,
  activityId: string,
  pushToken: string,
  platform: "ios" | "android" = "ios",
): Promise<boolean> {
  try {
    const res = await authFetch(`/api/races/${raceId}/live-activity/register`, {
      method: "POST",
      timeoutMs: API_TIMEOUT_MS,
      retryOnUnauthorized: false,
      body: JSON.stringify({ activityId, pushToken, platform }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
