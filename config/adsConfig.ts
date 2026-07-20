/**
 * AdMob unit / app IDs — driven by EXPO_PUBLIC_* env vars.
 * Google sample IDs are used only as local/dev fallbacks when env is unset.
 * Production EAS must supply real IDs (never sample ca-app-pub-3940256099942544…).
 */

import { Platform } from "react-native";
import { ADMOB_SAMPLE_APP_ID_PREFIX, isAdMobSampleId, isProductionAppEnv } from "@/config/env";

/** Google's documented sample / test units (safe for local, not for store). */
export const ADMOB_SAMPLE = {
  androidAppId: `${ADMOB_SAMPLE_APP_ID_PREFIX}~3347511713`,
  iosAppId: `${ADMOB_SAMPLE_APP_ID_PREFIX}~1458002511`,
  bannerAndroid: `${ADMOB_SAMPLE_APP_ID_PREFIX}/6300978111`,
  bannerIos: `${ADMOB_SAMPLE_APP_ID_PREFIX}/2934735716`,
  rewardedAndroid: `${ADMOB_SAMPLE_APP_ID_PREFIX}/5224354917`,
  rewardedIos: `${ADMOB_SAMPLE_APP_ID_PREFIX}/1712485313`,
  interstitialAndroid: `${ADMOB_SAMPLE_APP_ID_PREFIX}/1033173712`,
  interstitialIos: `${ADMOB_SAMPLE_APP_ID_PREFIX}/4411468910`,
} as const;

function pickEnv(...keys: string[]): string {
  for (const key of keys) {
    const v = (process.env[key] ?? "").trim();
    if (v) return v;
  }
  return "";
}

function withDevFallback(configured: string, sample: string): string {
  if (configured) return configured;
  // Never silently fall back to sample IDs in production builds.
  if (isProductionAppEnv()) return "";
  return sample;
}

export const ADS_ENABLED = process.env.EXPO_PUBLIC_ADS_ENABLED !== "false";

export function getAdMobAndroidAppId(): string {
  return withDevFallback(
    pickEnv("EXPO_PUBLIC_ADMOB_ANDROID_APP_ID"),
    ADMOB_SAMPLE.androidAppId,
  );
}

export function getAdMobIosAppId(): string {
  return withDevFallback(
    pickEnv("EXPO_PUBLIC_ADMOB_IOS_APP_ID"),
    ADMOB_SAMPLE.iosAppId,
  );
}

export function getBannerAdUnitId(): string {
  const configured =
    Platform.OS === "ios"
      ? pickEnv("EXPO_PUBLIC_ADMOB_IOS_BANNER_ID", "EXPO_PUBLIC_ADMOB_BANNER_ID")
      : pickEnv("EXPO_PUBLIC_ADMOB_ANDROID_BANNER_ID", "EXPO_PUBLIC_ADMOB_BANNER_ID");
  return withDevFallback(
    configured,
    Platform.OS === "ios" ? ADMOB_SAMPLE.bannerIos : ADMOB_SAMPLE.bannerAndroid,
  );
}

export function getRewardedAdUnitId(): string {
  const configured =
    Platform.OS === "ios"
      ? pickEnv("EXPO_PUBLIC_ADMOB_IOS_REWARDED_ID", "EXPO_PUBLIC_ADMOB_REWARDED_ID")
      : pickEnv("EXPO_PUBLIC_ADMOB_ANDROID_REWARDED_ID", "EXPO_PUBLIC_ADMOB_REWARDED_ID");
  return withDevFallback(
    configured,
    Platform.OS === "ios" ? ADMOB_SAMPLE.rewardedIos : ADMOB_SAMPLE.rewardedAndroid,
  );
}

export function getInterstitialAdUnitId(): string {
  const configured =
    Platform.OS === "ios"
      ? pickEnv(
          "EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_ID",
          "EXPO_PUBLIC_ADMOB_INTERSTITIAL_ID",
        )
      : pickEnv(
          "EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_ID",
          "EXPO_PUBLIC_ADMOB_INTERSTITIAL_ID",
        );
  return withDevFallback(
    configured,
    Platform.OS === "ios" ? ADMOB_SAMPLE.interstitialIos : ADMOB_SAMPLE.interstitialAndroid,
  );
}

/** Ads should not initialize in production when only sample IDs are present. */
export function areAdsConfiguredForCurrentEnv(): boolean {
  if (!ADS_ENABLED) return false;
  const banner = getBannerAdUnitId();
  const rewarded = getRewardedAdUnitId();
  if (!banner && !rewarded) return false;
  if (isProductionAppEnv() && (isAdMobSampleId(banner) || isAdMobSampleId(rewarded))) {
    return false;
  }
  return Boolean(banner || rewarded);
}
