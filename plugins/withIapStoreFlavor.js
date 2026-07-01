const { withAppBuildGradle } = require("expo/config-plugins");

const IAP_STORE_STRATEGY = "missingDimensionStrategy 'store', 'play'";

/** react-native-iap ships amazon + play flavors; pick Google Play for EAS builds. */
function withIapStoreFlavor(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") return cfg;

    let contents = cfg.modResults.contents;
    if (!contents.includes(IAP_STORE_STRATEGY)) {
      const updated = contents.replace(
        /defaultConfig\s*\{/,
        `defaultConfig {\n        ${IAP_STORE_STRATEGY}`,
      );
      if (updated === contents) {
        throw new Error(
          "withIapStoreFlavor: could not find defaultConfig in android/app/build.gradle",
        );
      }
      contents = updated;
    }

    // Remove duplicate missingDimensionStrategy lines from older prebuilds.
    contents = contents.replace(
      /missingDimensionStrategy ["']store["'], ["']play["']\s*\n/g,
      "",
    );
    contents = contents.replace(
      /defaultConfig\s*\{/,
      `defaultConfig {\n        ${IAP_STORE_STRATEGY}`,
    );

    cfg.modResults.contents = contents;
    return cfg;
  });
}

module.exports = withIapStoreFlavor;
