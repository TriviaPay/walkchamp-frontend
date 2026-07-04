const fs = require("fs");
const path = require("path");

const MODULE_NAME = "walkchamp-race-progress";

/** Resolve native module android dir — node_modules copy is authoritative on EAS. */
function resolveModuleAndroidDir(projectRoot) {
  const candidates = [
    path.join(projectRoot, "node_modules", MODULE_NAME, "android"),
    path.join(projectRoot, "modules", MODULE_NAME, "android"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "build.gradle"))) {
      return dir;
    }
  }
  return candidates[1];
}

function resolveModuleManifestPath(projectRoot) {
  return path.join(
    resolveModuleAndroidDir(projectRoot),
    "src",
    "main",
    "AndroidManifest.xml",
  );
}

function settingsGradleProjectDirLine(projectRoot) {
  const androidDir = resolveModuleAndroidDir(projectRoot);
  const relative = path
    .relative(path.join(projectRoot, "android"), androidDir)
    .replace(/\\/g, "/");
  return `project(':${MODULE_NAME}').projectDir = new File(rootProject.projectDir, '${relative}')`;
}

module.exports = {
  MODULE_NAME,
  resolveModuleAndroidDir,
  resolveModuleManifestPath,
  settingsGradleProjectDirLine,
};
