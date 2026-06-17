import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type TrackingStatus = "idle" | "walking" | "paused" | "syncing";

interface WalkState {
  trackingStatus: TrackingStatus;
  todaySteps: number;
  weeklySteps: number;
  allTimeSteps: number;
  currentStreak: number;
  activeDurationMinutes: number;
  distance: number;
  calories: number;
  milestoneReached: number | null;
}

const initialState: WalkState = {
  trackingStatus: "idle",
  todaySteps: 0,
  weeklySteps: 0,
  allTimeSteps: 0,
  currentStreak: 0,
  activeDurationMinutes: 0,
  distance: 0,
  calories: 0,
  milestoneReached: null,
};

const walkSlice = createSlice({
  name: "walk",
  initialState,
  reducers: {
    setTrackingStatus(state, action: PayloadAction<TrackingStatus>) {
      state.trackingStatus = action.payload;
    },
    setTodaySteps(state, action: PayloadAction<number>) {
      state.todaySteps = action.payload;
    },
    setWeeklySteps(state, action: PayloadAction<number>) {
      state.weeklySteps = action.payload;
    },
    setAllTimeSteps(state, action: PayloadAction<number>) {
      state.allTimeSteps = action.payload;
    },
    setCurrentStreak(state, action: PayloadAction<number>) {
      state.currentStreak = action.payload;
    },
    setActiveDuration(state, action: PayloadAction<number>) {
      state.activeDurationMinutes = action.payload;
    },
    setDistance(state, action: PayloadAction<number>) {
      state.distance = action.payload;
    },
    setCalories(state, action: PayloadAction<number>) {
      state.calories = action.payload;
    },
    setMilestone(state, action: PayloadAction<number | null>) {
      state.milestoneReached = action.payload;
    },
  },
});

export const walkActions = walkSlice.actions;
export default walkSlice.reducer;
