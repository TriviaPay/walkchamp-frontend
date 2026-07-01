const {
  requireOptionalNativeModule,
  requireNativeModule,
} = require("expo-modules-core");

/**
 * Never throw at import time — release APK/EAS builds must survive if the
 * native module is momentarily unavailable during bridge startup.
 */
function loadWalkChampRaceProgress() {
  try {
    return (
      requireOptionalNativeModule("WalkChampRaceProgress") ??
      requireNativeModule("WalkChampRaceProgress")
    );
  } catch {
    return null;
  }
}

module.exports = loadWalkChampRaceProgress();
