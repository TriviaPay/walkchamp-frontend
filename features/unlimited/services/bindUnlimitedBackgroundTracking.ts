/**
 * Keep streak / Unlimited counting while the user is on Walk or in the background.
 * Do not wait for Live Race to open — today's walk is the challenge lane.
 */

import { store } from "@/store";
import { ensureActiveRaceInStore } from "@/core/steps/stepProgressCoordinator";
import { registerUnlimitedClassicProgressBlock } from "@/features/unlimited/guards/unlimitedRaceProgressGuard";
import { resolveUnlimitedLiveDayContext } from "@/features/unlimited/mappers/unlimitedLiveDayContext";
import { formatChallengeDayKey } from "@/utils/challengeDayKey";
import { capStepsAtGoal } from "@/utils/liveRaceDisplay";
import { getDeviceTimezone } from "@/utils/timezone";

export function bindUnlimitedBackgroundTracking(params: {
  challengeId: string;
  userId: string;
  username: string;
  goalSteps: number;
  timezone?: string | null;
  startedAt?: string | null;
}): void {
  const id = params.challengeId.trim();
  if (!id || !params.userId) return;

  const deviceTz = getDeviceTimezone();
  const tz = (params.timezone && params.timezone.trim()) || deviceTz;
  const liveDay = resolveUnlimitedLiveDayContext({
    raceChallengeTimezone: tz,
    deviceTimezone: deviceTz,
    formattedDeviceDayKey: formatChallengeDayKey(Date.now(), tz) ?? undefined,
  });
  registerUnlimitedClassicProgressBlock(id, {
    challengeDayKey: liveDay?.challengeDayKey,
    timezone: liveDay?.timezone ?? tz,
  });

  const rp = store.getState().raceProgress;
  const classicOwnsTray =
    rp.raceStatus === "active" &&
    !!rp.activeRaceId &&
    rp.activeRaceId !== id &&
    String(rp.activeRaceType ?? "").toLowerCase() !== "unlimited_goal";
  if (classicOwnsTray) {
    // Classic live race keeps the tray; streak still advances via walk sync.
    return;
  }

  const daily = Math.max(
    0,
    Math.floor(
      Math.max(rp.verifiedTodaySteps ?? 0, rp.todaySteps ?? 0),
    ),
  );
  ensureActiveRaceInStore({
    raceId: id,
    raceStartTime: params.startedAt ?? new Date().toISOString(),
    userId: params.userId,
    username: params.username,
    goalSteps: params.goalSteps,
    totalParticipants: Math.max(1, rp.totalParticipants ?? 1),
    bootSteps: capStepsAtGoal(daily, params.goalSteps),
    participantConfirmed: true,
    unlimitedDailyMode: true,
    raceType: "unlimited_goal",
  });
}
