const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER = "// @generated walkchamp-codegen-cmake-fix";
const SNIPPET = `
${MARKER}
// Expo run:android uses --configure-on-demand, which can configure app CMake
// before autolinked libraries generate New Architecture codegen (CMakeLists.txt).
afterEvaluate {
    def codegenProjectPaths = [
        ":react-native-gesture-handler",
        ":react-native-reanimated",
        ":react-native-worklets",
        ":react-native-google-mobile-ads",
        ":react-native-health-connect",
        ":react-native-iap",
        ":react-native-onesignal",
        ":react-native-community_datetimepicker",
        ":react-native-community_netinfo",
        ":react-native-async-storage_async-storage",
    ]
    def codegenTasks = codegenProjectPaths.collect { projectPath ->
        tasks.findByPath("$projectPath:generateCodegenArtifactsFromSchema")
    }.findAll { it != null }

    tasks.matching { it.name.startsWith("configureCMake") }.configureEach { cmakeTask ->
        cmakeTask.dependsOn(codegenTasks)
    }
}
`;

/** Ensure RN codegen runs before CMake autolinking when configure-on-demand is enabled. */
function withCodegenCMakeFix(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") return cfg;

    let contents = cfg.modResults.contents;
    if (contents.includes(MARKER)) {
      return cfg;
    }

    cfg.modResults.contents = `${contents.trimEnd()}\n${SNIPPET}\n`;
    return cfg;
  });
}

module.exports = withCodegenCMakeFix;
