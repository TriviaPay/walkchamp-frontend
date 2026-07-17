import AsyncStorage from "@react-native-async-storage/async-storage";

export async function storageGet<T>(key: string): Promise<T | null> {
  try {
    const value = await AsyncStorage.getItem(key);
    if (value === null) return null;
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function storageSet<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export async function storageRemove(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {}
}

type DebouncedWrite = {
  value: unknown;
  timer: ReturnType<typeof setTimeout> | null;
};

const debouncedWrites = new Map<string, DebouncedWrite>();

/** Coalesce rapid writes — latest value wins. Flush on background via storageFlushDebounced. */
export function storageSetDebounced<T>(key: string, value: T, delayMs = 750): void {
  const existing = debouncedWrites.get(key);
  if (existing?.timer) clearTimeout(existing.timer);
  const entry: DebouncedWrite = { value, timer: null };
  entry.timer = setTimeout(() => {
    debouncedWrites.delete(key);
    void storageSet(key, value);
  }, delayMs);
  debouncedWrites.set(key, entry);
}

/** Persist all pending debounced writes immediately (e.g. app background). */
export async function storageFlushDebounced(): Promise<void> {
  const pending = Array.from(debouncedWrites.entries());
  debouncedWrites.clear();
  await Promise.all(
    pending.map(async ([key, entry]) => {
      if (entry.timer) clearTimeout(entry.timer);
      await storageSet(key, entry.value);
    }),
  );
}

export const STORAGE_KEYS = {
  USER: "walkchamp_user",
  DAILY_STEPS: "walkchamp_daily_steps",
  WALLET: "walkchamp_wallet",
  /** Last known coin balance (CoinBalance JSON) — seeds Redux before network. */
  COIN_BALANCE: "walkchamp_coin_balance",
  TRANSACTIONS: "walkchamp_transactions",
  STREAK: "walkchamp_streak",
  TOTAL_STEPS: "walkchamp_total_steps",
  RACE_TRACK_LAYOUTS: "walkchamp_race_track_layouts",
  /** ISO date string of the last date we synced steps to the backend (for delta tracking). */
  LAST_SYNCED_STEPS_DATE: "walkchamp_last_synced_steps_date",
  /** Steps already synced to the backend for today (so we only send deltas). */
  LAST_SYNCED_STEPS_COUNT: "walkchamp_last_synced_steps_count",
  /** Local calendar date (YYYY-MM-DD) for which daily steps were last persisted. */
  TRACKING_LOCAL_DATE: "walkchamp_tracking_local_date",
  /** Last user id that owned the local step cache — used to detect account switches. */
  LAST_STEP_USER_ID: "walkchamp_last_step_user_id",
  /**
   * Pending race state persisted across app close/kill.
   * Shape: { raceId: string, raceStartTimeUTC: string, raceEndTimeUTC?: string, status: 'in_progress'|'completed' }
   */
  PENDING_RACE: "walkchamp_pending_race",
  /** True after the notification system prompt was shown once. */
  NOTIFICATION_PERMISSION_ASKED: "walkchamp_notification_permission_asked_v1",
  /** True after the post-login push permission prompt was shown once. */
  PUSH_PERMISSION_PROMPTED: "walkchamp_push_permission_prompted_v1",
  /** In-flight wallet deposit — polled on app resume until terminal. */
  PENDING_DEPOSIT: "walkchamp_pending_deposit_v1",
  /** Payment result to show on wallet tab after Universal Link / resume poll. */
  PAYMENT_RESULT: "walkchamp_payment_result_v1",
};
