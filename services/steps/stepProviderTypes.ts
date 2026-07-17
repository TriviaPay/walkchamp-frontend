/**
 * Shared types for the unified step provider architecture.
 * iOS uses HealthKit; Android uses Health Connect with legacy sensor fallback.
 */

export type StepProviderId =
  | "ios_healthkit"
  | "android_health_connect"
  | "android_legacy_sensor";

export type StepVerificationLevel = "verified" | "legacy";

export type StepPermissionState =
  | "granted"
  | "denied"
  | "unknown"
  | "unavailable";

export interface StepPermissionResult {
  status: StepPermissionState;
  providerId: StepProviderId | null;
  message?: string;
}

export interface StepReadResult {
  steps: number;
  providerId: StepProviderId;
  verificationLevel: StepVerificationLevel;
  source: StepProviderId;
  from: string;
  to: string;
  localDate: string;
  timezone: string;
  distanceMeters?: number;
  caloriesBurned?: number;
  activeMinutes?: number;
}

export interface StepTrackingStatus {
  ready: boolean;
  providerId: StepProviderId | null;
  verificationLevel: StepVerificationLevel;
  permission: StepPermissionState;
  /** User-facing label for settings (optional). */
  sourceLabel: string | null;
}

export interface StepProvider {
  providerId: StepProviderId;
  verificationLevel: StepVerificationLevel;
  isAvailable(): Promise<boolean>;
  requestPermission(): Promise<StepPermissionResult>;
  getPermissionStatus(): Promise<StepPermissionState>;
  getTodaySteps(): Promise<StepReadResult>;
  getStepsForRange(start: Date, end: Date): Promise<StepReadResult>;
  getRaceSteps(
    raceId: string,
    raceStartAt: Date,
    userId: string,
    /** Optional exclusive end — Sponsored Events pass event endsAt so HC/HK queries stop at window end. */
    raceEndAt?: Date,
  ): Promise<StepReadResult>;
  createRaceBaseline?(
    raceId: string,
    userId: string,
  ): Promise<number>;
  clearRaceBaseline?(raceId: string, userId: string): Promise<void>;
  startWatchingSteps?(
    callback: (result: StepReadResult) => void,
  ): Promise<() => void>;
  stopWatchingSteps?(): void;
  resetForNewLocalDay?(): Promise<void>;
  reconcileTodaySteps?(steps: number): Promise<void>;
}

export function getLocalDateKey(d = new Date()): string {
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}`
  );
}

export function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export function emptyStepResult(
  providerId: StepProviderId,
  verificationLevel: StepVerificationLevel,
  from: Date,
  to: Date,
): StepReadResult {
  return {
    steps: 0,
    providerId,
    verificationLevel,
    source: providerId,
    from: from.toISOString(),
    to: to.toISOString(),
    localDate: getLocalDateKey(from),
    timezone: getUserTimezone(),
  };
}
