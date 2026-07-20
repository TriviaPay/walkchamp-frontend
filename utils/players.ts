export const PLAYER_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export const DEFAULT_PLAYER_COUNT = 10;

export function getPlayerOptions(): number[] {
  return [...PLAYER_OPTIONS];
}

export function getDefaultPlayerCount(): number {
  return DEFAULT_PLAYER_COUNT;
}

export function isValidPlayerCount(count: number): boolean {
  return PLAYER_OPTIONS.includes(count as (typeof PLAYER_OPTIONS)[number]);
}

export function formatPlayerLabel(count: number): string {
  return `${count} player${count === 1 ? "" : "s"}`;
}
