/**
 * prizeVerification Redux slice — protected-race qualification state.
 * Separate from raceProgress (realtime walking / provisional progress).
 */

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type {
  ContinuityEvent,
  HealthPermissionStatus,
  OfflineEpisode,
  PrizeApprovedSourceType,
  PrizeContinuityStatus,
  PrizeVerificationPlatform,
  PrizeVerificationStatus,
  ProtectedApprovedSource,
  ProtectedIntegrityProvider,
} from "@/services/raceVerification/raceVerificationTypes";

export type PrizeVerificationState = {
  raceId: string | null;
  participantId: string | null;
  verificationSessionId: string | null;
  challengeId: string | null;
  platform: PrizeVerificationPlatform | null;
  serverStartAt: string | null;
  serverEndAt: string | null;
  serverChallenge: string | null;
  registeredDeviceId: string | null;
  approvedSource: ProtectedApprovedSource | null;
  approvedSourceId: string | null;
  approvedSourceType: PrizeApprovedSourceType | null;
  integrityProvider: ProtectedIntegrityProvider | null;
  preflightPassed: boolean;
  evidenceSubmitted: boolean;
  isSponsored: boolean;
  healthPermissionStatus: HealthPermissionStatus;
  provisionalSteps: number;
  qualifyingSteps: number | null;
  verificationStatus: PrizeVerificationStatus;
  continuityStatus: PrizeContinuityStatus;
  settlementStatus: string | null;
  offlineStartedAt: string | null;
  totalOfflineMs: number;
  continuousOfflineMs: number;
  lastEvidenceAttemptAt: string | null;
  lastHeartbeatAt: string | null;
  serverTimeOffsetMs: number;
  offlineEpisodes: OfflineEpisode[];
  continuityEvents: ContinuityEvent[];
  featureEnabled: boolean | null;
  lastAdjudicationStatus: string | null;
  lastFailureReason: string | null;
  lastErrorCode: string | null;
};

export const initialPrizeVerificationState: PrizeVerificationState = {
  raceId: null,
  participantId: null,
  verificationSessionId: null,
  challengeId: null,
  platform: null,
  serverStartAt: null,
  serverEndAt: null,
  serverChallenge: null,
  registeredDeviceId: null,
  approvedSource: null,
  approvedSourceId: null,
  approvedSourceType: null,
  integrityProvider: null,
  preflightPassed: false,
  evidenceSubmitted: false,
  isSponsored: false,
  healthPermissionStatus: "granted",
  provisionalSteps: 0,
  qualifyingSteps: null,
  verificationStatus: "idle",
  continuityStatus: "healthy",
  settlementStatus: null,
  offlineStartedAt: null,
  totalOfflineMs: 0,
  continuousOfflineMs: 0,
  lastEvidenceAttemptAt: null,
  lastHeartbeatAt: null,
  serverTimeOffsetMs: 0,
  offlineEpisodes: [],
  continuityEvents: [],
  featureEnabled: null,
  lastAdjudicationStatus: null,
  lastFailureReason: null,
  lastErrorCode: null,
};

const prizeVerificationSlice = createSlice({
  name: "prizeVerification",
  initialState: initialPrizeVerificationState,
  reducers: {
    reset() {
      return { ...initialPrizeVerificationState };
    },
    setFeatureEnabled(state, action: PayloadAction<boolean | null>) {
      state.featureEnabled = action.payload;
    },
    beginPreflight(
      state,
      action: PayloadAction<{
        raceId: string;
        platform: PrizeVerificationPlatform;
        isSponsored?: boolean;
      }>,
    ) {
      state.raceId = action.payload.raceId;
      state.platform = action.payload.platform;
      state.isSponsored = action.payload.isSponsored === true;
      state.verificationStatus = "preflight";
      state.preflightPassed = false;
      state.lastFailureReason = null;
      state.lastErrorCode = null;
    },
    setSession(
      state,
      action: PayloadAction<{
        raceId?: string | null;
        verificationSessionId: string;
        challengeId: string;
        serverChallenge: string;
        registeredDeviceId?: string | null;
        approvedSource?: ProtectedApprovedSource | null;
        integrityProvider?: ProtectedIntegrityProvider | null;
        participantId?: string | null;
        serverStartAt?: string | null;
        serverEndAt?: string | null;
      }>,
    ) {
      if (action.payload.raceId) {
        state.raceId = action.payload.raceId;
      }
      state.verificationSessionId = action.payload.verificationSessionId;
      state.challengeId = action.payload.challengeId;
      state.serverChallenge = action.payload.serverChallenge;
      if (action.payload.registeredDeviceId != null) {
        state.registeredDeviceId = action.payload.registeredDeviceId;
      }
      if (action.payload.approvedSource) {
        state.approvedSource = action.payload.approvedSource;
      }
      if (action.payload.integrityProvider) {
        state.integrityProvider = action.payload.integrityProvider;
      }
      if (action.payload.participantId) {
        state.participantId = action.payload.participantId;
      }
      if (action.payload.serverStartAt) {
        state.serverStartAt = action.payload.serverStartAt;
      }
      if (action.payload.serverEndAt) {
        state.serverEndAt = action.payload.serverEndAt;
      }
    },
    setApprovedSource(
      state,
      action: PayloadAction<{
        approvedSourceId?: string;
        approvedSource?: ProtectedApprovedSource;
        approvedSourceType?: PrizeApprovedSourceType;
      }>,
    ) {
      if (action.payload.approvedSourceId) {
        state.approvedSourceId = action.payload.approvedSourceId;
      }
      if (action.payload.approvedSource) {
        state.approvedSource = action.payload.approvedSource;
      }
      state.approvedSourceType =
        action.payload.approvedSourceType ?? "native_phone";
    },
    setPreflightPassed(state, action: PayloadAction<boolean>) {
      state.preflightPassed = action.payload;
      if (action.payload) state.verificationStatus = "ready";
    },
    setReady(state) {
      state.verificationStatus = "ready";
    },
    setLive(state) {
      state.verificationStatus = "live";
    },
    setServerWindow(
      state,
      action: PayloadAction<{
        serverStartAt?: string | null;
        serverEndAt?: string | null;
      }>,
    ) {
      if (action.payload.serverStartAt) {
        state.serverStartAt = action.payload.serverStartAt;
      }
      if (action.payload.serverEndAt) {
        state.serverEndAt = action.payload.serverEndAt;
      }
    },
    setHealthPermissionStatus(
      state,
      action: PayloadAction<HealthPermissionStatus>,
    ) {
      state.healthPermissionStatus = action.payload;
    },
    setProvisionalSteps(state, action: PayloadAction<number>) {
      state.provisionalSteps = Math.max(0, Math.floor(action.payload));
    },
    setQualifyingSteps(state, action: PayloadAction<number | null>) {
      state.qualifyingSteps =
        action.payload == null ? null : Math.max(0, Math.floor(action.payload));
    },
    setVerificationStatus(state, action: PayloadAction<PrizeVerificationStatus>) {
      state.verificationStatus = action.payload;
    },
    setContinuityStatus(state, action: PayloadAction<PrizeContinuityStatus>) {
      state.continuityStatus = action.payload;
    },
    appendContinuityEvent(state, action: PayloadAction<ContinuityEvent>) {
      state.continuityEvents.push(action.payload);
      if (state.continuityEvents.length > 40) {
        state.continuityEvents = state.continuityEvents.slice(-40);
      }
    },
    setOfflineSnapshot(
      state,
      action: PayloadAction<{
        offlineStartedAt: string | null;
        totalOfflineMs: number;
        continuousOfflineMs: number;
        episodes: OfflineEpisode[];
      }>,
    ) {
      state.offlineStartedAt = action.payload.offlineStartedAt;
      state.totalOfflineMs = action.payload.totalOfflineMs;
      state.continuousOfflineMs = action.payload.continuousOfflineMs;
      state.offlineEpisodes = action.payload.episodes;
    },
    markEvidenceAttempt(state, action: PayloadAction<string>) {
      state.lastEvidenceAttemptAt = action.payload;
    },
    markHeartbeat(state, action: PayloadAction<{ at: string; serverTime?: string }>) {
      state.lastHeartbeatAt = action.payload.at;
      if (action.payload.serverTime) {
        const server = Date.parse(action.payload.serverTime);
        const local = Date.parse(action.payload.at);
        if (Number.isFinite(server) && Number.isFinite(local)) {
          state.serverTimeOffsetMs = server - local;
        }
      }
    },
    applyAdjudication(
      state,
      action: PayloadAction<{
        status: PrizeVerificationStatus;
        raw?: string | null;
        settlementStatus?: string | null;
      }>,
    ) {
      state.verificationStatus = action.payload.status;
      state.lastAdjudicationStatus = action.payload.raw ?? null;
      if (action.payload.settlementStatus !== undefined) {
        state.settlementStatus = action.payload.settlementStatus;
      }
    },
    setEvidenceSubmitted(state, action: PayloadAction<boolean>) {
      state.evidenceSubmitted = action.payload;
      if (action.payload) state.verificationStatus = "evidence_submitted";
    },
    setFailureReason(state, action: PayloadAction<string | null>) {
      state.lastFailureReason = action.payload;
    },
    setLastErrorCode(state, action: PayloadAction<string | null>) {
      state.lastErrorCode = action.payload;
    },
    suspendForAccountSwitch(state) {
      if (state.verificationStatus === "idle") return;
      state.continuityEvents.push({
        at: new Date().toISOString(),
        category: "ACCOUNT_SWITCH",
        code: "account_switched",
      });
      state.continuityStatus = "verification_gap";
    },
  },
});

export const prizeVerificationActions = prizeVerificationSlice.actions;
export default prizeVerificationSlice.reducer;
