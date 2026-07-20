/**
 * Race-specific step baselines — prevents step carry-over between races.
 * Key: raceId + userId + providerId
 *
 * IMPORTANT: Do NOT use the `raceSteps:` prefix — account-switch cleanup deletes
 * `raceSteps:${userId}:*` and would wipe the baseline, making raceSteps == todaySteps.
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

/** Authoritative server/race seed used to rebuild baseline after re-login. */
interface StoredRaceSeed {
  raceId: string;
  userId: string;
  seedSteps: number;
  updatedAt: string;
}

function baselineKey(
  raceId: string,
  userId: string,
  providerId: StepProviderId,
): string {
  return `raceBaseline:${userId}:${raceId}:${providerId}`;
}

/** Pre-fix key that was incorrectly wiped on account switch. */
function legacyBaselineKey(
  raceId: string,
  userId: string,
  providerId: StepProviderId,
): string {
  return `raceSteps:${userId}:${raceId}:${providerId}`;
}

function seedKey(raceId: string, userId: string): string {
  return `raceSeed:${userId}:${raceId}`;
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
  // Drop legacy key so account-switch cleanup cannot resurrect a stale value.
  await storageRemove(legacyBaselineKey(raceId, userId, providerId));
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

  // Migrate from old key (raceSteps:…:provider) if still present.
  const legacyScoped = await storageGet<StoredBaseline>(
    legacyBaselineKey(raceId, userId, providerId),
  );
  if (legacyScoped?.baselineSteps !== undefined) {
    await setRaceBaseline(raceId, userId, providerId, legacyScoped.baselineSteps);
    return legacyScoped.baselineSteps;
  }

  const legacy =
    (await storageGet<Record<string, StoredBaseline>>(LEGACY_STORAGE_KEY as never)) ?? {};
  const legacyEntry = legacy[`${raceId}:${userId}:${providerId}`];
  if (legacyEntry?.baselineSteps !== undefined) {
    await setRaceBaseline(raceId, userId, providerId, legacyEntry.baselineSteps);
    delete legacy[`${raceId}:${userId}:${providerId}`];
    await storageSet(LEGACY_STORAGE_KEY as never, legacy);
    return legacyEntry.baselineSteps;
  }
  return null;
}

export async function setRaceStepSeed(
  raceId: string,
  userId: string,
  seedSteps: number,
): Promise<void> {
  await storageSet(seedKey(raceId, userId), {
    raceId,
    userId,
    seedSteps: Math.max(0, Math.floor(seedSteps)),
    updatedAt: new Date().toISOString(),
  } satisfies StoredRaceSeed);
}

export async function getRaceStepSeed(
  raceId: string,
  userId: string,
): Promise<number | null> {
  const entry = await storageGet<StoredRaceSeed>(seedKey(raceId, userId));
  if (entry?.seedSteps === undefined) return null;
  return Math.max(0, Math.floor(entry.seedSteps));
}

export async function clearRaceStepSeed(raceId: string, userId: string): Promise<void> {
  await storageRemove(seedKey(raceId, userId));
}

export async function clearRaceBaseline(
  raceId: string,
  userId: string,
  providerId?: StepProviderId,
): Promise<void> {
  if (providerId) {
    await storageRemove(baselineKey(raceId, userId, providerId));
    await storageRemove(legacyBaselineKey(raceId, userId, providerId));
  } else {
    for (const id of ["ios_healthkit", "android_health_connect", "android_legacy_sensor"] as StepProviderId[]) {
      await storageRemove(baselineKey(raceId, userId, id));
      await storageRemove(legacyBaselineKey(raceId, userId, id));
    }
  }
  await clearRaceStepSeed(raceId, userId);
  if (__DEV__) {
    console.log(`[RaceSteps] race baseline cleared raceId=${raceId}`);
  }
}
