/**
 * Compact Step 5 checkout models — pure helpers for Create Challenge review.
 * Does not change payloads, fees, or acknowledgment requirements.
 */

import {
  durationDaysFromGoalType,
  inlineRulePreview,
  resolveChallengeFormat,
  type CreateChallengeDraft,
  type StepBlockReason,
} from "@/utils/createChallengeFlow";
import type { ChallengeReviewSchedule } from "@/utils/createChallengeSchedule";
import {
  formatDurationDaysLabel,
} from "@/utils/unlimitedGoal";
import { formatPlayerLabel } from "@/utils/players";
import { formatStepLabel } from "@/utils/targetSteps";

/** Mirror of TRACK_THEME_LABELS — keep in sync; avoids requiring image assets in Node tests. */
const TRACK_DISPLAY_LABELS: Record<string, string> = {
  bg: "Neon Finish",
  daylightStadium: "Daylight Stadium",
};

export const CHECKOUT_CARD_GAP = 12;
export const CHECKOUT_CARD_RADIUS = 16;
export const CHECKOUT_CARD_PAD_H = 16;
export const CHECKOUT_CARD_PAD_V = 14;

export const CHECKOUT_ACK_UNLIMITED_L1 =
  "I understand that the challenge cannot be cancelled after creation.";
export const CHECKOUT_ACK_UNLIMITED_L2 =
  "I understand that leaving before the challenge starts may qualify for an entry-fee refund according to the refund policy. Leaving at or after start provides no refund. If I leave, the challenge will continue for other participants.";

export const CHECKOUT_ACK_FIXED_USD_L1 =
  "I understand that the challenge cannot be cancelled after creation.";
export const CHECKOUT_ACK_FIXED_USD_L2 =
  "I understand that leaving before the challenge starts may qualify for an entry-fee refund according to the refund policy. Leaving at or after start provides no refund. If I leave, the challenge will continue for other participants.";

export const CHECKOUT_ACK_FREE_COINS_L1 =
  "I understand the challenge rules.";
export const CHECKOUT_ACK_FREE_COINS_L2 =
  "Results use verified step data.";

export const CHECKOUT_ACK_TERMS = "Agree to Terms & Conditions";

/** @deprecated Prefer multi-line ack helpers. */
export const CHECKOUT_ACK_UNLIMITED = CHECKOUT_ACK_UNLIMITED_L1;

/** @deprecated Prefer multi-line ack helpers. */
export const CHECKOUT_ACK_FIXED_USD = CHECKOUT_ACK_FIXED_USD_L1;

/** @deprecated Prefer multi-line ack helpers. */
export const CHECKOUT_ACK_FREE_COINS = CHECKOUT_ACK_FREE_COINS_L1;

export const CHECKOUT_VIEW_RULES_LABEL = "View rules";

export const CHECKOUT_REVIEW_TITLE = "Review Challenge";

export const CHECKOUT_VIEW_DETAILS_LABEL = "View all challenge details";

export const CHECKOUT_DISABLED_RULES_HINT =
  "Accept the challenge rules to continue.";

export const CHECKOUT_PRIZE_POOL_NOTE = "Your entry fee is added to the prize pool.";

export const CHECKOUT_GOLD = "#E8C547";

export const UNLIMITED_FULL_RULES = [
  "Complete the goal every required day.",
  "Missing a day removes eligibility.",
  "Leaving does not create a refund.",
  "Contribution remains in the prize pool.",
  "Qualified finishers share equally.",
  "Verified step data is required.",
  "Host follows the same rules.",
] as const;

export const DAILY_GOAL_BANNER_PRIMARY = "Complete your daily goal every day.";
export const DAILY_GOAL_BANNER_SECONDARY =
  "Qualified finishers split the prize pool equally.";
export const DAILY_GOAL_BANNER_EXPAND = "How qualification works";

export const DAILY_GOAL_BANNER_EXPAND_BULLETS = [
  "Missing one day removes prize eligibility.",
  "Leaving does not create a refund.",
  "Final results require verified step data.",
  "The host follows the same rules.",
] as const;

export type CheckoutDetailRow = { label: string; value: string };

export type CompactChallengeSummary = {
  title: string;
  roomBadge: "Public Room" | "Private Room";
  roomIcon: "globe" | "lock";
  /** e.g. "$10 entry" */
  entryLine: string;
  /** e.g. "Unlimited players" */
  capacityLine: string;
  /** e.g. "10,000 steps/day" */
  goalLine: string;
  /** e.g. "7 days" */
  durationLine: string;
  /** e.g. "Starts Today at 12:58 PM" */
  startsLine: string;
  /** e.g. "Ends Aug 4, 12:58 PM" */
  endsLine: string;
  prizeRule: string;
  detailRows: CheckoutDetailRow[];
  accessibilityLabel: string;
};

export type CompactPaymentRows = {
  entryLabel: string;
  entryValue: string;
  taxLabel: string;
  taxValue: string;
  platformFeeLabel: string;
  platformFeeValue: string;
  totalLabel: string;
  totalValue: string;
  prizePoolNote: string;
};

function formatCompactEndDate(isoOrDisplay: string, displayTime: string): string {
  // Prefer month short + day when displayDate looks like "Fri, Oct 16" or "Tue, Aug 4"
  const cleaned = isoOrDisplay.replace(/^[A-Za-z]{3},\s*/, "");
  return `Ends ${cleaned} at ${displayTime}`;
}

function formatStartsLine(dateLabel: string, timeLabel: string): string {
  if (dateLabel === "Today") return `Starts Today at ${timeLabel}`;
  return `Starts ${dateLabel} at ${timeLabel}`;
}

/** Secondary-only expandable rows — never repeat compact summary fields. */
export function buildCheckoutSecondaryDetailRows(params: {
  draft: CreateChallengeDraft;
  timezone: string;
  trackLabel: string;
}): CheckoutDetailRow[] {
  const format = resolveChallengeFormat(params.draft);
  const isUnlimited = format === "unlimited_goal";
  return [
    {
      label: "Entry Type",
      value:
        params.draft.entryType === "free"
          ? "Free"
          : params.draft.entryType === "coins"
            ? "Coins"
            : "USD",
    },
    {
      label: "Challenge Type",
      value: isUnlimited ? "Unlimited" : "Fixed",
    },
    { label: "Timezone", value: params.timezone },
    { label: "Selected Track", value: params.trackLabel },
  ];
}

export function getTrackDisplayLabel(trackId: string): string {
  return TRACK_DISPLAY_LABELS[trackId] ?? trackId;
}

/** Build compact summary + expandable detail rows for Step 5. */
export function buildCompactChallengeSummary(params: {
  draft: CreateChallengeDraft;
  schedule: ChallengeReviewSchedule;
  timezone: string;
  trackLabel: string;
}): CompactChallengeSummary {
  const { draft, schedule } = params;
  const format = resolveChallengeFormat(draft);
  const isUnlimited = format === "unlimited_goal";
  const preview = inlineRulePreview(draft);
  const roomBadge = draft.visibility === "public" ? "Public Room" : "Private Room";
  const roomIcon = draft.visibility === "public" ? "globe" : "lock";

  const durationDays = isUnlimited
    ? draft.unlimited.durationDays
    : durationDaysFromGoalType(draft.fixed.goalType);

  let entryLine: string;
  let capacityLine: string;
  let goalLine: string;
  let durationLine: string;

  if (isUnlimited) {
    entryLine = `$${draft.unlimited.entryDollars} entry`;
    capacityLine = "Unlimited players";
    goalLine = `${draft.unlimited.dailyGoalSteps.toLocaleString()} steps/day`;
    durationLine = formatDurationDaysLabel(draft.unlimited.durationDays);
  } else if (draft.entryType === "free") {
    entryLine = "Free entry";
    capacityLine = formatPlayerLabel(draft.fixed.maxPlayers);
    goalLine = formatStepLabel(draft.fixed.targetSteps);
    durationLine = `${durationDays} day${durationDays === 1 ? "" : "s"}`;
  } else if (draft.entryType === "coins") {
    entryLine = `${draft.fixed.coinEntryAmount.toLocaleString()} coins`;
    capacityLine = formatPlayerLabel(draft.fixed.maxPlayers);
    goalLine = formatStepLabel(draft.fixed.targetSteps);
    durationLine = `${durationDays} day${durationDays === 1 ? "" : "s"}`;
  } else {
    entryLine = `$${draft.fixed.usdAmountDollars} entry`;
    capacityLine = formatPlayerLabel(draft.fixed.maxPlayers);
    goalLine = formatStepLabel(draft.fixed.targetSteps);
    durationLine = `${durationDays} day${durationDays === 1 ? "" : "s"}`;
  }

  const startsLine = formatStartsLine(schedule.startDisplayDate, schedule.startDisplayTime);
  const endsLine = formatCompactEndDate(schedule.endDisplayDate, schedule.endDisplayTime);

  const accessibilityLabel = [
    CHECKOUT_REVIEW_TITLE,
    preview.title,
    roomBadge,
    entryLine,
    capacityLine,
    goalLine,
    durationLine,
    startsLine,
    endsLine,
  ].join(". ");

  return {
    title: CHECKOUT_REVIEW_TITLE,
    roomBadge,
    roomIcon,
    entryLine,
    capacityLine,
    goalLine,
    durationLine,
    startsLine,
    endsLine,
    prizeRule: "",
    detailRows: [],
    accessibilityLabel,
  };
}

export function buildUnlimitedPaymentRows(params: {
  entryFeeCents: number;
  platformFeeCents: number;
  totalChargeCents: number;
  /** Optional processing tax from backend; defaults to $0.00 for Fixed-label parity. */
  taxFeeCents?: number;
  formatUsd: (cents: number) => string;
}): CompactPaymentRows {
  const taxFeeCents = params.taxFeeCents ?? 0;
  return {
    entryLabel: "Entry Fee",
    entryValue: params.formatUsd(params.entryFeeCents),
    taxLabel: "Tax / Payment Processing Fee",
    taxValue: params.formatUsd(taxFeeCents),
    platformFeeLabel: "Platform Service Fee",
    platformFeeValue: params.formatUsd(params.platformFeeCents),
    totalLabel: "Total Payable",
    totalValue: params.formatUsd(params.totalChargeCents),
    prizePoolNote: CHECKOUT_PRIZE_POOL_NOTE,
  };
}

/** Allowed Unlimited Payment Summary labels. */
export function isAllowedPaymentSummaryLabel(label: string): boolean {
  return (
    label === "Entry Fee" ||
    label === "Tax / Payment Processing Fee" ||
    label === "Platform Service Fee" ||
    label === "Total Payable"
  );
}

export type CheckoutAckLines = {
  line1: string;
  line2: string;
  terms: string;
  accessibilityLabel: string;
};

export function checkoutAckLines(draft: CreateChallengeDraft): CheckoutAckLines {
  const format = resolveChallengeFormat(draft);
  let line1: string;
  let line2: string;
  if (format === "unlimited_goal") {
    line1 = CHECKOUT_ACK_UNLIMITED_L1;
    line2 = CHECKOUT_ACK_UNLIMITED_L2;
  } else if (draft.entryType === "usd") {
    line1 = CHECKOUT_ACK_FIXED_USD_L1;
    line2 = CHECKOUT_ACK_FIXED_USD_L2;
  } else {
    line1 = CHECKOUT_ACK_FREE_COINS_L1;
    line2 = CHECKOUT_ACK_FREE_COINS_L2;
  }
  return {
    line1,
    line2,
    terms: CHECKOUT_ACK_TERMS,
    accessibilityLabel: `${line1} ${line2} ${CHECKOUT_ACK_TERMS}`,
  };
}

/** @deprecated Prefer checkoutAckLines. */
export function checkoutAckCopy(draft: CreateChallengeDraft): string {
  return checkoutAckLines(draft).accessibilityLabel;
}

export function checkoutDisabledHint(
  reason: StepBlockReason | null,
  createEnabled: boolean,
): string | null {
  if (createEnabled) return null;
  if (reason === "rules_not_accepted") return CHECKOUT_DISABLED_RULES_HINT;
  if (reason === "past_start_time") return "Choose a valid start time to continue.";
  if (reason === "payload_invalid") return "Finish required challenge details to continue.";
  return null;
}

export function isRulesAccepted(draft: CreateChallengeDraft): boolean {
  const format = resolveChallengeFormat(draft);
  if (format === "unlimited_goal") return draft.unlimitedRulesAccepted;
  return draft.rulesAccepted;
}
