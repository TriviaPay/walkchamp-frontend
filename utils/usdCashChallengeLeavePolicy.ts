/**
 * Paid USD cash challenge leave / refund UI policy (Fixed + Unlimited).
 * Free, coins, and sponsored keep their existing cancel/leave behavior.
 *
 * Refund eligibility is decided by the backend. Client may only preview
 * before/after-start copy from scheduled start + room status.
 */

import { isUnlimitedGoalChallenge } from "@/utils/unlimitedGoal";
import type { CashChallengeLeaveResponse } from "@/services/refundApi";

export const PAID_CHALLENGE_CANNOT_BE_CANCELLED = "PAID_CHALLENGE_CANNOT_BE_CANCELLED";

export const USD_CASH_NO_CANCEL_MESSAGE =
  "Cash challenges cannot be cancelled after creation.";

export const USD_CASH_LEAVE_TITLE = "Leave Challenge?";
export const USD_CASH_LEAVE_ACTION_LABEL = "Leave Challenge";
export const USD_CASH_LEAVE_STAY_LABEL = "Stay in Challenge";
export const USD_CASH_LEAVE_PRE_START_CONFIRM = "Leave & Request Refund";
export const USD_CASH_LEAVE_POST_START_CONFIRM = "Leave Without Refund";

export const USD_CASH_LEAVE_PRE_START_PARTICIPANT =
  "You will leave this challenge and lose prize eligibility. Because the challenge has not started, your eligible entry fee will be refunded.";

export const USD_CASH_LEAVE_PRE_START_HOST =
  "You will leave this challenge. Because it has not started, your eligible entry fee will be refunded. The challenge will continue for other participants.";

export const USD_CASH_LEAVE_POST_START_PARTICIPANT =
  "Leaving will remove you from this challenge and prize eligibility. Because the challenge has already started, no refund will be issued.";

export const USD_CASH_LEAVE_POST_START_HOST =
  "Leaving will remove you from this challenge and prize eligibility. No refund will be issued. The challenge will continue for other participants.";

export const USD_CASH_ACK_NO_CANCEL =
  "I understand that the challenge cannot be cancelled after creation.";

export const USD_CASH_ACK_PRE_START_REFUND =
  "I understand that leaving before the challenge starts may qualify for an entry-fee refund according to the refund policy.";

export const USD_CASH_ACK_POST_START_NO_REFUND =
  "I understand that leaving at or after the challenge start time provides no refund and removes me from prize eligibility.";

export const USD_CASH_ACK_HOST_CONTINUES =
  "I understand that if I leave, the challenge will continue for other participants.";

export type UsdCashChallengeLike = {
  entryFeeCents?: number | null;
  entryFee?: number | null;
  entryType?: string | null;
  challengeType?: string | null;
  capacityMode?: string | null;
  maxPlayers?: number | null;
};

export function isUsdCashChallenge(room: UsdCashChallengeLike | null | undefined): boolean {
  if (!room) return false;
  const entryType = (room.entryType ?? "").toLowerCase();
  if (entryType === "free" || entryType === "coins_battle" || entryType === "coins") {
    return false;
  }
  if (
    isUnlimitedGoalChallenge({
      challengeType: room.challengeType,
      entryType: room.entryType,
      capacityMode: room.capacityMode,
      maxPlayers: room.maxPlayers,
    })
  ) {
    return true;
  }
  const cents =
    typeof room.entryFeeCents === "number" && Number.isFinite(room.entryFeeCents)
      ? room.entryFeeCents
      : typeof room.entryFee === "number" && Number.isFinite(room.entryFee)
        ? Math.round(room.entryFee * 100)
        : 0;
  if (cents <= 0) return false;
  if (
    entryType === "paid_usd" ||
    entryType === "usd" ||
    entryType === "cash" ||
    entryType === "" ||
    entryType.includes("usd") ||
    entryType.includes("cash")
  ) {
    return true;
  }
  return cents > 0 && !entryType.includes("coin");
}

export function isUnlimitedCashChallenge(room: UsdCashChallengeLike | null | undefined): boolean {
  if (!room) return false;
  return isUnlimitedGoalChallenge({
    challengeType: room.challengeType,
    entryType: room.entryType,
    capacityMode: room.capacityMode,
    maxPlayers: room.maxPlayers,
  });
}

/** Leave API path for USD Fixed vs Unlimited. */
export function usdCashLeaveEndpoint(challengeId: string, isUnlimited: boolean): string {
  return isUnlimited
    ? `/api/unlimited-challenges/${challengeId}/leave`
    : `/api/races/${challengeId}/leave`;
}

/**
 * Preview only — final refund eligibility comes from the leave response.
 * Treats status in-progress+ as started, and scheduledStartAt <= now as started.
 */
export function previewChallengeHasStarted(params: {
  scheduledStartAt?: string | null;
  status?: string | null;
  nowMs?: number;
}): boolean {
  const status = (params.status ?? "").toLowerCase();
  if (
    status === "in_progress" ||
    status === "in_race" ||
    status === "racing" ||
    status === "active" ||
    status === "finished" ||
    status === "completed"
  ) {
    return true;
  }
  if (!params.scheduledStartAt) return false;
  const startMs = new Date(params.scheduledStartAt).getTime();
  if (!Number.isFinite(startMs)) return false;
  return (params.nowMs ?? Date.now()) >= startMs;
}

export function usdCashLeaveConfirmCopy(params: {
  hasStartedPreview: boolean;
  isHost: boolean;
}): { title: string; message: string; confirmLabel: string; stayLabel: string } {
  const title = USD_CASH_LEAVE_TITLE;
  const stayLabel = USD_CASH_LEAVE_STAY_LABEL;
  if (params.hasStartedPreview) {
    return {
      title,
      stayLabel,
      confirmLabel: USD_CASH_LEAVE_POST_START_CONFIRM,
      message: params.isHost
        ? USD_CASH_LEAVE_POST_START_HOST
        : USD_CASH_LEAVE_POST_START_PARTICIPANT,
    };
  }
  return {
    title,
    stayLabel,
    confirmLabel: USD_CASH_LEAVE_PRE_START_CONFIRM,
    message: params.isHost
      ? USD_CASH_LEAVE_PRE_START_HOST
      : USD_CASH_LEAVE_PRE_START_PARTICIPANT,
  };
}

export function mapPaidCancelError(body: {
  code?: string | null;
  error?: string | null;
}): string {
  if (body.code === PAID_CHALLENGE_CANNOT_BE_CANCELLED) {
    return body.error?.trim() || USD_CASH_NO_CANCEL_MESSAGE;
  }
  const err = (body.error ?? "").toLowerCase();
  if (err.includes("cannot be cancelled") || err.includes("cannot cancel")) {
    return body.error?.trim() || USD_CASH_NO_CANCEL_MESSAGE;
  }
  return body.error?.trim() || "Could not cancel this room.";
}

/** 404 / already-left responses should unlock UI as if leave succeeded. */
export function isAlreadyLeftLeaveError(status: number, body: { error?: string | null; code?: string | null }): boolean {
  if (status === 404) return true;
  const msg = (body.error ?? "").toLowerCase();
  return (
    msg.includes("not an active participant") ||
    msg.includes("not a participant") ||
    msg.includes("already left") ||
    msg.includes("not registered")
  );
}

export function shouldReleaseActiveChallengeLock(
  body: CashChallengeLeaveResponse | null | undefined,
): boolean {
  if (!body) return false;
  if (body.activeChallengeReleased === true) return true;
  if (body.success === true && body.participationStatus === "left") return true;
  return body.success === true;
}
