const {
  withAndroidManifest,
  withInfoPlist,
  withDangerousMod,
  withXcodeProject,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");
const {
  resolveModuleAndroidDir,
  settingsGradleProjectDirLine,
} = require("./walkchampModulePaths");

const WIDGET_TARGET_NAME = "WalkChampWidget";
const WIDGET_DEPLOYMENT_TARGET = "16.2";
const WIDGET_BUNDLE_FILE = "WalkChampWidgetBundle.swift";
const WIDGET_WALK_FILE = "WalkChampWalkLiveActivityWidget.swift";
const WIDGET_RACE_FILE = "WalkChampRaceLiveActivityWidget.swift";
const WIDGET_INFO_PLIST = `${WIDGET_TARGET_NAME}-Info.plist`;

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function copyNotificationIcons(projectRoot) {
  const src = path.join(
    projectRoot,
    "modules/walkchamp-race-progress/android/src/main/res/drawable/ic_walkchamp_notification.xml",
  );
  const destDir = path.join(projectRoot, "android/app/src/main/res/drawable");
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, path.join(destDir, "ic_walkchamp_notification.xml"));
  fs.copyFileSync(src, path.join(destDir, "ic_notification.xml"));
  // OneSignal looks up this name when push payloads omit small_icon.
  fs.copyFileSync(src, path.join(destDir, "ic_stat_onesignal_default.xml"));

  const nodpiDir = path.join(
    projectRoot,
    "android/app/src/main/res/drawable-nodpi",
  );
  const xxxhdpiDir = path.join(
    projectRoot,
    "android/app/src/main/res/drawable-xxxhdpi",
  );
  fs.mkdirSync(nodpiDir, { recursive: true });
  fs.mkdirSync(xxxhdpiDir, { recursive: true });

  // Per-type colorful icons used by WalkChampNotificationServiceExtension + FGS RemoteViews.
  const assetNotifDir = path.join(projectRoot, "assets/notifications");
  const moduleNotifDir = path.join(
    projectRoot,
    "modules/walkchamp-race-progress/android/src/main/res/drawable-nodpi",
  );
  const copyPngNamed = (fileName) => {
    const fromAsset = path.join(assetNotifDir, fileName);
    const fromModule = path.join(moduleNotifDir, fileName);
    const from = fs.existsSync(fromAsset)
      ? fromAsset
      : fs.existsSync(fromModule)
        ? fromModule
        : null;
    if (!from) return;
    fs.copyFileSync(from, path.join(nodpiDir, fileName));
    fs.copyFileSync(from, path.join(moduleNotifDir, fileName));
  };

  // Union of both sources by filename — `assets/notifications` wins when it has a
  // given icon, but a missing icon there (e.g. only a subset was customized) must
  // still fall back to the module's bundled PNG instead of silently vanishing.
  const pngNames = new Set();
  if (fs.existsSync(assetNotifDir)) {
    for (const entry of fs.readdirSync(assetNotifDir)) {
      if (/^notification_.+\.png$/i.test(entry)) pngNames.add(entry);
    }
  }
  if (fs.existsSync(moduleNotifDir)) {
    for (const entry of fs.readdirSync(moduleNotifDir)) {
      if (/^notification_.+\.png$/i.test(entry)) pngNames.add(entry);
    }
  }
  for (const entry of pngNames) copyPngNamed(entry);

  const brandSrcCandidates = [
    path.join(assetNotifDir, "ic_onesignal_large_icon_default.png"),
    path.join(assetNotifDir, "notification_default.png"),
    path.join(moduleNotifDir, "notification_walkchamp_brand.png"),
  ];
  const brandSrc = brandSrcCandidates.find((p) => fs.existsSync(p));
  if (brandSrc) {
    fs.copyFileSync(
      brandSrc,
      path.join(nodpiDir, "ic_onesignal_large_icon_default.png"),
    );
    fs.copyFileSync(
      brandSrc,
      path.join(xxxhdpiDir, "ic_onesignal_large_icon_default.png"),
    );
  }
}

function widgetSourceDir(projectRoot) {
  return path.join(
    projectRoot,
    "modules/walkchamp-race-progress/ios/WidgetExtension",
  );
}

function widgetPodfileSnippet(targetName) {
  return `
target '${targetName}' do
  pod 'WalkChampRaceProgress', :path => '../node_modules/walkchamp-race-progress/ios'
  use_frameworks! :linkage => podfile_properties['ios.useFrameworks'].to_sym if podfile_properties['ios.useFrameworks']
  use_frameworks! :linkage => ENV['USE_FRAMEWORKS'].to_sym if ENV['USE_FRAMEWORKS']
end`;
}

function withEasWalkChampWidgetExtension(config) {
  const bundleId = config.ios?.bundleIdentifier ?? "com.walkchamp.app";
  const existing =
    config.extra?.eas?.build?.experimental?.ios?.appExtensions ?? [];
  if (existing.some((entry) => entry.targetName === WIDGET_TARGET_NAME)) {
    return config;
  }

  config.extra = {
    ...config.extra,
    eas: {
      ...config.extra?.eas,
      build: {
        ...config.extra?.eas?.build,
        experimental: {
          ...config.extra?.eas?.build?.experimental,
          ios: {
            ...config.extra?.eas?.build?.experimental?.ios,
            appExtensions: [
              ...existing,
              {
                targetName: WIDGET_TARGET_NAME,
                bundleIdentifier: `${bundleId}.${WIDGET_TARGET_NAME}`,
                entitlements: {},
              },
            ],
          },
        },
      },
    },
  };
  return config;
}

function withWalkChampWidgetPodfile(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.projectRoot, "ios", "Podfile");
      if (!fs.existsSync(podfilePath)) return cfg;

      const podfile = fs.readFileSync(podfilePath, "utf8");
      const regex = new RegExp(`target '${WIDGET_TARGET_NAME}'`);
      if (regex.test(podfile)) return cfg;

      fs.appendFileSync(podfilePath, widgetPodfileSnippet(WIDGET_TARGET_NAME));
      return cfg;
    },
  ]);
}

function withWalkChampWidgetFiles(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const sourceDir = widgetSourceDir(projectRoot);
      const targetDir = path.join(projectRoot, "ios", WIDGET_TARGET_NAME);
      fs.mkdirSync(targetDir, { recursive: true });

      const files = [
        WIDGET_BUNDLE_FILE,
        WIDGET_WALK_FILE,
        WIDGET_RACE_FILE,
        "WalkChampWidget-Info.plist",
      ];
      for (const file of files) {
        const src = path.join(sourceDir, file);
        const destName = file === "WalkChampWidget-Info.plist" ? WIDGET_INFO_PLIST : file;
        const dest = path.join(targetDir, destName);
        if (!fs.existsSync(src)) {
          throw new Error(
            `[withWalkChampRaceProgress] Missing widget file: ${src}`,
          );
        }
        let contents = fs.readFileSync(src, "utf8");
        if (file === "WalkChampWidget-Info.plist") {
          contents = contents
            .replace(/{{BUNDLE_VERSION}}/g, cfg.ios?.buildNumber ?? "1")
            .replace(/{{BUNDLE_SHORT_VERSION}}/g, cfg.version ?? "1.0");
        }
        fs.writeFileSync(dest, contents);
      }
      return cfg;
    },
  ]);
}

function withWalkChampWidgetXcodeProject(config) {
  return withXcodeProject(config, (cfg) => {
    const xcodeProject = cfg.modResults;
    if (xcodeProject.pbxTargetByName(WIDGET_TARGET_NAME)) return cfg;

    const bundleId = `${cfg.ios?.bundleIdentifier ?? "com.walkchamp.app"}.${WIDGET_TARGET_NAME}`;
    const widgetFiles = [
      WIDGET_BUNDLE_FILE,
      WIDGET_WALK_FILE,
      WIDGET_RACE_FILE,
      WIDGET_INFO_PLIST,
    ];

    const extGroup = xcodeProject.addPbxGroup(
      widgetFiles,
      WIDGET_TARGET_NAME,
      WIDGET_TARGET_NAME,
    );
    const groups = xcodeProject.hash.project.objects.PBXGroup;
    Object.keys(groups).forEach((key) => {
      if (
        typeof groups[key] === "object" &&
        groups[key].name === undefined &&
        groups[key].path === undefined
      ) {
        xcodeProject.addToPbxGroup(extGroup.uuid, key);
      }
    });

    const projObjects = xcodeProject.hash.project.objects;
    projObjects.PBXTargetDependency = projObjects.PBXTargetDependency || {};
    projObjects.PBXContainerItemProxy = projObjects.PBXContainerItemProxy || {};

    const widgetTarget = xcodeProject.addTarget(
      WIDGET_TARGET_NAME,
      "app_extension",
      WIDGET_TARGET_NAME,
      bundleId,
    );
    xcodeProject.addBuildPhase(
      [WIDGET_BUNDLE_FILE, WIDGET_WALK_FILE, WIDGET_RACE_FILE],
      "PBXSourcesBuildPhase",
      "Sources",
      widgetTarget.uuid,
    );
    xcodeProject.addBuildPhase(
      [],
      "PBXResourcesBuildPhase",
      "Resources",
      widgetTarget.uuid,
    );
    xcodeProject.addBuildPhase(
      [],
      "PBXFrameworksBuildPhase",
      "Frameworks",
      widgetTarget.uuid,
    );

    const configurations = xcodeProject.pbxXCBuildConfigurationSection();
    for (const key in configurations) {
      const entry = configurations[key];
      if (
        typeof entry.buildSettings === "undefined" ||
        entry.buildSettings.PRODUCT_NAME !== `"${WIDGET_TARGET_NAME}"`
      ) {
        continue;
      }
      entry.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = WIDGET_DEPLOYMENT_TARGET;
      entry.buildSettings.TARGETED_DEVICE_FAMILY = `"1,2"`;
      entry.buildSettings.SWIFT_VERSION = "5.0";
      entry.buildSettings.INFOPLIST_FILE = `${WIDGET_TARGET_NAME}/${WIDGET_INFO_PLIST}`;
      entry.buildSettings.CODE_SIGN_STYLE = "Automatic";
    }

    return cfg;
  });
}

function withWalkChampAndroidNativeModule(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      copyNotificationIcons(projectRoot);

      const moduleGradlePath = path.join(
        resolveModuleAndroidDir(projectRoot),
        "build.gradle",
      );
      if (fs.existsSync(moduleGradlePath)) {
        let gradle = fs.readFileSync(moduleGradlePath, "utf8");
        if (!gradle.includes("missingDimensionStrategy 'store', 'play'")) {
          gradle = gradle.replace(
            /defaultConfig\s*\{/,
            `defaultConfig {\n    missingDimensionStrategy 'store', 'play'`,
          );
          fs.writeFileSync(moduleGradlePath, gradle);
        }
      }

      const settingsGradlePath = path.join(projectRoot, "android/settings.gradle");
      if (fs.existsSync(settingsGradlePath)) {
        let settings = fs.readFileSync(settingsGradlePath, "utf8");
        const settingsProjectDir = settingsGradleProjectDirLine(projectRoot);
        if (!settings.includes("':walkchamp-race-progress'")) {
          settings += `
include ':walkchamp-race-progress'
${settingsProjectDir}
`;
          fs.writeFileSync(settingsGradlePath, settings);
        } else {
          settings = settings.replace(
            /project\(':walkchamp-race-progress'\)\.projectDir\s*=\s*new File\([^\n]+\)/,
            settingsProjectDir,
          );
          fs.writeFileSync(settingsGradlePath, settings);
        }
      }

      const appGradlePath = path.join(projectRoot, "android/app/build.gradle");
      if (fs.existsSync(appGradlePath)) {
        let appGradle = fs.readFileSync(appGradlePath, "utf8");
        if (!appGradle.includes("project(':walkchamp-race-progress')")) {
          appGradle = appGradle.replace(
            /dependencies\s*\{/,
            `dependencies {\n    implementation project(':walkchamp-race-progress')`,
          );
          fs.writeFileSync(appGradlePath, appGradle);
        }
      }

      return cfg;
    },
  ]);
}

function withOneSignalNseNotificationAssets(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const nseDir = path.join(
        projectRoot,
        "ios",
        "OneSignalNotificationServiceExtension",
      );
      if (!fs.existsSync(nseDir)) return cfg;

      const assetDir = path.join(projectRoot, "assets/notifications");
      if (!fs.existsSync(assetDir)) return cfg;

      for (const entry of fs.readdirSync(assetDir)) {
        if (!/^notification_.+\.png$/i.test(entry)) continue;
        fs.copyFileSync(
          path.join(assetDir, entry),
          path.join(nseDir, entry),
        );
      }

      // Ensure brand matches WalkChampProgress100 for NSE / rich media fallbacks.
      const brandSrc = path.join(
        projectRoot,
        "assets/icons/WalkChampProgress100.png",
      );
      if (fs.existsSync(brandSrc)) {
        fs.copyFileSync(
          brandSrc,
          path.join(nseDir, "notification_walkchamp_brand.png"),
        );
      }
      return cfg;
    },
  ]);
}

/**
 * Registers WalkChamp foreground service (Android) and Live Activities (iOS)
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

      application["meta-data"] = ensureArray(application["meta-data"]);
      const ensureMeta = (name, attrs) => {
        const existing = application["meta-data"].find(
          (m) => m.$?.["android:name"] === name,
        );
        if (existing) {
          existing.$ = { ...existing.$, ...attrs, "android:name": name };
        } else {
          application["meta-data"].push({
            $: { "android:name": name, ...attrs },
          });
        }
      };
      ensureMeta("com.onesignal.messaging.default_notification_icon", {
        "android:resource": "@drawable/ic_stat_onesignal_default",
      });
      ensureMeta("com.onesignal.NotificationAccentColor.DEFAULT", {
        "android:value": "FF00B4FF",
      });
      ensureMeta("com.onesignal.NotificationServiceExtension", {
        "android:value":
          "com.walkchamp.app.WalkChampNotificationServiceExtension",
      });
    }

    return cfg;
  });

  config = withWalkChampAndroidNativeModule(config);

  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.NSSupportsLiveActivities = true;
    if (!cfg.modResults.UIBackgroundModes) {
      cfg.modResults.UIBackgroundModes = [];
    }
    const modes = Array.isArray(cfg.modResults.UIBackgroundModes)
      ? cfg.modResults.UIBackgroundModes
      : [cfg.modResults.UIBackgroundModes];
    if (!modes.includes("fetch")) modes.push("fetch");
    if (!modes.includes("remote-notification")) modes.push("remote-notification");
    cfg.modResults.UIBackgroundModes = modes;
    return cfg;
  });

  config = withEasWalkChampWidgetExtension(config);
  config = withWalkChampWidgetPodfile(config);
  config = withWalkChampWidgetFiles(config);
  config = withWalkChampWidgetXcodeProject(config);
  config = withOneSignalNseNotificationAssets(config);

  return config;
}

module.exports = withWalkChampRaceProgress;
