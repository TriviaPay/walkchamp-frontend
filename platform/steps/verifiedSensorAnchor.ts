/**
 * Verified Health Connect/HealthKit total + phone-sensor session delta.
 * Sensor never reconstructs the whole day and never becomes verified.
 */

import { getLocalDateStr } from "@/utils/timezone";
import {
  isUnconfirmedSensorLeftover,
  shouldHoldSensorSessionUntilVerifiedRead,
} from "./walkDisplaySteps";

type VerifiedSensorAnchor = {
  localDate: string;
  verifiedSteps: number;
  sensorTotal: number;
};

let _anchor: VerifiedSensorAnchor | null = null;

export function resetVerifiedSensorAnchor(): void {
  _anchor = null;
}

export function getVerifiedSensorAnchor(): VerifiedSensorAnchor | null {
  return _anchor;
}

/** Call after every successful Health Connect / HealthKit aggregate read. */
export function noteVerifiedHealthConnectRead(opts: {
  verifiedSteps: number;
  sensorTotal?: number | null;
  localDate?: string;
}): void {
  const localDate = opts.localDate ?? getLocalDateStr();
  const verified = Math.max(0, Math.floor(opts.verifiedSteps));
  const sensor =
    opts.sensorTotal == null || !Number.isFinite(opts.sensorTotal)
      ? null
      : opts.sensorTotal;
  if (sensor == null || sensor < 0) {
    _anchor = {
      localDate,
      verifiedSteps: verified,
      sensorTotal: _anchor?.localDate === localDate ? _anchor.sensorTotal : -1,
    };
    return;
  }
  _anchor = { localDate, verifiedSteps: verified, sensorTotal: sensor };
}

/**
 * display = max(latestVerified, verifiedAnchor + max(0, sensorNow - sensorAtAnchor))
 */
export function resolveAnchoredDisplaySteps(opts: {
  verifiedSteps: number;
  sensorTotal?: number | null;
  sessionTodaySteps?: number | null;
  localDate?: string;
}): number {
  const localDate = opts.localDate ?? getLocalDateStr();
  const verified = Math.max(0, Math.floor(opts.verifiedSteps));
  const session =
    opts.sessionTodaySteps == null || !Number.isFinite(opts.sessionTodaySteps)
      ? 0
      : Math.max(0, Math.floor(opts.sessionTodaySteps));

  if (!_anchor || _anchor.localDate !== localDate) {
    if (verified > 0) return verified;
    if (
      shouldHoldSensorSessionUntilVerifiedRead({
        sessionSteps: session,
        verifiedSteps: verified,
        hasVerifiedAnchor: false,
      })
    ) {
      return verified;
    }
    return Math.max(verified, session);
  }

  // After a Health Connect / HealthKit read, Walk daily is that number only.
  if (verified > 0) return verified;
  if (_anchor.verifiedSteps > 0) return Math.max(verified, _anchor.verifiedSteps);

  const sensor = opts.sensorTotal;
  if (
    sensor == null ||
    !Number.isFinite(sensor) ||
    _anchor.sensorTotal < 0
  ) {
    return Math.max(verified, _anchor.verifiedSteps);
  }

  const sessionDelta = Math.max(0, Math.floor(sensor - _anchor.sensorTotal));
  if (
    sessionDelta <= 0 &&
    isUnconfirmedSensorLeftover(session)
  ) {
    return verified;
  }
  return Math.max(verified, sessionDelta);
}

export type DisplayVerification = "verified" | "syncing" | "provisional";

export function resolveDisplayVerification(opts: {
  verifiedSteps: number;
  displaySteps: number;
  verifiedStatus: "ready" | "ready_no_data" | "unavailable" | string;
}): DisplayVerification {
  const verified = Math.max(0, Math.floor(opts.verifiedSteps));
  const display = Math.max(0, Math.floor(opts.displaySteps));
  if (opts.verifiedStatus === "ready" && display <= verified) return "verified";
  if (opts.verifiedStatus === "ready" || opts.verifiedStatus === "ready_no_data") {
    return display > verified ? "syncing" : "verified";
  }
  return "provisional";
}
