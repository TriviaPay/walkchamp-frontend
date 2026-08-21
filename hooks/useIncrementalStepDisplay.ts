/**
 * Walk screen daily total display.
 * Same number as Health Connect / the ongoing notification — no leftover peak.
 */

import { useRef } from "react";

export function useIncrementalStepDisplay(confirmedSteps: number): number {
  const safe = Math.max(0, Math.floor(confirmedSteps));
  const peakRef = useRef(safe);

  // Keep the last positive total through a brief 0 (refresh). Any real Health
  // Connect update — including 115 → 84 — must replace the peak so Walk
  // matches the tray and the Health Connect app.
  if (safe === 0) {
    return peakRef.current;
  }
  peakRef.current = safe;
  return peakRef.current;
}
