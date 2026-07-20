/**
 * Two-layer screen data cache: in-memory Map (sync, instant) + AsyncStorage (persists across app kills).
 *
 * Usage pattern — stale-while-revalidate:
 *   1. Initialize state with `screenCache.getSync(key) ?? []` → zero-flicker on tab revisit.
 *   2. On mount: call `screenCache.get(key)` → warms from disk if mem is cold (first launch).
 *   3. After a successful fetch: call `screenCache.set(key, freshData)` → writes both layers.
 *
 * This gives three tiers of responsiveness:
 *   • Same session tab switch  → sync mem hit, data shown before paint.
 *   • App reopen (same session) → mem hit (process still alive).
 *   • App kill & reopen         → async disk read (~10–40 ms), shown before API responds.
 */

import { storageGet, storageSet } from "@/utils/storage";

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const mem = new Map<string, CacheEntry<unknown>>();

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

export const screenCache = {
  /**
   * Synchronous read from in-memory layer only.
   * Safe to call inside `useState(() => ...)` — zero async overhead.
   */
  getSync<T>(key: string, maxAgeMs = DEFAULT_MAX_AGE_MS): T | null {
    const entry = mem.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > maxAgeMs) return null;
    return entry.data as T;
  },

  /**
   * Async read — returns mem hit instantly, falls back to AsyncStorage disk cache.
   * Warms the in-memory layer from disk so subsequent getSync() calls hit the fast path.
   */
  async get<T>(key: string, maxAgeMs = DEFAULT_MAX_AGE_MS): Promise<T | null> {
    const memHit = this.getSync<T>(key, maxAgeMs);
    if (memHit !== null) return memHit;
    const stored = await storageGet<CacheEntry<T>>(key);
    if (!stored) return null;
    if (Date.now() - stored.ts > maxAgeMs) return null;
    mem.set(key, stored as CacheEntry<unknown>);
    return stored.data;
  },

  /**
   * Write to both in-memory layer and AsyncStorage.
   * Fire-and-forget: the AsyncStorage write is non-blocking.
   */
  async set<T>(key: string, data: T): Promise<void> {
    const entry: CacheEntry<T> = { data, ts: Date.now() };
    mem.set(key, entry as CacheEntry<unknown>);
    await storageSet(key, entry);
  },

  /** Evict a single key from both layers (e.g. on sign-out). */
  invalidate(key: string): void {
    mem.delete(key);
  },

  /**
   * Clear ALL entries from the in-memory layer.
   * Call on logout / definitive session expiry so the next user never sees
   * stale data from a previous session. AsyncStorage entries are left in
   * place — they will expire naturally after DEFAULT_MAX_AGE_MS (5 min).
   */
  clearAll(): void {
    mem.clear();
  },
};
