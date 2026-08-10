/**
 * Single Walk-tab focus refresh owner.
 * HIGH: today's steps (one coalesced GET). MEDIUM/LOW: TTL-gated secondary data.
 * Does not blank the screen — callers keep showing existing state.
 */
import { useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { InteractionManager } from "react-native";
import { apiFetchAllowed, markApiFetched, runCoalescedAuthed } from "@/utils/apiRequestCoordinator";
import { perf } from "@/utils/perfLogger";

export type WalkScreenBootstrapArgs = {
  enabled: boolean;
  userId: string | undefined;
  /** HIGH — single physical /api/walk/today (and related step refresh). */
  refreshToday: () => Promise<void>;
  /** After HIGH — resume pedometer/HC watch (no network storm). */
  resumeWatching?: () => void;
  /** MEDIUM — challenge cards */
  refreshChallenges?: () => void;
  /** LOW — themes/coins/rooms/sponsored (already TTL-gated inside) */
  refreshSecondary?: () => void;
};

export function useWalkScreenBootstrap({
  enabled,
  userId,
  refreshToday,
  resumeWatching,
  refreshChallenges,
  refreshSecondary,
}: WalkScreenBootstrapArgs): void {
  useFocusEffect(
    useCallback(() => {
      if (!enabled || !userId) return;

      const todayKey = `walk_focus_today:${userId}`;
      let cancelled = false;

      const run = async () => {
        // HIGH: coalesce duplicate today fetches from rank/db/rehydrate paths.
        if (apiFetchAllowed(todayKey, 8_000)) {
          markApiFetched(todayKey);
          perf.focusFetch("Walk", "today", "start");
          await runCoalescedAuthed(todayKey, userId, async () => {
            if (!cancelled) await refreshToday();
          });
        } else {
          perf.focusFetch("Walk", "today", "skip_ttl");
        }

        if (cancelled) return;
        resumeWatching?.();

        // MEDIUM after first interactions
        InteractionManager.runAfterInteractions(() => {
          if (cancelled) return;
          refreshChallenges?.();
          // LOW — stagger so it does not compete with challenge paint
          setTimeout(() => {
            if (!cancelled) refreshSecondary?.();
          }, 250);
        });
      };

      void run();
      return () => {
        cancelled = true;
      };
    }, [
      enabled,
      userId,
      refreshToday,
      resumeWatching,
      refreshChallenges,
      refreshSecondary,
    ]),
  );
}
