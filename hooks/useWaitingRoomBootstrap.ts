/**
 * Waiting Room focus/bootstrap orchestration (extract from matchmaking mega-screen).
 * Keeps room poll + presence refresh ownership in one place without changing lobby rules.
 */
import { useCallback, useEffect, useRef } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";

export type WaitingRoomBootstrapArgs = {
  enabled: boolean;
  pollRoom: () => void | Promise<void>;
  refreshOnlineIds?: () => void | Promise<void>;
  /** Defaults to MATCHMAKING_ROOM_POLL_MS */
  pollMs?: number;
};

export function useWaitingRoomBootstrap({
  enabled,
  pollRoom,
  refreshOnlineIds,
  pollMs = STEP_SYNC_CONFIG.MATCHMAKING_ROOM_POLL_MS,
}: WaitingRoomBootstrapArgs): void {
  const pollRef = useRef(pollRoom);
  const onlineRef = useRef(refreshOnlineIds);
  pollRef.current = pollRoom;
  onlineRef.current = refreshOnlineIds;

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      void pollRef.current();
      void onlineRef.current?.();
      const id = setInterval(() => {
        void pollRef.current();
      }, pollMs);
      return () => clearInterval(id);
    }, [enabled, pollMs]),
  );

  // When lobby stays mounted but enabled flips true, ensure one poll.
  useEffect(() => {
    if (!enabled) return;
    void pollRef.current();
  }, [enabled]);
}
