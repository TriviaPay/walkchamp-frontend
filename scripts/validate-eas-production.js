/**
 * Production EAS env guard — fails CI if the store profile ships cash-on
 * or sandbox payment / AdMob sample IDs.
 * Run: node scripts/validate-eas-production.js
 */
const fs = require("fs");
const path = require("path");

const easPath = path.join(__dirname, "..", "eas.json");
const eas = JSON.parse(fs.readFileSync(easPath, "utf8"));
const prod = eas?.build?.production?.env;
if (!prod || typeof prod !== "object") {
  console.error("eas.json build.production.env is missing");
  process.exit(1);
}

const errors = [];
if (prod.EXPO_PUBLIC_ENABLE_CASH_CHALLENGES !== "false") {
  errors.push(
    "EXPO_PUBLIC_ENABLE_CASH_CHALLENGES must be false on production EAS until legal F-04 is signed off.",
  );
}
if (prod.EXPO_PUBLIC_APP_ENV !== "production") {
  errors.push("EXPO_PUBLIC_APP_ENV must be production.");
}

for (const [key, value] of Object.entries(prod)) {
  const v = String(value ?? "");
  if (v.includes("pk_test_") || v.includes("rzp_test_")) {
    errors.push(`${key} embeds a test payment key in the production profile.`);
  }
  if (v.includes("ca-app-pub-3940256099942544")) {
    errors.push(`${key} embeds a Google sample AdMob ID in the production profile.`);
  }
}

if (errors.length) {
  console.error("Production EAS validation failed:\n" + errors.map((e) => ` - ${e}`).join("\n"));
  process.exit(1);
}

console.log("validate-eas-production: ok");
