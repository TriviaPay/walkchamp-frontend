/**
 * Walk screen daily total display.
 * Shows confirmed steps on the same render (no tick animation / useEffect lag)
 * so the hero stays in sync with sensor + ongoing notification.
 */

import { useRef } from "react";

export function useIncrementalStepDisplay(confirmedSteps: number): number {
  const safe = Math.max(0, Math.floor(confirmedSteps));
  const peakRef = useRef(safe);

  // Allow reset on midnight / account switch / large HC correction; otherwise
  // keep a monotonic peak so brief provider dips don't flash the counter down.
  if (safe === 0 || safe + 500 < peakRef.current) {
    peakRef.current = safe;
  } else if (safe > peakRef.current) {
    peakRef.current = safe;
  }

  return peakRef.current;
}
