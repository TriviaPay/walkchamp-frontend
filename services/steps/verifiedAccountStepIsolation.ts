/**
 * Per-account step isolation for verified device sources (Health Connect / HealthKit).
 *
 * HC/HK expose one device-wide daily total, not a WalkChamp-account total. After an
 * account switch on the same phone, the new account must not inherit the previous
 * account's device reading. Only steps walked *after* bind are attributed on top of
 * that account's own backend/local floor.
 *
 * Same-user re-login does NOT enable isolation — HC remains authoritative there.
 */

import { getTodayKey } from "@/utils/format";

export type VerifiedAccountStepIsolation = {
  userId: string;
  localDate: string;
  /** This account's trusted total at bind (backend / last-synced), never device HC. */
  accountFloor: number;
  /** Device HC/HK reading captured at bind — deltas above this are attributed. */
  providerBaseline: number;
};

let active: VerifiedAccountStepIsolation | null = null;

/** Pure attribution math — unit-tested without RN. */
export function resolveIsolatedVerifiedTodaySteps(args: {
  providerSteps: number;
  accountFloor: number;
  providerBaseline: number;
}): number {
  const provider = Math.max(0, Math.floor(args.providerSteps));
  const floor = Math.max(0, Math.floor(args.accountFloor));
  const baseline = Math.max(0, Math.floor(args.providerBaseline));
  return floor + Math.max(0, provider - baseline);
}

export function beginVerifiedAccountStepIsolation(args: {
  userId: string;
  localDate?: string;
  accountFloor: number;
  providerBaseline: number;
}): VerifiedAccountStepIsolation {
  active = {
    userId: args.userId,
    localDate: args.localDate ?? getTodayKey(),
    accountFloor: Math.max(0, Math.floor(args.accountFloor)),
    providerBaseline: Math.max(0, Math.floor(args.providerBaseline)),
  };
  return active;
}

export function clearVerifiedAccountStepIsolation(): void {
  active = null;
}

export function getVerifiedAccountStepIsolation(): VerifiedAccountStepIsolation | null {
  return active;
}

/**
 * If isolation is active for this user/day, map a raw device reading to the
 * account-attributed total. Otherwise returns null (caller uses normal HC path).
 */
export function applyVerifiedAccountStepIsolation(
  userId: string | null | undefined,
  providerSteps: number,
  localDate = getTodayKey(),
): number | null {
  if (!userId || !active) return null;
  if (active.userId !== userId || active.localDate !== localDate) return null;
  return resolveIsolatedVerifiedTodaySteps({
    providerSteps,
    accountFloor: active.accountFloor,
    providerBaseline: active.providerBaseline,
  });
}
