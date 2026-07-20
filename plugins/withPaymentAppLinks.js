const {
  withPlugins,
  withEntitlementsPlist,
  withAndroidManifest,
  AndroidConfig,
} = require("@expo/config-plugins");

function hostFromEnvUrl(envKey, fallback) {
  const raw = process.env[envKey] ?? fallback;
  try {
    return new URL(raw.startsWith("http") ? raw : `https://${raw}`).hostname;
  } catch {
    return fallback;
  }
}

/**
 * Registers Universal Links (iOS) and App Links (Android) for wallet payment return.
 *
 * Hosts (from env at prebuild):
 *   EXPO_PUBLIC_WEB_URL      → walkchamp.app (marketing / preferred)
 *   EXPO_PUBLIC_API_URL host → api.walkchamp.miragaming.com (backend done page)
 *
 * Website team must host verification files on each host — see docs/STRIPE_RAZORPAY_SETUP.md
 */
function withPaymentAppLinks(config) {
  const webHost = hostFromEnvUrl("EXPO_PUBLIC_WEB_URL", "walkchamp.app");
  const apiHost = hostFromEnvUrl("EXPO_PUBLIC_API_URL", "api.walkchamp.miragaming.com");
  const hosts = [...new Set([webHost, apiHost].filter(Boolean))];

  config = withEntitlementsPlist(config, (cfg) => {
    const key = "com.apple.developer.associated-domains";
    const existing = cfg.modResults[key] ?? [];
    const applinks = hosts.map((h) => `applinks:${h}`);
    cfg.modResults[key] = [...new Set([...existing, ...applinks])];
    return cfg;
  });

  config = withPlugins(config, [
    (inner) => {
      return withAndroidManifest(inner, (cfg) => {
        const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
        const filters = mainActivity["intent-filter"] ?? [];

        for (const host of hosts) {
          filters.push({
            action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
            category: [
              { $: { "android:name": "android.intent.category.DEFAULT" } },
              { $: { "android:name": "android.intent.category.BROWSABLE" } },
            ],
            data: [
              { $: { "android:scheme": "https", "android:host": host, "android:pathPrefix": "/payment-complete" } },
              { $: { "android:scheme": "https", "android:host": host, "android:pathPrefix": "/api/wallet/deposit/done" } },
            ],
            $: { "android:autoVerify": "true" },
          });
        }

        mainActivity["intent-filter"] = filters;
        return cfg;
      });
    },
  ]);

  return config;
}

module.exports = withPaymentAppLinks;
