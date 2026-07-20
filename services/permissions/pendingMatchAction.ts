/**
 * Pending match join/start action — scoped to user + session.
 * Cleared on logout / session replacement / account switch.
 */

import { storageGet, storageRemove, storageSet } from "@/utils/storage";
import { getActiveSessionMeta } from "@/services/authSessionMetadata";

const KEY = "walkchamp_pending_match_permission_action_v1";

export type PendingMatchAction = {
  type: string;
  raceId?: string;
  challengeId?: string;
  createdAt: string;
  userId: string;
  sessionId?: string;
  originalParams?: Record<string, unknown>;
};

export async function setPendingMatchPermissionAction(
  action: PendingMatchAction,
): Promise<void> {
  await storageSet(KEY, action);
}

export async function getPendingMatchPermissionAction(): Promise<PendingMatchAction | null> {
  const action = await storageGet<PendingMatchAction>(KEY);
  if (!action?.userId) return null;
  const meta = await getActiveSessionMeta();
  if (meta?.userId && action.userId !== meta.userId) {
    await storageRemove(KEY);
    return null;
  }
  if (action.sessionId && meta?.sessionId && action.sessionId !== meta.sessionId) {
    await storageRemove(KEY);
    return null;
  }
  // Stale after 10 minutes
  const created = Date.parse(action.createdAt);
  if (Number.isFinite(created) && Date.now() - created > 10 * 60_000) {
    await storageRemove(KEY);
    return null;
  }
  return action;
}

export async function clearPendingMatchPermissionAction(): Promise<void> {
  await storageRemove(KEY);
}
