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

config.watcher = {
  ...(config.watcher ?? {}),
  healthCheck: {
    enabled: true,
    interval: 30000,
    timeout: 10000,
  },
};

module.exports = config;
