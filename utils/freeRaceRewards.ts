/**
 * Free-challenge coin rewards — must match Backend `coinRewardService.getRaceWinRewardCode`.
 * Coins are awarded only for races with targetSteps >= 1000.
 */

export const FREE_RACE_COIN_MIN_TARGET_STEPS = 1000;

/** Coins awarded per rank in free races (1st / 2nd / 3rd). */
export const FREE_TIER_COIN_REWARDS = [50, 30, 20] as const;

export function freeRaceAwardsCoinPrizes(
  targetSteps: number | null | undefined,
): boolean {
  return (
    typeof targetSteps === "number" &&
    Number.isFinite(targetSteps) &&
    targetSteps >= FREE_RACE_COIN_MIN_TARGET_STEPS
  );
}

/** Winner slots: 2→1, 3→2, 4+→3 (matches backend numWinners). */
export function freeRaceWinnerSlots(playerCount: number): number {
  if (playerCount <= 1) return 0;
  if (playerCount === 2) return 1;
  if (playerCount === 3) return 2;
  return 3;
}

/** Total coin prize pool for a free race, or 0 when the goal is below the coin threshold. */
export function freeRaceCoinPrizePool(
  playerCount: number,
  targetSteps: number | null | undefined,
): number {
  if (!freeRaceAwardsCoinPrizes(targetSteps)) return 0;
  const slots = freeRaceWinnerSlots(playerCount);
  return FREE_TIER_COIN_REWARDS.slice(0, slots).reduce((a, b) => a + b, 0);
}
