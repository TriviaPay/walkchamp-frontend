import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { stepsKeys } from "@/services/queryKeys";
import { QUERY_STALE_TIMES } from "@/services/queryClient";
import { fetchTodayWalkFromApi } from "@/services/walkTodayApi";
import { getTodayKey } from "@/utils/format";

const DEFAULT_DAILY_GOAL = 10_000;

export function useTodayWalkSteps(userId: string | undefined | null) {
  const { sessionToken, loading: authLoading } = useAuth();
  const localDate = getTodayKey();
  const authReady = !authLoading;
  const enabled = authReady && !!sessionToken && !!userId;

  const query = useQuery({
    queryKey: userId
      ? stepsKeys.today(userId, localDate)
      : ["todaySteps", "anonymous", localDate],
    queryFn: () => fetchTodayWalkFromApi(userId!, localDate),
    enabled,
    staleTime: QUERY_STALE_TIMES.steps,
    gcTime: 10 * 60_000,
    refetchOnMount: false,
  });

  const data = query.data;

  return {
    ...query,
    authReady,
    tokenExists: !!sessionToken,
    localDate,
    todaySteps: data?.todaySteps ?? 0,
    goalSteps: data?.goalSteps ?? DEFAULT_DAILY_GOAL,
    dailyRank: data?.dailyRank ?? null,
    activeMinutes: data?.activeMinutes ?? 0,
    progress:
      (data?.goalSteps ?? DEFAULT_DAILY_GOAL) > 0
        ? (data?.todaySteps ?? 0) / (data?.goalSteps ?? DEFAULT_DAILY_GOAL)
        : 0,
  };
}
