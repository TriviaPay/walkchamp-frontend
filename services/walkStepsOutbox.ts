/**
 * Latest-value offline outbox for daily walk step sync.
 * Stores only the most recent unsynced total per user/localDate.
 */

import { storageGet, storageSet, storageRemove } from "@/utils/storage";
import { stepScopedKeys } from "@/utils/stepScopedStorage";

export type WalkStepsOutboxEntry = {
  userId: string;
  totalSteps: number;
  stepSource: string;
  localDate: string;
  updatedAt: string;
};

export async function saveWalkStepsOutbox(entry: WalkStepsOutboxEntry): Promise<void> {
  await storageSet(stepScopedKeys(entry.userId, entry.localDate).outbox, entry);
  if (__DEV__) {
    console.log(
      `[BackendSync] walk outbox saved userId=${entry.userId} localDate=${entry.localDate} totalSteps=${entry.totalSteps}`,
    );
  }
}

export async function loadWalkStepsOutbox(
  userId: string,
  localDate: string,
): Promise<WalkStepsOutboxEntry | null> {
  return (await storageGet<WalkStepsOutboxEntry>(stepScopedKeys(userId, localDate).outbox)) ?? null;
}

export async function clearWalkStepsOutbox(
  userId?: string,
  localDate?: string,
): Promise<void> {
  if (!userId || !localDate) {
    await storageRemove("walk_steps_outbox" as never);
    return;
  }
  await storageRemove(stepScopedKeys(userId, localDate).outbox);
}
