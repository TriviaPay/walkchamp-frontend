/**
 * Lightweight API request coordination — debounce, in-flight dedup, TTL gates.
 * Event-driven paths (Pusher) remain primary; HTTP is fallback with throttles.
 */

const lastFetchAt = new Map<string, number>();
const inFlight = new Map<string, Promise<unknown>>();

export function apiFetchAllowed(
  key: string,
  minIntervalMs: number,
  options: { force?: boolean; forceMinGapMs?: number } = {},
): boolean {
  const now = Date.now();
  const last = lastFetchAt.get(key) ?? 0;
  const elapsed = now - last;
  if (options.force) {
    return elapsed >= (options.forceMinGapMs ?? 2_000);
  }
  return elapsed >= minIntervalMs;
}

export function markApiFetched(key: string): void {
  lastFetchAt.set(key, Date.now());
}

export function resetApiFetchGate(keyPrefix?: string): void {
  if (!keyPrefix) {
    lastFetchAt.clear();
    return;
  }
  for (const key of lastFetchAt.keys()) {
    if (key.startsWith(keyPrefix)) lastFetchAt.delete(key);
  }
}

/** Run at most one in-flight request per key; subsequent callers share the promise. */
export async function runCoalesced<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = fn().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounce rapid triggers (focus bursts, Pusher event storms). */
export function debounceKeyed(
  key: string,
  fn: () => void,
  delayMs: number,
): void {
  const prev = debounceTimers.get(key);
  if (prev) clearTimeout(prev);
  debounceTimers.set(
    key,
    setTimeout(() => {
      debounceTimers.delete(key);
      fn();
    }, delayMs),
  );
}

export function cancelDebounce(key: string): void {
  const prev = debounceTimers.get(key);
  if (prev) clearTimeout(prev);
  debounceTimers.delete(key);
}
