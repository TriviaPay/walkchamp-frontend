/**
 * Protected-race verification orchestrator.
 *
 * Answers: is this protected-race evidence acceptable for backend adjudication?
 * Does NOT replace stepProgressCoordinator (display / tracking lane).
 */

import { Platform } from "react-native";
import { isProtectedRaceVerificationEnabled } from "@/config/featureFlags";
import { getInstallationId } from "@/services/deviceIdentity";
import { resolveStepTrackingCapability } from "@/platform/steps/stepTrackingCapability";
import { store } from "@/store";
import { prizeVerificationActions } from "@/store/slices/prizeVerificationSlice";
import { getRaceResultStatus } from "@/services/raceVerificationApi";
import { collectProtectedRaceEvidence } from "./raceEvidenceCollector";
import {
  startPrizeContinuityMonitor,
  stopPrizeContinuityMonitor,
  reportAccountSwitchDuringRace,
} from "./raceContinuityMonitor";
import {
  startPrizeOfflineMonitor,
  stopPrizeOfflineMonitor,
} from "./raceOfflineMonitor";
import {
  isIntegrityCapabilityAvailable,
  requestIntegrityToken,
} from "./raceIntegrityService";
import { hashCanonicalPayload } from "./canonicalEvidenceHash";
import {
  isProtectedPrizeRace,
  isProtectedRacePlatformSupported,
} from "./prizeRaceHelpers";
import { resolvePrizeRaceReadiness } from "./raceVerificationPreflight";
import { adjudicationToPrizeStatus } from "./prizeStatusLabels";
import {
  createProtectedVerificationSession,
  fetchRaceProtectedContext,
  getProtectedVerificationStatus,
  postProtectedHeartbeat,
  requestProtectedFinalChallenge,
  submitProtectedFinalEvidence,
  submitProtectedPreflight,
} from "./raceVerificationApi";
import {
  clearPrizeVerificationSession,
  clearUnsentFinalEvidence,
  loadPrizeVerificationSession,
  persistPrizeVerificationSession,
  persistUnsentFinalEvidence,
} from "./raceVerificationSessionStore";
import { resolveApprovedNativeSourceId } from "./approvedSourceResolver";
import type {
  HealthPermissionStatus,
  PrizeRaceReadiness,
  ProtectedApprovedSource,
  ProtectedFinalIntegrityPayload,
  ProtectedPreflightPayload,
  ProtectedSourceEvidence,
} from "./raceVerificationTypes";

const HEARTBEAT_MS = 60_000;
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let _finalRetryTimer: ReturnType<typeof setTimeout> | null = null;

function platform(): "android" | "ios" {
  return Platform.OS === "ios" ? "ios" : "android";
}

function approvedSourceForPlatform(): ProtectedApprovedSource {
  return Platform.OS === "ios" ? "healthkit" : "health_connect";
}

export async function resolveHealthPermissionStatus(): Promise<HealthPermissionStatus> {
  const cap = await resolveStepTrackingCapability().catch(() => null);
  if (cap?.verifiedPermissionGranted) return "granted";
  if (cap?.verifiedHealthAvailable) return "denied";
  return "denied";
}

export type PrepareProtectedRaceArgs = {
  raceId: string;
  userId: string;
  protectedRace?: boolean | null;
  challengeType?: string | null;
  entryType?: string | null;
  entryFeeCents?: number | null;
  entryFee?: number | null;
  isSponsored?: boolean | null;
  durationMinutes?: number | null;
  raceAlreadyStarted?: boolean;
  raceAlreadyEnded?: boolean;
};

export type PrepareProtectedRaceResult =
  | { ok: true; readiness: PrizeRaceReadiness }
  | { ok: false; skipped: true }
  | { ok: false; skipped: false; readiness: PrizeRaceReadiness; code?: string };

/**
 * Create session + submit integrity-bound preflight after join/register.
 */
export async function prepareProtectedRace(
  args: PrepareProtectedRaceArgs & { _attempt?: number },
): Promise<PrepareProtectedRaceResult> {
  if (!isProtectedRaceVerificationEnabled()) {
    return { ok: false, skipped: true };
  }

  const ctx = await fetchRaceProtectedContext(args.raceId);
  const protectedRace =
    ctx?.protectedRace === true ||
    isProtectedPrizeRace({
      protectedRace: args.protectedRace ?? ctx?.protectedRace,
      challengeType: args.challengeType ?? ctx?.challengeType,
      entryType: args.entryType ?? ctx?.entryType,
      entryFeeCents: args.entryFeeCents,
      entryFee: args.entryFee,
      isSponsored: args.isSponsored ?? ctx?.isSponsored,
    });

  if (!protectedRace) {
    return { ok: false, skipped: true };
  }

  if (!isProtectedRacePlatformSupported()) {
    const readiness: PrizeRaceReadiness = {
      eligible: false,
      sensorReady: false,
      healthPlatformReady: false,
      approvedSourceReady: false,
      registeredDeviceReady: false,
      integrityReady: false,
      connectivityReady: true,
      failureReason: "ios_not_configured",
      userMessage:
        "Verified prize challenges aren't available on iPhone yet. Free races are still available.",
    };
    return { ok: false, skipped: false, readiness, code: "IOS_APP_ATTEST_NOT_CONFIGURED" };
  }

  const plat = platform();
  store.dispatch(
    prizeVerificationActions.beginPreflight({
      raceId: args.raceId,
      platform: plat,
      isSponsored: ctx?.isSponsored === true || args.isSponsored === true,
    }),
  );
  store.dispatch(prizeVerificationActions.setFeatureEnabled(true));

  const participantId = ctx?.participantId;
  if (!participantId) {
    const readiness = await resolvePrizeRaceReadiness({
      userId: args.userId,
      registeredDeviceId: await getInstallationId().catch(() => null),
      verificationSessionObtained: false,
      raceAlreadyStarted: args.raceAlreadyStarted,
      raceAlreadyEnded: args.raceAlreadyEnded,
    });
    store.dispatch(
      prizeVerificationActions.setFailureReason("participant_missing"),
    );
    return { ok: false, skipped: false, readiness };
  }

  const permissionStatus = await resolveHealthPermissionStatus();
  store.dispatch(
    prizeVerificationActions.setHealthPermissionStatus(permissionStatus),
  );

  const source = await resolveApprovedNativeSourceId();
  if (source.approvedSourceId) {
    store.dispatch(
      prizeVerificationActions.setApprovedSource({
        approvedSourceId: source.approvedSourceId,
        approvedSource: approvedSourceForPlatform(),
      }),
    );
  }

  const sessionResult = await createProtectedVerificationSession(
    args.raceId,
    plat,
  );

  if (!sessionResult.ok) {
    if (sessionResult.status === 404) {
      store.dispatch(prizeVerificationActions.setFeatureEnabled(false));
      return { ok: false, skipped: true };
    }
    store.dispatch(
      prizeVerificationActions.setLastErrorCode(sessionResult.code ?? null),
    );
    const readiness = await resolvePrizeRaceReadiness({
      userId: args.userId,
      registeredDeviceId: await getInstallationId().catch(() => null),
      verificationSessionObtained: false,
      raceAlreadyStarted: args.raceAlreadyStarted,
      raceAlreadyEnded: args.raceAlreadyEnded,
    });
    return {
      ok: false,
      skipped: false,
      readiness,
      code: sessionResult.code,
    };
  }

  const session = sessionResult.session;
  store.dispatch(
    prizeVerificationActions.setSession({
      verificationSessionId: session.verificationSessionId,
      challengeId: session.challengeId,
      serverChallenge: session.serverChallenge,
      registeredDeviceId: session.registeredDeviceId,
      approvedSource: session.approvedSource,
      integrityProvider: session.integrityProvider,
      participantId,
      serverStartAt: ctx?.serverStartAt,
      serverEndAt: ctx?.serverEndAt,
    }),
  );

  const preflightPayload: ProtectedPreflightPayload = {
    approvedSource: session.approvedSource,
    permissionStatus,
    participantId,
    platform: plat,
    purpose: "preflight",
    raceId: args.raceId,
    registeredDeviceId: session.registeredDeviceId,
    serverChallenge: session.serverChallenge,
    verificationSessionId: session.verificationSessionId,
  };

  const requestHash = hashCanonicalPayload(preflightPayload);
  const integrity = await requestIntegrityToken({
    requestHash,
    serverChallenge: session.serverChallenge,
  });

  if (!integrity.token) {
    store.dispatch(
      prizeVerificationActions.setLastErrorCode("INTEGRITY_PROVIDER_UNAVAILABLE"),
    );
    const readiness = await resolvePrizeRaceReadiness({
      userId: args.userId,
      registeredDeviceId: session.registeredDeviceId,
      verificationSessionObtained: true,
      integrityRequired: true,
      raceAlreadyStarted: args.raceAlreadyStarted,
      raceAlreadyEnded: args.raceAlreadyEnded,
    });
    return {
      ok: false,
      skipped: false,
      readiness: {
        ...readiness,
        integrityReady: false,
        eligible: false,
        failureReason: "integrity_unavailable",
        userMessage: "Your step tracker isn't ready for verified challenges.",
      },
      code: "INTEGRITY_PROVIDER_UNAVAILABLE",
    };
  }

  const preflight = await submitProtectedPreflight(args.raceId, {
    verificationSessionId: session.verificationSessionId,
    challengeId: session.challengeId,
    serverChallenge: session.serverChallenge,
    approvedSource: session.approvedSource,
    permissionStatus,
    integrity: {
      provider: integrity.provider,
      token: integrity.token,
      requestHash,
    },
  });

  if (!preflight.ok) {
    store.dispatch(
      prizeVerificationActions.setLastErrorCode(preflight.code ?? null),
    );
    if (
      preflight.code === "INTEGRITY_CHALLENGE_EXPIRED" ||
      preflight.code === "INTEGRITY_CHALLENGE_REPLAYED" ||
      preflight.code === "INTEGRITY_TOKEN_STALE"
    ) {
      if ((args._attempt ?? 0) < 1) {
        return prepareProtectedRace({ ...args, _attempt: (args._attempt ?? 0) + 1 });
      }
    }
    const readiness = await resolvePrizeRaceReadiness({
      userId: args.userId,
      registeredDeviceId: session.registeredDeviceId,
      verificationSessionObtained: true,
      raceAlreadyStarted: args.raceAlreadyStarted,
      raceAlreadyEnded: args.raceAlreadyEnded,
    });
    return { ok: false, skipped: false, readiness, code: preflight.code };
  }

  store.dispatch(prizeVerificationActions.setPreflightPassed(true));

  await persistPrizeVerificationSession({
    raceId: args.raceId,
    participantId,
    verificationSessionId: session.verificationSessionId,
    registeredDeviceId: session.registeredDeviceId,
    platform: plat,
    approvedSource: session.approvedSource,
    integrityProvider: session.integrityProvider,
    serverStartAt: ctx?.serverStartAt ?? undefined,
    serverEndAt: ctx?.serverEndAt ?? undefined,
    preflightPassed: true,
    evidenceSubmitted: false,
    challengeId: session.challengeId,
    userId: args.userId,
    serverChallenge: session.serverChallenge,
    savedAt: new Date().toISOString(),
  });

  const readiness = await resolvePrizeRaceReadiness({
    userId: args.userId,
    registeredDeviceId: session.registeredDeviceId,
    verificationSessionObtained: true,
    integrityRequired: true,
    raceAlreadyStarted: args.raceAlreadyStarted,
    raceAlreadyEnded: args.raceAlreadyEnded,
  });

  if (!readiness.eligible) {
    store.dispatch(
      prizeVerificationActions.setFailureReason(readiness.failureReason ?? null),
    );
    return { ok: false, skipped: false, readiness };
  }

  store.dispatch(prizeVerificationActions.setReady());
  return { ok: true, readiness };
}

/** Fire-and-forget after join/register. Safe if race is not protected. */
export async function beginProtectedPreflightAfterJoin(
  raceId: string,
  userId: string,
): Promise<void> {
  await prepareProtectedRace({ raceId, userId });
}

async function sendHeartbeat(): Promise<void> {
  const state = store.getState().prizeVerification;
  if (!state.raceId || !state.verificationSessionId || !state.approvedSource) {
    return;
  }
  const permissionStatus = await resolveHealthPermissionStatus();
  store.dispatch(
    prizeVerificationActions.setHealthPermissionStatus(permissionStatus),
  );
  const result = await postProtectedHeartbeat(state.raceId, {
    verificationSessionId: state.verificationSessionId,
    approvedSource: state.approvedSource,
    permissionStatus,
  });
  const at = new Date().toISOString();
  store.dispatch(
    prizeVerificationActions.markHeartbeat({
      at,
      serverTime: result?.serverTime,
    }),
  );
}

export function beginProtectedRaceLive(args: {
  raceId: string;
  durationMinutes?: number | null;
}): void {
  const state = store.getState().prizeVerification;
  if (state.raceId !== args.raceId) return;
  if (!isProtectedRaceVerificationEnabled()) return;

  store.dispatch(prizeVerificationActions.setLive());

  void fetchRaceProtectedContext(args.raceId).then((ctx) => {
    if (!ctx) return;
    store.dispatch(
      prizeVerificationActions.setServerWindow({
        serverStartAt: ctx.serverStartAt,
        serverEndAt: ctx.serverEndAt,
      }),
    );
  });

  startPrizeContinuityMonitor({
    raceId: args.raceId,
    approvedSourceId: state.approvedSourceId,
    registeredDeviceId: state.registeredDeviceId,
    verificationSessionId: state.verificationSessionId ?? "",
  });

  const durationMs = (args.durationMinutes ?? 60) * 60_000;
  startPrizeOfflineMonitor({
    raceDurationMs: durationMs,
    maxContinuousOfflineMinutes: 10,
    maxOfflinePercent: 20,
  });

  stopHeartbeat();
  void sendHeartbeat();
  _heartbeatTimer = setInterval(() => {
    void sendHeartbeat();
  }, HEARTBEAT_MS);
}

export function stopHeartbeat(): void {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}

export function onProtectedRaceEnd(args: {
  raceId: string;
  provisionalSteps: number;
}): void {
  const state = store.getState().prizeVerification;
  if (state.raceId !== args.raceId) return;
  store.dispatch(prizeVerificationActions.setProvisionalSteps(args.provisionalSteps));
  store.dispatch(
    prizeVerificationActions.setVerificationStatus("result_pending_verification"),
  );
  stopPrizeOfflineMonitor();
}

export type SubmitEvidenceArgs = {
  raceId: string;
  userId: string;
  participantId: string;
  provisionalSteps: number;
  reason?: string;
};

/**
 * After serverEndAt: request final challenge, read HC/HK window, bind integrity, submit.
 * Uses result-status.liveSteps as provisionalSteps. Never submits qualifyingSteps=0 on read error.
 */
export async function submitProtectedRaceEvidence(
  args: SubmitEvidenceArgs,
): Promise<void> {
  const state = store.getState().prizeVerification;
  if (state.raceId !== args.raceId) return;
  if (!isProtectedRaceVerificationEnabled()) return;
  if (!state.verificationSessionId || !state.preflightPassed) return;
  if (state.evidenceSubmitted) return;

  const status = await getProtectedVerificationStatus(args.raceId);
  const serverStartAt = status?.serverStartAt ?? state.serverStartAt;
  const serverEndAt = status?.serverEndAt ?? state.serverEndAt;
  if (serverStartAt && serverEndAt) {
    store.dispatch(
      prizeVerificationActions.setServerWindow({ serverStartAt, serverEndAt }),
    );
  }

  if (!serverEndAt || Date.now() + state.serverTimeOffsetMs < Date.parse(serverEndAt)) {
    scheduleFinalRetry(args, 5_000);
    return;
  }

  const challenge = await requestProtectedFinalChallenge(
    args.raceId,
    state.verificationSessionId,
  );
  if (!challenge.ok) {
    if (challenge.code === "RACE_NOT_ENDED") {
      scheduleFinalRetry(args, 5_000);
      return;
    }
    if (
      challenge.code === "INTEGRITY_CHALLENGE_EXPIRED" ||
      challenge.code === "INTEGRITY_CHALLENGE_REPLAYED"
    ) {
      scheduleFinalRetry(args, 2_000);
      return;
    }
    store.dispatch(
      prizeVerificationActions.setLastErrorCode(challenge.code ?? null),
    );
    scheduleFinalRetry(args, 15_000);
    return;
  }

  const resultStatus = await getRaceResultStatus(args.raceId);
  const provisionalSteps =
    typeof resultStatus?.liveSteps === "number"
      ? resultStatus.liveSteps
      : args.provisionalSteps;

  store.dispatch(prizeVerificationActions.setProvisionalSteps(provisionalSteps));
  store.dispatch(prizeVerificationActions.setVerificationStatus("reconciling"));
  store.dispatch(
    prizeVerificationActions.markEvidenceAttempt(new Date().toISOString()),
  );

  const evidence = await collectProtectedRaceEvidence({
    serverStartAt: serverStartAt ?? "",
    serverEndAt,
    approvedSourceId: state.approvedSourceId,
    provisionalSteps,
  });

  if (evidence.qualifyingSteps == null) {
    store.dispatch(
      prizeVerificationActions.setVerificationStatus("result_pending_verification"),
    );
    scheduleFinalRetry(args, 5 * 60_000);
    return;
  }

  const verificationReadAt = new Date(evidence.verificationReadAt).toISOString();
  const sourceEvidence: ProtectedSourceEvidence = evidence.sourceEvidence;
  const evidenceHash = hashCanonicalPayload(sourceEvidence);

  const participantId = state.participantId ?? args.participantId;
  const registeredDeviceId =
    state.registeredDeviceId ?? (await getInstallationId().catch(() => ""));
  const approvedSource = state.approvedSource ?? approvedSourceForPlatform();

  const finalPayload: ProtectedFinalIntegrityPayload = {
    approvedSource,
    evidenceHash,
    participantId,
    provisionalSteps,
    qualifyingSteps: evidence.qualifyingSteps,
    raceId: args.raceId,
    registeredDeviceId,
    serverChallenge: challenge.serverChallenge,
    serverEndAt,
    serverStartAt: serverStartAt ?? "",
    verificationReadAt,
    verificationSessionId: state.verificationSessionId,
  };

  const requestHash = hashCanonicalPayload(finalPayload);
  const integrity = await requestIntegrityToken({
    requestHash,
    serverChallenge: challenge.serverChallenge,
  });

  if (!integrity.token) {
    store.dispatch(
      prizeVerificationActions.setLastErrorCode("INTEGRITY_PROVIDER_UNAVAILABLE"),
    );
    scheduleFinalRetry(args, 30_000);
    return;
  }

  const body = {
    verificationSessionId: state.verificationSessionId,
    challengeId: challenge.challengeId,
    serverChallenge: challenge.serverChallenge,
    registeredDeviceId,
    serverStartAt: serverStartAt ?? "",
    serverEndAt,
    approvedSource,
    qualifyingSteps: evidence.qualifyingSteps,
    provisionalSteps,
    verificationReadAt,
    evidenceHash,
    sourceEvidence,
    integrity: {
      provider: integrity.provider,
      token: integrity.token,
      requestHash,
    },
  };

  const result = await submitProtectedFinalEvidence(args.raceId, body);

  if (!result.ok) {
    if (result.code === "FINAL_EVIDENCE_ALREADY_SUBMITTED") {
      store.dispatch(prizeVerificationActions.setEvidenceSubmitted(true));
      await clearUnsentFinalEvidence();
      return;
    }
    if (result.code === "PROVISIONAL_STEPS_MISMATCH") {
      scheduleFinalRetry(args, 2_000);
      return;
    }
    if (result.code === "RACE_WINDOW_MISMATCH") {
      scheduleFinalRetry(args, 2_000);
      return;
    }
    if (
      result.code === "INTEGRITY_CHALLENGE_EXPIRED" ||
      result.code === "INTEGRITY_CHALLENGE_REPLAYED" ||
      result.code === "INTEGRITY_TOKEN_STALE" ||
      result.code === "INTEGRITY_REQUEST_HASH_MISMATCH"
    ) {
      scheduleFinalRetry(args, 2_000);
      return;
    }
    await persistUnsentFinalEvidence(args.raceId, body);
    store.dispatch(prizeVerificationActions.setLastErrorCode(result.code ?? null));
    scheduleFinalRetry(args, 15_000);
    return;
  }

  store.dispatch(prizeVerificationActions.setEvidenceSubmitted(true));
  store.dispatch(
    prizeVerificationActions.setQualifyingSteps(evidence.qualifyingSteps),
  );
  await clearUnsentFinalEvidence();

  if (result.adjudication) {
    store.dispatch(
      prizeVerificationActions.applyAdjudication({
        status: adjudicationToPrizeStatus(result.adjudication.status),
        raw: result.adjudication.status,
      }),
    );
  }
}

function scheduleFinalRetry(args: SubmitEvidenceArgs, delayMs: number): void {
  if (_finalRetryTimer) clearTimeout(_finalRetryTimer);
  _finalRetryTimer = setTimeout(() => {
    void submitProtectedRaceEvidence(args);
  }, delayMs);
}

export async function resumeProtectedRaceFromStorage(
  userId: string,
): Promise<boolean> {
  const saved = await loadPrizeVerificationSession();
  if (!saved || saved.userId !== userId) return false;

  store.dispatch(
    prizeVerificationActions.setSession({
      raceId: saved.raceId,
      verificationSessionId: saved.verificationSessionId,
      challengeId: saved.challengeId ?? "",
      serverChallenge: saved.serverChallenge ?? "",
      registeredDeviceId: saved.registeredDeviceId,
      approvedSource: saved.approvedSource,
      integrityProvider: saved.integrityProvider,
      participantId: saved.participantId,
      serverStartAt: saved.serverStartAt,
      serverEndAt: saved.serverEndAt,
    }),
  );
  if (saved.preflightPassed) {
    store.dispatch(prizeVerificationActions.setPreflightPassed(true));
  }
  if (saved.evidenceSubmitted) {
    store.dispatch(prizeVerificationActions.setEvidenceSubmitted(true));
  }
  store.dispatch(prizeVerificationActions.setLive());
  return true;
}

export function stopProtectedRaceVerification(): void {
  stopHeartbeat();
  if (_finalRetryTimer) {
    clearTimeout(_finalRetryTimer);
    _finalRetryTimer = null;
  }
  stopPrizeContinuityMonitor();
  stopPrizeOfflineMonitor();
  void clearPrizeVerificationSession();
  store.dispatch(prizeVerificationActions.reset());
}

export function handleProtectedRaceAccountSwitch(): void {
  reportAccountSwitchDuringRace();
}

export function getProtectedProgressPiggyback(raceId: string): {
  protectedVerificationSessionId?: string;
  healthPermissionStatus?: HealthPermissionStatus;
} {
  const state = store.getState().prizeVerification;
  if (
    state.raceId !== raceId ||
    !state.verificationSessionId ||
    !state.preflightPassed
  ) {
    return {};
  }
  return {
    protectedVerificationSessionId: state.verificationSessionId,
    healthPermissionStatus: state.healthPermissionStatus,
  };
}

export { isProtectedPrizeRace, isIntegrityCapabilityAvailable };
