const {
  withAndroidManifest,
  withDangerousMod,
  withSettingsGradle,
  withAppBuildGradle,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MODULE_NAME = "walkchamp-race-progress";
const SERVICE_NAME =
  "com.globalwalkerleague.walkchampraceprogress.WalkChampRaceForegroundService";
const SERVICE_XML = `    <service android:name="${SERVICE_NAME}" android:enabled="true" android:exported="false" android:foregroundServiceType="health" android:stopWithTask="false"/>`;
const MODULE_MANIFEST_REL = `modules/${MODULE_NAME}/android/src/main/AndroidManifest.xml`;
const SETTINGS_INCLUDE = `include ':${MODULE_NAME}'`;
const SETTINGS_PROJECT_DIR = `project(':${MODULE_NAME}').projectDir = new File(rootProject.projectDir, '../modules/${MODULE_NAME}/android')`;

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function patchMainAndroidManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `[withWalkChampForegroundService] Missing manifest: ${manifestPath}`,
    );
  }

  let xml = fs.readFileSync(manifestPath, "utf8");
  if (xml.includes(SERVICE_NAME)) {
    return false;
  }

  const applicationOpen = xml.match(/<application\b[^>]*>/);
  if (!applicationOpen) {
    throw new Error(
      "[withWalkChampForegroundService] <application> tag not found in AndroidManifest.xml",
    );
  }

  const insertAt = applicationOpen.index + applicationOpen[0].length;
  xml =
    xml.slice(0, insertAt) +
    "\n" +
    SERVICE_XML +
    xml.slice(insertAt);
  fs.writeFileSync(manifestPath, xml);
  return true;
}

function ensureModuleManifest(projectRoot) {
  const moduleManifestPath = path.join(projectRoot, MODULE_MANIFEST_REL);
  if (!fs.existsSync(moduleManifestPath)) {
    console.warn(
      `[withWalkChampForegroundService] module manifest missing: ${moduleManifestPath}`,
    );
    return;
  }

  let xml = fs.readFileSync(moduleManifestPath, "utf8");
  const fqcnService = `<service
      android:name="${SERVICE_NAME}"
      android:enabled="true"
      android:exported="false"
      android:foregroundServiceType="health"
      android:stopWithTask="false" />`;

  if (xml.includes(SERVICE_NAME)) {
    return;
  }

  if (!xml.includes("<application")) {
    xml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_HEALTH" />
  <uses-permission android:name="android.permission.ACTIVITY_RECOGNITION" />
  <uses-permission android:name="android.permission.WAKE_LOCK" />
  <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
  <application>
${fqcnService}
  </application>
</manifest>
`;
  } else {
    xml = xml.replace(
      "</application>",
      `    ${fqcnService.replace(/\n/g, "\n    ")}\n  </application>`,
    );
  }

  fs.writeFileSync(moduleManifestPath, xml);
}

/**
 * Ensures WalkChampRaceForegroundService is in the final merged release manifest
 * and walkchamp-race-progress is linked in Gradle (EAS prebuild + local).
 */
function withWalkChampForegroundService(config) {
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    manifest["uses-permission"] = ensureArray(manifest["uses-permission"]);
    const permissions = [
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_HEALTH",
      "android.permission.ACTIVITY_RECOGNITION",
      "android.permission.WAKE_LOCK",
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
    if (!application) {
      throw new Error(
        "[withWalkChampForegroundService] AndroidManifest application tag not found",
      );
    }

    application.service = ensureArray(application.service);
    const hasService = application.service.some(
      (s) => s.$?.["android:name"] === SERVICE_NAME,
    );
    if (!hasService) {
      application.service.push({
        $: {
          "android:name": SERVICE_NAME,
          "android:enabled": "true",
          "android:exported": "false",
          "android:foregroundServiceType": "health",
          "android:stopWithTask": "false",
        },
      });
    } else {
      const svc = application.service.find(
        (s) => s.$?.["android:name"] === SERVICE_NAME,
      );
      if (svc?.$) {
        svc.$["android:enabled"] = "true";
        svc.$["android:exported"] = "false";
        svc.$["android:foregroundServiceType"] = "health";
        svc.$["android:stopWithTask"] = "false";
      }
    }

    return cfg;
  });

  config = withSettingsGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (!contents.includes(SETTINGS_INCLUDE)) {
      contents = `${contents.trim()}\n${SETTINGS_INCLUDE}\n${SETTINGS_PROJECT_DIR}\n`;
    } else if (!contents.includes("../modules/walkchamp-race-progress/android")) {
      contents = contents.replace(
        /project\(':walkchamp-race-progress'\)\.projectDir\s*=\s*new File\([^\n]+\)/,
        SETTINGS_PROJECT_DIR,
      );
    }
    cfg.modResults.contents = contents;
    return cfg;
  });

  config = withAppBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;
    const dep = `implementation project(':${MODULE_NAME}')`;
    if (!contents.includes(dep)) {
      contents = contents.replace(
        /dependencies\s*\{/,
        `dependencies {\n    ${dep}`,
      );
    }
    cfg.modResults.contents = contents;
    return cfg;
  });

  config = withDangerousMod(config, [
    "android",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      ensureModuleManifest(projectRoot);

      const manifestPath = path.join(
        cfg.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "AndroidManifest.xml",
      );
      const patched = patchMainAndroidManifest(manifestPath);
      if (patched) {
        console.log(
          "[withWalkChampForegroundService] patched app AndroidManifest.xml with FGS service",
        );
      }
      return cfg;
    },
  ]);

  return config;
}

module.exports = withWalkChampForegroundService;
