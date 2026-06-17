import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface LiveRace {
  id: string;
  title: string;
  participants: number;
  spectators: number;
  phase: string;
}

interface LiveState {
  liveRaces: LiveRace[];
  selectedLiveRaceId: string | null;
  loading: boolean;
  error: string | null;
}

const initialState: LiveState = {
  liveRaces: [],
  selectedLiveRaceId: null,
  loading: false,
  error: null,
};

const liveSlice = createSlice({
  name: "live",
  initialState,
  reducers: {
    setLiveRaces(state, action: PayloadAction<LiveRace[]>) {
      state.liveRaces = action.payload;
    },
    selectLiveRace(state, action: PayloadAction<string | null>) {
      state.selectedLiveRaceId = action.payload;
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
  },
});

export const liveActions = liveSlice.actions;
export default liveSlice.reducer;
