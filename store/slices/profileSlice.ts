import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";
import { fetchMe, checkUsernameAvailable } from "@/services/authService";
import type { UserProfile } from "@/store/types";
import { dbProfileToUserProfile } from "@/utils/profileMapper";

interface ProfileState {
  loading: boolean;
  usernameChecking: boolean;
  usernameAvailable: boolean | null;
  error: string | null;
}

const initialState: ProfileState = {
  loading: false,
  usernameChecking: false,
  usernameAvailable: null,
  error: null,
};

export const fetchProfile = createAsyncThunk(
  "profile/fetchMe",
  async (sessionJwt: string, { rejectWithValue }) => {
    try {
      const raw = await fetchMe(sessionJwt);
      if (!raw) return rejectWithValue("no_profile");
      return dbProfileToUserProfile(raw);
    } catch (err: unknown) {
      return rejectWithValue((err as Error).message ?? "fetch_failed");
    }
  },
);

export const checkUsername = createAsyncThunk(
  "profile/checkUsername",
  async (username: string, { rejectWithValue }) => {
    try {
      const result = await checkUsernameAvailable(username);
      return result.available;
    } catch {
      return rejectWithValue("check_failed");
    }
  },
);

const profileSlice = createSlice({
  name: "profile",
  initialState,
  reducers: {
    clearUsernameCheck(state) {
      state.usernameAvailable = null;
    },
    clearError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchProfile.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchProfile.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(fetchProfile.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(checkUsername.pending, (state) => {
        state.usernameChecking = true;
      })
      .addCase(checkUsername.fulfilled, (state, action) => {
        state.usernameChecking = false;
        state.usernameAvailable = action.payload;
      })
      .addCase(checkUsername.rejected, (state) => {
        state.usernameChecking = false;
        state.usernameAvailable = null;
      });
  },
});

export const profileActions = profileSlice.actions;
export default profileSlice.reducer;
