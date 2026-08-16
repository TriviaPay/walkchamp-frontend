const { withAppBuildGradle, withGradleProperties } = require("expo/config-plugins");

const MARKER = "// @generated walkchamp-codegen-cmake-fix";
const CMAKE_MARKER = "// @generated walkchamp-cmake-object-path-max";

const CMAKE_SNIPPET = `        ${CMAKE_MARKER}
        // Windows MAX_PATH (260): New Architecture CMake embeds full source paths
        // into object filenames. 248 stays under Windows 260 and above the
        // object dir (~163) so CMake hashes instead of skipping the cap.
        externalNativeBuild {
            cmake {
                arguments "-DCMAKE_OBJECT_PATH_MAX=248",
                    "-C\${rootDir.absolutePath.replace('\\\\', '/')}/cmake-object-path-max.cmake"
            }
        }`;

const SNIPPET = `
${MARKER}
// Expo run:android uses --configure-on-demand, which can configure app CMake
// before autolinked libraries generate New Architecture codegen (CMakeLists.txt).
// If codegen files appear later, ninja globs unhashed Windows object paths and
// Stat() fails at 260 characters (keyboard-controller / screens / svg / safe-area).
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
        ":react-native-keyboard-controller",
        ":react-native-screens",
        ":react-native-svg",
        ":react-native-safe-area-context",
    ]
    def codegenTasks = codegenProjectPaths.collect { projectPath ->
        tasks.findByPath("$projectPath:generateCodegenArtifactsFromSchema")
    }.findAll { it != null }

    tasks.matching { it.name.startsWith("configureCMake") }.configureEach { cmakeTask ->
        cmakeTask.dependsOn(codegenTasks)
    }

    def cmakeArgs = android.defaultConfig.externalNativeBuild.cmake.arguments
    if (cmakeArgs.every { !it.toString().contains("CMAKE_OBJECT_PATH_MAX") }) {
        cmakeArgs.add("-DCMAKE_OBJECT_PATH_MAX=248")
    }
}
`;

function replaceMarkedBlock(contents, marker, nextBlock) {
  if (!contents.includes(marker)) {
    return `${contents.trimEnd()}\n${nextBlock}\n`;
  }
  const start = contents.indexOf(marker);
  const after = contents.slice(start);
  const closeRel = after.indexOf("\n}\n");
  if (closeRel < 0) {
    return `${contents.slice(0, start).trimEnd()}\n${nextBlock}\n`;
  }
  const end = start + closeRel + 3;
  return `${contents.slice(0, start).trimEnd()}\n${nextBlock}\n${contents.slice(end)}`;
}

/** Ensure RN codegen runs before CMake autolinking when configure-on-demand is enabled. */
function withCodegenCMakeFix(config) {
  config = withGradleProperties(config, (cfg) => {
    const hasOverride = cfg.modResults.some(
      (item) => item.type === "property" && item.key === "android.overridePathCheck",
    );
    if (!hasOverride) {
      cfg.modResults.push({
        type: "property",
        key: "android.overridePathCheck",
        value: "true",
      });
    }
    return cfg;
  });

  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") return cfg;

    let contents = cfg.modResults.contents;

    if (contents.includes(CMAKE_MARKER)) {
      contents = contents.replace(
        /\/\/ @generated walkchamp-cmake-object-path-max[\s\S]*?externalNativeBuild \{[\s\S]*?cmake \{[\s\S]*?\}\s*\}/,
        CMAKE_SNIPPET.trim(),
      );
    } else if (contents.includes("CMAKE_OBJECT_PATH_MAX")) {
      contents = contents.replace(
        /\/\/ Windows MAX_PATH[\s\S]*?externalNativeBuild \{[\s\S]*?cmake \{[\s\S]*?\}\s*\}/,
        CMAKE_SNIPPET.trim(),
      );
    } else {
      contents = contents.replace(
        /buildConfigField "String", "REACT_NATIVE_RELEASE_LEVEL".*\n/,
        (match) => `${match}\n${CMAKE_SNIPPET}\n`,
      );
    }

    contents = replaceMarkedBlock(contents, MARKER, SNIPPET);
    cfg.modResults.contents = contents;
    return cfg;
  });
}

module.exports = withCodegenCMakeFix;
