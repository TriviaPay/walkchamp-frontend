/**
 * Lightweight tests for date-of-birth helpers (no jest — run via npx tsx).
 */
import {
  normalizeDayInput,
  normalizeMonthInput,
  parseDateOfBirth,
  validateDateOfBirth,
} from "./dateOfBirth";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// normalize
assert(normalizeDayInput("08") === "08", "day 08");
assert(normalizeDayInput("8") === "8", "day 8");
assert(normalizeDayInput("32a") === "32", "day digits only slice");
assert(normalizeMonthInput("5") === "5", "month 5");
assert(normalizeMonthInput("12") === "12", "month 12");

// valid single + double digit
for (const [d, m, y, iso] of [
  ["1", "1", "2000", "2000-01-01"],
  ["01", "01", "2000", "2000-01-01"],
  ["9", "9", "2000", "2000-09-09"],
  ["09", "09", "2000", "2000-09-09"],
  ["8", "5", "1993", "1993-05-08"],
  ["31", "1", "2000", "2000-01-31"],
  ["29", "2", "2000", "2000-02-29"],
  ["30", "4", "2000", "2000-04-30"],
] as const) {
  const p = parseDateOfBirth(d, m, y);
  assert(p.ok && p.iso === iso, `parse ${d}/${m}/${y} → ${iso}`);
}

// invalid
assert(parseDateOfBirth("0", "1", "2000").ok === false, "day 0");
assert(parseDateOfBirth("00", "1", "2000").ok === false, "day 00");
assert(parseDateOfBirth("32", "1", "2000").ok === false, "day 32");
assert(parseDateOfBirth("1", "0", "2000").ok === false, "month 0");
assert(parseDateOfBirth("1", "00", "2000").ok === false, "month 00");
assert(parseDateOfBirth("1", "13", "2000").ok === false, "month 13");
assert(parseDateOfBirth("31", "2", "2000").ok === false, "31 Feb");
assert(parseDateOfBirth("29", "2", "2001").ok === false, "non-leap");
assert(parseDateOfBirth("31", "4", "2000").ok === false, "31 Apr");
assert(parseDateOfBirth("8", "5", "199").ok === false, "incomplete year");

const under = validateDateOfBirth("1", "1", String(new Date().getFullYear() - 10));
assert(under.valid === false, "underage");

const ok = validateDateOfBirth("8", "5", "1993");
assert(ok.valid === true && ok.iso === "1993-05-08", "validate 5/8/1993");

console.log("dateOfBirth tests passed");
