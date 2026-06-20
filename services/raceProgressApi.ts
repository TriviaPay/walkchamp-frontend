import { getValidSession } from "@/services/authService";
import { timeoutSignal, STEP_SYNC_TIMEOUT, API_TIMEOUT_MS } from "@/utils/authFetch";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

export type RaceProgressSource =
  | "healthkit"
  | "health_connect"
  | "simulation"
  | "race_start"
  | string;

export async function postRaceProgress(
  raceId: string,
  steps: number,
  sequenceId?: number,
  deviceTotalSteps?: number,
  stepSource?: RaceProgressSource,
): Promise<boolean> {
  try {
    const session = await getValidSession();
    if (!session) return false;
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
    if (__DEV__) {
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      console.log(
        `[RaceSteps] sync response progress: ${json.steps ?? "?"} skipped=${json.skipped ?? false}`,
      );
    }
    return true;
  } catch (err) {
    if (__DEV__) console.log(`[RaceSteps] sync failed: ${String(err)}`);
    return false;
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
