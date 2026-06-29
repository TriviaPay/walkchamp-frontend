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
      "android.permission.ACTIVITY_RECOGNITION",
      "android.permission.WAKE_LOCK",
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
            "android:enabled": "true",
            "android:exported": "false",
            "android:foregroundServiceType": "health",
            "android:stopWithTask": "false",
          },
        });
      } else {
        const svc = application.service.find(
          (s) => s.$?.["android:name"] === serviceName,
        );
        if (svc?.$) {
          svc.$["android:enabled"] = "true";
          svc.$["android:stopWithTask"] = "false";
          svc.$["android:foregroundServiceType"] = "health";
        }
      }
    }

    return cfg;
  });

  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.NSSupportsLiveActivities = true;
    if (!cfg.modResults.UIBackgroundModes) {
      cfg.modResults.UIBackgroundModes = [];
    }
    const modes = Array.isArray(cfg.modResults.UIBackgroundModes)
      ? cfg.modResults.UIBackgroundModes
      : [cfg.modResults.UIBackgroundModes];
    if (!modes.includes("fetch")) modes.push("fetch");
    cfg.modResults.UIBackgroundModes = modes;
    return cfg;
  });

  return config;
}

module.exports = withWalkChampRaceProgress;
