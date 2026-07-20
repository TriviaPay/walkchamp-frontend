/**
 * Avoids "There was a problem loading the project" (SocketTimeoutException) on
 * first open. expo run:android launches the app while Metro is still building
 * the first bundle — the dev client times out, but Reload works once Metro finishes.
 *
 * Flow: start Metro (if needed) → wait until ready → pre-bundle Android → launch app.
 */
const { spawn, execSync } = require("child_process");
const http = require("http");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.RCT_METRO_PORT || 8081);
const METRO = `http://127.0.0.1:${PORT}`;
const IS_WIN = process.platform === "win32";
const NPX = IS_WIN ? "npx.cmd" : "npx";

function httpGet(url, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("timeout"));
    });
  });
}

async function metroRunning() {
  try {
    const { status, body } = await httpGet(`${METRO}/status`, 2000);
    return status === 200 && body.includes("running");
  } catch {
    return false;
  }
}

async function waitForMetro(maxMs = 180_000) {
  const start = Date.now();
  process.stdout.write("[android] Waiting for Metro");
  while (Date.now() - start < maxMs) {
    if (await metroRunning()) {
      console.log(" — ready");
      return;
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Metro did not become ready in time");
}

async function prewarmAndroidBundle(maxMs = 600_000) {
  const entry = "node_modules/expo-router/entry.bundle";
  const qs =
    "platform=android&dev=true&hot=false&lazy=true&minify=false";
  const url = `${METRO}/${entry}?${qs}`;
  console.log("[android] Pre-bundling for Android (prevents first-launch timeout)...");

  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Bundle prewarm failed (HTTP ${res.statusCode})`));
        return;
      }
      res.on("data", () => {});
      res.on("end", () => {
        console.log("[android] Bundle cached — safe to open app");
        resolve();
      });
    });
    req.on("error", reject);
    req.setTimeout(maxMs, () => {
      req.destroy(new Error("Bundle prewarm timed out"));
    });
  });
}

function setupAdbReverse() {
  try {
    execSync(`adb reverse tcp:${PORT} tcp:${PORT}`, { stdio: "ignore" });
    console.log("[android] adb reverse tcp:8081 configured");
  } catch {
    // Emulator / no device — ignore
  }
}

function run(cmd, args, inherit = true) {
  return spawn(cmd, args, {
    cwd: ROOT,
    stdio: inherit ? "inherit" : "ignore",
    shell: IS_WIN,
  });
}

async function main() {
  let startedMetro = false;

  if (!(await metroRunning())) {
    console.log("[android] Starting Metro...");
    run(NPX, ["expo", "start", "--dev-client", "--port", String(PORT)]);
    startedMetro = true;
    await new Promise((r) => setTimeout(r, 2000));
    await waitForMetro();
  } else {
    console.log("[android] Metro already running");
  }

  await prewarmAndroidBundle();
  setupAdbReverse();

  console.log("[android] Installing / launching (Metro stays running)...");
  const child = run(NPX, [
    "expo",
    "run:android",
    "--no-bundler",
    "--port",
    String(PORT),
  ]);

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  if (startedMetro) {
    console.log(
      "[android] Tip: keep this terminal open while developing. If the app shows a load error, Metro may still be starting — tap Reload.",
    );
  }
}

main().catch((err) => {
  console.error("[android]", err.message);
  process.exit(1);
});
