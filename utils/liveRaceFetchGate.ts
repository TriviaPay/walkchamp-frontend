/**
 * Per-key throttle for live-race HTTP refreshes (detail, comments bundle, etc.).
 * Prevents Pusher bursts and token-refresh effect churn from hammering the API.
 */

const lastFetchAt = new Map<string, number>();

export function liveRaceFetchAllowed(
  key: string,
  minIntervalMs: number,
  force = false,
): boolean {
  if (force) return true;
  const now = Date.now();
  const last = lastFetchAt.get(key) ?? 0;
  return now - last >= minIntervalMs;
}

export function markLiveRaceFetched(key: string): void {
  lastFetchAt.set(key, Date.now());
}

export function resetLiveRaceFetchGate(raceId?: string): void {
  if (raceId) {
    for (const key of lastFetchAt.keys()) {
      if (key.startsWith(`${raceId}:`)) lastFetchAt.delete(key);
    }
    return;
  }
  lastFetchAt.clear();
}
