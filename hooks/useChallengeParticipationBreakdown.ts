import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { profileMeCacheKey } from "@/hooks/useAvatarCache";
import { authFetch } from "@/utils/authFetch";
import { profileMePath } from "@/utils/profileApi";
import { apiFetchAllowed, markApiFetched } from "@/utils/apiRequestCoordinator";
import { screenCache } from "@/utils/screenCache";
import {
  applyIncomingBreakdown,
  extractBreakdownFromProfileMePayload,
  statsHasBreakdownField,
  type ChallengeParticipationBreakdown,
} from "@/utils/challengeParticipationBreakdown";

const PROFILE_ME_TTL_MS = 90_000;

/**
 * Lazy-load challenge participation breakdown for inline Profile expand.
 * Fetches while expanded; seeds from profile cache when available.
 */
export function useChallengeParticipationBreakdown(
  userId: string | undefined,
  enabled: boolean,
): {
  breakdown: ChallengeParticipationBreakdown | undefined;
  loading: boolean;
} {
  const profileCacheKey = profileMeCacheKey(userId);
  const [breakdown, setBreakdown] = useState<ChallengeParticipationBreakdown | undefined>(() => {
    const cached = screenCache.getSync<{ stats?: unknown }>(profileCacheKey);
    return applyIncomingBreakdown(cached?.stats, undefined);
  });
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!userId || !enabled) {
        setLoading(false);
        return;
      }

      const cachedNow = screenCache.getSync<{ stats?: unknown }>(profileCacheKey);
      if (cachedNow?.stats) {
        setBreakdown((prev) => applyIncomingBreakdown(cachedNow.stats, prev));
      }

      if (!apiFetchAllowed("profile_me_full", PROFILE_ME_TTL_MS)) {
        setLoading(false);
        return;
      }

      markApiFetched("profile_me_full");
      setLoading(!statsHasBreakdownField(cachedNow?.stats));
      void (async () => {
        try {
          const res = await authFetch(profileMePath());
          if (!res.ok) return;
          const json: unknown = await res.json();
          const data = (json as { data?: { stats?: unknown } }).data;
          if (statsHasBreakdownField(data?.stats)) {
            setBreakdown(extractBreakdownFromProfileMePayload(json));
          }
        } finally {
          setLoading(false);
        }
      })();
    }, [userId, enabled, profileCacheKey]),
  );

  return { breakdown, loading: enabled && loading && breakdown === undefined };
}
