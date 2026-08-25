/**
 * Pure protected-race detection and error copy (no React Native).
 * Prefer backend `protectedRace`. Do not treat ordinary free or Streak races as protected.
 */

export const IOS_PROTECTED_UNAVAILABLE_MESSAGE =
  "Verified prize challenges aren't available on iPhone yet. Free races are still available.";

export const PROTECTED_PREFLIGHT_WAIT_MESSAGE =
  "Waiting for all participants to verify";

export function isProtectedPrizeRace(input: {
  protectedRace?: boolean | null;
  challengeType?: string | null;
  raceType?: string | null;
  entryType?: string | null;
  entryFeeCents?: number | null;
  entryFee?: number | null;
  isCash?: boolean | null;
  isSponsored?: boolean | null;
  verificationRequired?: boolean | null;
}): boolean {
  if (input.protectedRace === false) return false;
  if (input.protectedRace === true || input.verificationRequired === true) {
    return true;
  }

  const type = String(
    input.challengeType ?? input.raceType ?? input.entryType ?? "",
  )
    .trim()
    .toLowerCase();

  if (
    type === "free" ||
    type === "unlimited_goal" ||
    type === "unlimited" ||
    type === "streak"
  ) {
    return false;
  }

  if (input.isSponsored === true || type === "sponsored") return true;
  if (input.isCash === true) return true;
  if (
    type === "cash" ||
    type === "cash_challenge" ||
    type === "paid_usd" ||
    type === "coins_battle" ||
    type === "prize" ||
    type === "protected"
  ) {
    return true;
  }

  const feeCents =
    typeof input.entryFeeCents === "number"
      ? input.entryFeeCents
      : typeof input.entryFee === "number"
        ? Math.round(input.entryFee * 100)
        : 0;
  return feeCents > 0;
}

export function isProtectedClassicDurationOk(input: {
  durationMinutes: number | null | undefined;
  minimumRaceDurationMinutes: number;
  challengeType?: string | null;
}): { ok: boolean; message?: string } {
  const type = String(input.challengeType ?? "").toLowerCase();
  if (type === "unlimited_goal" || type === "unlimited" || type === "streak") {
    return { ok: true };
  }
  const mins = input.durationMinutes;
  if (mins == null || !Number.isFinite(mins)) {
    return { ok: true };
  }
  if (mins < input.minimumRaceDurationMinutes) {
    return {
      ok: false,
      message: `Verified prize challenges must run for at least ${input.minimumRaceDurationMinutes} minutes.`,
    };
  }
  return { ok: true };
}

export function protectedRaceErrorCopy(code?: string, fallback?: string): string {
  switch (code) {
    case "PROTECTED_PREFLIGHT_INCOMPLETE":
      return PROTECTED_PREFLIGHT_WAIT_MESSAGE;
    case "PROTECTED_RACE_DURATION_TOO_SHORT":
      return fallback || "Verified prize challenges must run for at least 60 minutes.";
    case "PROTECTED_DEVICE_SESSION_REQUIRED":
      return "Please sign in again to continue this verified challenge.";
    case "PROTECTED_REGISTERED_DEVICE_MISMATCH":
    case "PROTECTED_SESSION_BINDING_MISMATCH":
      return "This challenge is bound to a different phone or session. Contact support if you need help.";
    case "INTEGRITY_APP_MISMATCH":
    case "INTEGRITY_APP_UNRECOGNIZED":
    case "INTEGRITY_DEVICE_FAILED":
      return "This device isn't eligible for verified prize challenges.";
    case "IOS_APP_ATTEST_NOT_CONFIGURED":
      return IOS_PROTECTED_UNAVAILABLE_MESSAGE;
    case "INTEGRITY_PROVIDER_NOT_CONFIGURED":
      return "Verified prize challenges aren't available on this app version yet.";
    case "RACE_NOT_ENDED":
      return "The challenge is still in progress.";
    case "FINAL_EVIDENCE_ALREADY_SUBMITTED":
      return "Your verified activity was already submitted.";
    default:
      return fallback || "Couldn't complete verification. Please try again.";
  }
}
