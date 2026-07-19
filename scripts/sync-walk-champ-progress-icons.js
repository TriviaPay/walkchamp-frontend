/**
 * Merges WalkChampProgress icon folders (android/res) into main/res with
 * expo-alternate-app-icons naming (ic_launcher_walk_champ_progress*).
 *
 * Source of truth: android/app/src/main/WalkChampProgress{0,25,50,75,100}/
 * Also syncs in-app PNGs to assets/icons/ from xxxhdpi/ic_launcher.png.
 *
 * Usage (from project root):
 *   node scripts/sync-walk-champ-progress-icons.js
 */

const fs = require("fs");
const path = require("path");

const MILESTONES = [
  "WalkChampProgress0",
  "WalkChampProgress25",
  "WalkChampProgress50",
  "WalkChampProgress75",
  "WalkChampProgress100",
];

const MIPMAP_DPI = [
  "mipmap-mdpi",
  "mipmap-hdpi",
  "mipmap-xhdpi",
  "mipmap-xxhdpi",
  "mipmap-xxxhdpi",
];

const FILE_MAP = [
  ["ic_launcher.png", (snake) => `ic_launcher_${snake}.png`],
  ["ic_launcher_foreground.png", (snake) => `ic_launcher_foreground_${snake}.png`],
  ["ic_launcher_background.png", (snake) => `ic_launcher_background_${snake}.png`],
  ["ic_launcher_monochrome.png", (snake) => `ic_launcher_monochrome_${snake}.png`],
];

function toSnakeCase(name) {
  return name.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) return false;
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return true;
}

/** Remove stale Expo-generated webp when replacing with png (same resource name). */
function removeStaleFormats(destDir, baseName) {
  for (const ext of [".webp", ".xml"]) {
    const stale = path.join(destDir, `${baseName}${ext}`);
    if (fs.existsSync(stale)) {
      fs.unlinkSync(stale);
    }
  }
}

function adaptiveIconXml(snake, hasBackground, hasMonochrome) {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">'];
  if (hasBackground) {
    lines.push(`    <background android:drawable="@mipmap/ic_launcher_background_${snake}"/>`);
  } else {
    const pascal = snake
      .split("_")
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join("");
    lines.push(`    <background android:drawable="@color/iconBackground${pascal}"/>`);
  }
  lines.push(`    <foreground android:drawable="@mipmap/ic_launcher_foreground_${snake}"/>`);
  if (hasMonochrome) {
    lines.push(`    <monochrome android:drawable="@mipmap/ic_launcher_monochrome_${snake}"/>`);
  }
  lines.push("</adaptive-icon>");
  return lines.join("\n") + "\n";
}

function defaultAdaptiveIconXml(hasBackground, hasMonochrome) {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">'];
  if (hasBackground) {
    lines.push('    <background android:drawable="@mipmap/ic_launcher_background"/>');
  } else {
    lines.push('    <background android:drawable="@color/iconBackground"/>');
  }
  lines.push('    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>');
  if (hasMonochrome) {
    lines.push('    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>');
  }
  lines.push("</adaptive-icon>");
  return lines.join("\n") + "\n";
}

function syncMilestoneFromAssets(projectRoot, resDir, milestoneName, isDefault) {
  const adaptiveSrc = path.join(projectRoot, "assets", "icons", "adaptive", `${milestoneName}.png`);
  const launcherSrc = path.join(projectRoot, "assets", "icons", `${milestoneName}.png`);
  if (!fs.existsSync(adaptiveSrc)) return false;

  const snake = toSnakeCase(milestoneName);
  for (const dpi of MIPMAP_DPI) {
    const destDpi = path.join(resDir, dpi);
    ensureDir(destDpi);
    const fgDest = isDefault
      ? "ic_launcher_foreground.png"
      : `ic_launcher_foreground_${snake}.png`;
    const iconDest = isDefault ? "ic_launcher.png" : `ic_launcher_${snake}.png`;
    removeStaleFormats(destDpi, path.basename(fgDest, ".png"));
    removeStaleFormats(destDpi, path.basename(iconDest, ".png"));
    copyFile(adaptiveSrc, path.join(destDpi, fgDest));
    if (fs.existsSync(launcherSrc)) {
      copyFile(launcherSrc, path.join(destDpi, iconDest));
    }
  }

  const anydpi = path.join(resDir, "mipmap-anydpi-v26");
  ensureDir(anydpi);
  fs.writeFileSync(
    path.join(anydpi, `ic_launcher_${snake}.xml`),
    adaptiveIconXml(snake, false, false),
  );
  if (isDefault) {
    fs.writeFileSync(
      path.join(anydpi, "ic_launcher.xml"),
      defaultAdaptiveIconXml(false, false),
    );
    fs.writeFileSync(
      path.join(anydpi, "ic_launcher_round.xml"),
      defaultAdaptiveIconXml(false, false),
    );
  }

  console.log(`synced ${milestoneName} from assets/icons${isDefault ? " (default launcher)" : ""}`);
  return true;
}

function syncMilestone(projectRoot, mainDir, resDir, milestoneName, isDefault) {
  const srcRes = path.join(mainDir, milestoneName, "android", "res");
  if (!fs.existsSync(srcRes)) {
    if (syncMilestoneFromAssets(projectRoot, resDir, milestoneName, isDefault)) {
      return;
    }
    console.warn(`skip ${milestoneName}: missing ${srcRes}`);
    return;
  }

  const snake = toSnakeCase(milestoneName);
  let hasBackground = false;
  let hasMonochrome = false;

  for (const dpi of MIPMAP_DPI) {
    const srcDpi = path.join(srcRes, dpi);
    if (!fs.existsSync(srcDpi)) continue;
    const destDpi = path.join(resDir, dpi);

    for (const [srcName, destNameFn] of FILE_MAP) {
      const destNames = isDefault
        ? [srcName, destNameFn(snake)]
        : [destNameFn(snake)];

      for (const destName of destNames) {
        const destPath = path.join(destDpi, destName);
        removeStaleFormats(
          destDpi,
          path.basename(destName, path.extname(destName)),
        );
        if (copyFile(path.join(srcDpi, srcName), destPath)) {
          if (srcName.includes("background")) hasBackground = true;
          if (srcName.includes("monochrome")) hasMonochrome = true;
        }
      }
    }
  }

  const anydpi = path.join(resDir, "mipmap-anydpi-v26");
  ensureDir(anydpi);

  fs.writeFileSync(
    path.join(anydpi, `ic_launcher_${snake}.xml`),
    adaptiveIconXml(snake, hasBackground, hasMonochrome),
  );

  if (isDefault) {
    fs.writeFileSync(
      path.join(anydpi, "ic_launcher.xml"),
      defaultAdaptiveIconXml(hasBackground, hasMonochrome),
    );
    fs.writeFileSync(
      path.join(anydpi, "ic_launcher_round.xml"),
      defaultAdaptiveIconXml(hasBackground, hasMonochrome),
    );
  }

  console.log(`synced ${milestoneName}${isDefault ? " (default launcher)" : ""}`);
}

function syncInAppAssets(mainDir, assetsDir) {
  ensureDir(assetsDir);
  const adaptiveDir = path.join(assetsDir, "adaptive");
  ensureDir(adaptiveDir);
  for (const milestoneName of MILESTONES) {
    const xxxhdpi = path.join(
      mainDir,
      milestoneName,
      "android",
      "res",
      "mipmap-xxxhdpi",
    );
    const launcherSrc = path.join(xxxhdpi, "ic_launcher.png");
    const foregroundSrc = path.join(xxxhdpi, "ic_launcher_foreground.png");
    const dest = path.join(assetsDir, `${milestoneName}.png`);
    const adaptiveDest = path.join(adaptiveDir, `${milestoneName}.png`);
    if (copyFile(launcherSrc, dest)) {
      console.log(`in-app asset: ${milestoneName}.png`);
    }
    if (copyFile(foregroundSrc, adaptiveDest)) {
      console.log(`adaptive asset: adaptive/${milestoneName}.png`);
    }
  }
}

function purgeWebpWhenPngExists(resDir) {
  for (const dpi of MIPMAP_DPI) {
    const destDpi = path.join(resDir, dpi);
    if (!fs.existsSync(destDpi)) continue;
    for (const file of fs.readdirSync(destDpi)) {
      if (!file.endsWith(".webp")) continue;
      const base = file.slice(0, -".webp".length);
      if (fs.existsSync(path.join(destDpi, `${base}.png`))) {
        fs.unlinkSync(path.join(destDpi, file));
      }
    }
  }
}

function syncWalkChampProgressIcons(projectRoot) {
  const mainDir = path.join(projectRoot, "android", "app", "src", "main");
  const resDir = path.join(mainDir, "res");
  const assetsDir = path.join(projectRoot, "assets", "icons");

  if (!fs.existsSync(mainDir)) {
    console.warn(`android main dir missing: ${mainDir}`);
    return;
  }

  ensureDir(resDir);

  for (const milestoneName of MILESTONES) {
    syncMilestone(projectRoot, mainDir, resDir, milestoneName, milestoneName === "WalkChampProgress0");
  }

  purgeWebpWhenPngExists(resDir);
  syncInAppAssets(mainDir, assetsDir);
  console.log("WalkChamp progress icons sync complete.");
}

if (require.main === module) {
  const projectRoot = path.resolve(__dirname, "..");
  syncWalkChampProgressIcons(projectRoot);
}

module.exports = { syncWalkChampProgressIcons, MILESTONES };
