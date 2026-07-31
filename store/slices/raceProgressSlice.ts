import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type RaceProgressStatus =
  | "idle"
  | "waiting"
  | "active"
  | "finished"
  | "quit"
  | "cancelled";

export type StepProgressSource =
  | "health_connect"
  | "healthkit"
  | "sensor"
  | "backend"
  | "unknown"
  | "android_step_counter"
  | "android_health_connect"
  | "ios_healthkit"
  | "device_sensor";

export type DailyDisplaySource =
  | "health_connect"
  | "healthkit"
  | "sensor_estimate";

export type DailyVerificationStatus =
  | "verified"
  | "pending"
  | "delayed"
  | "temporarily_unavailable"
  | "unavailable";

export interface RaceProgressState {
  userId: string | null;
  username: string | null;

  /**
   * Display total = max(verifiedTodaySteps, provisionalSensorTodaySteps ?? 0).
   * Kept for backward-compatible UI; never treat as verified sync authority alone.
   */
  todaySteps: number;
  todayStepsLastUpdatedAt: string | null;

  /** Health Connect / HealthKit verified daily total (backend sync authority). */
  verifiedTodaySteps: number;
  verifiedTodayStepsAt: string | null;
  /** TYPE_STEP_COUNTER / CMPedometer estimate for responsive UI + tray only. */
  provisionalSensorTodaySteps: number | null;
  provisionalSensorTodayStepsAt: string | null;
  dailyDisplaySource: DailyDisplaySource;
  dailyVerificationStatus: DailyVerificationStatus;

  activeRaceId: string | null;
  /**
   * Optional second race (sponsored ↔ free/coins). Steps sync to both via
   * deviceTotalSteps; only activeRaceId owns the primary FGS / UI counter.
   */
  companionRaceId: string | null;
  /** Whether the primary FGS race is a sponsored event (notification title). */
  activeRaceIsSponsored: boolean;
  /** Whether the companion tray race is sponsored. */
  companionRaceIsSponsored: boolean;
  raceStartTime: string | null;
  raceStatus: RaceProgressStatus;

  /** Live race steps (sensor / pedometer) — provisional uploads. */
  raceSteps: number;
  raceStepsLastUpdatedAt: string | null;
  /** Last Health Connect / HealthKit race-window verification (null = not yet). */
  verifiedRaceSteps: number | null;
  verifiedRaceStepsAt: string | null;
  /**
   * @deprecated Local merge candidate only — NOT final authority.
   * Prefer backendReconciledSteps / finalAuthoritativeSteps.
   */
  reconciledRaceSteps: number;

  /** Backend-accepted provisional live race total. */
  backendAcceptedLiveSteps: number;
  /** Backend settlement/reconcile total when available. */
  backendReconciledSteps: number | null;
  reconciliationStatus:
    | "not_started"
    | "pending"
    | "verification_delayed"
    | "review_required"
    | "verification_rejected"
    | "finalized";
  finalAuthoritativeSteps: number | null;

  /** Live race tracking session — distinguishes restart/reboot/resume. */
  liveRaceSessionId: string | null;
  liveRaceSequence: number;

  rank: number | null;
  totalParticipants: number | null;
  goalSteps: number | null;
  timeLeftSeconds: number | null;

  stepSource: StepProgressSource;
  lastBackendSyncedAt: string | null;
  lastNotificationUpdatedAt: string | null;

  isSyncing: boolean;
  syncError: string | null;

  /** Last race steps shown on Walk tab after race ends */
  walkRaceStepsDisplay: number;
  /** User's daily step goal for notifications / progress UI */
  dailyGoal: number;
}

function recomputeDisplayToday(state: RaceProgressState): void {
  const verified = Math.max(0, Math.floor(state.verifiedTodaySteps));
  const provisional =
    state.provisionalSensorTodaySteps == null
      ? 0
      : Math.max(0, Math.floor(state.provisionalSensorTodaySteps));
  state.todaySteps = Math.max(verified, provisional);
  if (provisional > verified) {
    state.dailyDisplaySource = "sensor_estimate";
    if (state.dailyVerificationStatus === "verified") {
      state.dailyVerificationStatus = "delayed";
    }
  } else if (verified > 0) {
    state.dailyDisplaySource =
      state.stepSource === "healthkit" || state.stepSource === "ios_healthkit"
        ? "healthkit"
        : "health_connect";
    state.dailyVerificationStatus = "verified";
  }
}

const initialState: RaceProgressState = {
  userId: null,
  username: null,
  todaySteps: 0,
  todayStepsLastUpdatedAt: null,
  verifiedTodaySteps: 0,
  verifiedTodayStepsAt: null,
  provisionalSensorTodaySteps: null,
  provisionalSensorTodayStepsAt: null,
  dailyDisplaySource: "health_connect",
  dailyVerificationStatus: "pending",
  activeRaceId: null,
  companionRaceId: null,
  activeRaceIsSponsored: false,
  companionRaceIsSponsored: false,
  raceStartTime: null,
  raceStatus: "idle",
  raceSteps: 0,
  raceStepsLastUpdatedAt: null,
  verifiedRaceSteps: null,
  verifiedRaceStepsAt: null,
  reconciledRaceSteps: 0,
  backendAcceptedLiveSteps: 0,
  backendReconciledSteps: null,
  reconciliationStatus: "not_started",
  finalAuthoritativeSteps: null,
  liveRaceSessionId: null,
  liveRaceSequence: 0,
  rank: null,
  totalParticipants: null,
  goalSteps: null,
  timeLeftSeconds: null,
  stepSource: "unknown",
  lastBackendSyncedAt: null,
  lastNotificationUpdatedAt: null,
  isSyncing: false,
  syncError: null,
  walkRaceStepsDisplay: 0,
  dailyGoal: 10_000,
};

function isStale(incoming: string | undefined, current: string | null): boolean {
  if (!incoming) return false;
  if (!current) return false;
  return new Date(incoming).getTime() < new Date(current).getTime();
}

/** Sensor/pedometer sources must not overwrite the verified daily stepSource label. */
function treatStepSourceAsProvisionalOnly(source: StepProgressSource): boolean {
  return (
    source === "android_step_counter" ||
    source === "sensor" ||
    source === "device_sensor"
  );
}

const raceProgressSlice = createSlice({
  name: "raceProgress",
  initialState,
  reducers: {
    setUserContext(
      state,
      action: PayloadAction<{ userId: string | null; username?: string | null }>,
    ) {
      state.userId = action.payload.userId;
      if (action.payload.username !== undefined) {
        state.username = action.payload.username;
      }
    },

    setActiveRace(
      state,
      action: PayloadAction<{
        raceId: string;
        raceStartTime: string;
        userId: string;
        username: string;
        goalSteps: number;
        totalParticipants?: number;
        bootSteps?: number;
        /** When opening race B while race A is still active (sponsored dual). */
        preserveAsCompanion?: boolean;
        isSponsored?: boolean;
      }>,
    ) {
      const boot = Math.max(0, action.payload.bootSteps ?? 0);
      const prevActive = state.activeRaceId;
      const prevSponsored = state.activeRaceIsSponsored;
      if (
        action.payload.preserveAsCompanion &&
        prevActive &&
        prevActive !== action.payload.raceId
      ) {
        state.companionRaceId = prevActive;
        state.companionRaceIsSponsored = prevSponsored;
      } else if (state.companionRaceId === action.payload.raceId) {
        state.companionRaceId = null;
        state.companionRaceIsSponsored = false;
      }
      state.activeRaceId = action.payload.raceId;
      state.raceStartTime = action.payload.raceStartTime;
      state.raceStatus = "active";
      state.userId = action.payload.userId;
      state.username = action.payload.username;
      state.goalSteps = action.payload.goalSteps;
      state.totalParticipants = action.payload.totalParticipants ?? state.totalParticipants;
      // Same race re-hydrate (poll/focus) must not wipe higher local steps with API 0.
      const sameRace = prevActive === action.payload.raceId;
      const nextSteps = sameRace ? Math.max(state.raceSteps ?? 0, boot) : boot;
      state.raceSteps = nextSteps;
      state.raceStepsLastUpdatedAt = new Date().toISOString();
      state.verifiedRaceSteps = null;
      state.verifiedRaceStepsAt = null;
      state.reconciledRaceSteps = sameRace
        ? Math.max(state.reconciledRaceSteps ?? 0, nextSteps)
        : nextSteps;
      state.backendAcceptedLiveSteps = sameRace
        ? Math.max(state.backendAcceptedLiveSteps ?? 0, nextSteps)
        : nextSteps;
      state.backendReconciledSteps = null;
      state.reconciliationStatus = "not_started";
      state.finalAuthoritativeSteps = null;
      // New tracking session per race activation (≤64 chars; restart/reboot rotates).
      const reuseSession =
        prevActive === action.payload.raceId && state.liveRaceSessionId
          ? state.liveRaceSessionId.slice(0, 64)
          : null;
      if (reuseSession) {
        state.liveRaceSessionId = reuseSession;
        state.liveRaceSequence = state.liveRaceSequence;
      } else {
        // Inline mint — keep slice free of circular imports.
        const u = String(action.payload.userId ?? "u")
          .replace(/[^a-zA-Z0-9]/g, "")
          .slice(0, 8);
        const r = String(action.payload.raceId ?? "r")
          .replace(/[^a-zA-Z0-9]/g, "")
          .slice(0, 8);
        state.liveRaceSessionId =
          `s${u}${r}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(
            0,
            64,
          );
        state.liveRaceSequence = 0;
      }
      state.rank = state.rank ?? 1;
      state.timeLeftSeconds = state.timeLeftSeconds ?? 0;
      // Sticky sponsored: once true for this race, don't wipe to Live Race title on rejoin.
      state.activeRaceIsSponsored =
        action.payload.isSponsored === true ||
        (prevActive === action.payload.raceId && prevSponsored);
      state.syncError = null;
      if (__DEV__) {
        console.log(
          `[StepStore] setActiveRace raceId=${action.payload.raceId} bootSteps=${boot} companion=${state.companionRaceId ?? "none"}`,
        );
      }
    },

    setCompanionRaceId(state, action: PayloadAction<string | null>) {
      const id = action.payload;
      if (!id || id === state.activeRaceId) {
        state.companionRaceId = null;
        state.companionRaceIsSponsored = false;
        return;
      }
      state.companionRaceId = id;
    },

    setCompanionRaceMeta(
      state,
      action: PayloadAction<{ raceId: string; isSponsored?: boolean }>,
    ) {
      if (state.companionRaceId !== action.payload.raceId) return;
      state.companionRaceIsSponsored = action.payload.isSponsored === true;
    },

    clearActiveRace(
      state,
      action: PayloadAction<{ status: RaceProgressStatus; preserveWalkDisplay?: number }>,
    ) {
      if (
        action.payload.preserveWalkDisplay !== undefined &&
        action.payload.preserveWalkDisplay > 0
      ) {
        state.walkRaceStepsDisplay = action.payload.preserveWalkDisplay;
      }
      state.activeRaceId = null;
      state.companionRaceId = null;
      state.activeRaceIsSponsored = false;
      state.companionRaceIsSponsored = false;
      state.raceStartTime = null;
      state.raceStatus = action.payload.status;
      state.raceSteps = 0;
      state.raceStepsLastUpdatedAt = null;
      state.verifiedRaceSteps = null;
      state.verifiedRaceStepsAt = null;
      state.reconciledRaceSteps = 0;
      state.backendAcceptedLiveSteps = 0;
      state.backendReconciledSteps = null;
      state.reconciliationStatus = "not_started";
      state.finalAuthoritativeSteps = null;
      state.liveRaceSessionId = null;
      state.liveRaceSequence = 0;
      state.rank = null;
      state.totalParticipants = null;
      state.goalSteps = null;
      state.timeLeftSeconds = null;
      state.isSyncing = false;
      if (__DEV__) {
        console.log(`[StepStore] clearActiveRace status=${action.payload.status}`);
      }
    },

    updateFromDeviceSource(
      state,
      action: PayloadAction<{
        todaySteps?: number;
        raceSteps?: number;
        stepSource?: StepProgressSource;
        updatedAt?: string;
        /**
         * verified = Health Connect / HealthKit daily sync authority
         * provisional = sensor/pedometer display-only
         * auto = infer from stepSource (default)
         */
        dailyLane?: "verified" | "provisional" | "auto";
      }>,
    ) {
      const { todaySteps, raceSteps, stepSource, updatedAt } = action.payload;
      const ts = updatedAt ?? new Date().toISOString();
      const lane =
        action.payload.dailyLane ??
        (stepSource === "android_step_counter" ||
        stepSource === "sensor" ||
        stepSource === "device_sensor"
          ? "provisional"
          : "auto");

      if (todaySteps !== undefined) {
        if (!isStale(ts, state.todayStepsLastUpdatedAt)) {
          const next = Math.max(0, Math.floor(todaySteps));
          const treatProvisional =
            lane === "provisional" ||
            (lane === "auto" &&
              (stepSource === "android_step_counter" ||
                stepSource === "sensor" ||
                stepSource === "device_sensor"));
          const treatVerified =
            lane === "verified" ||
            (lane === "auto" &&
              (stepSource === "health_connect" ||
                stepSource === "android_health_connect" ||
                stepSource === "healthkit" ||
                stepSource === "ios_healthkit"));

          if (treatProvisional) {
            const prev =
              state.provisionalSensorTodaySteps == null
                ? 0
                : state.provisionalSensorTodaySteps;
            if (next >= prev) {
              state.provisionalSensorTodaySteps = next;
              state.provisionalSensorTodayStepsAt = ts;
              state.todayStepsLastUpdatedAt = ts;
              recomputeDisplayToday(state);
            }
          } else if (treatVerified) {
            if (next >= state.verifiedTodaySteps) {
              state.verifiedTodaySteps = next;
              state.verifiedTodayStepsAt = ts;
              state.todayStepsLastUpdatedAt = ts;
              if (stepSource) state.stepSource = stepSource;
              recomputeDisplayToday(state);
            }
          } else if (next >= state.todaySteps) {
            // Legacy / unknown — keep prior monotonic todaySteps behavior.
            state.todaySteps = next;
            state.verifiedTodaySteps = Math.max(state.verifiedTodaySteps, next);
            state.todayStepsLastUpdatedAt = ts;
          }
        }
      }

      if (
        raceSteps !== undefined &&
        state.raceStatus === "active" &&
        state.activeRaceId
      ) {
        if (!isStale(ts, state.raceStepsLastUpdatedAt)) {
          const next = Math.max(0, Math.floor(raceSteps));
          if (next >= state.raceSteps) {
            state.raceSteps = next;
            state.raceStepsLastUpdatedAt = ts;
            // Local live candidate only — verification/finalize stay separate.
            state.reconciledRaceSteps = Math.max(state.reconciledRaceSteps, next);
            if (__DEV__) {
              console.log(
                `[StepStore] update source=${stepSource ?? state.stepSource} todaySteps=${state.todaySteps} raceSteps=${next} raceId=${state.activeRaceId} updatedAt=${ts}`,
              );
            }
          }
        }
      }

      if (stepSource && !treatStepSourceAsProvisionalOnly(stepSource)) {
        state.stepSource = stepSource;
      }
    },

    setVerifiedRaceSteps(
      state,
      action: PayloadAction<{ steps: number; verifiedAt?: string }>,
    ) {
      const next = Math.max(0, Math.floor(action.payload.steps));
      state.verifiedRaceSteps = next;
      state.verifiedRaceStepsAt =
        action.payload.verifiedAt ?? new Date().toISOString();
      // Verification is independent — do NOT promote to final authority via max().
      if (state.reconciliationStatus === "not_started") {
        state.reconciliationStatus = "pending";
      }
    },

    setBackendReconciliation(
      state,
      action: PayloadAction<{
        status:
          | "not_started"
          | "pending"
          | "verification_delayed"
          | "review_required"
          | "verification_rejected"
          | "finalized";
        backendAcceptedLiveSteps?: number;
        backendReconciledSteps?: number | null;
        finalAuthoritativeSteps?: number | null;
      }>,
    ) {
      state.reconciliationStatus = action.payload.status;
      if (action.payload.backendAcceptedLiveSteps !== undefined) {
        state.backendAcceptedLiveSteps = Math.max(
          0,
          Math.floor(action.payload.backendAcceptedLiveSteps),
        );
      }
      if (action.payload.backendReconciledSteps !== undefined) {
        state.backendReconciledSteps =
          action.payload.backendReconciledSteps == null
            ? null
            : Math.max(0, Math.floor(action.payload.backendReconciledSteps));
      }
      if (action.payload.finalAuthoritativeSteps !== undefined) {
        state.finalAuthoritativeSteps =
          action.payload.finalAuthoritativeSteps == null
            ? null
            : Math.max(0, Math.floor(action.payload.finalAuthoritativeSteps));
      } else if (
        action.payload.status === "finalized" &&
        state.backendReconciledSteps != null
      ) {
        state.finalAuthoritativeSteps = state.backendReconciledSteps;
      }
    },

    bumpLiveRaceSequence(state) {
      state.liveRaceSequence = Math.max(0, state.liveRaceSequence) + 1;
    },

    replaceLiveRaceSession(
      state,
      action: PayloadAction<{ sessionId: string; reason?: string }>,
    ) {
      state.liveRaceSessionId = String(action.payload.sessionId).slice(0, 64);
      state.liveRaceSequence = 0;
      if (__DEV__) {
        console.log(
          `[StepStore] replaceLiveRaceSession id=${action.payload.sessionId} reason=${action.payload.reason ?? "n/a"}`,
        );
      }
    },

    updateFromBackend(
      state,
      action: PayloadAction<{
        raceSteps?: number;
        rank?: number;
        totalParticipants?: number;
        goalSteps?: number;
        timeLeftSeconds?: number;
        /** Sticky true once known — never demote Sponsored → Live via an omit/false update. */
        isSponsored?: boolean;
        syncedAt?: string;
      }>,
    ) {
      const syncedAt = action.payload.syncedAt ?? new Date().toISOString();
      if (action.payload.raceSteps !== undefined) {
        const accepted = Math.max(0, Math.floor(action.payload.raceSteps));
        state.raceSteps = Math.max(state.raceSteps, accepted);
        state.backendAcceptedLiveSteps = Math.max(
          state.backendAcceptedLiveSteps,
          accepted,
        );
        // Local merge candidate only — never treat as finalized authority.
        state.reconciledRaceSteps = Math.max(
          state.reconciledRaceSteps,
          state.backendAcceptedLiveSteps,
        );
      }
      if (action.payload.rank !== undefined) state.rank = action.payload.rank;
      if (action.payload.totalParticipants !== undefined) {
        state.totalParticipants = action.payload.totalParticipants;
      }
      if (action.payload.goalSteps !== undefined) {
        state.goalSteps = action.payload.goalSteps;
      }
      if (action.payload.timeLeftSeconds !== undefined) {
        state.timeLeftSeconds = action.payload.timeLeftSeconds;
      }
      if (action.payload.isSponsored === true) {
        state.activeRaceIsSponsored = true;
      }
      state.lastBackendSyncedAt = syncedAt;
      state.isSyncing = false;
      state.syncError = null;
      if (__DEV__) {
        console.log(
          `[RaceSync] response rank=${state.rank} total=${state.totalParticipants} raceSteps=${state.raceSteps}`,
        );
      }
    },

    setWalkRaceStepsDisplay(state, action: PayloadAction<number>) {
      const safe = Math.max(0, Math.floor(action.payload));
      if (safe > 0) state.walkRaceStepsDisplay = safe;
    },

    setDailyGoal(state, action: PayloadAction<number>) {
      const goal = Math.floor(action.payload);
      state.dailyGoal = goal > 0 ? goal : 10_000;
    },

    setSyncing(state, action: PayloadAction<boolean>) {
      state.isSyncing = action.payload;
    },

    setSyncError(state, action: PayloadAction<string | null>) {
      state.syncError = action.payload;
      state.isSyncing = false;
    },

    markNotificationUpdated(state, action: PayloadAction<string | undefined>) {
      state.lastNotificationUpdatedAt =
        action.payload ?? new Date().toISOString();
    },

    resetRaceStepBuffer(state) {
      state.raceSteps = 0;
      state.raceStepsLastUpdatedAt = null;
      state.verifiedRaceSteps = null;
      state.verifiedRaceStepsAt = null;
      state.reconciledRaceSteps = 0;
      state.backendAcceptedLiveSteps = 0;
      state.backendReconciledSteps = null;
      state.reconciliationStatus = "not_started";
      state.finalAuthoritativeSteps = null;
      state.liveRaceSessionId = null;
      state.liveRaceSequence = 0;
      state.walkRaceStepsDisplay = 0;
    },

    hydrateRaceSteps(
      state,
      action: PayloadAction<{ raceSteps: number; updatedAt?: string }>,
    ) {
      if (state.raceStatus !== "active" || !state.activeRaceId) return;
      const ts = action.payload.updatedAt ?? new Date().toISOString();
      if (isStale(ts, state.raceStepsLastUpdatedAt)) return;
      const next = Math.max(state.raceSteps, Math.max(0, action.payload.raceSteps));
      state.raceSteps = next;
      state.raceStepsLastUpdatedAt = ts;
    },

    /** Force daily step count down on local-midnight rollover (bypasses monotonic guard). */
    resetDailyStepsForNewDay(
      state,
      action: PayloadAction<{ todaySteps?: number; updatedAt?: string }>,
    ) {
      const next = Math.max(0, Math.floor(action.payload.todaySteps ?? 0));
      const ts = action.payload.updatedAt ?? new Date().toISOString();
      state.verifiedTodaySteps = next;
      state.verifiedTodayStepsAt = ts;
      state.provisionalSensorTodaySteps = null;
      state.provisionalSensorTodayStepsAt = null;
      state.todaySteps = next;
      state.todayStepsLastUpdatedAt = ts;
      state.dailyDisplaySource =
        state.stepSource === "healthkit" || state.stepSource === "ios_healthkit"
          ? "healthkit"
          : "health_connect";
      state.dailyVerificationStatus = next > 0 ? "verified" : "pending";
      if (__DEV__) {
        console.log(`[StepStore] resetDailyStepsForNewDay todaySteps=${state.todaySteps}`);
      }
    },

    resetStepStateForLogout(state) {
      Object.assign(state, initialState);
    },

    initializeStepsForUserDate(
      state,
      action: PayloadAction<{
        userId: string;
        username?: string | null;
        localDate: string;
        bootTodaySteps?: number;
      }>,
    ) {
      state.userId = action.payload.userId;
      if (action.payload.username !== undefined) {
        state.username = action.payload.username;
      }
      const boot = Math.max(0, Math.floor(action.payload.bootTodaySteps ?? 0));
      state.verifiedTodaySteps = Math.max(state.verifiedTodaySteps, boot);
      state.verifiedTodayStepsAt = new Date().toISOString();
      recomputeDisplayToday(state);
      state.todayStepsLastUpdatedAt = new Date().toISOString();
      if (__DEV__) {
        console.log(
          `[StepStore] initializeStepsForUserDate userId=${action.payload.userId} localDate=${action.payload.localDate} bootTodaySteps=${boot}`,
        );
      }
    },

    setStepBaseline(
      _state,
      action: PayloadAction<{ userId: string; localDate: string; baseline: number }>,
    ) {
      if (__DEV__) {
        console.log(
          `[StepBaseline] userId=${action.payload.userId} localDate=${action.payload.localDate} baseline=${action.payload.baseline}`,
        );
      }
    },

    clearRaceStepStateForAccountSwitch(state) {
      state.activeRaceId = null;
      state.companionRaceId = null;
      state.activeRaceIsSponsored = false;
      state.companionRaceIsSponsored = false;
      state.raceStartTime = null;
      state.raceStatus = "idle";
      state.raceSteps = 0;
      state.raceStepsLastUpdatedAt = null;
      state.verifiedRaceSteps = null;
      state.verifiedRaceStepsAt = null;
      state.reconciledRaceSteps = 0;
      state.backendAcceptedLiveSteps = 0;
      state.backendReconciledSteps = null;
      state.reconciliationStatus = "not_started";
      state.finalAuthoritativeSteps = null;
      state.liveRaceSessionId = null;
      state.liveRaceSequence = 0;
      state.rank = null;
      state.totalParticipants = null;
      state.goalSteps = null;
      state.timeLeftSeconds = null;
      state.walkRaceStepsDisplay = 0;
      state.isSyncing = false;
      state.syncError = null;
    },
  },
});

export const raceProgressActions = raceProgressSlice.actions;
export default raceProgressSlice.reducer;
