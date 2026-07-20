const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const IAP_KT = path.join(
  "node_modules",
  "react-native-iap",
  "android",
  "src",
  "play",
  "java",
  "com",
  "dooboolab",
  "rniap",
  "RNIapModule.kt",
);

const OLD = "val activity = currentActivity";
const FIXED = "val activity = reactApplicationContext.currentActivity";

/**
 * react-native-iap@12.16.4 uses `currentActivity` which is typed as Any? on RN 0.81+.
 * Kotlin compilePlayReleaseKotlin fails on EAS without this one-line fix.
 */
function withReactNativeIapKotlinFix(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const file = path.join(cfg.modRequest.projectRoot, IAP_KT);
      if (!fs.existsSync(file)) return cfg;

      const content = fs.readFileSync(file, "utf8");
      if (content.includes(OLD) && !content.includes(FIXED)) {
        fs.writeFileSync(file, content.replace(OLD, FIXED));
      }
      return cfg;
    },
  ]);
}

module.exports = withReactNativeIapKotlinFix;
