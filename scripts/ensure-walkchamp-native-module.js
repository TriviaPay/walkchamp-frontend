/**
 * EAS/local install: guarantee walkchamp-race-progress lands in node_modules
 * so Gradle autolinking always sees the Android sources + manifest.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "modules", "walkchamp-race-progress");
const dest = path.join(root, "node_modules", "walkchamp-race-progress");
const SERVICE =
  "com.globalwalkerleague.walkchampraceprogress.WalkChampRaceForegroundService";

function copyRecursive(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.name === "build" || entry.name === ".gradle") continue;
    if (entry.isDirectory()) copyRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(src)) {
  console.warn("[ensure-walkchamp-native-module] source missing:", src);
  process.exit(0);
}

const moduleManifest = path.join(
  src,
  "android",
  "src",
  "main",
  "AndroidManifest.xml",
);
if (
  fs.existsSync(moduleManifest) &&
  !fs.readFileSync(moduleManifest, "utf8").includes(SERVICE)
) {
  console.warn(
    "[ensure-walkchamp-native-module] module AndroidManifest missing FGS service",
  );
}

const androidDest = path.join(dest, "android", "src");
if (!fs.existsSync(androidDest) || !fs.existsSync(path.join(dest, "expo-module.config.json"))) {
  console.log("[ensure-walkchamp-native-module] syncing module into node_modules");
  copyRecursive(src, dest);
} else {
  copyRecursive(src, dest);
  console.log("[ensure-walkchamp-native-module] refreshed node_modules copy");
}
