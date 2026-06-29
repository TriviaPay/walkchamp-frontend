/**
 * Latest-value offline outbox for daily walk step sync.
 * Stores only the most recent unsynced total per user/localDate.
 */

import { storageGet, storageSet, storageRemove } from "@/utils/storage";

const OUTBOX_KEY = "walk_steps_outbox" as const;

export type WalkStepsOutboxEntry = {
  totalSteps: number;
  stepSource: string;
  localDate: string;
  updatedAt: string;
};

export async function saveWalkStepsOutbox(entry: WalkStepsOutboxEntry): Promise<void> {
  await storageSet(OUTBOX_KEY as never, entry);
  if (__DEV__) {
    console.log(`[BackendSync] walk outbox saved totalSteps=${entry.totalSteps}`);
  }
}

export async function loadWalkStepsOutbox(): Promise<WalkStepsOutboxEntry | null> {
  return (await storageGet<WalkStepsOutboxEntry>(OUTBOX_KEY as never)) ?? null;
}

export async function clearWalkStepsOutbox(): Promise<void> {
  await storageRemove(OUTBOX_KEY as never);
}
