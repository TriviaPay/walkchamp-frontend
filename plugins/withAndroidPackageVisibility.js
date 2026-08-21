const { withAndroidManifest } = require("@expo/config-plugins");

const HEALTH_CONNECT_PACKAGE = "com.google.android.apps.healthdata";
const SCHEMES = [
  "market",
  "healthconnect",
];

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function getQueriesBlock(manifest) {
  if (!manifest.queries || !Array.isArray(manifest.queries)) {
    manifest.queries = [{ package: [], intent: [] }];
  }
  if (manifest.queries.length === 0) {
    manifest.queries.push({ package: [], intent: [] });
  }
  const block = manifest.queries[0];
  block.package = ensureArray(block.package);
  block.intent = ensureArray(block.intent);
  return block;
}

function hasSchemeIntent(queries, scheme) {
  return queries.intent?.some((intent) => {
    const data = ensureArray(intent.data);
    return data.some((d) => d?.$?.["android:scheme"] === scheme);
  });
}

function withAndroidPackageVisibility(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const queries = getQueriesBlock(manifest);

    const hasHealthConnectPackage = queries.package.some(
      (entry) => entry?.$?.["android:name"] === HEALTH_CONNECT_PACKAGE,
    );
    if (!hasHealthConnectPackage) {
      queries.package.push({
        $: { "android:name": HEALTH_CONNECT_PACKAGE },
      });
    }

    for (const scheme of SCHEMES) {
      if (hasSchemeIntent(queries, scheme)) continue;
      queries.intent.push({
        action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
        data: [{ $: { "android:scheme": scheme } }],
      });
    }

    return cfg;
  });
}

module.exports = withAndroidPackageVisibility;
