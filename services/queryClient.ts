import { QueryClient } from "@tanstack/react-query";
import { stepsKeys, walkKeys, USER_STEP_QUERY_PREFIXES } from "@/services/queryKeys";

/** Default stale times by data volatility (ms). */
export const QUERY_STALE_TIMES = {
  profile: 120_000,
  wallet: 30_000,
  liveRace: 5_000,
  leaderboard: 60_000,
  staticConfig: 600_000,
  steps: 30_000,
} as const;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: QUERY_STALE_TIMES.steps,
      gcTime: 10 * 60_000,
      // Reuse cached data on tab revisit; background refetch only when stale.
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});

function queryKeyMatchesUser(queryKey: readonly unknown[], userId: string): boolean {
  if (!Array.isArray(queryKey) || queryKey.length < 2) return false;
  const prefix = String(queryKey[0]);
  if (!USER_STEP_QUERY_PREFIXES.includes(prefix as (typeof USER_STEP_QUERY_PREFIXES)[number])) {
    return false;
  }
  return queryKey[1] === userId;
}

/** Remove all step/walk queries for a specific user (logout or account switch). */
export function clearUserSessionQueryCache(userId?: string): void {
  void queryClient.cancelQueries();
  if (!userId) {
    for (const prefix of USER_STEP_QUERY_PREFIXES) {
      queryClient.removeQueries({ queryKey: [prefix] });
    }
    if (__DEV__) console.log("[AuthSwitch] query cache cleared (all users)");
    return;
  }

  const allQueries = queryClient.getQueryCache().getAll();
  for (const query of allQueries) {
    if (queryKeyMatchesUser(query.queryKey, userId)) {
      queryClient.removeQueries({ queryKey: query.queryKey });
    }
  }
  if (__DEV__) {
    console.log(`[AuthSwitch] query cache cleared for userId=${userId}`);
  }
}

/** @deprecated Use clearUserSessionQueryCache(userId) */
export function clearStepQueryCache(userId?: string): void {
  clearUserSessionQueryCache(userId);
}

export { stepsKeys, walkKeys };
