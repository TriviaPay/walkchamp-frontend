import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type RacePhase = "idle" | "matchmaking" | "countdown" | "in_race" | "finished";

export interface RaceParticipant {
  id: string;
  username: string;
  countryFlag: string;
  avatarColor: string;
  raceSteps: number;
  isFinished: boolean;
  finishRank?: number;
  isUser?: boolean;
}

interface RacesState {
  racePhase: RacePhase;
  raceEntryFee: number;
  participants: RaceParticipant[];
  countdown: number;
  loading: boolean;
  error: string | null;
}

const initialState: RacesState = {
  racePhase: "idle",
  raceEntryFee: 0,
  participants: [],
  countdown: 0,
  loading: false,
  error: null,
};

const racesSlice = createSlice({
  name: "races",
  initialState,
  reducers: {
    setRacePhase(state, action: PayloadAction<RacePhase>) {
      state.racePhase = action.payload;
    },
    setEntryFee(state, action: PayloadAction<number>) {
      state.raceEntryFee = action.payload;
    },
    setParticipants(state, action: PayloadAction<RaceParticipant[]>) {
      state.participants = action.payload;
    },
    updateParticipant(state, action: PayloadAction<{ id: string; steps: number }>) {
      const p = state.participants.find((x) => x.id === action.payload.id);
      if (p) p.raceSteps = action.payload.steps;
    },
    setCountdown(state, action: PayloadAction<number>) {
      state.countdown = action.payload;
    },
    resetRace(state) {
      state.racePhase = "idle";
      state.participants = [];
      state.countdown = 0;
      state.error = null;
    },
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
  },
});

export const racesActions = racesSlice.actions;
export default racesSlice.reducer;
