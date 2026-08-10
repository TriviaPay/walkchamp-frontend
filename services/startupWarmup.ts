/**
 * Startup warmup — kick off SecureStore / profile cache reads during the font
 * gate and existing Lottie window so AuthProvider + first screens hit memory.
 *
 * Does NOT change splash duration or visual sequence.
 */

import { getStoredSession } from "@/services/authService";
import { storageGet, STORAGE_KEYS } from "@/utils/storage";
import type { UserProfile } from "@/store/types";

let userWarmPromise: Promise<UserProfile | null> | null = null;
let warmedUser: UserProfile | null | undefined = undefined;
let warmupStarted = false;

/**
 * Begin warming session tokens + cached profile as early as possible
 * (even before fonts finish / AuthProvider mounts).
 */
export function beginStartupWarmup(): void {
  if (warmupStarted) return;
  warmupStarted = true;

  // Warm SecureStore → memory (single-flight inside getStoredSession).
  void getStoredSession().catch(() => undefined);

  if (!userWarmPromise) {
    userWarmPromise = storageGet<UserProfile>(STORAGE_KEYS.USER)
      .then((u) => {
        warmedUser = u ?? null;
        return warmedUser;
      })
      .catch(() => {
        warmedUser = null;
        return null;
      });
  }
}

/** Prefer warmed profile; falls back to storage if warmup not finished. */
export async function getWarmedCachedUser(): Promise<UserProfile | null> {
  if (warmedUser !== undefined) return warmedUser;
  if (userWarmPromise) return userWarmPromise;
  beginStartupWarmup();
  return userWarmPromise ?? Promise.resolve(null);
}

export function clearStartupWarmup(): void {
  warmedUser = undefined;
  userWarmPromise = null;
  warmupStarted = false;
}
