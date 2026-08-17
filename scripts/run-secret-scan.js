/**
 * Mirrors GitHub Actions "Secret scan (working tree)" for local pre-push checks.
 * Downloads gitleaks into %TEMP% / /tmp so project files are never overwritten.
 */
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");

const VERSION = "8.24.2";
const ROOT = path.resolve(__dirname, "..");
const CONFIG = path.join(ROOT, ".gitleaks.toml");

function platformAsset() {
  const p = process.platform;
  const a = process.arch;
  if (p === "win32" && (a === "x64" || a === "arm64")) {
    return {
      name: `gitleaks_${VERSION}_windows_x64.zip`,
      bin: "gitleaks.exe",
      kind: "zip",
    };
  }
  if (p === "darwin" && a === "arm64") {
    return {
      name: `gitleaks_${VERSION}_darwin_arm64.tar.gz`,
      bin: "gitleaks",
      kind: "tar",
    };
  }
  if (p === "darwin") {
    return {
      name: `gitleaks_${VERSION}_darwin_x64.tar.gz`,
      bin: "gitleaks",
      kind: "tar",
    };
  }
  return {
    name: `gitleaks_${VERSION}_linux_x64.tar.gz`,
    bin: "gitleaks",
    kind: "tar",
  };
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          download(res.headers.location, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: ${res.statusCode} ${url}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", reject);
  });
}

async function ensureBinary() {
  const asset = platformAsset();
  const dir = path.join(os.tmpdir(), `walkchamp-gitleaks-${VERSION}`);
  fs.mkdirSync(dir, { recursive: true });
  const binPath = path.join(dir, asset.bin);
  if (fs.existsSync(binPath)) return binPath;

  const archive = path.join(dir, asset.name);
  const url = `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${asset.name}`;
  console.log(`Downloading gitleaks ${VERSION}...`);
  await download(url, archive);

  if (asset.kind === "zip") {
    // Prefer PowerShell Expand-Archive on Windows; fallback to tar if available.
    const ps = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    if (fs.existsSync(ps)) {
      execFileSync(
        ps,
        [
          "-NoProfile",
          "-Command",
          `Expand-Archive -Force -LiteralPath '${archive}' -DestinationPath '${dir}'`,
        ],
        { stdio: "inherit" },
      );
    } else {
      execFileSync("tar", ["-xf", archive, "-C", dir], { stdio: "inherit" });
    }
  } else {
    execFileSync("tar", ["-xzf", archive, "-C", dir], { stdio: "inherit" });
  }

  if (!fs.existsSync(binPath)) {
    throw new Error(`gitleaks binary missing after extract: ${binPath}`);
  }
  try {
    fs.chmodSync(binPath, 0o755);
  } catch {
    /* windows */
  }
  return binPath;
}

async function main() {
  const bin = await ensureBinary();
  const result = spawnSync(
    bin,
    [
      "detect",
      "--no-git",
      "--source",
      ROOT,
      "--redact",
      "--exit-code",
      "1",
      "--config",
      CONFIG,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
  console.log("Secret scan: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
