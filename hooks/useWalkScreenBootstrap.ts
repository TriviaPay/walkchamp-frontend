/**
 * Walk screen focus bootstrap — coordinates parallel fetches without changing
 * endpoint contracts or displayed data. Dedupes against recent login hydration.
 */
import { useCallback, useRef } from "react";
import { useFocusEffect } from "expo-router";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "@/store";
import { fetchTrackThemes } from "@/store/slices/trackThemesSlice";
import { fetchCoinBalance } from "@/store/slices/coinsSlice";
import { authFetch, STEP_SYNC_TIMEOUT } from "@/utils/authFetch";
import { runCoalesced, apiFetchAllowed, markApiFetched } from "@/utils/apiRequestCoordinator";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";
import { adaptivePollMs, isPusherHealthy } from "@/services/pusherHealth";
import { perf } from "@/utils/perfLogger";
import { wasHydratedRecently, HYDRATION_KEYS } from "@/services/loginHydration";
import { fetchSponsoredEvents } from "@/services/api/hotReads";

/** Walk focus polls — shorter than general 12s so a slow endpoint cannot pin the tab. */
const WALK_POLL_TIMEOUT_MS = STEP_SYNC_TIMEOUT; // 6s

export type WalkBootstrapHandlers = {
  userReady: boolean;
  usingRealTracking: boolean;
  showCoinStore: boolean;
  refreshTodayRank: () => void | Promise<void>;
  refetchDbWalk: () => void | Promise<unknown>;
  refreshTodaySteps: (opts?: {
    rehydrateBackend?: boolean;
    mergeNative?: boolean;
    applyDisplay?: boolean;
  }) => void | Promise<void>;
  resumeStepWatching: () => void | Promise<void>;
  loadChallengeStatuses: () => void | Promise<void>;
  onRoomCounts?: (counts: { current: number; upcoming: number; total: number }) => void;
  onSponsoredPayload?: (data: unknown) => void;
};

/**
 * Single focus effect that mirrors prior Walk fan-out behavior:
 * rank + walk + steps + themes + coins + challenges (+ adaptive poll) + rooms + sponsored (+ adaptive poll).
 */
export function useWalkScreenBootstrap(h: WalkBootstrapHandlers): void {
  const dispatch = useDispatch<AppDispatch>();
  const handlersRef = useRef(h);
  handlersRef.current = h;

  useFocusEffect(
    useCallback(() => {
      const {
        userReady,
        usingRealTracking,
        showCoinStore,
        refreshTodayRank,
        refetchDbWalk,
        refreshTodaySteps,
        resumeStepWatching,
        loadChallengeStatuses,
        onRoomCounts,
        onSponsoredPayload,
      } = handlersRef.current;

      if (!userReady) {
        if (__DEV__) {
          console.log("[WalkScreen] skipped fetch reason=missing userReady");
        }
        return;
      }

      perf.screenFocus("Walk");
      const focusStarted = Date.now();

      void refreshTodayRank();
      void refetchDbWalk();

      if (usingRealTracking) {
        void refreshTodaySteps({
          rehydrateBackend: true,
          mergeNative: false,
          applyDisplay: false,
        });
        void resumeStepWatching();
      }

      if (!showCoinStore) {
        if (!wasHydratedRecently(HYDRATION_KEYS.trackThemes, 60_000)) {
          dispatch(fetchTrackThemes());
        } else {
          perf.apiSkipped("walk_themes_hydrated");
        }
        if (!wasHydratedRecently(HYDRATION_KEYS.coinBalance, 60_000)) {
          dispatch(fetchCoinBalance());
        } else {
          perf.apiSkipped("walk_coins_hydrated");
        }
      }

      void loadChallengeStatuses();
      const challengePollMs = adaptivePollMs(STEP_SYNC_CONFIG.WALK_CHALLENGE_POLL_MS);
      if (isPusherHealthy() && challengePollMs !== STEP_SYNC_CONFIG.WALK_CHALLENGE_POLL_MS) {
        perf.fallbackPollTriggered(`challenges_stretched_ms=${challengePollMs}`);
      }
      const challengeInterval = setInterval(() => {
        void loadChallengeStatuses();
      }, challengePollMs);

      const fetchRooms = async (force = false) => {
        if (!force && !apiFetchAllowed("walk_room_counts", 15_000)) {
          perf.apiSkipped("walk_room_counts_throttled");
          return;
        }
        try {
          await runCoalesced("walk_room_counts", async () => {
            const res = await authFetch("/api/rooms/counts", {
              timeoutMs: WALK_POLL_TIMEOUT_MS,
            });
            if (!res.ok) return;
            markApiFetched("walk_room_counts");
            const data = (await res.json()) as {
              currentRoomsCount: number;
              upcomingRoomsCount: number;
              totalRoomsCount: number;
            };
            onRoomCounts?.({
              current: data.currentRoomsCount,
              upcoming: data.upcomingRoomsCount,
              total: data.totalRoomsCount,
            });
          });
        } catch {
          /* silent — same as prior Walk screen */
        }
      };
      void fetchRooms(true);

      let sponsoredCancelled = false;
      const fetchSponsored = async () => {
        if (!apiFetchAllowed("walk_sponsored", 20_000)) {
          perf.apiSkipped("walk_sponsored_throttled");
          return;
        }
        try {
          const result = await fetchSponsoredEvents();
          if (!result.ok || !result.data || sponsoredCancelled) return;
          markApiFetched("walk_sponsored");
          onSponsoredPayload?.(result.data);
        } catch {
          /* silent */
        }
      };

      // Always fetch once on focus (matches prior behavior).
      void (async () => {
        try {
          const res = await authFetch("/api/sponsored-events", {
            timeoutMs: WALK_POLL_TIMEOUT_MS,
          });
          if (!res.ok || sponsoredCancelled) return;
          markApiFetched("walk_sponsored");
          onSponsoredPayload?.(await res.json());
        } catch {
          /* silent */
        }
      })();

      const sponsoredPollMs = adaptivePollMs(30_000);
      const sponsoredInterval = setInterval(() => {
        void fetchSponsored();
      }, sponsoredPollMs);

      queueMicrotask(() => {
        perf.focusToContent("Walk");
        perf.firstContentfulRender("Walk");
        if (__DEV__) {
          console.log(`[Perf] screen=Walk focusBatchStartedMs=${Date.now() - focusStarted}`);
        }
      });

      return () => {
        clearInterval(challengeInterval);
        clearInterval(sponsoredInterval);
        sponsoredCancelled = true;
      };
    }, [dispatch, h.userReady, h.usingRealTracking, h.showCoinStore]),
  );
}
