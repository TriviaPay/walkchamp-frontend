import { getValidSession } from "@/services/authService";
import { timeoutSignal, API_TIMEOUT_MS } from "@/utils/authFetch";
import { getTodayKey } from "@/utils/format";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

export type TodayWalkApiResponse = {
  today?: {
    steps?: number;
    goal?: number;
    dailyRank?: number | null;
    activeMinutes?: number;
  };
};

export type TodayWalkData = {
  todaySteps: number;
  goalSteps: number;
  dailyRank: number | null;
  activeMinutes: number;
  localDate: string;
};

const DEFAULT_DAILY_GOAL = 10_000;

export function parseTodayWalkResponse(
  data: TodayWalkApiResponse,
  localDate: string,
): TodayWalkData {
  const today = data.today ?? {};
  return {
    todaySteps:
      typeof today.steps === "number"
        ? Math.max(0, Math.floor(today.steps))
        : 0,
    goalSteps:
      typeof today.goal === "number" && today.goal > 0
        ? today.goal
        : DEFAULT_DAILY_GOAL,
    dailyRank:
      typeof today.dailyRank === "number"
        ? today.dailyRank
        : today.dailyRank === null
          ? null
          : null,
    activeMinutes:
      typeof today.activeMinutes === "number" && today.activeMinutes > 0
        ? today.activeMinutes
        : 0,
    localDate,
  };
}

export async function fetchTodayWalkFromApi(
  userId: string,
  localDate = getTodayKey(),
): Promise<TodayWalkData> {
  const token = await getValidSession();
  if (!token) {
    if (__DEV__) {
      console.log(
        `[WalkScreen] skipped fetch reason=missing token userId=${userId}`,
      );
    }
    return parseTodayWalkResponse({}, localDate);
  }

  if (__DEV__) {
    console.log(
      `[WalkScreen] fetching DB steps queryKey=["todaySteps","${userId}","${localDate}"]`,
    );
  }

  const res = await fetch(
    `${API_BASE}/api/walk/today?localDate=${encodeURIComponent(localDate)}`,
    {
      signal: timeoutSignal(API_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!res.ok) {
    if (__DEV__) {
      console.log(`[WalkScreen] DB response=error status=${res.status}`);
    }
    return parseTodayWalkResponse({}, localDate);
  }

  const json = (await res.json()) as TodayWalkApiResponse;
  const parsed = parseTodayWalkResponse(json, localDate);
  if (__DEV__) {
    console.log(
      `[WalkScreen] DB response=steps:${parsed.todaySteps} goal:${parsed.goalSteps} rank:${parsed.dailyRank}`,
    );
  }
  return parsed;
}
