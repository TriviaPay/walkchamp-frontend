/**
 * Ongoing race tray label hint — Free / Coins Battle / Cash / Sponsored / Streak.
 * Native FGS maps this to the text under the LIVE badge.
 */
export function resolveRaceNotificationTypeHint(input: {
  type?: string | null;
  entryType?: string | null;
  challengeType?: string | null;
  unlimited?: boolean | null;
  isSponsored?: boolean | null;
}): string {
  if (input.unlimited === true || String(input.challengeType ?? "").toLowerCase() === "unlimited_goal") {
    return "unlimited_goal";
  }
  if (
    input.isSponsored === true ||
    String(input.type ?? "").toLowerCase() === "sponsored" ||
    String(input.challengeType ?? "").toLowerCase() === "sponsored"
  ) {
    return "sponsored";
  }
  const blob = `${input.type ?? ""} ${input.entryType ?? ""} ${input.challengeType ?? ""}`.toLowerCase();
  if (blob.includes("coin")) return "coins_battle";
  if (blob.includes("cash") || blob.includes("paid_usd") || /\bpaid\b/.test(blob)) return "cash";
  return "free";
}
