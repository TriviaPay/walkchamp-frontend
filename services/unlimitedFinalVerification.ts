/**
 * Streak Challenge final-day Health Connect / HealthKit submission.
 * Does not replace POST /api/walk/steps. Never submits pedometer / step-counter data.
 */

import { Platform } from "react-native";
import { authFetch, API_TIMEOUT_MS, STEP_SYNC_TIMEOUT } from "@/utils/authFetch";
import { logger } from "@/utils/logger";
import {
  addCrashBreadcrumb,
  captureMessage,
} from "@/services/monitoring/sentry";
import { stepProviderManager } from "@/platform/steps/stepProviderManager";
import { fetchUnlimitedDailyHistory } from "@/features/unlimited/api/unlimitedResultsApi";
import {
  canonicalUnlimitedFinalHealthSource,
  classifyUnlimitedFinalVerificationError,
  isUnlimitedFinalVerificationRequested,
  selectUnlimitedFinalDayWindow,
  type UnlimitedFinalHealthSource,
} from "@/features/unlimited/mappers/unlimitedFinalVerification";
import type { UnlimitedDailyHistoryPayload } from "@/features/unlimited/mappers/unlimitedDayProgress";

export type UnlimitedFinalVerificationSubmitResult =
  | {
      ok: true;
      accepted: boolean;
      alreadyCompleted: boolean;
      status: string;
      verificationStatus?: string;
      verifiedSteps?: number;
    }
  | {
      ok: false;
      skipped: true;
      reason:
        | "not_requested"
        | "permission"
        | "provider"
        | "window"
        | "read_error"
        | "not_settlement_participant";
      code?: string;
    }
  | {
      ok: false;
      skipped: false;
      httpStatus: number;
      code?: string;
      error?: string;
      retry: ReturnType<typeof classifyUnlimitedFinalVerificationError>;
    };

function emitTelemetry(
  event: string,
  data: Record<string, unknown>,
): void {
  addCrashBreadcrumb(event, "unlimited_final_verification", data);
  if (
    event === "provider_read_failed" ||
    event === "permission_failed" ||
    event === "window_mismatch" ||
    event === "stuck_requested" ||
    event === "stuck_submitted"
  ) {
    captureMessage(`unlimited_final_verification:${event}`, "warning");
  }
  logger.warn("UnlimitedFinalVerify", event, data);
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function postUnlimitedFinalVerification(
  challengeId: string,
  body: {
    source: UnlimitedFinalHealthSource;
    dayNumber: number;
    intervalStartUtc: string;
    intervalEndUtc: string;
    verifiedSteps: number;
    measuredAtUtc: string;
  },
): Promise<UnlimitedFinalVerificationSubmitResult> {
  try {
    const res = await authFetch(
      `/api/unlimited-challenges/${challengeId}/final-verification`,
      {
        method: "POST",
        timeoutMs: STEP_SYNC_TIMEOUT,
        retryOnUnauthorized: false,
        body: JSON.stringify(body),
      },
    );
    const json = await readJson(res);
    const code = typeof json.code === "string" ? json.code : undefined;
    if (!res.ok) {
      if (code === "verification_window_mismatch") {
        emitTelemetry("window_mismatch", { challengeId, code, status: res.status });
      }
      return {
        ok: false,
        skipped: false,
        httpStatus: res.status,
        code,
        error: typeof json.error === "string" ? json.error : undefined,
        retry: classifyUnlimitedFinalVerificationError({
          httpStatus: res.status,
          code,
        }),
      };
    }
    return {
      ok: true,
      accepted: json.accepted !== false,
      alreadyCompleted: json.alreadyCompleted === true,
      status: typeof json.status === "string" ? json.status : "submitted",
      verificationStatus:
        typeof json.verificationStatus === "string"
          ? json.verificationStatus
          : undefined,
      verifiedSteps:
        typeof json.verifiedSteps === "number" ? json.verifiedSteps : undefined,
    };
  } catch (err) {
    logger.debug("UnlimitedFinalVerify", `network: ${String(err)}`);
    return {
      ok: false,
      skipped: false,
      httpStatus: 0,
      code: "network_error",
      error: "network_error",
      retry: "retry",
    };
  }
}

/**
 * When `finalVerificationRequired` / status is `requested`, read the exact
 * server final-day Health interval and POST /final-verification.
 */
export async function submitRequestedUnlimitedFinalVerification(
  challengeId: string,
  opts?: { history?: UnlimitedDailyHistoryPayload | null },
): Promise<UnlimitedFinalVerificationSubmitResult> {
  const history =
    opts?.history ?? (await fetchUnlimitedDailyHistory(challengeId));
  if (!isUnlimitedFinalVerificationRequested(history)) {
    return { ok: false, skipped: true, reason: "not_requested" };
  }

  if (history?.inSettlementPopulation === false) {
    return { ok: false, skipped: true, reason: "not_settlement_participant" };
  }

  const window = selectUnlimitedFinalDayWindow(history);
  if (!window) {
    emitTelemetry("final_day_missing", { challengeId });
    return { ok: false, skipped: true, reason: "window", code: "final_day_missing" };
  }

  await stepProviderManager.initialize();
  const status = await stepProviderManager.refreshStatus();
  if (status.permission !== "granted") {
    emitTelemetry("permission_failed", {
      challengeId,
      permission: status.permission,
    });
    return { ok: false, skipped: true, reason: "permission" };
  }

  const source = canonicalUnlimitedFinalHealthSource(
    stepProviderManager.getDailyProviderId() ??
      (Platform.OS === "ios" ? "ios_healthkit" : "android_health_connect"),
  );
  if (!source) {
    emitTelemetry("provider_read_failed", {
      challengeId,
      reason: "non_health_source",
    });
    return { ok: false, skipped: true, reason: "provider" };
  }

  const start = new Date(window.intervalStartUtc);
  const end = new Date(window.intervalEndUtc);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    emitTelemetry("window_mismatch", { challengeId, reason: "unparseable_window" });
    return { ok: false, skipped: true, reason: "window" };
  }

  let snap: Awaited<ReturnType<typeof stepProviderManager.getStepsForRange>>;
  try {
    snap = await stepProviderManager.getStepsForRange(start, end);
  } catch (err) {
    emitTelemetry("provider_read_failed", {
      challengeId,
      reason: "throw",
      message: String(err),
    });
    return { ok: false, skipped: true, reason: "read_error" };
  }

  if (!snap || snap.queryStatus === "error") {
    emitTelemetry("provider_read_failed", {
      challengeId,
      reason: snap ? "query_error" : "empty",
    });
    return { ok: false, skipped: true, reason: "read_error" };
  }

  const verifiedSource = canonicalUnlimitedFinalHealthSource(snap.source ?? snap.providerId);
  if (!verifiedSource) {
    emitTelemetry("provider_read_failed", {
      challengeId,
      reason: "sensor_rejected",
      source: snap.source,
    });
    return { ok: false, skipped: true, reason: "provider" };
  }

  const measuredAtUtc = new Date().toISOString();
  return postUnlimitedFinalVerification(challengeId, {
    source: verifiedSource,
    dayNumber: window.dayNumber,
    intervalStartUtc: window.intervalStartUtc,
    intervalEndUtc: window.intervalEndUtc,
    verifiedSteps: Math.max(0, Math.floor(snap.steps)),
    measuredAtUtc,
  });
}

export async function fetchUnlimitedFinalVerificationContext(
  challengeId: string,
): Promise<UnlimitedDailyHistoryPayload | null> {
  try {
    const res = await authFetch(`/api/unlimited-challenges/${challengeId}`, {
      method: "GET",
      timeoutMs: API_TIMEOUT_MS,
      retryOnUnauthorized: false,
    });
    if (!res.ok) return null;
    const json = await readJson(res);
    const challenge =
      json.challenge && typeof json.challenge === "object"
        ? (json.challenge as Record<string, unknown>)
        : json;
    return {
      durationDays:
        typeof challenge.durationDays === "number"
          ? challenge.durationDays
          : typeof json.durationDays === "number"
            ? json.durationDays
            : undefined,
      resultsStatus:
        typeof challenge.resultsStatus === "string"
          ? challenge.resultsStatus
          : typeof json.resultsStatus === "string"
            ? json.resultsStatus
            : typeof json.viewerResultsStatus === "string"
              ? json.viewerResultsStatus
              : null,
      finalVerificationStatus:
        typeof json.finalVerificationStatus === "string"
          ? json.finalVerificationStatus
          : null,
      finalVerificationRequired: json.finalVerificationRequired === true,
      finalVerificationSubmittedAt:
        typeof json.finalVerificationSubmittedAt === "string"
          ? json.finalVerificationSubmittedAt
          : null,
      finalVerificationCompletedAt:
        typeof json.finalVerificationCompletedAt === "string"
          ? json.finalVerificationCompletedAt
          : null,
      finalVerificationSource:
        typeof json.finalVerificationSource === "string"
          ? json.finalVerificationSource
          : null,
      inSettlementPopulation: json.inSettlementPopulation === true,
    };
  } catch {
    return null;
  }
}
