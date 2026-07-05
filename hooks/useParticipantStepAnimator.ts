/**
 * Smooth step display animation for live race participants.
 *
 * confirmedSteps — latest server/local truth (never decreases unless reset).
 * displaySteps   — animated value shown in UI (catches up to confirmed).
 */

import { useCallback, useEffect, useRef, useState } from "react";

const TICK_MS = 75;
const MAX_INSTANT_FIRST = 20;

interface ParticipantAnimState {
  confirmed: number;
  display: number;
}

export function useParticipantStepAnimator() {
  const statesRef = useRef<Map<string, ParticipantAnimState>>(new Map());
  const [displayMap, setDisplayMap] = useState<Record<string, number>>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRaceRef = useRef<string | null>(null);

  const resetForRace = useCallback((raceId: string) => {
    activeRaceRef.current = raceId;
    statesRef.current.clear();
    setDisplayMap({});
  }, []);

  const setConfirmedSteps = useCallback(
    (userId: string, steps: number, options?: { allowRollback?: boolean; instant?: boolean }) => {
      if (!userId) return;
      const safe = Math.max(0, Math.floor(steps));
      const prev = statesRef.current.get(userId);

      const confirmed = options?.allowRollback
        ? safe
        : Math.max(prev?.confirmed ?? 0, safe);

      let display: number;
      if (!prev || options?.instant) {
        display = confirmed;
      } else if (confirmed <= MAX_INSTANT_FIRST) {
        display = confirmed;
      } else {
        display = Math.max(prev.display, Math.min(prev.display, confirmed));
      }

      statesRef.current.set(userId, { confirmed, display });
      setDisplayMap((m) => ({ ...m, [userId]: display }));
    },
    [],
  );

  const getDisplaySteps = useCallback(
    (userId: string, fallback = 0): number => {
      if (!userId) return fallback;
      return displayMap[userId] ?? statesRef.current.get(userId)?.display ?? fallback;
    },
    [displayMap],
  );

  useEffect(() => {
    timerRef.current = setInterval(() => {
      let changed = false;
      const next: Record<string, number> = {};

      statesRef.current.forEach((state, userId) => {
        if (state.display < state.confirmed) {
          const gap = state.confirmed - state.display;
          const increment = Math.max(1, Math.ceil(gap / 8));
          state.display = Math.min(state.confirmed, state.display + increment);
          changed = true;
        }
        next[userId] = state.display;
      });

      if (changed) {
        setDisplayMap((prev) => {
          const merged = { ...prev };
          for (const [uid, val] of Object.entries(next)) {
            merged[uid] = val;
          }
          return merged;
        });
      }
    }, TICK_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return { resetForRace, setConfirmedSteps, getDisplaySteps };
}
