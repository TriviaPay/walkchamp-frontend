/**
 * Protected / prize-race verification types.
 * Matches backend protected-verification contract.
 * Frontend collects evidence; backend adjudicates settlement.
 */

export type PrizeVerificationPlatform = "android" | "ios";

export type ProtectedApprovedSource = "health_connect" | "healthkit";

export type ProtectedIntegrityProvider =
  | "android_play_integrity"
  | "ios_app_attest";

export type HealthPermissionStatus = "granted" | "revoked" | "denied";

export type PrizeApprovedSourceType = "native_phone";

export type PrizeVerificationStatus =
  | "idle"
  | "preflight"
  | "ready"
  | "live"
  | "result_pending_verification"
  | "reconciling"
  | "evidence_submitted"
  | "verified_clear_result"
  | "close_result_review"
  | "continuity_review"
  | "offline_review"
  | "source_review"
  | "integrity_review"
  | "review_required"
  | "finalized"
  | "voided"
  | "disqualified";

export type PrizeContinuityStatus =
  | "healthy"
  | "platform_failure"
  | "permission_lost"
  | "app_reinstalled"
  | "device_changed"
  | "source_changed"
  | "integrity_failed"
  | "verification_gap"
  | "unexplained_failure";

export type ContinuityFactCategory =
  | "PLATFORM_FAILURE"
  | "USER_CONTINUITY_BREACH"
  | "UNEXPLAINED_FAILURE"
  | "CONFIRMED_MANIPULATION"
  | "OFFLINE_POLICY_EXCEEDED"
  | "ACCOUNT_SWITCH"
  | "REBOOT_RECOVERY"
  | "SESSION_CONFLICT";

export type HealthEvidenceErrorKind =
  | "READY_NO_DATA"
  | "SYNC_DELAYED"
  | "PERMISSION_REQUIRED"
  | "SOURCE_NOT_APPROVED"
  | "INTEGRITY_UNAVAILABLE"
  | "NETWORK_OFFLINE"
  | "PLATFORM_ERROR"
  | "VERIFICATION_PENDING";

export type PrizeRaceReadiness = {
  eligible: boolean;
  sensorReady: boolean;
  healthPlatformReady: boolean;
  approvedSourceReady: boolean;
  registeredDeviceReady: boolean;
  integrityReady: boolean;
  connectivityReady: boolean;
  failureReason?: string;
  userMessage?: string;
};

export type OfflineEpisode = {
  disconnectedAt: string;
  reconnectedAt: string | null;
  durationMs: number;
};

export type ContinuityEvent = {
  at: string;
  category: ContinuityFactCategory;
  code: string;
  detail?: string;
};

export type ProtectedRaceLocalState = {
  raceId: string;
  participantId: string;
  verificationSessionId: string;
  registeredDeviceId: string;
  platform: PrizeVerificationPlatform;
  approvedSource: ProtectedApprovedSource;
  integrityProvider: ProtectedIntegrityProvider;
  serverStartAt?: string;
  serverEndAt?: string;
  preflightPassed: boolean;
  evidenceSubmitted: boolean;
  challengeId?: string | null;
  userId?: string;
};

export type ProtectedVerificationSession = {
  verificationSessionId: string;
  registeredDeviceId: string;
  approvedHealthPlatform: ProtectedApprovedSource;
  approvedSource: ProtectedApprovedSource;
  integrityProvider: ProtectedIntegrityProvider;
  challengeId: string;
  serverChallenge: string;
  expiresAt: string;
};

export type ProtectedSourceEvidence = {
  automaticRecordCount: number;
  manualEntryCount: number;
  sourceIds: string[];
  recordingMethods: string[];
};

export type QualifyingEvidenceSummary = {
  qualifyingSteps: number | null;
  verificationReadAt: string;
  errorKind: HealthEvidenceErrorKind | null;
  sourceEvidence: ProtectedSourceEvidence;
};

export type ProtectedIntegrityBinding = {
  provider: ProtectedIntegrityProvider;
  token: string;
  requestHash: string;
};

export type ProtectedPreflightPayload = {
  approvedSource: ProtectedApprovedSource;
  permissionStatus: HealthPermissionStatus;
  participantId: string;
  platform: PrizeVerificationPlatform;
  purpose: "preflight";
  raceId: string;
  registeredDeviceId: string;
  serverChallenge: string;
  verificationSessionId: string;
};

export type ProtectedFinalIntegrityPayload = {
  approvedSource: ProtectedApprovedSource;
  evidenceHash: string;
  participantId: string;
  provisionalSteps: number;
  qualifyingSteps: number;
  raceId: string;
  registeredDeviceId: string;
  serverChallenge: string;
  serverEndAt: string;
  serverStartAt: string;
  verificationReadAt: string;
  verificationSessionId: string;
};

export type ProtectedRaceFields = {
  protectedRace: boolean;
  protectionPolicyVersion: string | null;
  protectedDurationMinutes: number | null;
  serverEndAt: string | null;
  adjudicationStatus:
    | "pending_verification"
    | "reconciling"
    | "review_required"
    | "finalized"
    | "voided"
    | null;
  adjudicationReasonCodes: string[] | null;
  settlementStatus: string | null;
  voidedAt: string | null;
  voidReason: string | null;
};

/** @deprecated Use ProtectedVerificationSession */
export type VerificationSessionResponse = ProtectedVerificationSession;

/** Backend adjudication status strings. */
export type BackendPrizeAdjudicationStatus =
  | "PENDING_VERIFICATION"
  | "RECONCILING"
  | "REVIEW_REQUIRED"
  | "FINALIZED"
  | "VOIDED"
  | "DISQUALIFIED"
  | string;
