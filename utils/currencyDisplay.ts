/**
 * Shared "$X.XX (≈₹YYY)" display helper for Indian users.
 *
 * This is a display-only hint — it never changes what is actually charged/paid.
 * Every existing USD label keeps showing the real USD amount first; Indian users
 * additionally see an approximate INR conversion in brackets right after it.
 */
import { store } from "@/store";
import { getUsdToInrRateSync } from "@/utils/fxRate";

export interface MinimalUserForCurrency {
  countryCode?: string | null;
  country?: string | null;
}

export function isIndiaUser(user?: MinimalUserForCurrency | null): boolean {
  if (!user) return false;
  const code = (user.countryCode ?? "").trim().toUpperCase();
  const country = (user.country ?? "").trim().toLowerCase();
  return code === "IN" || country === "india" || country === "in";
}

/** True when the *current signed-in* user is Indian, read straight from the Redux store. */
export function isCurrentUserIndian(): boolean {
  try {
    return isIndiaUser(store.getState().auth.user);
  } catch {
    return false;
  }
}

function formatInrApprox(inrAmount: number): string {
  const rounded = Math.round(inrAmount);
  return `₹${rounded.toLocaleString("en-IN")}`;
}

/**
 * "(≈₹YYY)" for the current Indian user, or null (nothing to render) otherwise.
 * Kept separate from the amount label so callers can render it as its own,
 * smaller-font `<Text>` node instead of baking it into a single-size string.
 */
export function getInrHintLabel(usdAmount: number): string | null {
  if (!Number.isFinite(usdAmount) || usdAmount <= 0) return null;
  if (!isCurrentUserIndian()) return null;
  const inr = usdAmount * getUsdToInrRateSync();
  return `(≈${formatInrApprox(inr)})`;
}

/**
 * Appends "(≈₹YYY)" after a USD-formatted string for Indian users. Pass the raw dollar
 * amount alongside the already-formatted label so we never re-derive/parse currency text.
 *
 * Example: appendInrHint(3, "$3.00") -> "$3.00 (≈₹264)" for an Indian user, else "$3.00".
 */
export function appendInrHint(usdAmount: number, formattedUsd: string): string {
  if (!Number.isFinite(usdAmount) || usdAmount <= 0) return formattedUsd;
  if (!isCurrentUserIndian()) return formattedUsd;
  const inr = usdAmount * getUsdToInrRateSync();
  return `${formattedUsd} (≈${formatInrApprox(inr)})`;
}

/** Convenience: format a dollar amount (already in dollars, not cents) with the INR hint. */
export function formatUsdWithInrHint(dollars: number): string {
  const n = typeof dollars === "number" && Number.isFinite(dollars) ? dollars : 0;
  return appendInrHint(n, `$${n.toFixed(2)}`);
}

/** Convenience: format a cents amount with the INR hint. */
export function formatUsdCentsWithInrHint(cents: number): string {
  const n = typeof cents === "number" && Number.isFinite(cents) ? cents : 0;
  return formatUsdWithInrHint(n / 100);
}
