/**
 * useStepSourceGuard
 *
 * All races (free + cash/coins/sponsored) require verified Health Connect / HealthKit.
 * Prefer opening the existing WearableSetupModal via onSetupRequired.
 *
 * Usage:
 *   const { canJoinRewardRaces, guardRewardAction } = useStepSourceGuard({
 *     onSetupRequired: () => setShowStepSetup(true),
 *   });
 *   <Button onPress={() => guardRewardAction(handleJoin)} />
 */

import { useCallback } from "react";
import { Alert, Platform } from "react-native";
import { useWalkContext } from "@/context/WalkContext";
import { requireVerifiedStepTracking } from "@/services/steps/verifiedStepCapability";

export function useStepSourceGuard(options?: {
  /** Open existing WearableSetupModal — no new modal. */
  onSetupRequired?: () => void;
}) {
  const { canJoinRewardRaces, verificationLevel, activeStepSource } = useWalkContext();
  const onSetupRequired = options?.onSetupRequired;

  /**
   * Wrap join/create/race actions. Blocks until verified tracking is available;
   * otherwise opens WearableSetupModal (or Alert fallback).
   */
  const guardRewardAction = useCallback(
    (action: () => void) => {
      void requireVerifiedStepTracking({
        action: "join_or_create_race",
        onAllowed: () => {
          action();
        },
        onSetupRequired: () => {
          if (onSetupRequired) {
            onSetupRequired();
            return;
          }
          Alert.alert(
            "Verified Step Tracking Required",
            Platform.OS === "ios"
              ? "Connect Apple Health to join or create challenges."
              : "Connect Health Connect to join or create challenges.",
            [{ text: "OK" }],
          );
        },
      });
    },
    [onSetupRequired],
  );

  return { canJoinRewardRaces, guardRewardAction, verificationLevel, activeStepSource };
}
