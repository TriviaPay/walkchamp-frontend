/**
 * Smooth tick-up display for a single monotonic step counter (Walk screen daily total).
 * confirmedSteps is authoritative; displaySteps catches up incrementally for live UI.
 */

import { useEffect, useRef, useState } from "react";

const TICK_MS = 75;
const INSTANT_CATCH_UP_MAX = 20;

export function useIncrementalStepDisplay(confirmedSteps: number): number {
  const safeConfirmed = Math.max(0, Math.floor(confirmedSteps));
  const confirmedRef = useRef(safeConfirmed);
  const displayRef = useRef(safeConfirmed);
  const [display, setDisplay] = useState(safeConfirmed);

  useEffect(() => {
    const next = Math.max(0, Math.floor(confirmedSteps));
    if (next < confirmedRef.current) return;
    const prevConfirmed = confirmedRef.current;
    confirmedRef.current = next;

    const gap = next - displayRef.current;
    // Tab open / refresh catch-up — show immediately; only animate small live +1/+2 ticks.
    if (gap > 3 || (prevConfirmed === 0 && next > INSTANT_CATCH_UP_MAX)) {
      displayRef.current = next;
      setDisplay(next);
      return;
    }

    if (
      next > 0 &&
      displayRef.current === 0 &&
      next <= INSTANT_CATCH_UP_MAX
    ) {
      displayRef.current = next;
      setDisplay(next);
    }
  }, [confirmedSteps]);

  useEffect(() => {
    const id = setInterval(() => {
      const target = confirmedRef.current;
      if (displayRef.current >= target) return;
      const gap = target - displayRef.current;
      const increment = Math.max(1, Math.ceil(gap / 8));
      const next = Math.min(target, displayRef.current + increment);
      displayRef.current = next;
      setDisplay(next);
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  return display;
}
