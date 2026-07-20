import { configureStore, combineReducers } from "@reduxjs/toolkit";
import type { UnknownAction } from "@reduxjs/toolkit";
import authReducer from "./slices/authSlice";
import coinsReducer from "./slices/coinsSlice";
import trackThemesReducer from "./slices/trackThemesSlice";
import raceProgressReducer from "./slices/raceProgressSlice";

/**
 * Store of record for auth, coins, themes, and canonical step progress.
 * Legacy walk/races/live/chat/wallet/profile slices were unused by UI and removed.
 * See docs/STEP_SOURCE_OF_TRUTH.md.
 */
const appReducer = combineReducers({
  auth: authReducer,
  coins: coinsReducer,
  trackThemes: trackThemesReducer,
  raceProgress: raceProgressReducer,
});

type AppState = ReturnType<typeof appReducer>;

// When the user logs out, pass undefined so every slice returns its own
// initialState — cleanly wiping all user-specific data from memory.
function rootReducer(state: AppState | undefined, action: UnknownAction): AppState {
  if (
    action.type === "auth/localLogout" ||
    action.type === "auth/signOut/fulfilled"
  ) {
    return appReducer(undefined, action);
  }
  return appReducer(state, action);
}

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ["auth/restoreSession/fulfilled"],
      },
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
