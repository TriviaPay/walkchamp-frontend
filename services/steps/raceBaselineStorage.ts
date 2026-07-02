/**
 * Race-specific step baselines — prevents step carry-over between races.
 * Key: raceId + userId + providerId
 */

import { storageGet, storageRemove, storageSet } from "@/utils/storage";
import type { StepProviderId } from "./stepProviderTypes";

const LEGACY_STORAGE_KEY = "race_step_baselines_v1";

interface StoredBaseline {
  raceId: string;
  userId: string;
  providerId: StepProviderId;
  baselineSteps: number;
  createdAt: string;
}

function baselineKey(
  raceId: string,
  userId: string,
  providerId: StepProviderId,
): string {
  return `raceSteps:${userId}:${raceId}:${providerId}`;
}

async function writeBaseline(key: string, baseline: StoredBaseline): Promise<void> {
  await storageSet(key, baseline);
}

export async function setRaceBaseline(
  raceId: string,
  userId: string,
  providerId: StepProviderId,
  baselineSteps: number,
): Promise<void> {
  await writeBaseline(baselineKey(raceId, userId, providerId), {
    raceId,
    userId,
    providerId,
    baselineSteps,
    createdAt: new Date().toISOString(),
  });
  if (__DEV__) {
    console.log(
      `[RaceSteps] race baseline created raceId=${raceId} provider=${providerId} baseline=${baselineSteps}`,
    );
  }
}

export async function getRaceBaseline(
  raceId: string,
  userId: string,
  providerId: StepProviderId,
): Promise<number | null> {
  const entry = await storageGet<StoredBaseline>(baselineKey(raceId, userId, providerId));
  if (entry?.baselineSteps !== undefined) return entry.baselineSteps;

  const legacy =
    (await storageGet<Record<string, StoredBaseline>>(LEGACY_STORAGE_KEY as never)) ?? {};
  const legacyEntry = legacy[`${raceId}:${userId}:${providerId}`];
  if (legacyEntry?.baselineSteps !== undefined) {
    await setRaceBaseline(raceId, userId, providerId, legacyEntry.baselineSteps);
    delete legacy[`${raceId}:${userId}:${providerId}`];
    await storageSet(LEGACY_STORAGE_KEY as never, legacy);
    return legacyEntry.baselineSteps;
  }
  return entry?.baselineSteps ?? null;
}

export async function clearRaceBaseline(
  raceId: string,
  userId: string,
  providerId?: StepProviderId,
): Promise<void> {
  if (providerId) {
    await storageRemove(baselineKey(raceId, userId, providerId));
  } else {
    for (const id of ["ios_healthkit", "android_health_connect", "android_legacy_sensor"] as StepProviderId[]) {
      await storageRemove(baselineKey(raceId, userId, id));
    }
  }
  if (__DEV__) {
    console.log(`[RaceSteps] race baseline cleared raceId=${raceId}`);
  }
}
