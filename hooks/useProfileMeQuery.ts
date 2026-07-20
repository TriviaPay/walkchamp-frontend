/**
 * React Query — profile/me (server state). Does not replace AppContext wallet;
 * uses existing hotReads coalescing + authFetch contracts.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchProfileMe } from "@/services/api/hotReads";
import { QUERY_STALE_TIMES } from "@/services/queryClient";
import { useAuth } from "@/context/AuthContext";

export function useProfileMeQuery(enabled = true) {
  const { user, sessionToken } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: ["profile", userId ?? "anon"],
    enabled: enabled && !!userId && !!sessionToken,
    staleTime: QUERY_STALE_TIMES.profile,
    queryFn: async () => {
      const result = await fetchProfileMe();
      if (!result.ok) throw new Error(`profile_me_${result.status}`);
      return result.data;
    },
  });
}
