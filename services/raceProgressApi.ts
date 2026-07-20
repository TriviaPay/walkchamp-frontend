import { getValidSession } from "@/services/authService";
import { timeoutSignal, STEP_SYNC_TIMEOUT, API_TIMEOUT_MS } from "@/utils/authFetch";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

export type RaceProgressSource =
  | "healthkit"
  | "health_connect"
  | "simulation"
  | "race_start"
  | string;

export interface RaceProgressResult {
  ok: boolean;
  acceptedSteps: number;
  skipped: boolean;
  rank?: number;
  totalParticipants?: number;
  goalSteps?: number;
  timeLeftSeconds?: number;
  username?: string;
  raceStatus?: string;
  userId?: string;
  raceId?: string;
}

export async function postRaceProgress(
  raceId: string,
  steps: number,
  sequenceId?: number,
  deviceTotalSteps?: number,
  stepSource?: RaceProgressSource,
): Promise<RaceProgressResult> {
  try {
    const session = await getValidSession();
    if (!session) return { ok: false, acceptedSteps: 0, skipped: false };
    const body: Record<string, unknown> = {
      steps,
      deviceTime: new Date().toISOString(),
    };
    if (sequenceId !== undefined) body.sequenceId = sequenceId;
    if (deviceTotalSteps !== undefined) body.deviceTotalSteps = deviceTotalSteps;
    if (stepSource !== undefined) body.stepSource = stepSource;
    if (__DEV__) {
      console.log(
        `[RaceSteps] sending sync: raceId=${raceId} steps=${steps} source=${stepSource ?? "unknown"} seq=${sequenceId ?? "n/a"} deviceTotal=${deviceTotalSteps ?? "n/a"}`,
      );
    }
    const res = await fetch(`${API_BASE}/api/races/${raceId}/progress`, {
      method: "POST",
      signal: timeoutSignal(STEP_SYNC_TIMEOUT),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session}`,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const acceptedSteps =
      typeof json.steps === "number" ? json.steps : typeof json.raceSteps === "number" ? json.raceSteps : steps;
    const skipped = json.skipped === true || typeof json.skipped === "string";
    if (__DEV__) {
      console.log(
        `[RaceSteps] sync response HTTP ${res.status} progress:${acceptedSteps} skipped=${skipped}`,
      );
    }
    if (!res.ok) {
      return { ok: false, acceptedSteps: 0, skipped: false };
    }
    return {
      ok: true,
      acceptedSteps,
      skipped,
      rank: typeof json.rank === "number" ? json.rank : undefined,
      totalParticipants: typeof json.totalParticipants === "number" ? json.totalParticipants : undefined,
      goalSteps: typeof json.goalSteps === "number" ? json.goalSteps : undefined,
      timeLeftSeconds: typeof json.timeLeftSeconds === "number" ? json.timeLeftSeconds : undefined,
      username: typeof json.username === "string" ? json.username : undefined,
      raceStatus: typeof json.raceStatus === "string" ? json.raceStatus : typeof json.race_status === "string" ? json.race_status : undefined,
      userId: typeof json.userId === "string" ? json.userId : undefined,
      raceId: typeof json.raceId === "string" ? json.raceId : undefined,
    };
  } catch (err) {
    if (__DEV__) console.log(`[RaceSteps] sync failed: ${String(err)}`);
    return { ok: false, acceptedSteps: 0, skipped: false };
  }
}

export async function postRaceReconcile(
  raceId: string,
  steps: number,
  source: string,
): Promise<void> {
  try {
    const session = await getValidSession();
    if (!session) return;
    await fetch(`${API_BASE}/api/races/${raceId}/reconcile-steps`, {
      method: "POST",
      signal: timeoutSignal(API_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session}`,
      },
      body: JSON.stringify({ steps, source }),
    });
  } catch {
    /* best-effort */
  }
}

export async function registerLiveActivityToken(
  raceId: string,
  activityId: string,
  pushToken: string,
  platform: "ios" | "android" = "ios",
): Promise<boolean> {
  try {
    const session = await getValidSession();
    if (!session) return false;
    const res = await fetch(`${API_BASE}/api/races/${raceId}/live-activity/register`, {
      method: "POST",
      signal: timeoutSignal(API_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session}`,
      },
      body: JSON.stringify({ activityId, pushToken, platform }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
