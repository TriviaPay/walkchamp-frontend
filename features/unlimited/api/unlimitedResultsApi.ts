/**
 * Data access for the Unlimited Daily Goal Challenge Results screen.
 *
 * Detail: `GET /api/unlimited-challenges/:id`
 * History: `GET /api/unlimited-challenges/:id/daily-history?userId=`
 * Own prize: prefer participant-row `payoutCents` from detail; notifications are fallback only.
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

/** Prefer backend payout stored on the viewer’s participant row. */
export function payoutCentsFromParticipants(
  participants: UnlimitedLiveDetailMapped["participants"] | null | undefined,
  viewerUserId: string | null | undefined,
): number | null {
  if (!viewerUserId || !participants?.length) return null;
  const me = participants.find((p) => p.userId === viewerUserId);
  const cents = me?.payoutCents;
  if (typeof cents !== "number" || !Number.isFinite(cents)) return null;
  return Math.floor(cents);
}

/**
 * The logged-in user's own final payout for this challenge.
 * Prefer participant-row `payoutCents` from challenge detail (authoritative).
 * Fallback: scan recent `race_won` notifications (limit=50) — retention/ordering fragile.
 */
export async function fetchUnlimitedOwnPrizeShareCents(
  challengeId: string,
  opts?: {
    viewerUserId?: string | null;
    participants?: UnlimitedLiveDetailMapped["participants"] | null;
  },
): Promise<number | null> {
  const fromRow = payoutCentsFromParticipants(opts?.participants, opts?.viewerUserId);
  if (fromRow != null) return fromRow;

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
