/**
 * Whether the JS step pipeline currently owns authoritative display state.
 * When true, Android FGS sensor updates must not write Redux / merge into UI
 * (notification may still update from native for background UX).
 */

import { AppState } from "react-native";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import { stepPollingService } from "@/services/StepPollingService";

export function isJsAuthoritativeStepSession(): boolean {
  if (stepProviderManager.isLiveWatchActive()) return true;
  if (stepPollingService.isRacePolling()) return true;
  // Foreground + verified source: HC/HK polls own UI even without a watch handle.
  if (
    AppState.currentState === "active" &&
    stepProviderManager.usesVerifiedStepSource()
  ) {
    return true;
  }
  return false;
}
