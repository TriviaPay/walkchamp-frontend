const { withAppBuildGradle } = require("expo/config-plugins");

/**
 * Play Console App Optimization expects R8 + optimize rules so the AAB
 * includes mapping.txt and reports shrinking/obfuscation instead of "-".
 * Expo's template still references proguard-android.txt (no optimization).
 */
function withR8ReleaseOptimization(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") return cfg;
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /getDefaultProguardFile\(["']proguard-android\.txt["']\)/g,
      'getDefaultProguardFile("proguard-android-optimize.txt")',
    );
    return cfg;
  });
}

module.exports = withR8ReleaseOptimization;
