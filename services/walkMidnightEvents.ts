/** Lightweight pub/sub so WalkContext resets UI when the coordinator detects midnight. */

type MidnightListener = () => void;
const listeners = new Set<MidnightListener>();

export function subscribeMidnightRollover(listener: MidnightListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyMidnightRollover(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // never break rollover pipeline
    }
  }
}
