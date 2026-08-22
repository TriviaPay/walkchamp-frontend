/** User-facing name for paid USD / cash prize challenges. */
export const TOP_FINISHERS_CHALLENGE = "Top finishers Challenge";
export const TOP_FINISHERS_CHALLENGES = "Top finishers Challenges";

/** Remap legacy "Cash Challenge" copy without changing amounts or other words. */
export function displayCashChallengeCopy(text: string): string {
  if (!text) return text;
  return text
    .replace(/Cash Prize Challenges/gi, TOP_FINISHERS_CHALLENGES)
    .replace(/Cash Prize Challenge/gi, TOP_FINISHERS_CHALLENGE)
    .replace(/Cash Challenges/gi, TOP_FINISHERS_CHALLENGES)
    .replace(/Cash Challenge/gi, TOP_FINISHERS_CHALLENGE);
}
