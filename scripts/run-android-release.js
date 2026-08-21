/**
 * Release APK build that avoids the gesture-handler CMake/codegen race from
 * `expo run:android --variant release` (--configure-on-demand).
 *
 * Windows ninja Stat()/mkdir fails at MAX_PATH 260 for New Architecture
 * autolinked codegen. Flatten those .cpp files onto C:\g and compile them
 * from short CMakeLists under C:\m.
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ANDROID = path.join(ROOT, "android");
const IS_WIN = process.platform === "win32";
const GRADLEW = IS_WIN ? "gradlew.bat" : "./gradlew";

function rmIfExists(target) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function ensureJunction(link, target) {
  const stats = fs.existsSync(link) ? fs.lstatSync(link) : null;
  if (stats && stats.isSymbolicLink()) return;
  if (stats) {
    fs.rmSync(link, { recursive: true, force: true });
  }
  execSync(`cmd /c mklink /J "${link}" "${target}"`, { stdio: "inherit" });
}

function gradle(args) {
  execSync(`${GRADLEW} ${args.join(" ")}`, {
    cwd: ANDROID,
    stdio: "inherit",
    shell: IS_WIN,
  });
}

function copyDirSources(fromDir, toDir) {
  if (!fs.existsSync(fromDir)) return;
  fs.mkdirSync(toDir, { recursive: true });
  for (const name of fs.readdirSync(fromDir)) {
    const full = path.join(fromDir, name);
    if (fs.statSync(full).isDirectory()) continue;
    if (!/\.(cpp|h|hpp)$/.test(name)) continue;
    fs.copyFileSync(full, path.join(toDir, name));
  }
}

function writeShortCmake(srcCmake, destDir, replacements) {
  fs.mkdirSync(destDir, { recursive: true });
  let text = fs.readFileSync(srcCmake, "utf8");
  for (const [from, to] of replacements) {
    if (!text.includes(from)) {
      throw new Error(`CMake patch missed:\n${from}\nin ${srcCmake}`);
    }
    text = text.replace(from, to);
  }
  fs.writeFileSync(path.join(destDir, "CMakeLists.txt"), text);
}

function flattenAutolinkedCpp() {
  const kcSrc = path.join(ROOT, "node_modules", "react-native-keyboard-controller");
  const screensSrc = path.join(ROOT, "node_modules", "react-native-screens");
  const svgSrc = path.join(ROOT, "node_modules", "react-native-svg");
  const saSrc = path.join(ROOT, "node_modules", "react-native-safe-area-context");

  rmIfExists("C:\\g");
  rmIfExists("C:\\m");

  const kcCodegenJni = path.join(kcSrc, "android", "build", "generated", "source", "codegen", "jni");
  copyDirSources(path.join(kcSrc, "android", "src", "main", "jni"), "C:\\g\\kc\\n");
  copyDirSources(
    path.join(kcSrc, "common", "cpp", "react", "renderer", "components", "reactnativekeyboardcontroller"),
    "C:\\g\\kc\\m",
  );
  copyDirSources(kcCodegenJni, "C:\\g\\kc\\g");
  copyDirSources(
    path.join(kcCodegenJni, "react", "renderer", "components", "reactnativekeyboardcontroller"),
    "C:\\g\\kc\\p",
  );

  const sCodegen = path.join(
    screensSrc,
    "android",
    "build",
    "generated",
    "source",
    "codegen",
    "jni",
    "react",
    "renderer",
    "components",
    "rnscreens",
  );
  copyDirSources(path.join(screensSrc, "android", "src", "main", "jni"), "C:\\g\\s\\n");
  copyDirSources(
    path.join(screensSrc, "common", "cpp", "react", "renderer", "components", "rnscreens"),
    "C:\\g\\s\\m",
  );
  copyDirSources(
    path.join(screensSrc, "common", "cpp", "react", "renderer", "components", "rnscreens", "utils"),
    "C:\\g\\s\\u",
  );
  copyDirSources(sCodegen, "C:\\g\\s\\p");

  const vCodegen = path.join(
    svgSrc,
    "android",
    "build",
    "generated",
    "source",
    "codegen",
    "jni",
    "react",
    "renderer",
    "components",
    "rnsvg",
  );
  copyDirSources(path.join(svgSrc, "android", "src", "main", "jni"), "C:\\g\\v\\n");
  copyDirSources(
    path.join(svgSrc, "common", "cpp", "react", "renderer", "components", "rnsvg"),
    "C:\\g\\v\\m",
  );
  copyDirSources(vCodegen, "C:\\g\\v\\p");

  const aCodegenJni = path.join(saSrc, "android", "build", "generated", "source", "codegen", "jni");
  copyDirSources(path.join(saSrc, "android", "src", "main", "jni"), "C:\\g\\a\\n");
  copyDirSources(
    path.join(saSrc, "common", "cpp", "react", "renderer", "components", "safeareacontext"),
    "C:\\g\\a\\m",
  );
  copyDirSources(aCodegenJni, "C:\\g\\a\\g");
  copyDirSources(
    path.join(aCodegenJni, "react", "renderer", "components", "safeareacontext"),
    "C:\\g\\a\\p",
  );

  writeShortCmake(
    path.join(kcSrc, "android", "src", "main", "jni", "CMakeLists.txt"),
    "C:\\m\\kc",
    [
      [
        "set(LIB_ANDROID_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../..)",
        "set(LIB_ANDROID_DIR C:/k/android)",
      ],
      [
        "file(GLOB LIB_CUSTOM_SRCS CONFIGURE_DEPENDS *.cpp ${LIB_COMMON_COMPONENTS_DIR}/*.cpp)",
        "file(GLOB LIB_CUSTOM_SRCS CONFIGURE_DEPENDS C:/g/kc/n/*.cpp C:/g/kc/m/*.cpp)",
      ],
      [
        "file(GLOB LIB_CODEGEN_SRCS CONFIGURE_DEPENDS ${LIB_ANDROID_GENERATED_JNI_DIR}/*.cpp ${LIB_ANDROID_GENERATED_COMPONENTS_DIR}/*.cpp)",
        "file(GLOB LIB_CODEGEN_SRCS CONFIGURE_DEPENDS C:/g/kc/g/*.cpp C:/g/kc/p/*.cpp)",
      ],
      ["  PUBLIC\n  .", "  PUBLIC\n  C:/g/kc/n\n  C:/g/kc/m\n  C:/g/kc/g\n  C:/g/kc/p\n  C:/k/android/src/main/jni\n  ."],
    ],
  );

  writeShortCmake(
    path.join(screensSrc, "android", "src", "main", "jni", "CMakeLists.txt"),
    "C:\\m\\s",
    [
      [
        "set(LIB_ANDROID_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../..)",
        "set(LIB_ANDROID_DIR C:/s/android)",
      ],
      [
        "file(GLOB LIB_CUSTOM_SRCS CONFIGURE_DEPENDS *.cpp ${LIB_COMMON_COMPONENTS_DIR}/*.cpp ${LIB_COMMON_COMPONENTS_DIR}/utils/*.cpp)",
        "file(GLOB LIB_CUSTOM_SRCS CONFIGURE_DEPENDS C:/g/s/n/*.cpp C:/g/s/m/*.cpp C:/g/s/u/*.cpp)",
      ],
      [
        "file(GLOB LIB_CODEGEN_SRCS CONFIGURE_DEPENDS ${LIB_ANDROID_GENERATED_COMPONENTS_DIR}/*.cpp)",
        "file(GLOB LIB_CODEGEN_SRCS CONFIGURE_DEPENDS C:/g/s/p/*.cpp)",
      ],
      ["  PUBLIC\n  .", "  PUBLIC\n  C:/g/s/n\n  C:/g/s/m\n  C:/g/s/u\n  C:/g/s/p\n  C:/s/android/src/main/jni\n  ."],
    ],
  );

  writeShortCmake(
    path.join(svgSrc, "android", "src", "main", "jni", "CMakeLists.txt"),
    "C:\\m\\v",
    [
      [
        "set(RNSVG_ANDROID_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../..)",
        "set(RNSVG_ANDROID_DIR C:/v/android)",
      ],
      [
        "file(GLOB rnsvg_SRCS CONFIGURE_DEPENDS *.cpp ${RNSVG_COMMON_DIR}/react/renderer/components/rnsvg/*.cpp)",
        "file(GLOB rnsvg_SRCS CONFIGURE_DEPENDS C:/g/v/n/*.cpp C:/g/v/m/*.cpp)",
      ],
      [
        "file(GLOB rnsvg_codegen_SRCS CONFIGURE_DEPENDS ${RNSVG_GENERATED_REACT_DIR}/*cpp)",
        "file(GLOB rnsvg_codegen_SRCS CONFIGURE_DEPENDS C:/g/v/p/*.cpp)",
      ],
      ["  PUBLIC\n  .", "  PUBLIC\n  C:/g/v/n\n  C:/g/v/m\n  C:/g/v/p\n  C:/v/android/src/main/jni\n  ."],
    ],
  );

  writeShortCmake(
    path.join(saSrc, "android", "src", "main", "jni", "CMakeLists.txt"),
    "C:\\m\\a",
    [
      [
        "set(LIB_ANDROID_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../..)",
        "set(LIB_ANDROID_DIR C:/a/android)",
      ],
      [
        "file(GLOB LIB_CUSTOM_SRCS CONFIGURE_DEPENDS *.cpp ${LIB_COMMON_DIR}/react/renderer/components/${LIB_LITERAL}/*.cpp)",
        "file(GLOB LIB_CUSTOM_SRCS CONFIGURE_DEPENDS C:/g/a/n/*.cpp C:/g/a/m/*.cpp)",
      ],
      [
        "file(GLOB LIB_CODEGEN_SRCS CONFIGURE_DEPENDS ${LIB_ANDROID_GENERATED_JNI_DIR}/*.cpp ${LIB_ANDROID_GENERATED_COMPONENTS_DIR}/*.cpp)",
        "file(GLOB LIB_CODEGEN_SRCS CONFIGURE_DEPENDS C:/g/a/g/*.cpp C:/g/a/p/*.cpp)",
      ],
      ["  PUBLIC\n  .", "  PUBLIC\n  C:/g/a/n\n  C:/g/a/m\n  C:/g/a/g\n  C:/g/a/p\n  C:/a/android/src/main/jni\n  ."],
    ],
  );
}

function main() {
  rmIfExists(path.join(ANDROID, "app", ".cxx"));

  ensureJunction(
    "C:\\k",
    path.join(ROOT, "node_modules", "react-native-keyboard-controller"),
  );
  ensureJunction("C:\\s", path.join(ROOT, "node_modules", "react-native-screens"));
  ensureJunction("C:\\v", path.join(ROOT, "node_modules", "react-native-svg"));
  ensureJunction(
    "C:\\a",
    path.join(ROOT, "node_modules", "react-native-safe-area-context"),
  );

  process.env.NODE_ENV = "production";

  const codegenArgs = [
    ":react-native-gesture-handler:generateCodegenArtifactsFromSchema",
    ":react-native-reanimated:generateCodegenArtifactsFromSchema",
    ":react-native-worklets:generateCodegenArtifactsFromSchema",
    ":react-native-keyboard-controller:generateCodegenArtifactsFromSchema",
    ":react-native-screens:generateCodegenArtifactsFromSchema",
    ":react-native-svg:generateCodegenArtifactsFromSchema",
    ":react-native-safe-area-context:generateCodegenArtifactsFromSchema",
    "--no-daemon",
    "--no-configure-on-demand",
  ];

  console.log("[android:release] Generating New Architecture codegen...");
  gradle(codegenArgs);

  console.log("[android:release] Flattening JNI sources for Windows MAX_PATH...");
  flattenAutolinkedCpp();

  console.log("[android:release] Building release APK...");
  gradle([
    ":app:assembleRelease",
    "-PreactNativeArchitectures=arm64-v8a",
    "--no-daemon",
    "--no-configure-on-demand",
  ]);

  console.log("[android:release] Building release AAB...");
  gradle([
    ":app:bundleRelease",
    "-PreactNativeArchitectures=arm64-v8a",
    "--no-daemon",
    "--no-configure-on-demand",
  ]);

  const apk = path.join(
    ANDROID,
    "app",
    "build",
    "outputs",
    "apk",
    "release",
    "app-release.apk",
  );
  const aab = path.join(
    ANDROID,
    "app",
    "build",
    "outputs",
    "bundle",
    "release",
    "app-release.aab",
  );
  console.log(`[android:release] Done: ${apk}`);
  console.log(`[android:release] Done: ${aab}`);
}

main();
