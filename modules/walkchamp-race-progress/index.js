const {
  requireOptionalNativeModule,
} = require("expo-modules-core");

let cachedModule = undefined;

/**
 * Lazy load — never touch the native bridge at require() time (bridgeless RN 0.81).
 * Never call requireNativeModule: that throws JavaScriptContextHolder NPE while
 * Metro is reloading. Retry on each access until the module is actually there.
 */
function getWalkChampRaceProgress() {
  if (cachedModule) return cachedModule;
  try {
    cachedModule = requireOptionalNativeModule("WalkChampRaceProgress") ?? null;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

module.exports = new Proxy(
  {},
  {
    get(_target, prop) {
      try {
        const mod = getWalkChampRaceProgress();
        if (!mod || prop === "then") return undefined;
        const value = mod[prop];
        return typeof value === "function" ? value.bind(mod) : value;
      } catch {
        cachedModule = null;
        return undefined;
      }
    },
  },
);
