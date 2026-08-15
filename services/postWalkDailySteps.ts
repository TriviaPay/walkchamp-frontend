import { Platform } from "react-native";
import { authFetch } from "@/utils/authFetch";
import { getDeviceTimezone, getLocalDateStr } from "@/utils/timezone";

/**
 * Persist an absolute daily total to GET /api/walk/history via POST /api/walk/steps.
 * Used on midnight rollover (yesterday) so history matches Health Connect / local day totals.
 */
export async function postWalkDailyTotal(params: {
  totalSteps: number;
  localDate: string;
  source?: string;
}): Promise<boolean> {
  const totalSteps = Math.max(0, Math.floor(params.totalSteps));
  if (totalSteps <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(params.localDate)) {
    return false;
  }
  if (params.localDate === getLocalDateStr()) {
    return false;
  }
  const source =
    params.source ??
    (Platform.OS === "ios" ? "healthkit" : "health_connect");
  const distanceMeters = Math.round(totalSteps * 0.762);
  const caloriesBurned = Math.round(totalSteps * 0.04);
  const activeMinutes = Math.ceil(totalSteps / 120);
  try {
    const res = await authFetch("/api/walk/steps", {
      method: "POST",
      timeoutMs: 15_000,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        steps: totalSteps,
        totalSteps,
        dailySteps: totalSteps,
        distanceMeters,
        caloriesBurned,
        durationSeconds: activeMinutes * 60,
        activeMinutes,
        source,
        localDate: params.localDate,
        timezone: getDeviceTimezone(),
        timestampUtc: new Date().toISOString(),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
