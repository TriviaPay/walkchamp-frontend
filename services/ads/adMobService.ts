/**
 * adMobService.ts — Centralized AdMob service for Walk Champ.
 *
 * Provides:
 *  • initializeAds()          — call once on app startup
 *  • preloadRewardedAd()      — preload a rewarded ad (call when Coins store opens)
 *  • showRewardedAdForCoins() — show rewarded ad; invokes onRewarded callback
 *
 * Banner ads are handled by the BannerAdView component directly.
 * Screen-switch interstitials have been removed.
 *
 * Safe in Expo Go (graceful no-op when the native module is unavailable).
 */

import { Platform } from "react-native";
import Constants from "expo-constants";

const ADS_ENABLED = process.env.EXPO_PUBLIC_ADS_ENABLED !== "false";

/**
 * In Expo Go, TurboModuleRegistry.getEnforcing() throws an Invariant Violation
 * at the native layer — before JavaScript try/catch can intercept it.
 * Skipping the require() entirely in Expo Go is the only safe guard.
 */
const IS_EXPO_GO = (Constants.executionEnvironment as string) === "storeClient";

const REWARDED_AD_UNIT_ID =
  Platform.select({
    ios:     "ca-app-pub-3940256099942544/1712485313",
    android: "ca-app-pub-3940256099942544/5224354917",
  }) ?? "ca-app-pub-3940256099942544/5224354917";

type AdMobModule = typeof import("react-native-google-mobile-ads");

interface RewardedAdHandle {
  load(): void;
  show(): Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addAdEventListener(event: string, handler: (...args: any[]) => void): () => void;
}

let _module: AdMobModule | null = null;

function getAdsModule(): AdMobModule | null {
  if (_module) return _module;
  if (IS_EXPO_GO) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-google-mobile-ads") as AdMobModule;
    if (!mod?.RewardedAd || !mod?.RewardedAdEventType || !mod?.AdEventType || !mod?.default) {
      if (__DEV__) console.warn("[AdMob] Native module loaded but bridge missing (Expo Go)");
      return null;
    }
    _module = mod;
    return _module;
  } catch {
    if (__DEV__) console.warn("[AdMob] Native module unavailable");
    return null;
  }
}

let _initialized = false;
let _rewarded: RewardedAdHandle | null = null;
let _rewardedLoaded = false;
let _rewardedShowing = false;

function _createAndLoadRewarded(): void {
  const mod = getAdsModule();
  if (!mod || _rewardedShowing || _rewarded) return;

  try {
    const ad = mod.RewardedAd.createForAdRequest(REWARDED_AD_UNIT_ID, {
      requestNonPersonalizedAdsOnly: true,
    });

    ad.addAdEventListener(mod.RewardedAdEventType.LOADED, () => {
      _rewardedLoaded = true;
      if (__DEV__) console.log("[AdMob] Rewarded ad loaded");
    });

    ad.addAdEventListener(mod.AdEventType.ERROR, () => {
      _rewardedLoaded = false;
      _rewarded = null;
    });

    ad.addAdEventListener(mod.AdEventType.CLOSED, () => {
      _rewardedShowing = false;
      _rewardedLoaded = false;
      _rewarded = null;
      setTimeout(_createAndLoadRewarded, 500);
    });

    ad.load();
    _rewarded = ad;
  } catch (e) {
    if (__DEV__) console.warn("[AdMob] createForAdRequest (rewarded) failed:", e);
  }
}

export async function initializeAds(): Promise<void> {
  if (!ADS_ENABLED || Platform.OS === "web") return;
  if (_initialized) return;

  const mod = getAdsModule();
  if (!mod) return;

  try {
    _initialized = true;
    await mod.default().initialize();
    if (__DEV__) console.log("[AdMob] SDK initialized");
    _createAndLoadRewarded();
  } catch (e) {
    _initialized = false;
    if (__DEV__) console.warn("[AdMob] Initialization failed:", e);
  }
}

export function preloadRewardedAd(): void {
  if (!ADS_ENABLED || !_initialized || _rewarded) return;
  _createAndLoadRewarded();
}

/** True only when the AdMob native module is fully bridged (not Expo Go). */
export function isNativeAdsAvailable(): boolean {
  return getAdsModule() !== null;
}

export function isRewardedAdReady(): boolean {
  return ADS_ENABLED && _initialized && _rewardedLoaded && !_rewardedShowing && !!_rewarded;
}

export type RewardedAdResult = "rewarded" | "not_loaded" | "skipped" | "error";

/**
 * Show a rewarded ad. Calls `onRewarded` only if the user watches the full ad.
 * Returns "rewarded" on success, "not_loaded" if no ad is ready,
 * "skipped" if the user closed early, or "error" on failure.
 */
export async function showRewardedAdForCoins(
  onRewarded: () => Promise<void>,
): Promise<RewardedAdResult> {
  if (!ADS_ENABLED || !_initialized) return "not_loaded";
  if (!_rewardedLoaded || _rewardedShowing || !_rewarded) return "not_loaded";

  const mod = getAdsModule();
  if (!mod) return "not_loaded";

  return new Promise<RewardedAdResult>((resolve) => {
    let earned = false;

    const offEarned = _rewarded!.addAdEventListener(
      mod.RewardedAdEventType.EARNED_REWARD,
      () => { earned = true; },
    );

    const offClosed = _rewarded!.addAdEventListener(
      mod.AdEventType.CLOSED,
      async () => {
        offEarned();
        offClosed();
        _rewardedShowing = false;
        _rewardedLoaded = false;
        _rewarded = null;
        setTimeout(_createAndLoadRewarded, 500);

        if (earned) {
          try {
            await onRewarded();
            resolve("rewarded");
          } catch {
            resolve("error");
          }
        } else {
          resolve("skipped");
        }
      },
    );

    _rewardedShowing = true;
    _rewardedLoaded = false;
    _rewarded!.show().catch(() => {
      offEarned();
      offClosed();
      _rewardedShowing = false;
      resolve("error");
    });
  });
}
