/**
 * Defensive guard: Unlimited challenge IDs must never hit POST /api/races/:id/progress.
 * Also retains day/timezone context for provisional Unlimited live uploads while
 * the user remains an active participant (not tied to Live Detail mount).
 */

type UnlimitedLiveContext = {
  challengeDayKey: string;
  timezone: string;
};

const unlimitedClassicProgressBlockedIds = new Set<string>();
const unlimitedLiveContextById = new Map<string, UnlimitedLiveContext>();

export function registerUnlimitedClassicProgressBlock(
  challengeId: string | null | undefined,
  ctx?: Partial<UnlimitedLiveContext> | null,
): void {
  const id = typeof challengeId === "string" ? challengeId.trim() : "";
  if (!id) return;
  unlimitedClassicProgressBlockedIds.add(id);
  if (ctx?.challengeDayKey) {
    unlimitedLiveContextById.set(id, {
      challengeDayKey: ctx.challengeDayKey,
      timezone:
        ctx.timezone ||
        Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  }
}

export function unregisterUnlimitedClassicProgressBlock(challengeId: string | null | undefined): void {
  const id = typeof challengeId === "string" ? challengeId.trim() : "";
  if (!id) return;
  unlimitedClassicProgressBlockedIds.delete(id);
  unlimitedLiveContextById.delete(id);
}

export function isUnlimitedClassicProgressBlocked(raceId: string | null | undefined): boolean {
  const id = typeof raceId === "string" ? raceId.trim() : "";
  if (!id) return false;
  return unlimitedClassicProgressBlockedIds.has(id);
}

export function getBlockedUnlimitedChallengeIds(): string[] {
  return [...unlimitedClassicProgressBlockedIds];
}

export function getUnlimitedLiveContext(
  challengeId: string,
): UnlimitedLiveContext | null {
  return unlimitedLiveContextById.get(challengeId) ?? null;
}

/** Test helper — clear all blocked ids. */
export function clearUnlimitedClassicProgressBlocks(): void {
  unlimitedClassicProgressBlockedIds.clear();
  unlimitedLiveContextById.clear();
}
