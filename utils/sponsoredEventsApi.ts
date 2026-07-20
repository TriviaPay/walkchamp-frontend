export type SponsoredEventDto = {
  id: string;
  title: string;
  status: string;
  scheduledStartAt: string | null;
  startedAt?: string | null;
  endsAt?: string | null;
  targetSteps: number;
  maxSlots: number;
  registeredCount: number;
  prizePoolCents: number;
  prizePerWinnerCents?: number;
  winnerCount?: number;
  entryCoinFee: number;
  isRegistered: boolean;
  isActive: boolean;
  joinWindowOpen: boolean;
  isFull: boolean;
  canRegister: boolean;
  registeredUsers: Array<{
    userId: string;
    username: string;
    avatarUrl: string | null;
    avatarColor: string;
    countryFlag: string | null;
    badge: string;
  }>;
};

/** Default sponsored goal — matches backend TARGET_STEPS. */
export const SPONSORED_DEFAULT_TARGET_STEPS = 10_000;

/** Default Amazon gift card per winner — matches backend PRIZE_PER_WINNER_CENTS. */
export const SPONSORED_PRIZE_PER_WINNER_CENTS = 500;

/**
 * Sponsored winner slots from active/registered player count:
 *  1–2 players → 1 winner
 *  3–10 players → 2 winners
 */
export function getSponsoredWinnerCount(playerCount: number): number {
  const n = Math.max(0, Math.floor(playerCount));
  if (n <= 0) return 0;
  if (n <= 2) return 1;
  return 2;
}

export function getSponsoredPrizePerWinnerUsd(
  prizePerWinnerCents?: number | null,
): number {
  const cents =
    typeof prizePerWinnerCents === "number" && prizePerWinnerCents > 0
      ? prizePerWinnerCents
      : SPONSORED_PRIZE_PER_WINNER_CENTS;
  return Math.round(cents) / 100;
}

const RACE_DURATION_MS = 3 * 60 * 60 * 1000;

export function parseSponsoredEventsResponse(
  raw: unknown,
): { events: SponsoredEventDto[]; coinBalance: number } {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const nested = body.data && typeof body.data === "object"
    ? (body.data as Record<string, unknown>)
    : null;

  const eventsRaw = body.events ?? nested?.events;
  const events = Array.isArray(eventsRaw) ? (eventsRaw as SponsoredEventDto[]) : [];

  const coinBalance =
    typeof body.coinBalance === "number"
      ? body.coinBalance
      : typeof nested?.coinBalance === "number"
        ? nested.coinBalance
        : 0;

  return { events, coinBalance };
}

/** Show live races and scheduled events until their end window (not only before start). */
export function isSponsoredEventVisible(
  ev: Pick<SponsoredEventDto, "status" | "scheduledStartAt" | "startedAt" | "endsAt" | "isRegistered">,
  now = Date.now(),
): boolean {
  if (ev.status === "in_progress") return true;
  if (ev.status !== "scheduled") return false;

  const endMs = ev.endsAt
    ? new Date(ev.endsAt).getTime()
    : ev.startedAt
      ? new Date(ev.startedAt).getTime() + RACE_DURATION_MS
      : ev.scheduledStartAt
        ? new Date(ev.scheduledStartAt).getTime() + RACE_DURATION_MS
        : 0;

  if (endMs > now) return true;

  // Registered users may still need the card until the server flips status.
  if (ev.isRegistered && ev.scheduledStartAt) {
    return new Date(ev.scheduledStartAt).getTime() + RACE_DURATION_MS > now;
  }

  return false;
}
