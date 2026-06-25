const { withAndroidManifest, withInfoPlist } = require("@expo/config-plugins");

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

/**
 * Registers Walk Champ foreground service (Android) and Live Activities (iOS)
 * for persistent walk-step and live-race progress notifications.
 */
function withWalkChampRaceProgress(config) {
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    manifest["uses-permission"] = ensureArray(manifest["uses-permission"]);
    const permissions = [
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_HEALTH",
      "android.permission.POST_NOTIFICATIONS",
    ];
    for (const name of permissions) {
      const exists = manifest["uses-permission"].some(
        (p) => p.$?.["android:name"] === name,
      );
      if (!exists) {
        manifest["uses-permission"].push({ $: { "android:name": name } });
      }
    }

    const application = manifest.application?.[0];
    if (application) {
      application.service = ensureArray(application.service);
      const serviceName =
        "com.globalwalkerleague.walkchampraceprogress.WalkChampRaceForegroundService";
      const hasService = application.service.some(
        (s) => s.$?.["android:name"] === serviceName,
      );
      if (!hasService) {
        application.service.push({
          $: {
            "android:name": serviceName,
            "android:exported": "false",
            "android:foregroundServiceType": "health",
          },
        });
      }
    }

    return cfg;
  });

  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.NSSupportsLiveActivities = true;
    return cfg;
  });

  return config;
}

module.exports = withWalkChampRaceProgress;
