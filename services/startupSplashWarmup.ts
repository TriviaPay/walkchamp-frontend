/**
 * During the existing ~10s Lottie splash, warm critical first-screen data so
 * Walk paints from cache when the animation finishes.
 *
 * Fire-and-forget only — never blocks splash exit or changes Lottie timing.
 */

import { runCoalesced } from "@/utils/apiRequestCoordinator";
import { screenCache } from "@/utils/screenCache";
import { markHydrated, HYDRATION_KEYS } from "@/services/loginHydration";
import { authFetch, API_TIMEOUT_MS } from "@/utils/authFetch";
import { getTodayKey } from "@/utils/format";
import { store } from "@/store";
import { fetchCoinBalance } from "@/store/slices/coinsSlice";
import { fetchTrackThemes } from "@/store/slices/trackThemesSlice";

let lastWarmUserId: string | null = null;
let warmGen = 0;

/**
 * Start non-blocking warmup for the signed-in user while Lottie plays.
 * Safe to call multiple times — gen-guarded + coalesced GETs.
 */
export function warmCriticalDataDuringSplash(userId: string | null | undefined): void {
  if (!userId) return;
  lastWarmUserId = userId;
  const gen = ++warmGen;

  void store.dispatch(fetchCoinBalance()).then(() => {
    if (gen !== warmGen) return;
    markHydrated(HYDRATION_KEYS.coinBalance);
  });
  void store.dispatch(fetchTrackThemes()).then(() => {
    if (gen !== warmGen) return;
    markHydrated(HYDRATION_KEYS.trackThemes);
  });

  void runCoalesced(`startup_walk_today:${userId}`, async () => {
    if (gen !== warmGen) return;
    const localDate = getTodayKey();
    const res = await authFetch(`/api/walk/today?localDate=${encodeURIComponent(localDate)}`, {
      timeoutMs: Math.min(API_TIMEOUT_MS, 8_000),
    });
    if (!res.ok) return;
    const data = await res.json().catch(() => null);
    if (data && gen === warmGen) {
      await screenCache.set(`walk_today:${userId}:${localDate}`, data);
      markHydrated(`walk_today:${userId}`);
    }
  }).catch(() => undefined);
}

export function resetSplashWarmup(): void {
  lastWarmUserId = null;
  warmGen += 1;
}
