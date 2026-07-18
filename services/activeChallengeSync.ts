/**
 * Active challenge registry — single place that tracks every race/challenge
 * the signed-in user is currently participating in.
 *
 * Step updates flow through stepProgressCoordinator (one device source).
 * This registry tells the coordinator which additional race rooms should
 * receive the same deviceTotalSteps so multi-day + sponsored + live races
 * stay aligned without duplicate pedometer logic.
 */

type Listener = (raceIds: readonly string[]) => void;

const _ids = new Set<string>();
const _listeners = new Set<Listener>();

function emit(): void {
  const snapshot = Object.freeze([..._ids]);
  for (const fn of _listeners) {
    try {
      fn(snapshot);
    } catch {
      /* ignore listener errors */
    }
  }
}

export const activeChallengeSync = {
  /** Register a race the user is an eligible participant in. */
  register(raceId: string | null | undefined): void {
    if (!raceId || _ids.has(raceId)) return;
    _ids.add(raceId);
    if (__DEV__) {
      console.log(`[ActiveChallengeSync] register raceId=${raceId} count=${_ids.size}`);
    }
    emit();
  },

  /** Register many race ids (e.g. from /api/races/my-active). */
  registerMany(raceIds: Array<string | null | undefined>): void {
    let changed = false;
    for (const id of raceIds) {
      if (!id || _ids.has(id)) continue;
      _ids.add(id);
      changed = true;
    }
    if (changed) {
      if (__DEV__) {
        console.log(`[ActiveChallengeSync] registerMany count=${_ids.size}`);
      }
      emit();
    }
  },

  unregister(raceId: string | null | undefined): void {
    if (!raceId || !_ids.has(raceId)) return;
    _ids.delete(raceId);
    if (__DEV__) {
      console.log(`[ActiveChallengeSync] unregister raceId=${raceId} count=${_ids.size}`);
    }
    emit();
  },

  clear(): void {
    if (_ids.size === 0) return;
    _ids.clear();
    emit();
  },

  getRaceIds(): string[] {
    return [..._ids];
  },

  has(raceId: string): boolean {
    return _ids.has(raceId);
  },

  subscribe(listener: Listener): () => void {
    _listeners.add(listener);
    return () => {
      _listeners.delete(listener);
    };
  },
};
