/**
 * Challenge-day identity helpers for Unlimited Live progress merges.
 * Day keys are YYYY-MM-DD in the participant/challenge locked IANA timezone.
 */

/** Format an instant as YYYY-MM-DD in an IANA timezone (DST-safe). */
export function formatChallengeDayKey(
  instant: Date | number | string,
  timeZone: string | null | undefined,
): string | null {
  const tz = typeof timeZone === "string" && timeZone.trim() ? timeZone.trim() : null;
  if (!tz) return null;
  const date =
    instant instanceof Date
      ? instant
      : typeof instant === "number"
        ? new Date(instant)
        : new Date(String(instant));
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (!y || !m || !d) return null;
    return `${y}-${m}-${d}`;
  } catch {
    return null;
  }
}

export function isSameChallengeDay(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a === b;
}
