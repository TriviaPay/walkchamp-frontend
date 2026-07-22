/**
 * One-command revert for premium onboarding.
 * Usage:
 *   npm run onboarding:disable
 *   npm run onboarding:enable
 */
const fs = require("node:fs");
const path = require("node:path");

const flagFile = path.join(__dirname, "..", "config", "featureFlags.ts");
const mode = process.argv[2] === "enable" ? "enable" : "disable";
const want = mode === "enable";

let src = fs.readFileSync(flagFile, "utf8");
const re =
  /(export const ENABLE_PREMIUM_ONBOARDING =\s*process\.env\.EXPO_PUBLIC_ENABLE_PREMIUM_ONBOARDING !== "false" &&\s*\/\/[^\n]*\n\s*)(true|false);/;

if (!re.test(src)) {
  console.error("Could not find ENABLE_PREMIUM_ONBOARDING hard switch in config/featureFlags.ts");
  process.exit(1);
}

src = src.replace(re, `$1${want};`);
fs.writeFileSync(flagFile, src);
console.log(
  want
    ? "ENABLE_PREMIUM_ONBOARDING = true (premium onboarding ON)"
    : "ENABLE_PREMIUM_ONBOARDING = false (legacy Sign In-first restored)",
);
console.log("Restart Expo with a clean cache: npx expo start -c");
