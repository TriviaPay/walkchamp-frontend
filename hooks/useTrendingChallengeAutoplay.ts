/**
 * Autoplay for Trending Challenges stack — one timer, AppState + interaction aware.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, AppState } from "react-native";
import {
  TRENDING_AUTOPLAY_MS,
  TRENDING_RESUME_AFTER_INTERACTION_MS,
} from "@/utils/trendingChallenges";

type Options = {
  count: number;
  enabled: boolean;
  onAutoAdvance?: (nextIndex: number) => void;
};

export function useTrendingChallengeAutoplay({ count, enabled, onAutoAdvance }: Options) {
  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  const pausedRef = useRef(false);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const indexRef = useRef(0);
  const onAutoAdvanceRef = useRef(onAutoAdvance);
  onAutoAdvanceRef.current = onAutoAdvance;

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReducedMotion(v);
    });
    void AccessibilityInfo.isScreenReaderEnabled().then((v) => {
      if (mounted) setScreenReader(v);
    });
    const motionSub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    const readerSub = AccessibilityInfo.addEventListener("screenReaderChanged", setScreenReader);
    return () => {
      mounted = false;
      motionSub.remove();
      readerSub.remove();
    };
  }, []);

  const clearResume = () => {
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  };

  const pause = useCallback(() => {
    pausedRef.current = true;
    clearResume();
  }, []);

  const resumeSoon = useCallback(() => {
    clearResume();
    resumeTimerRef.current = setTimeout(() => {
      pausedRef.current = false;
      resumeTimerRef.current = null;
    }, TRENDING_RESUME_AFTER_INTERACTION_MS);
  }, []);

  const goTo = useCallback((next: number) => {
    if (count <= 0) return;
    const wrapped = ((next % count) + count) % count;
    setIndex(wrapped);
  }, [count]);

  const next = useCallback(() => {
    if (count <= 0) return;
    const n = (indexRef.current + 1) % count;
    setIndex(n);
  }, [count]);

  const advanceAuto = useCallback(() => {
    if (count <= 0) return;
    const n = (indexRef.current + 1) % count;
    setIndex(n);
    onAutoAdvanceRef.current?.(n);
  }, [count]);

  const prev = useCallback(() => {
    if (count <= 0) return;
    goTo(indexRef.current - 1);
  }, [count, goTo]);

  // Keep index in range when list shrinks
  useEffect(() => {
    if (count <= 0) {
      setIndex(0);
      return;
    }
    if (indexRef.current >= count) setIndex(0);
  }, [count]);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (!enabled || reducedMotion || screenReader || count <= 1) return;

    const tick = () => {
      if (pausedRef.current) return;
      if (AppState.currentState !== "active") return;
      advanceAuto();
    };
    intervalRef.current = setInterval(tick, TRENDING_AUTOPLAY_MS);

    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        pausedRef.current = true;
      } else {
        // Resume after returning to foreground unless user interaction pending
        if (!resumeTimerRef.current) pausedRef.current = false;
      }
    });

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      sub.remove();
    };
  }, [enabled, reducedMotion, screenReader, count, advanceAuto]);

  useEffect(() => () => clearResume(), []);

  return {
    index,
    setIndex: goTo,
    next,
    prev,
    pause,
    resumeSoon,
    reducedMotion,
  };
}
