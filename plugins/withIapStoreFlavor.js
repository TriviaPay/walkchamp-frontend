const { withAppBuildGradle } = require("expo/config-plugins");

const IAP_STORE_STRATEGY = "missingDimensionStrategy 'store', 'play'";

/** react-native-iap ships amazon + play flavors; pick Google Play for EAS builds. */
function withIapStoreFlavor(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") return cfg;
    if (cfg.modResults.contents.includes(IAP_STORE_STRATEGY)) return cfg;

    const updated = cfg.modResults.contents.replace(
      /defaultConfig\s*\{/,
      `defaultConfig {\n        ${IAP_STORE_STRATEGY}`,
    );

    if (updated === cfg.modResults.contents) {
      throw new Error(
        "withIapStoreFlavor: could not find defaultConfig in android/app/build.gradle",
      );
    }

    cfg.modResults.contents = updated;
    return cfg;
  });
}

module.exports = withIapStoreFlavor;
