/**
 * Data access for the Unlimited Daily Goal Challenge Results screen.
 *
 * Detail: `GET /api/unlimited-challenges/:id`
 * History: `GET /api/unlimited-challenges/:id/daily-history?userId=`
 * Own prize: `GET /api/notifications` for `race_won` payoutCents only.
 */
import { authFetch } from "@/utils/authFetch";
import {
  mapUnlimitedDetailToLiveDetail,
  type UnlimitedLiveDetailMapped,
} from "@/utils/unlimitedLiveRace";
import type { UnlimitedDailyHistoryPayload } from "@/utils/unlimitedDayProgress";

export interface UnlimitedResultsData {
  race: UnlimitedLiveDetailMapped["race"];
  participants: UnlimitedLiveDetailMapped["participants"];
}

export async function fetchUnlimitedResultsData(
  challengeId: string,
): Promise<UnlimitedResultsData | null> {
  try {
    const res = await authFetch(`/api/unlimited-challenges/${challengeId}`);
    if (!res.ok) return null;
    const payload: unknown = await res.json().catch(() => null);
    const mapped = mapUnlimitedDetailToLiveDetail(payload);
    if (!mapped) return null;
    return { race: mapped.race, participants: mapped.participants };
  } catch {
    return null;
  }
}

/** Full verified day history for a participant (defaults to the caller). */
export async function fetchUnlimitedDailyHistory(
  challengeId: string,
  userId?: string | null,
): Promise<UnlimitedDailyHistoryPayload | null> {
  try {
    const qs = userId ? `?userId=${encodeURIComponent(userId)}` : "";
    const res = await authFetch(`/api/unlimited-challenges/${challengeId}/daily-history${qs}`);
    if (!res.ok) return null;
    const payload: unknown = await res.json().catch(() => null);
    if (!payload || typeof payload !== "object") return null;
    return payload as UnlimitedDailyHistoryPayload;
  } catch {
    return null;
  }
}

/**
 * The logged-in user's own final payout for this challenge, sourced from
 * their `race_won` notification `data.payoutCents` — backend-authoritative,
 * written only once by `settleUnlimitedChallenge`. Returns `null` when no
 * such notification exists yet (not a winner, or settlement hasn't credited
 * this user yet).
 */
export async function fetchUnlimitedOwnPrizeShareCents(challengeId: string): Promise<number | null> {
  try {
    const res = await authFetch("/api/notifications?limit=50");
    if (!res.ok) return null;
    const payload: unknown = await res.json().catch(() => null);
    const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
    const list = Array.isArray(root?.notifications) ? (root!.notifications as unknown[]) : [];
    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      const n = row as Record<string, unknown>;
      if (n.type !== "race_won") continue;
      const data = n.data && typeof n.data === "object" ? (n.data as Record<string, unknown>) : null;
      if (!data) continue;
      const dataChallengeId = typeof data.challengeId === "string" ? data.challengeId : null;
      if (dataChallengeId !== challengeId) continue;
      const cents = typeof data.payoutCents === "number" ? data.payoutCents : null;
      if (cents != null) return cents;
    }
    return null;
  } catch {
    return null;
  }
}
