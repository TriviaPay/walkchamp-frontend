const { withSettingsGradle, withAppBuildGradle } = require("@expo/config-plugins");

const MODULE_NAME = "walkchamp-race-progress";
const INCLUDE = `include ':${MODULE_NAME}'`;
/** Prefer ./modules — always uploaded to EAS; node_modules file: copy can be incomplete. */
const PROJECT_DIR = `project(':${MODULE_NAME}').projectDir = new File(rootProject.projectDir, '../modules/${MODULE_NAME}/android')`;

/**
 * Ensures walkchamp-race-progress is linked on EAS prebuild.
 * Device APK was missing WalkChampRaceProgress from dex without this.
 */
function withWalkChampNativeModule(config) {
  config = withSettingsGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (!contents.includes(INCLUDE)) {
      contents = `${contents.trim()}\n${INCLUDE}\n${PROJECT_DIR}\n`;
    } else if (!contents.includes("../modules/walkchamp-race-progress/android")) {
      contents = contents.replace(
        /project\(':walkchamp-race-progress'\)\.projectDir\s*=\s*new File\([^\n]+\)/,
        PROJECT_DIR,
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

  return config;
}

module.exports = withWalkChampNativeModule;
