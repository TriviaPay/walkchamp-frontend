/**
 * BannerAdView — safe wrapper around react-native-google-mobile-ads BannerAd.
 *
 * • In a proper dev/production build: renders a real AdMob banner.
 * • In Expo Go or on web: renders a clearly-labelled placeholder so the
 *   layout is visible and the developer knows where the ad will appear.
 */
import React from "react";
import { Platform, Text, View } from "react-native";
import Constants from "expo-constants";

type AdModule = typeof import("react-native-google-mobile-ads");

const BANNER_AD_UNIT_ID =
  Platform.select({
    ios:     "ca-app-pub-3940256099942544/2934735716",
    android: "ca-app-pub-3940256099942544/6300978111",
  }) ?? "ca-app-pub-3940256099942544/6300978111";

// Detect Expo Go (storeClient) FIRST — must be before loadAdModule runs.
// TurboModuleRegistry.getEnforcing throws immediately in Expo Go even inside try/catch.
const isExpoGo: boolean =
  (Constants as unknown as { executionEnvironment?: string }).executionEnvironment === "storeClient";

function loadAdModule(): AdModule | null {
  if (Platform.OS === "web") return null;
  // Guard before require() — TurboModuleRegistry.getEnforcing('RNGoogleMobileAdsModule')
  // throws synchronously in Expo Go, before the try/catch can intercept it.
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

export default function BannerAdView({ style }: { style?: object }) {
  if (adMod && !isExpoGo) {
    const { BannerAd, BannerAdSize } = adMod;
    return (
      <View style={[{ alignItems: "center", width: "100%" }, style]}>
        <BannerAd
          unitId={BANNER_AD_UNIT_ID}
          size={BannerAdSize.BANNER}
          requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        />
      </View>
    );
  }

  if (Platform.OS === "web") return null;

  // Expo Go or native module missing — show a dev-mode placeholder
  // so the layout is visible. This never appears in production builds.
  return (
    <View
      style={[
        {
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: 52,
          backgroundColor: "#1A1D2E",
          borderWidth: 1,
          borderColor: "#2A2D3E",
          borderStyle: "dashed",
        },
        style,
      ]}
    >
      <Text style={{ color: "#4B5563", fontSize: 11, fontWeight: "600", letterSpacing: 0.3 }}>
        📢 Ad banner · available in app build
      </Text>
    </View>
  );
}
