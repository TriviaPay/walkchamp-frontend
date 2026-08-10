/**
 * Durable iOS logical device-total for Core Motion live races.
 * CMPedometer does not expose Android-style cumulative-since-reboot counters.
 */

import { storageGet, storageSet } from "@/utils/storage";

export type IOSLogicalStepCounterState = {
  enrollmentId: string;
  logicalDeviceTotalSteps: number;
  lastCheckpointAt: string;
  lastLiveSessionStartAt?: string;
  lastLiveSessionStartLogicalTotal?: number;
  lastUpdatedAt: string;
};

const STORAGE_KEY = "ios_logical_step_counter" as never;

function newEnrollmentId(): string {
  return `ios_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadIOSLogicalStepCounter(): Promise<IOSLogicalStepCounterState> {
  const stored = await storageGet<IOSLogicalStepCounterState>(STORAGE_KEY);
  if (
    stored &&
    typeof stored.logicalDeviceTotalSteps === "number" &&
    stored.enrollmentId
  ) {
    return stored;
  }
  const fresh: IOSLogicalStepCounterState = {
    enrollmentId: newEnrollmentId(),
    logicalDeviceTotalSteps: 0,
    lastCheckpointAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
  };
  await storageSet(STORAGE_KEY, fresh);
  return fresh;
}

/** Monotonic advance of the logical total; ignores older async results. */
export async function advanceIOSLogicalStepCounter(
  nextTotal: number,
  opts?: { sessionStart?: boolean },
): Promise<IOSLogicalStepCounterState> {
  const current = await loadIOSLogicalStepCounter();
  const floor = Math.max(0, Math.floor(current.logicalDeviceTotalSteps));
  const incoming = Math.max(0, Math.floor(nextTotal));
  const logicalDeviceTotalSteps = Math.max(floor, incoming);
  const now = new Date().toISOString();
  const next: IOSLogicalStepCounterState = {
    ...current,
    logicalDeviceTotalSteps,
    lastCheckpointAt: now,
    lastUpdatedAt: now,
    ...(opts?.sessionStart
      ? {
          lastLiveSessionStartAt: now,
          lastLiveSessionStartLogicalTotal: logicalDeviceTotalSteps,
        }
      : {}),
  };
  await storageSet(STORAGE_KEY, next);
  return next;
}

/** Apply a Core Motion session delta onto the session-start logical total. */
export async function applyIOSCoreMotionSessionProgress(
  sessionSteps: number,
): Promise<IOSLogicalStepCounterState> {
  const current = await loadIOSLogicalStepCounter();
  const sessionStart =
    typeof current.lastLiveSessionStartLogicalTotal === "number"
      ? current.lastLiveSessionStartLogicalTotal
      : current.logicalDeviceTotalSteps;
  const nextTotal = Math.max(
    current.logicalDeviceTotalSteps,
    sessionStart + Math.max(0, Math.floor(sessionSteps)),
  );
  return advanceIOSLogicalStepCounter(nextTotal);
}
