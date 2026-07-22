/**
 * Make Android dynamic launcher icons reliable:
 * - MainActivity must NOT be a LAUNCHER entry (OEM shortcuts pin MainActivity and ignore aliases).
 * - Default launcher is MainActivityWalkChampProgress0 (enabled).
 * - Other progress aliases stay disabled until selected.
 *
 * Runs after expo-alternate-app-icons / scheme plugins.
 */
const { withFinalizedMod, AndroidConfig } = require("@expo/config-plugins");
const path = require("path");

const PROGRESS_ALIASES = [
  "WalkChampProgress0",
  "WalkChampProgress25",
  "WalkChampProgress50",
  "WalkChampProgress75",
  "WalkChampProgress100",
];

function isLauncherFilter(filter) {
  const actions = (filter.action ?? []).map((a) => a.$?.["android:name"]);
  const categories = (filter.category ?? []).map((c) => c.$?.["android:name"]);
  return (
    actions.includes("android.intent.action.MAIN") &&
    categories.includes("android.intent.category.LAUNCHER")
  );
}

function applyLauncherAliasPattern(androidManifest) {
  const mainActivity =
    AndroidConfig.Manifest.getMainActivityOrThrow(androidManifest);
  const mainApplication =
    AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);

  // Strip LAUNCHER from MainActivity — keep VIEW / Health Connect filters.
  mainActivity["intent-filter"] = (mainActivity["intent-filter"] ?? []).filter(
    (f) => !isLauncherFilter(f),
  );

  const aliases = mainApplication["activity-alias"] ?? [];
  for (const alias of aliases) {
    const name = alias.$?.["android:name"] ?? "";
    const short = name.startsWith(".") ? name.slice(1) : name.split(".").pop();
    if (!short?.startsWith("MainActivityWalkChampProgress")) continue;

    const suffix = short.replace(/^MainActivity/, "");
    const isDefault = suffix === "WalkChampProgress0";
    alias.$["android:enabled"] = isDefault ? "true" : "false";
    alias.$["android:exported"] = "true";
    alias.$["android:targetActivity"] = ".MainActivity";

    // Ensure roundIcon matches icon so adaptive launchers refresh correctly.
    const snake = suffix
      .replace(/([A-Z])/g, "_$1")
      .replace(/^_/, "")
      .toLowerCase();
    const mipmap = `@mipmap/ic_launcher_${snake}`;
    alias.$["android:icon"] = mipmap;
    alias.$["android:roundIcon"] = mipmap;
  }

  // Ensure every progress alias exists (in case a prebuild dropped one).
  const existing = new Set(
    aliases.map((a) => {
      const n = a.$?.["android:name"] ?? "";
      return n.startsWith(".") ? n.slice(1) : n.split(".").pop();
    }),
  );

  for (const progress of PROGRESS_ALIASES) {
    const aliasName = `MainActivity${progress}`;
    if (existing.has(aliasName)) continue;
    const snake = progress
      .replace(/([A-Z])/g, "_$1")
      .replace(/^_/, "")
      .toLowerCase();
    const mipmap = `@mipmap/ic_launcher_${snake}`;
    aliases.push({
      $: {
        "android:name": `.${aliasName}`,
        "android:enabled": progress === "WalkChampProgress0" ? "true" : "false",
        "android:exported": "true",
        "android:icon": mipmap,
        "android:roundIcon": mipmap,
        "android:targetActivity": ".MainActivity",
      },
      "intent-filter": [
        {
          action: [{ $: { "android:name": "android.intent.action.MAIN" } }],
          category: [
            { $: { "android:name": "android.intent.category.LAUNCHER" } },
          ],
        },
      ],
    });
  }

  mainApplication["activity-alias"] = aliases;
  return androidManifest;
}

function withWalkChampLauncherAliases(config) {
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
        applyLauncherAliasPattern(androidManifest),
      );
      return cfg;
    },
  ]);
}

module.exports = withWalkChampLauncherAliases;
module.exports.applyLauncherAliasPattern = applyLauncherAliasPattern;
