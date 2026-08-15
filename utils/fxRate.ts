/**
 * USD → INR display-rate provider.
 *
 * Purely a display convenience (rounding INR "≈" hints next to USD amounts for
 * Indian users) — never used for money movement, wallet balances, or payment math.
 * Actual charges always happen in the currency the backend quotes.
 *
 * Resolution order:
 *   1. In-memory cache (refreshed at most once per CACHE_TTL_MS).
 *   2. Cached value persisted on-device from the last successful live fetch.
 *   3. Live fetch from a free, no-key FX API (frankfurter.app).
 *   4. EXPO_PUBLIC_USD_TO_INR_RATE env override, if set.
 *   5. Hardcoded sane fallback so the UI never breaks or shows "undefined".
 */
import { storageGet, storageSet } from "@/utils/storage";

const CACHE_KEY = "walkchamp_usd_to_inr_rate_v1";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h — a display hint doesn't need to be live-live.
const FETCH_TIMEOUT_MS = 4000;

/** Last-resort constant, only used if no env override and the live fetch has never succeeded. */
const HARD_FALLBACK_RATE = Number(process.env.EXPO_PUBLIC_USD_TO_INR_RATE) > 0
  ? Number(process.env.EXPO_PUBLIC_USD_TO_INR_RATE)
  : 88;

interface CachedRate {
  rate: number;
  fetchedAt: number;
}

let memoryCache: CachedRate | null = null;
let inFlight: Promise<number> | null = null;

function isFresh(entry: CachedRate | null): entry is CachedRate {
  return !!entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

async function fetchLiveRate(): Promise<number | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=INR", {
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { rates?: { INR?: number } };
    const rate = data?.rates?.INR;
    if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) return rate;
    return null;
  } catch {
    return null;
  }
}

/**
 * Kick off (or join) a refresh of the USD→INR rate. Safe to call repeatedly
 * (e.g. on app start and on Walk-tab focus) — only fetches when the cache is stale.
 */
export async function ensureFxRateLoaded(): Promise<number> {
  if (isFresh(memoryCache)) return memoryCache.rate;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    if (!memoryCache) {
      const persisted = await storageGet<CachedRate>(CACHE_KEY);
      if (persisted && typeof persisted.rate === "number" && persisted.rate > 0) {
        memoryCache = persisted;
      }
    }
    const live = await fetchLiveRate();
    if (live) {
      memoryCache = { rate: live, fetchedAt: Date.now() };
      void storageSet(CACHE_KEY, memoryCache);
    } else if (!memoryCache) {
      // Never fetched successfully (fresh install, offline) — use the fallback but
      // don't persist it, so the next launch retries the live fetch.
      memoryCache = { rate: HARD_FALLBACK_RATE, fetchedAt: Date.now() };
    }
    return memoryCache.rate;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Synchronous getter for use inside render/format functions — always returns a usable number. */
export function getUsdToInrRateSync(): number {
  return memoryCache?.rate ?? HARD_FALLBACK_RATE;
}

/** Fire-and-forget refresh — call once near app start. */
export function primeFxRate(): void {
  void ensureFxRateLoaded();
}
