import type { RaceStartingSoonChallengeType } from "@/components/RaceStartingSoonCard";

/** Walk My Race: treat streak / multi-day rooms as unlimited even if entryKey is cash. */
export function isUnlimitedWalkMembership(opts: {
  entryKey?: string | null;
  roomType?: string | null;
  knownChallengeType?: string | null;
  knownEntryType?: string | null;
  durationDays?: number | null;
}): boolean {
  if (opts.entryKey === "unlimited_goal") return true;
  const blob = `${opts.roomType ?? ""} ${opts.knownChallengeType ?? ""} ${opts.knownEntryType ?? ""}`.toLowerCase();
  if (blob.includes("unlimited") || blob.includes("streak")) return true;
  return (opts.durationDays ?? 0) > 1;
}

export function walkSoonCardTypeFromValues(opts: {
  fallback: RaceStartingSoonChallengeType;
  isSponsored?: boolean;
  entryAmountCents?: number | null;
  coinEntryAmount?: number | null;
  prizePoolCents?: number | null;
}): RaceStartingSoonChallengeType {
  if (opts.isSponsored) return "sponsored";
  const coins = Math.max(0, opts.coinEntryAmount ?? 0);
  const cash = Math.max(0, opts.entryAmountCents ?? 0);
  const prize = Math.max(0, opts.prizePoolCents ?? 0);
  if (cash > 0 || prize > 0) return "cash";
  if (coins > 0) return "coins";
  return opts.fallback;
}

/** Valid ISO from API payloads — no 24h / duration math. */
function toIsoOrNull(raw?: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Prefer the farthest API end (full challenge window), never a shorter daily leftover. */
export function pickApiChallengeEndAt(
  ...candidates: Array<string | null | undefined>
): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const raw of candidates) {
    const iso = toIsoOrNull(raw ?? null);
    if (!iso) continue;
    const ms = new Date(iso).getTime();
    if (ms > bestMs) {
      best = iso;
      bestMs = ms;
    }
  }
  return best;
}

/** My Race clock: only ISO fields from list/detail APIs — never cache/Redux/native. */
export function resolveWalkCardEndsAt(opts: {
  raceId?: string | null;
  userId?: string | null;
  endsAt?: string | null;
  endsAtAlt?: string | null;
}): string | null {
  return pickApiChallengeEndAt(opts.endsAt, opts.endsAtAlt);
}
