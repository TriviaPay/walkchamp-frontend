const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// react-native-iap creates _tmp_ directories during postinstall that Metro
// tries to watch before they're cleaned up, causing ENOENT crashes.
// Block the pattern so Metro ignores them entirely.
config.resolver = config.resolver ?? {};
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList) ? config.resolver.blockList : []),
  /react-native-iap_tmp_.*/,
];

module.exports = config;
