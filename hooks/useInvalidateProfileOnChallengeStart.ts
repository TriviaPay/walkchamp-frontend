import { useEffect } from "react";
import {
  CHANNELS,
  EVENTS,
  subscribeToChannel,
} from "@/core/realtime/realtimeService";
import { queryClient } from "@/services/queryClient";
import { debounceKeyed, resetApiFetchGate } from "@/utils/apiRequestCoordinator";

/**
 * Invalidate the current user's profile once when a race or Streak challenge
 * actually starts. Does not listen to step / progress updates.
 */
export function useInvalidateProfileOnChallengeStart(onInvalidate?: () => void) {
  useEffect(() => {
    const channel = subscribeToChannel(CHANNELS.PRESENCE);
    if (!channel) return;

    const onStarted = () => {
      debounceKeyed(
        "profile_invalidate_on_challenge_start",
        () => {
          resetApiFetchGate("profile_me_full");
          void queryClient.invalidateQueries({ queryKey: ["profile"] });
          onInvalidate?.();
        },
        250,
      );
    };

    channel.bind(EVENTS.RACE_STARTED, onStarted);
    channel.bind("challenge_started", onStarted);
    return () => {
      channel.unbind(EVENTS.RACE_STARTED, onStarted);
      channel.unbind("challenge_started", onStarted);
    };
  }, [onInvalidate]);
}
