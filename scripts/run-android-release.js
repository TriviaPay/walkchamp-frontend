/**
 * Release APK build that avoids the gesture-handler CMake/codegen race from
 * `expo run:android --variant release` (--configure-on-demand).
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

function main() {
  // Stale CMake cache can point at codegen folders that were never generated.
  rmIfExists(path.join(ANDROID, "app", ".cxx"));

  process.env.NODE_ENV = "production";

  const gradleArgs = [
    ":react-native-gesture-handler:generateCodegenArtifactsFromSchema",
    ":react-native-reanimated:generateCodegenArtifactsFromSchema",
    ":react-native-worklets:generateCodegenArtifactsFromSchema",
    ":app:assembleRelease",
    "--no-daemon",
    "--no-configure-on-demand",
  ];

  console.log("[android:release] Building release APK...");
  execSync(`${GRADLEW} ${gradleArgs.join(" ")}`, {
    cwd: ANDROID,
    stdio: "inherit",
    shell: IS_WIN,
  });

  const apk = path.join(
    ANDROID,
    "app",
    "build",
    "outputs",
    "apk",
    "release",
    "app-release.apk",
  );
  console.log(`[android:release] Done: ${apk}`);
}

main();
