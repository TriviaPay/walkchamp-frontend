import { normalizeActiveRaceInfo, type ActiveRaceInfo } from "@/components/ActiveRaceModal";
import { authFetch } from "@/utils/authFetch";

export function isOneChallengeConflictCode(code: unknown): boolean {
  return (
    code === "ACTIVE_RACE_EXISTS" ||
    code === "one_challenge_at_a_time" ||
    code === "REGULAR_RACE_REGISTRATION_EXISTS"
  );
}

/** Map join/host 409 bodies (`active_race` or `blocking`) into the existing modal shape. */
export function activeRaceFromConflictBody(
  body: Record<string, unknown>,
): ActiveRaceInfo | null {
  const raw = (body.active_race ?? body.blocking) as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return null;
  const kind = String(raw.kind ?? "");
  const info = normalizeActiveRaceInfo({
    ...raw,
    room_id: String(raw.room_id ?? raw.id ?? ""),
    room_status: String(raw.room_status ?? raw.status ?? ""),
    challenge_type: String(
      raw.challenge_type ??
        (kind === "unlimited" ? "unlimited_goal" : raw.entryType ?? ""),
    ),
    room_type: String(
      raw.room_type ?? (kind === "unlimited" ? "unlimited_goal" : raw.type ?? ""),
    ),
  });
  return info.room_id ? info : null;
}

function isSponsoredInfo(info: ActiveRaceInfo): boolean {
  return (
    info.is_sponsored === true ||
    info.room_type === "sponsored" ||
    info.challenge_type === "sponsored"
  );
}

/**
 * Streak / classic membership that must block joining another non-sponsored challenge.
 * Sponsored is allowed alongside (companion race).
 */
export async function fetchBlockingNonSponsoredChallenge(): Promise<ActiveRaceInfo | null> {
  try {
    const unl = await authFetch("/api/unlimited-challenges/my-active");
    if (unl.ok) {
      const data = (await unl.json()) as { challenges?: Record<string, unknown>[] };
      const row = data.challenges?.[0];
      if (row) {
        const id = String(row.id ?? row.challengeId ?? row.room_id ?? "");
        if (id) {
          return normalizeActiveRaceInfo({
            room_id: id,
            room_status: String(row.status ?? "waiting"),
            challenge_type: "unlimited_goal",
            room_type: "unlimited_goal",
            entry_fee:
              typeof row.entryFeeCents === "number" ? row.entryFeeCents / 100 : 0,
            target_steps:
              typeof row.dailyGoalSteps === "number" ? row.dailyGoalSteps : 0,
            current_user_role: "participant",
            can_leave: true,
            next_screen: "waiting_room",
            scheduled_start_at: (row.startAtUtc ??
              row.startAtIso ??
              row.scheduledStartAt) as string | undefined,
            duration_days: row.durationDays as number | undefined,
            challenge_timezone: row.challengeTimezone as string | undefined,
          });
        }
      }
    }
  } catch {
    /* optional */
  }

  try {
    const res = await authFetch("/api/races/current-active");
    if (!res.ok) return null;
    const data = (await res.json()) as {
      has_active_race?: boolean;
      active_race?: Record<string, unknown> | null;
    };
    if (!data.has_active_race || !data.active_race) return null;
    const info = normalizeActiveRaceInfo(data.active_race);
    if (!info.room_id || isSponsoredInfo(info)) return null;
    return info;
  } catch {
    return null;
  }
}
