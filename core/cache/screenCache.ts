/**
 * Two-layer screen data cache: in-memory Map (sync, instant) + AsyncStorage (persists across app kills).
 *
 * Usage pattern — stale-while-revalidate:
 *   1. Initialize state with `screenCache.getSync(key) ?? []` → zero-flicker on tab revisit.
 *   2. On mount: call `screenCache.get(key)` → warms from disk if mem is cold (first launch).
 *   3. After a successful fetch: call `screenCache.set(key, freshData)` → writes both layers.
 *
 * CRITICAL: `set()` must not JSON.stringify on the caller's stack. Navigation taps that
 * seed cache (e.g. View Race) must return to `router.push` before disk serialization.
 *
 * Logout: `clearAll()` clears memory AND AsyncStorage entries tracked by this module so
 * a newly signed-in account never briefly sees the previous user's private screen data.
 */

import { storageGet, storageRemove, storageSet } from "@/utils/storage";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const mem = new Map<string, CacheEntry<unknown>>();
const knownKeys = new Set<string>();
const KEY_INDEX = "screen_cache_index_v1";

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

/** Pre-scoping private keys — always wipe on logout even if missing from the index. */
const LEGACY_PRIVATE_KEYS = [
  "screen_conversations",
  "screen_groups_overview",
  "screen:profile_me:v1",
] as const;

async function persistKeyIndex(): Promise<void> {
  try {
    await storageSet(KEY_INDEX, Array.from(knownKeys));
  } catch {
    /* best-effort */
  }
}

function rememberKey(key: string): void {
  if (knownKeys.has(key)) return;
  knownKeys.add(key);
  void persistKeyIndex();
}

async function loadKeyIndex(): Promise<void> {
  if (knownKeys.size > 0) return;
  const stored = await storageGet<string[]>(KEY_INDEX);
  if (!Array.isArray(stored)) return;
  for (const k of stored) {
    if (typeof k === "string" && k.length > 0) knownKeys.add(k);
  }
}

export function scopedScreenCacheKey(base: string, userId: string | null | undefined): string {
  return userId ? `${base}:${userId}` : base;
}

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
   * Sync memory-only write — no JSON.stringify / AsyncStorage.
   * Use before navigation so the destination can hydrate on first paint.
   */
  primeSync<T>(key: string, data: T): void {
    mem.set(key, { data, ts: Date.now() } as CacheEntry<unknown>);
    rememberKey(key);
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
    rememberKey(key);
    return stored.data;
  },

  /**
   * Write memory immediately; persist to disk only after yielding so callers
   * (router.push, first paint) are never blocked by JSON.stringify.
   */
  async set<T>(key: string, data: T): Promise<void> {
    const entry: CacheEntry<T> = { data, ts: Date.now() };
    mem.set(key, entry as CacheEntry<unknown>);
    rememberKey(key);
    // Yield to the event loop before stringify + AsyncStorage.
    await Promise.resolve();
    await storageSet(key, entry);
  },

  /** Evict a single key from memory and disk. */
  invalidate(key: string): void {
    mem.delete(key);
    knownKeys.delete(key);
    void storageRemove(key);
    void persistKeyIndex();
  },

  /**
   * Clear ALL entries from memory and AsyncStorage tracked by this cache.
   * Call on logout / definitive session expiry so the next user never sees
   * stale private data from a previous account.
   */
  async clearAll(): Promise<void> {
    mem.clear();
    await loadKeyIndex();
    const keys = Array.from(new Set([...knownKeys, ...LEGACY_PRIVATE_KEYS]));
    knownKeys.clear();
    try {
      if (keys.length > 0) await AsyncStorage.multiRemove(keys);
    } catch {
      await Promise.all(keys.map((k) => storageRemove(k)));
    }
    await storageRemove(KEY_INDEX);
  },
};
