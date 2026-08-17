/**
 * Client-side cash eligibility (age + territory).
 * Server still enforces CASH_FEATURES_ENABLED / REAL_MONEY_*.
 * Default allowlist is US + IN until legal expands territories.
 */

import { ageFromIsoDate } from "@/utils/dateOfBirth";

export const CASH_MIN_AGE = 18;
export const DEFAULT_CASH_ALLOWED_COUNTRIES = ["US", "IN"] as const;

export type CashEligibilityReason =
  | "ok"
  | "build_disabled"
  | "underage"
  | "region"
  | "unknown_profile";

export type CashEligibility = {
  allowed: boolean;
  reason: CashEligibilityReason;
};

export function parseCashAllowedCountries(raw?: string | null): string[] {
  const src = (raw ?? process.env.EXPO_PUBLIC_CASH_ALLOWED_COUNTRIES ?? "US,IN")
    .trim()
    .toUpperCase();
  if (!src) return [...DEFAULT_CASH_ALLOWED_COUNTRIES];
  const codes = src
    .split(",")
    .map((s: string) => s.trim())
    .filter((s: string) => /^[A-Z]{2}$/.test(s));
  return codes.length > 0 ? codes : [...DEFAULT_CASH_ALLOWED_COUNTRIES];
}

export function isCashCountryAllowed(
  countryCode?: string | null,
  countryName?: string | null,
  allowed = parseCashAllowedCountries(),
): boolean {
  const code = (countryCode ?? "").trim().toUpperCase();
  if (code && allowed.includes(code)) return true;
  const name = (countryName ?? "").trim().toLowerCase();
  if (!name) return false;
  if (allowed.includes("IN") && name === "india") return true;
  if (
    allowed.includes("US") &&
    (name === "united states" ||
      name === "usa" ||
      name === "united states of america")
  ) {
    return true;
  }
  return false;
}

export function isCashAgeEligible(
  dateOfBirth?: string | null,
  opts?: { isAdult?: boolean | null; today?: Date },
): boolean {
  if (opts?.isAdult === true) return true;
  const age = ageFromIsoDate(dateOfBirth, opts?.today);
  return age != null && age >= CASH_MIN_AGE;
}

export function resolveCashEligibility(input: {
  buildEnabled: boolean;
  countryCode?: string | null;
  country?: string | null;
  dateOfBirth?: string | null;
  isAdult?: boolean | null;
}): CashEligibility {
  if (!input.buildEnabled) return { allowed: false, reason: "build_disabled" };
  const hasDob = Boolean((input.dateOfBirth ?? "").trim());
  const hasCountry = Boolean(
    (input.countryCode ?? "").trim() || (input.country ?? "").trim(),
  );
  if (!hasDob && input.isAdult !== true) {
    return { allowed: false, reason: "unknown_profile" };
  }
  if (!hasCountry) return { allowed: false, reason: "unknown_profile" };
  if (!isCashAgeEligible(input.dateOfBirth, { isAdult: input.isAdult })) {
    return { allowed: false, reason: "underage" };
  }
  if (!isCashCountryAllowed(input.countryCode, input.country)) {
    return { allowed: false, reason: "region" };
  }
  return { allowed: true, reason: "ok" };
}

export function cashUnavailableMessage(reason: CashEligibilityReason): string {
  switch (reason) {
    case "build_disabled":
      return "Cash challenges are not available in this build.";
    case "underage":
      return "You must be 18 or older to use cash challenges, deposits, and withdrawals.";
    case "region":
      return "Cash challenges are not available in your region.";
    case "unknown_profile":
      return "Add your date of birth and country in Profile to use cash features.";
    default:
      return "Cash features are unavailable.";
  }
}

/** Paid cash (not coins / free / sponsored). Used to hide discovery surfaces. */
export function isPaidCashClientRoom(room: {
  entry_fee?: number | null;
  entryFee?: number | null;
  challenge_type?: string | null;
  challengeType?: string | null;
  entryType?: string | null;
  coin_entry_amount?: number | null;
}): boolean {
  const type = String(
    room.challenge_type ?? room.challengeType ?? room.entryType ?? "",
  ).toLowerCase();
  if (
    type === "free" ||
    type === "coins_battle" ||
    type === "sponsored"
  ) {
    return false;
  }
  if ((room.coin_entry_amount ?? 0) > 0 && !(Number(room.entry_fee ?? room.entryFee ?? 0) > 0)) {
    return false;
  }
  return Number(room.entry_fee ?? room.entryFee ?? 0) > 0;
}

/**
 * Hide cash contests from public discovery. My Races / already-registered
 * rows stay visible so a player can finish or leave a contest they joined.
 */
export function filterOutCashDiscovery<T>(
  items: T[],
  opts: {
    cashUiAllowed: boolean;
    keepAll?: boolean;
    isCash: (item: T) => boolean;
  },
): T[] {
  if (opts.cashUiAllowed || opts.keepAll) return items;
  return items.filter((item) => !opts.isCash(item));
}
