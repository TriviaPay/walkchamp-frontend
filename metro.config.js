const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// react-native-iap creates _tmp_ directories during postinstall that Metro
// tries to watch before they're cleaned up, causing ENOENT crashes.
// Also skip heavy generated trees — watching them can hang Metro on Windows
// ("Failed to start watch mode" after the watcher timeout).
config.resolver = config.resolver ?? {};
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList) ? config.resolver.blockList : []),
  /react-native-iap_tmp_.*/,
  /[/\\]\.git[/\\]/,
  /[/\\]_originals[/\\]/,
  /[/\\]android[/\\].*[/\\]build[/\\]/,
  /[/\\]android[/\\]build[/\\]/,
  /[/\\]ios[/\\]build[/\\]/,
  /[/\\]\.gradle[/\\]/,
  /[/\\]\.cxx[/\\]/,
];

/**
 * Force livekit-client ESM instead of the UMD main entry.
 *
 * Hermes bug (facebook/hermes#2104 / livekit#1952): the UMD minifier reuses
 * `catch (e)` which shadows the module-namespace `e`. When negotiate() rejects
 * while aborting, `finally` reads `e.EngineEvent.Closing` against the Error and
 * throws: "Cannot read property 'Closing' of undefined".
 *
 * The ESM build keeps distinct identifiers and is safe on Hermes/RN.
 */
const livekitClientEsm = path.join(
  path.dirname(require.resolve("livekit-client/package.json")),
  "dist",
  "livekit-client.esm.mjs",
);

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "livekit-client") {
    return { type: "sourceFile", filePath: livekitClientEsm };
  }
  if (typeof upstreamResolveRequest === "function") {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

config.watcher = {
  ...(config.watcher ?? {}),
  healthCheck: {
    enabled: true,
    interval: 30000,
    timeout: 10000,
  },
};

module.exports = config;
