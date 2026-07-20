const { withAndroidManifest } = require("@expo/config-plugins");

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

/** Expo manifest uses queries: ManifestQuery[] — not a plain object. */
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

/**
 * Health Connect manifest entries so Walk Champ appears in
 * Health Connect > App permissions (activity-alias + package visibility).
 */
function withHealthConnectManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const application = manifest.application?.[0];
    if (!application) return cfg;

    application["activity-alias"] = ensureArray(application["activity-alias"]);
    const hasAlias = application["activity-alias"].some(
      (a) => a.$?.["android:name"] === "ViewPermissionUsageActivity",
    );
    if (!hasAlias) {
      application["activity-alias"].push({
        $: {
          "android:name": "ViewPermissionUsageActivity",
          "android:exported": "true",
          "android:permission": "android.permission.START_VIEW_PERMISSION_USAGE",
          "android:targetActivity": ".MainActivity",
        },
        "intent-filter": [
          {
            action: [{ $: { "android:name": "android.intent.action.VIEW_PERMISSION_USAGE" } }],
            category: [{ $: { "android:name": "android.intent.category.HEALTH_PERMISSIONS" } }],
          },
        ],
      });
    }

    const queries = getQueriesBlock(manifest);

    const hasHcPackage = queries.package.some(
      (p) => p.$?.["android:name"] === "com.google.android.apps.healthdata",
    );
    if (!hasHcPackage) {
      queries.package.push({ $: { "android:name": "com.google.android.apps.healthdata" } });
    }

    const hasRationale = queries.intent.some((intent) =>
      intent.action?.some(
        (a) => a.$?.["android:name"] === "androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE",
      ),
    );
    if (!hasRationale) {
      queries.intent.push({
        action: [{ $: { "android:name": "androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" } }],
      });
    }

    return cfg;
  });
}

module.exports = withHealthConnectManifest;
