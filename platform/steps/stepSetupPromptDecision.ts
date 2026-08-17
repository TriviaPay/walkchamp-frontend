/**
 * When to auto-open Health Connect / Apple Health setup.
 *
 * OS step access and Maybe Later are per install (device), not per account.
 * Uninstall clears OS grants + local flags, so another phone / reinstall may ask.
 */

export const STEP_SETUP_LATER_SNOOZE_MS = 24 * 60 * 60 * 1000;

export type StepSetupPromptDecision = "skip_silent" | "grant_only" | "full_wizard";

export type DeviceStepSetupRecord = {
  completed: boolean;
  laterCount: number;
  snoozeUntilMs: number;
  resumeStep: number;
  resumeAndroidPhase: string;
};

export function emptyDeviceStepSetupRecord(): DeviceStepSetupRecord {
  return {
    completed: false,
    laterCount: 0,
    snoozeUntilMs: 0,
    resumeStep: 0,
    resumeAndroidPhase: "",
  };
}

export function parseDeviceStepSetupRecord(raw: unknown): DeviceStepSetupRecord {
  if (raw === true) {
    return {
      completed: true,
      laterCount: 0,
      snoozeUntilMs: 0,
      resumeStep: 0,
      resumeAndroidPhase: "",
    };
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    return {
      completed: o.completed === true,
      laterCount: Math.max(0, Math.min(2, Math.floor(Number(o.laterCount) || 0))),
      snoozeUntilMs: Math.max(0, Math.floor(Number(o.snoozeUntilMs) || 0)),
      resumeStep: Math.max(0, Math.floor(Number(o.resumeStep) || 0)),
      resumeAndroidPhase:
        typeof o.resumeAndroidPhase === "string" ? o.resumeAndroidPhase : "",
    };
  }
  return emptyDeviceStepSetupRecord();
}

export function applyDeviceSetupLater(
  cur: DeviceStepSetupRecord,
  nowMs: number,
  snoozeMs: number = STEP_SETUP_LATER_SNOOZE_MS,
): DeviceStepSetupRecord {
  if (cur.completed) return cur;
  const laterCount = Math.min(2, cur.laterCount + 1);
  return {
    ...cur,
    laterCount,
    snoozeUntilMs: laterCount === 1 ? nowMs + snoozeMs : 0,
  };
}

export function applyDeviceSetupCompleted(): DeviceStepSetupRecord {
  return {
    completed: true,
    laterCount: 0,
    snoozeUntilMs: 0,
    resumeStep: 0,
    resumeAndroidPhase: "",
  };
}

export function decideStepSetupPrompt(args: {
  /** Health Connect READ_STEPS / HealthKit already granted on this install. */
  osStepAccessGranted: boolean;
  /** This install previously completed setup while OS access was granted. */
  deviceSetupCompleted: boolean;
  /** Health Connect app missing or needs a Play Store update. */
  healthConnectMissingOrNeedsUpdate: boolean;
  /** Times this install tapped Maybe Later (0–2). */
  laterCount: number;
  /** First Later snooze deadline (epoch ms). */
  snoozeUntilMs: number;
  nowMs?: number;
}): StepSetupPromptDecision {
  if (args.osStepAccessGranted) return "skip_silent";
  const laterCount = Math.max(0, Math.floor(args.laterCount));
  const now = args.nowMs ?? 0;
  // Second Later: browse the app, no auto-prompt. Profile / Walk health icon still resume setup.
  if (laterCount >= 2) return "skip_silent";
  // First Later: wait the gap, then ask once more.
  if (laterCount === 1 && now < Math.max(0, args.snoozeUntilMs)) return "skip_silent";
  if (laterCount === 1 && now >= Math.max(0, args.snoozeUntilMs)) return "full_wizard";
  if (args.healthConnectMissingOrNeedsUpdate) return "full_wizard";
  if (args.deviceSetupCompleted) return "grant_only";
  return "full_wizard";
}

/** After two Maybes on this device, races stay view-only until OS step access is granted. */
export function isDeviceRaceViewOnly(args: {
  osStepAccessGranted: boolean;
  laterCount: number;
  deviceSetupCompleted: boolean;
}): boolean {
  if (args.osStepAccessGranted || args.deviceSetupCompleted) return false;
  return Math.max(0, Math.floor(args.laterCount)) >= 2;
}
