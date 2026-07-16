/**
 * Remote / local feature flags with safe defaults and TTL cache.
 * Falls back to compile-time env flags when remote config is unavailable.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiBase } from "@/utils/apiUrl";
import { ENABLE_CASH_CHALLENGES, FEATURE_FLAGS } from "@/config/featureFlags";
import { ADS_ENABLED } from "@/config/adsConfig";

const CACHE_KEY = "walkchamp_remote_feature_flags_v1";
const CACHE_TTL_MS = 5 * 60_000;

export type RemoteFeatureFlags = {
  cashFeatures: boolean;
  ads: boolean;
  healthConnectFallback: boolean;
  stripe: boolean;
  razorpay: boolean;
  sponsoredEvents: boolean;
  withdrawals: boolean;
  /** Backend PAYMENTS_LIVE_MODE — optional; ignored if absent. */
  paymentsLiveMode?: boolean;
  updatedAt: number;
};

const DEFAULTS: RemoteFeatureFlags = {
  cashFeatures: ENABLE_CASH_CHALLENGES,
  ads: ADS_ENABLED,
  healthConnectFallback: FEATURE_FLAGS.FALLBACK_ANDROID_PEDOMETER,
  stripe: true,
  razorpay: true,
  sponsoredEvents: true,
  withdrawals: true,
  paymentsLiveMode: undefined,
  updatedAt: 0,
};

let memoryCache: RemoteFeatureFlags | null = null;
let inflight: Promise<RemoteFeatureFlags> | null = null;

function mergeFlags(partial: Partial<RemoteFeatureFlags> | null | undefined): RemoteFeatureFlags {
  return {
    ...DEFAULTS,
    ...(partial ?? {}),
    updatedAt: Date.now(),
  };
}

async function readDiskCache(): Promise<RemoteFeatureFlags | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RemoteFeatureFlags;
    if (!parsed || typeof parsed !== "object") return null;
    return mergeFlags(parsed);
  } catch {
    return null;
  }
}

async function writeDiskCache(flags: RemoteFeatureFlags): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(flags));
  } catch {
    /* ignore */
  }
}

/**
 * Fetch remote flags from `/api/preferences/feature-flags` when available.
 * Unknown / failing endpoints keep last cache or safe defaults — never throws.
 */
export async function loadRemoteFeatureFlags(options?: {
  force?: boolean;
}): Promise<RemoteFeatureFlags> {
  if (!options?.force && memoryCache && Date.now() - memoryCache.updatedAt < CACHE_TTL_MS) {
    return memoryCache;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    const cached = memoryCache ?? (await readDiskCache());
    if (cached && !options?.force && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
      memoryCache = cached;
      return cached;
    }

    try {
      const base = getApiBase();
      if (!base) {
        memoryCache = mergeFlags(cached);
        return memoryCache;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6_000);
      const res = await fetch(`${base}/api/preferences/feature-flags`, {
        method: "GET",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);
      if (!res.ok) {
        memoryCache = mergeFlags(cached);
        return memoryCache;
      }
      const body = (await res.json()) as Partial<RemoteFeatureFlags>;
      memoryCache = mergeFlags({ ...cached, ...body });
      await writeDiskCache(memoryCache);
      return memoryCache;
    } catch {
      memoryCache = mergeFlags(cached);
      return memoryCache;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function getCachedFeatureFlags(): RemoteFeatureFlags {
  return memoryCache ?? DEFAULTS;
}

export function isRemoteFlagEnabled(key: keyof Omit<RemoteFeatureFlags, "updatedAt">): boolean {
  return Boolean(getCachedFeatureFlags()[key]);
}
