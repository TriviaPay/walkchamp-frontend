/**
 * Run: npx tsx utils/cashEligibility.test.ts
 */
import assert from "node:assert/strict";
import {
  cashUnavailableMessage,
  filterOutCashDiscovery,
  isCashAgeEligible,
  isCashCountryAllowed,
  isPaidCashClientRoom,
  parseCashAllowedCountries,
  resolveCashEligibility,
} from "./cashEligibility";

assert.deepEqual(parseCashAllowedCountries("us, in"), ["US", "IN"]);
assert.deepEqual(parseCashAllowedCountries(""), ["US", "IN"]);
assert.equal(isCashCountryAllowed("US"), true);
assert.equal(isCashCountryAllowed("IN"), true);
assert.equal(isCashCountryAllowed("GB"), false);
assert.equal(isCashCountryAllowed(null, "India"), true);
assert.equal(isCashCountryAllowed(null, "France"), false);

assert.equal(isCashAgeEligible("2000-01-01"), true);
assert.equal(isCashAgeEligible("2015-01-01"), false);
assert.equal(isCashAgeEligible("", { isAdult: true }), true);
assert.equal(isCashAgeEligible(""), false);

assert.equal(
  resolveCashEligibility({
    buildEnabled: false,
    countryCode: "US",
    dateOfBirth: "2000-01-01",
  }).reason,
  "build_disabled",
);
assert.equal(
  resolveCashEligibility({
    buildEnabled: true,
    countryCode: "US",
    dateOfBirth: "2014-06-01",
  }).reason,
  "underage",
);
assert.equal(
  resolveCashEligibility({
    buildEnabled: true,
    countryCode: "GB",
    dateOfBirth: "1990-01-01",
  }).reason,
  "region",
);
assert.equal(
  resolveCashEligibility({
    buildEnabled: true,
    countryCode: "US",
    dateOfBirth: "1990-01-01",
  }).allowed,
  true,
);
assert.equal(
  resolveCashEligibility({
    buildEnabled: true,
    countryCode: "",
    dateOfBirth: "1990-01-01",
  }).reason,
  "unknown_profile",
);
assert.equal(
  cashUnavailableMessage("region").includes("region"),
  true,
);

assert.equal(
  isPaidCashClientRoom({ entry_fee: 3, challenge_type: "paid_usd" }),
  true,
);
assert.equal(
  isPaidCashClientRoom({ entry_fee: 0, challenge_type: "free" }),
  false,
);
assert.equal(
  isPaidCashClientRoom({
    entry_fee: 0,
    coin_entry_amount: 500,
    challenge_type: "coins_battle",
  }),
  false,
);

const hidden = filterOutCashDiscovery(
  [{ id: "c", cash: true }, { id: "f", cash: false }],
  { cashUiAllowed: false, isCash: (r) => r.cash },
);
assert.deepEqual(hidden.map((r) => r.id), ["f"]);
assert.equal(
  filterOutCashDiscovery([{ id: "c", cash: true }], {
    cashUiAllowed: false,
    keepAll: true,
    isCash: (r) => r.cash,
  }).length,
  1,
);

console.log("cashEligibility.test.ts: ok");
