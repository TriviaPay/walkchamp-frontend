/**
 * Dynamic Expo config — wraps app.json and injects AdMob app IDs from env.
 * Production EAS must set EXPO_PUBLIC_ADMOB_ANDROID_APP_ID / EXPO_PUBLIC_ADMOB_IOS_APP_ID.
 * Local/dev falls back to Google sample IDs when unset.
 */

const appJson = require("./app.json");

const SAMPLE_ANDROID = "ca-app-pub-3940256099942544~3347511713";
const SAMPLE_IOS = "ca-app-pub-3940256099942544~1458002511";

function resolveAdMobAppIds() {
  const appEnv = (process.env.EXPO_PUBLIC_APP_ENV || "").toLowerCase();
  const android =
    (process.env.EXPO_PUBLIC_ADMOB_ANDROID_APP_ID || "").trim() ||
    (appEnv === "production" ? "" : SAMPLE_ANDROID);
  const ios =
    (process.env.EXPO_PUBLIC_ADMOB_IOS_APP_ID || "").trim() ||
    (appEnv === "production" ? "" : SAMPLE_IOS);

  // Plugin requires non-empty IDs at prebuild time. If production secrets are
  // missing during a dry config read, keep sample placeholders so tooling works;
  // EAS production builds must inject real IDs via env/secrets before prebuild.
  return {
    androidAppId: android || SAMPLE_ANDROID,
    iosAppId: ios || SAMPLE_IOS,
  };
}

function patchAdMobPlugin(plugins, androidAppId, iosAppId) {
  return (plugins || []).map((plugin) => {
    if (Array.isArray(plugin) && plugin[0] === "react-native-google-mobile-ads") {
      return [
        "react-native-google-mobile-ads",
        {
          ...(plugin[1] || {}),
          androidAppId,
          iosAppId,
        },
      ];
    }
    return plugin;
  });
}

module.exports = () => {
  const { androidAppId, iosAppId } = resolveAdMobAppIds();
  const expo = { ...appJson.expo };
  expo.plugins = patchAdMobPlugin(expo.plugins, androidAppId, iosAppId);
  expo.extra = {
    ...(expo.extra || {}),
    // Node evaluates this file during Gradle — `__DEV__` is not defined there.
    appEnv:
      process.env.EXPO_PUBLIC_APP_ENV ||
      (process.env.NODE_ENV === "production" ? "production" : "development"),
  };
  return { expo };
};
