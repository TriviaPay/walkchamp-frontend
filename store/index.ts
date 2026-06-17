import { configureStore, combineReducers } from "@reduxjs/toolkit";
import type { UnknownAction } from "@reduxjs/toolkit";
import authReducer from "./slices/authSlice";
import profileReducer from "./slices/profileSlice";
import walkReducer from "./slices/walkSlice";
import racesReducer from "./slices/racesSlice";
import liveReducer from "./slices/liveSlice";
import chatReducer from "./slices/chatSlice";
import walletReducer from "./slices/walletSlice";
import coinsReducer from "./slices/coinsSlice";
import trackThemesReducer from "./slices/trackThemesSlice";

const appReducer = combineReducers({
  auth: authReducer,
  profile: profileReducer,
  walk: walkReducer,
  races: racesReducer,
  live: liveReducer,
  chat: chatReducer,
  wallet: walletReducer,
  coins: coinsReducer,
  trackThemes: trackThemesReducer,
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
