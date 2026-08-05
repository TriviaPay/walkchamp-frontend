const {
  withFinalizedMod,
  AndroidConfig,
} = require("@expo/config-plugins");
const path = require("path");

function isViewBrowsableFilter(filter) {
  const actions = (filter.action ?? []).map((a) => a.$?.["android:name"]);
  const categories = (filter.category ?? []).map((c) => c.$?.["android:name"]);
  return (
    actions.includes("android.intent.action.VIEW") &&
    categories.includes("android.intent.category.BROWSABLE")
  );
}

function splitMultiSchemeFilters(filters) {
  const split = [];
  for (const filter of filters) {
    const dataEls = Array.isArray(filter.data)
      ? filter.data
      : filter.data
        ? [filter.data]
        : [];
    const schemes = [
      ...new Set(
        dataEls
          .map((d) => d.$?.["android:scheme"])
          .filter((s) => typeof s === "string" && s.length > 0),
      ),
    ];

    if (schemes.length <= 1) {
      split.push(filter);
      continue;
    }

    const { data: _drop, ...base } = filter;
    for (const scheme of schemes) {
      split.push({
        ...base,
        data: [{ $: { "android:scheme": scheme } }],
      });
    }
  }
  return split;
}

function applySplitToManifest(androidManifest) {
  const mainActivity =
    AndroidConfig.Manifest.getMainActivityOrThrow(androidManifest);
  const mainApplication =
    AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);

  mainActivity["intent-filter"] = splitMultiSchemeFilters(
    mainActivity["intent-filter"] ?? [],
  );

  // Deep links MUST live only on MainActivity (singleTask). Mirroring VIEW /
  // BROWSABLE onto every progress launcher alias makes React Navigation /
  // expo-router think linking is configured in multiple places and can spawn
  // conflicting activity entries. Aliases keep MAIN/LAUNCHER only.
  const aliases = mainApplication["activity-alias"] ?? [];
  const targetActivity = mainActivity.$["android:name"];

  for (const alias of aliases) {
    if (alias.$?.["android:targetActivity"] !== targetActivity) continue;
    const name = alias.$?.["android:name"] ?? "";
    if (name.endsWith("ViewPermissionUsageActivity")) continue;

    const aliasFilters = alias["intent-filter"] ?? [];
    alias["intent-filter"] = aliasFilters.filter((f) => !isViewBrowsableFilter(f));
  }

  return androidManifest;
}

/**
 * Runs in the finalized mod phase (after expo-dev-client + alternate icons).
 * Splits combined scheme intent-filters on MainActivity and strips mirrored
 * deep-link VIEW filters from launcher activity-aliases.
 */
function withSplitSchemeIntentFilters(config) {
  return withFinalizedMod(config, [
    "android",
    async (cfg) => {
      const manifestPath = path.join(
        cfg.modRequest.platformProjectRoot,
        "app/src/main/AndroidManifest.xml",
      );
      const androidManifest =
        await AndroidConfig.Manifest.readAndroidManifestAsync(manifestPath);
      await AndroidConfig.Manifest.writeAndroidManifestAsync(
        manifestPath,
        applySplitToManifest(androidManifest),
      );
      return cfg;
    },
  ]);
}

module.exports = withSplitSchemeIntentFilters;
