/**
 * Keeps the ongoing walk/race notification aligned with the Profile
 * "Push Notifications" toggle (and OS permission).
 *
 * Preference ON  → start ongoing tracker when OS allows + step source ready
 * Preference OFF → stop ongoing tracker (no nag prompts)
 */

import { Platform } from "react-native";
import { store } from "@/store";
import { stepTrackingNotificationService } from "@/services/stepTrackingNotificationService";
import { hasOngoingNotificationAccess } from "@/services/permissions/notificationGate";
import { pushWalkNotificationFromCanonicalStore } from "@/services/stepProgressCoordinator";

export async function applyOngoingNotificationPreference(
  enabled: boolean,
  userId?: string | null,
): Promise<void> {
  if (Platform.OS === "web") return;

  if (!enabled) {
    try {
      await stepTrackingNotificationService.stop();
    } catch {
      /* best-effort */
    }
    return;
  }

  const uid = userId ?? store.getState().raceProgress.userId;
  if (!uid) return;

  const osOk =
    Platform.OS !== "android" || (await hasOngoingNotificationAccess());
  if (!osOk) return;

  try {
    await pushWalkNotificationFromCanonicalStore(true, uid);
  } catch {
    const s = store.getState().raceProgress;
    await stepTrackingNotificationService.start({
      userId: uid,
      todaySteps: Math.max(0, s.todaySteps ?? 0),
      dailyGoal: 10_000,
    });
  }
}
