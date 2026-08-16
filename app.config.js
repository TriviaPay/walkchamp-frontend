/**
 * Dynamic Expo config — wraps app.json and injects AdMob app IDs from env.
 * Production EAS must set EXPO_PUBLIC_ADMOB_ANDROID_APP_ID / EXPO_PUBLIC_ADMOB_IOS_APP_ID.
 * Local/dev falls back to Google sample IDs when unset.
 */

const fs = require("fs");
const path = require("path");
const appJson = require("./app.json");

// Local `npx expo run:*` does not load EAS env. Second machines often lack
// gitignored `.env` — load it explicitly, then fall back to the public
// Descope project ID already committed in eas.json (safe to embed).
try {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
} catch {
  // dotenv optional — Expo CLI may already have injected EXPO_PUBLIC_*
}
if (!process.env.EXPO_PUBLIC_DESCOPE_PROJECT_ID) {
  try {
    const envPath = path.join(__dirname, ".env");
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*EXPO_PUBLIC_DESCOPE_PROJECT_ID\s*=\s*(.*)$/);
        if (m) {
          process.env.EXPO_PUBLIC_DESCOPE_PROJECT_ID = m[1]
            .trim()
            .replace(/^["']|["']$/g, "");
          break;
        }
      }
    }
  } catch {
    /* ignore */
  }
}

/** Public Descope project id (same as eas.json) — not a secret. */
const DESCOPE_PROJECT_ID_FALLBACK = "P3E9mQAxf0N6l75csydDy6kGeOPR";

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

function resolveDescopeProjectIdForExtra() {
  const fromEnv = (process.env.EXPO_PUBLIC_DESCOPE_PROJECT_ID || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  return fromEnv || DESCOPE_PROJECT_ID_FALLBACK;
}

module.exports = () => {
  const { androidAppId, iosAppId } = resolveAdMobAppIds();
  const expo = { ...appJson.expo };
  expo.plugins = patchAdMobPlugin(expo.plugins, androidAppId, iosAppId);
  const descopeProjectId = resolveDescopeProjectIdForExtra();

  expo.extra = {
    ...(expo.extra || {}),
    // Node evaluates this file during Gradle — `__DEV__` is not defined there.
    appEnv:
      process.env.EXPO_PUBLIC_APP_ENV ||
      (process.env.NODE_ENV === "production" ? "production" : "development"),
    // Always embed so second-machine APKs / offline installs still have auth.
    descopeProjectId,
    // Bake Unlimited flag into native extra so Live/Walk still work if Metro
    // env inlining misses EXPO_PUBLIC_ENABLE_UNLIMITED_GOAL at runtime.
    enableUnlimitedGoal:
      String(process.env.EXPO_PUBLIC_ENABLE_UNLIMITED_GOAL ?? "true")
        .trim()
        .toLowerCase() !== "false",
  };
  return { expo };
};
