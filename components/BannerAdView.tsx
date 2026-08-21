/**
 * BannerAdView — safe wrapper around react-native-google-mobile-ads BannerAd.
 *
 * • In a proper dev/production build: renders a real AdMob banner.
 * • In Expo Go or on web: renders a clearly-labelled placeholder so the
 *   layout is visible and the developer knows where the ad will appear.
 *
 * Slot chrome follows the in-app light/dark setting (not the OS scheme).
 */
import React, { memo } from "react";
import { Platform, Text, View } from "react-native";
import Constants from "expo-constants";
import { areAdsConfiguredForCurrentEnv, getBannerAdUnitId } from "@/config/adsConfig";
import { useColors } from "@/hooks/useColors";
import { rf } from "@/utils/responsive";

type AdModule = typeof import("react-native-google-mobile-ads");

const BANNER_AD_UNIT_ID = getBannerAdUnitId();

/** Standard AdMob banner height (320×50) on iOS and Android. */
export const BANNER_SLOT_HEIGHT = 50;

const isExpoGo: boolean =
  (Constants as unknown as { executionEnvironment?: string }).executionEnvironment === "storeClient";

function loadAdModule(): AdModule | null {
  if (Platform.OS === "web") return null;
  if (isExpoGo) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-google-mobile-ads") as AdModule;
    if (!mod?.BannerAd || !mod?.BannerAdSize) return null;
    return mod;
  } catch {
    return null;
  }
}

const adMod = loadAdModule();

function BannerAdView({ style }: { style?: object }) {
  const colors = useColors();
  const slotStyle = {
    alignItems: "center" as const,
    justifyContent: "center" as const,
    width: "100%" as const,
    height: BANNER_SLOT_HEIGHT,
    backgroundColor: colors.background,
    overflow: "hidden" as const,
  };

  if (adMod && !isExpoGo && BANNER_AD_UNIT_ID && areAdsConfiguredForCurrentEnv()) {
    const { BannerAd, BannerAdSize } = adMod;
    return (
      <View style={[slotStyle, style]} collapsable={false}>
        <BannerAd
          unitId={BANNER_AD_UNIT_ID}
          size={BannerAdSize.BANNER}
          requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        />
      </View>
    );
  }

  if (Platform.OS === "web") return null;

  return (
    <View
      style={[
        slotStyle,
        {
          borderWidth: 1,
          borderColor: colors.border,
          borderStyle: "dashed",
        },
        style,
      ]}
    >
      <Text style={{ color: colors.mutedForeground, fontSize: rf(10), fontWeight: "600", letterSpacing: 0.3 }}>
        Test ad · 320×50
      </Text>
    </View>
  );
}

export default memo(BannerAdView);
