/**
 * Login hydration coordination — Walk focus reuses fresh hydrated server state
 * instead of immediately re-fetching the same resources.
 */
const hydratedAt = new Map<string, number>();

export const HYDRATION_KEYS = {
  wallet: "wallet",
  leaderboard: "leaderboard",
  timezone: "timezone",
  trackThemes: "trackThemes",
  coinBalance: "coinBalance",
  profile: "profile",
} as const;

export type HydrationKey = (typeof HYDRATION_KEYS)[keyof typeof HYDRATION_KEYS] | string;

export function markHydrated(key: HydrationKey, at = Date.now()): void {
  hydratedAt.set(key, at);
}

export function wasHydratedRecently(key: HydrationKey, maxAgeMs: number): boolean {
  const at = hydratedAt.get(key);
  if (at == null) return false;
  return Date.now() - at < maxAgeMs;
}

export function clearHydrationMarks(): void {
  hydratedAt.clear();
}

export function getHydrationAgeMs(key: HydrationKey): number | null {
  const at = hydratedAt.get(key);
  if (at == null) return null;
  return Date.now() - at;
}
