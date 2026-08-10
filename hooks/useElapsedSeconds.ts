/**
 * Local 1s ticker derived from a fixed start timestamp.
 * Only the calling component re-renders — not the provider tree.
 */
import { useTickingNow } from "@/components/perf/LiveClockText";

export function useElapsedSeconds(
  startedAtMs: number | null | undefined,
  enabled = true,
): number {
  const active = enabled && typeof startedAtMs === "number" && Number.isFinite(startedAtMs);
  const now = useTickingNow(!!active);
  if (!active) return 0;
  return Math.max(0, Math.floor((now - startedAtMs!) / 1000));
}
