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
  | "ios_healthkit";

export interface RaceProgressState {
  userId: string | null;
  username: string | null;

  todaySteps: number;
  todayStepsLastUpdatedAt: string | null;

  activeRaceId: string | null;
  raceStartTime: string | null;
  raceStatus: RaceProgressStatus;

  raceSteps: number;
  raceStepsLastUpdatedAt: string | null;

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
}

const initialState: RaceProgressState = {
  userId: null,
  username: null,
  todaySteps: 0,
  todayStepsLastUpdatedAt: null,
  activeRaceId: null,
  raceStartTime: null,
  raceStatus: "idle",
  raceSteps: 0,
  raceStepsLastUpdatedAt: null,
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
};

function isStale(incoming: string | undefined, current: string | null): boolean {
  if (!incoming) return false;
  if (!current) return false;
  return new Date(incoming).getTime() < new Date(current).getTime();
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
      }>,
    ) {
      const boot = Math.max(0, action.payload.bootSteps ?? 0);
      state.activeRaceId = action.payload.raceId;
      state.raceStartTime = action.payload.raceStartTime;
      state.raceStatus = "active";
      state.userId = action.payload.userId;
      state.username = action.payload.username;
      state.goalSteps = action.payload.goalSteps;
      state.totalParticipants = action.payload.totalParticipants ?? state.totalParticipants;
      state.raceSteps = boot;
      state.raceStepsLastUpdatedAt = new Date().toISOString();
      state.rank = state.rank ?? 1;
      state.timeLeftSeconds = state.timeLeftSeconds ?? 0;
      state.syncError = null;
      if (__DEV__) {
        console.log(
          `[StepStore] setActiveRace raceId=${action.payload.raceId} bootSteps=${boot}`,
        );
      }
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
      state.raceStartTime = null;
      state.raceStatus = action.payload.status;
      state.raceSteps = 0;
      state.raceStepsLastUpdatedAt = null;
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
      }>,
    ) {
      const { todaySteps, raceSteps, stepSource, updatedAt } = action.payload;
      const ts = updatedAt ?? new Date().toISOString();

      if (todaySteps !== undefined) {
        if (!isStale(ts, state.todayStepsLastUpdatedAt)) {
          const next = Math.max(0, Math.floor(todaySteps));
          if (next >= state.todaySteps) {
            state.todaySteps = next;
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
            if (__DEV__) {
              console.log(
                `[StepStore] update source=${stepSource ?? state.stepSource} todaySteps=${state.todaySteps} raceSteps=${next} raceId=${state.activeRaceId} updatedAt=${ts}`,
              );
            }
          }
        }
      }

      if (stepSource) state.stepSource = stepSource;
    },

    updateFromBackend(
      state,
      action: PayloadAction<{
        raceSteps?: number;
        rank?: number;
        totalParticipants?: number;
        goalSteps?: number;
        timeLeftSeconds?: number;
        syncedAt?: string;
      }>,
    ) {
      const syncedAt = action.payload.syncedAt ?? new Date().toISOString();
      if (action.payload.raceSteps !== undefined) {
        state.raceSteps = Math.max(
          state.raceSteps,
          Math.max(0, Math.floor(action.payload.raceSteps)),
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
      state.todaySteps = Math.max(0, Math.floor(action.payload.todaySteps ?? 0));
      state.todayStepsLastUpdatedAt =
        action.payload.updatedAt ?? new Date().toISOString();
      if (__DEV__) {
        console.log(`[StepStore] resetDailyStepsForNewDay todaySteps=${state.todaySteps}`);
      }
    },
  },
});

export const raceProgressActions = raceProgressSlice.actions;
export default raceProgressSlice.reducer;
