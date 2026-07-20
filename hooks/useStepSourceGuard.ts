/**
 * useStepSourceGuard
 *
 * Returns helpers to check whether the current user can join reward races
 * (cash challenges, coins battles, sponsored events, paid races).
 *
 * Rules:
 *   verified  → can join all races
 *   limited   → walk tab display only; reward races blocked
 *   unsupported / null → reward races blocked
 *
 * Usage:
 *   const { canJoinRewardRaces, guardRewardAction, verificationLevel } = useStepSourceGuard();
 *   <Button onPress={() => guardRewardAction(handleJoin)} />
 */

import { useCallback } from "react";
import { Alert } from "react-native";
import { useWalkContext } from "@/context/WalkContext";

export function useStepSourceGuard() {
  const { canJoinRewardRaces, verificationLevel, activeStepSource } = useWalkContext();

  /**
   * Wrap a reward action. If the user cannot join reward races, shows an
   * informative alert and does NOT call the action.
   */
  const guardRewardAction = useCallback(
    (action: () => void) => {
      if (canJoinRewardRaces) {
        action();
        return;
      }

      const isLimited = verificationLevel === "limited";
      Alert.alert(
        "Verified Step Tracking Required",
        isLimited
          ? "Limited tracking (phone sensor) cannot be used for cash, coins battles, sponsored rewards, or prize races.\n\nPlease connect Health Connect or Apple Health to join reward races."
          : "Verified step tracking is required to join reward races. Please connect Health Connect or Apple Health.",
        [{ text: "OK" }],
      );
    },
    [canJoinRewardRaces, verificationLevel],
  );

  return { canJoinRewardRaces, guardRewardAction, verificationLevel, activeStepSource };
}
