/**
 * Isolated ticking clock — owns its 1s interval so parents do not re-render.
 * Pass a fixed endMs (or startedAtMs + live elapsed) and render via children.
 */
import React, { memo, useEffect, useState } from "react";
import { AppState, Text, type StyleProp, type TextStyle } from "react-native";
import { perf } from "@/utils/perfLogger";

export function useTickingNow(enabled: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    perf.timerRegistered(1);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") setNow(Date.now());
    });
    return () => {
      clearInterval(id);
      perf.timerRegistered(-1);
      sub.remove();
    };
  }, [enabled, intervalMs]);

  return now;
}

type LiveClockTextProps = {
  enabled?: boolean;
  format: (nowMs: number) => string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
};

/** Renders a live-updating label without forcing parent re-renders. */
export const LiveClockText = memo(function LiveClockText({
  enabled = true,
  format,
  style,
  numberOfLines,
}: LiveClockTextProps) {
  const now = useTickingNow(enabled);
  useEffect(() => {
    perf.componentRender("LiveClockText");
  });
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {format(now)}
    </Text>
  );
});

type CountdownTextProps = {
  endMs: number | null | undefined;
  enabled?: boolean;
  format: (remainingMs: number, nowMs: number) => string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
};

/** Countdown from a fixed end timestamp (no decrement drift). */
export const CountdownText = memo(function CountdownText({
  endMs,
  enabled = true,
  format,
  style,
  numberOfLines,
}: CountdownTextProps) {
  const active = enabled && typeof endMs === "number" && Number.isFinite(endMs);
  const now = useTickingNow(!!active);
  const remaining = active ? Math.max(0, endMs! - now) : 0;
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {format(remaining, now)}
    </Text>
  );
});
