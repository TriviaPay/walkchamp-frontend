const {
  requireOptionalNativeModule,
  requireNativeModule,
} = require("expo-modules-core");

let cachedModule = undefined;
let loadAttempted = false;

/**
 * Lazy load — never touch the native bridge at require() time (bridgeless RN 0.81).
 */
function getWalkChampRaceProgress() {
  if (loadAttempted) return cachedModule ?? null;
  loadAttempted = true;
  try {
    cachedModule =
      requireOptionalNativeModule("WalkChampRaceProgress") ??
      requireNativeModule("WalkChampRaceProgress");
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

module.exports = new Proxy(
  {},
  {
    get(_target, prop) {
      const mod = getWalkChampRaceProgress();
      if (!mod || prop === "then") return undefined;
      const value = mod[prop];
      return typeof value === "function" ? value.bind(mod) : value;
    },
  },
);
