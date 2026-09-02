/**
 * Continuity monitoring for protected races — report facts, never local DQ.
 */

import { store } from "@/store";
import { prizeVerificationActions } from "@/store/slices/prizeVerificationSlice";
import { reportPrizeContinuityEvent } from "./raceVerificationApi";
import type {
  ContinuityEvent,
  ContinuityFactCategory,
  PrizeContinuityStatus,
} from "./raceVerificationTypes";

let _raceId: string | null = null;
let _approvedSourceId: string | null = null;
let _registeredDeviceId: string | null = null;
let _verificationSessionId: string | null = null;

export function startPrizeContinuityMonitor(args: {
  raceId: string;
  approvedSourceId: string | null;
  registeredDeviceId: string | null;
  verificationSessionId: string;
}): void {
  _raceId = args.raceId;
  _approvedSourceId = args.approvedSourceId;
  _registeredDeviceId = args.registeredDeviceId;
  _verificationSessionId = args.verificationSessionId;
}

export function stopPrizeContinuityMonitor(): void {
  _raceId = null;
  _approvedSourceId = null;
  _registeredDeviceId = null;
  _verificationSessionId = null;
}

function mapCategoryToContinuityStatus(
  category: ContinuityFactCategory,
): PrizeContinuityStatus {
  switch (category) {
    case "PLATFORM_FAILURE":
      return "platform_failure";
    case "USER_CONTINUITY_BREACH":
    case "ACCOUNT_SWITCH":
    case "SESSION_CONFLICT":
      return "verification_gap";
    case "OFFLINE_POLICY_EXCEEDED":
      return "verification_gap";
    case "REBOOT_RECOVERY":
      return "healthy";
    case "CONFIRMED_MANIPULATION":
      return "integrity_failed";
    case "UNEXPLAINED_FAILURE":
    default:
      return "unexplained_failure";
  }
}

export function reportPrizeContinuityFact(args: {
  category: ContinuityFactCategory;
  code: string;
  detail?: string;
  at?: string;
}): void {
  const raceId = _raceId ?? store.getState().prizeVerification.raceId;
  if (!raceId) return;

  const event: ContinuityEvent = {
    at: args.at ?? new Date().toISOString(),
    category: args.category,
    code: args.code,
    detail: args.detail,
  };

  store.dispatch(prizeVerificationActions.appendContinuityEvent(event));
  store.dispatch(
    prizeVerificationActions.setContinuityStatus(
      mapCategoryToContinuityStatus(args.category),
    ),
  );

  void reportPrizeContinuityEvent(raceId, {
    verificationSessionId:
      _verificationSessionId ??
      store.getState().prizeVerification.verificationSessionId,
    registeredDeviceId:
      _registeredDeviceId ??
      store.getState().prizeVerification.registeredDeviceId,
    approvedSourceId:
      _approvedSourceId ?? store.getState().prizeVerification.approvedSourceId,
    event,
  });
}

export function reportPermissionLost(kind: "health" | "activity_recognition"): void {
  reportPrizeContinuityFact({
    category: "PLATFORM_FAILURE",
    code: kind === "health" ? "permission_lost_health" : "permission_lost_ar",
  });
  store.dispatch(prizeVerificationActions.setContinuityStatus("permission_lost"));
}

export function reportSourceChanged(nextSourceId: string | null): void {
  reportPrizeContinuityFact({
    category: "USER_CONTINUITY_BREACH",
    code: "source_changed",
    detail: nextSourceId ?? undefined,
  });
  store.dispatch(prizeVerificationActions.setContinuityStatus("source_changed"));
}

export function reportDeviceChanged(): void {
  reportPrizeContinuityFact({
    category: "USER_CONTINUITY_BREACH",
    code: "device_changed",
  });
  store.dispatch(prizeVerificationActions.setContinuityStatus("device_changed"));
}

export function reportAccountSwitchDuringRace(): void {
  reportPrizeContinuityFact({
    category: "ACCOUNT_SWITCH",
    code: "account_switched",
  });
  store.dispatch(prizeVerificationActions.suspendForAccountSwitch());
}

export function reportRebootRecovery(): void {
  reportPrizeContinuityFact({
    category: "REBOOT_RECOVERY",
    code: "reboot_recovery",
  });
}

export function reportIntegrityFailure(detail?: string): void {
  reportPrizeContinuityFact({
    category: "UNEXPLAINED_FAILURE",
    code: "integrity_unavailable",
    detail,
  });
  store.dispatch(prizeVerificationActions.setContinuityStatus("integrity_failed"));
}

export function reportOfflinePolicyExceeded(detail?: string): void {
  reportPrizeContinuityFact({
    category: "OFFLINE_POLICY_EXCEEDED",
    code: "offline_policy_exceeded",
    detail,
  });
}
