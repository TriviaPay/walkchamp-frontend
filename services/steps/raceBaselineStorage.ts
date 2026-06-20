/**
 * Race-specific step baselines — prevents step carry-over between races.
 * Key: raceId + userId + providerId
 */

import { storageGet, storageSet } from "@/utils/storage";
import type { StepProviderId } from "./stepProviderTypes";

const STORAGE_KEY = "race_step_baselines_v1";

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
  return `${raceId}:${userId}:${providerId}`;
}

async function readAll(): Promise<Record<string, StoredBaseline>> {
  return (await storageGet<Record<string, StoredBaseline>>(STORAGE_KEY as never)) ?? {};
}

async function writeAll(data: Record<string, StoredBaseline>): Promise<void> {
  await storageSet(STORAGE_KEY as never, data);
}

export async function setRaceBaseline(
  raceId: string,
  userId: string,
  providerId: StepProviderId,
  baselineSteps: number,
): Promise<void> {
  const all = await readAll();
  all[baselineKey(raceId, userId, providerId)] = {
    raceId,
    userId,
    providerId,
    baselineSteps,
    createdAt: new Date().toISOString(),
  };
  await writeAll(all);
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
  const all = await readAll();
  const entry = all[baselineKey(raceId, userId, providerId)];
  return entry?.baselineSteps ?? null;
}

export async function clearRaceBaseline(
  raceId: string,
  userId: string,
  providerId?: StepProviderId,
): Promise<void> {
  const all = await readAll();
  if (providerId) {
    delete all[baselineKey(raceId, userId, providerId)];
  } else {
    for (const key of Object.keys(all)) {
      if (all[key].raceId === raceId && all[key].userId === userId) {
        delete all[key];
      }
    }
  }
  await writeAll(all);
  if (__DEV__) {
    console.log(`[RaceSteps] race baseline cleared raceId=${raceId}`);
  }
}
