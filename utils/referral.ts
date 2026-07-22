import { authFetch } from "@/utils/authFetch";

export type ReferralStats = {
  invitesSent: number | null;
  friendsJoined: number | null;
  qualifiedReferrals: number | null;
  rewardsEarned: number | null;
};

export type ReferralConfig = {
  rewardAmount: number | null;
  friendRewardAmount: number | null;
  currency: string;
  requirementLabel: string | null;
  rules: string[];
};

export type ReferralDetails = {
  code: string;
  inviteUrl: string;
  stats: ReferralStats;
  config: ReferralConfig;
};

const DEFAULT_INVITE_BASE =
  process.env.EXPO_PUBLIC_APP_INVITE_URL ?? "https://walkchamp.app/invite";

/** Existing product copy used on Wallet → How to Earn Cash. */
const FALLBACK_CONFIG: ReferralConfig = {
  rewardAmount: 3,
  friendRewardAmount: 3,
  currency: "USD",
  requirementLabel: "Your friend joins an eligible Cash Challenge",
  rules: [
    "You earn a cash reward for each successful referral.",
    "Your friend also receives a reward after the requirement is completed.",
    "Rewards are credited after referral requirements are verified.",
    "Only eligible paid Cash Challenges qualify.",
    "Cancelled or forfeited challenges do not count toward referral rewards.",
  ],
};

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildInviteUrl(code: string): string {
  const base = DEFAULT_INVITE_BASE.replace(/\/$/, "");
  if (!code) return base;
  // Prefer /invite/<code> when base already ends with /invite.
  if (/\/invite$/i.test(base)) return `${base}/${encodeURIComponent(code)}`;
  return `${base}?code=${encodeURIComponent(code)}`;
}

function formatMoney(amount: number | null, currency: string): string {
  if (amount == null) return "—";
  if (currency.toUpperCase() === "INR") return `₹${Math.round(amount).toLocaleString()}`;
  const rounded = Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(2);
  return `$${rounded}`;
}

export function formatReferralReward(amount: number | null, currency = "USD"): string {
  return formatMoney(amount, currency);
}

export function buildReferralShareMessage(details: Pick<ReferralDetails, "code" | "inviteUrl" | "config">): string {
  const reward = formatMoney(details.config.rewardAmount, details.config.currency);
  const friendReward = formatMoney(details.config.friendRewardAmount, details.config.currency);
  const rewardLine =
    details.config.rewardAmount != null && details.config.friendRewardAmount != null
      ? `\nYou both can earn ${reward} / ${friendReward} after they complete the requirement.`
      : details.config.requirementLabel
        ? `\n${details.config.requirementLabel}.`
        : "";

  return [
    "Join me on Walk Champ!",
    "Walk together. Compete together. Earn rewards.",
    "",
    `My invite code: ${details.code}`,
    details.inviteUrl,
    rewardLine.trim(),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function parseReferralPayload(
  raw: Record<string, unknown>,
  fallbackCode: string,
): ReferralDetails {
  const nested =
    (typeof raw.data === "object" && raw.data ? (raw.data as Record<string, unknown>) : null) ??
    (typeof raw.referral === "object" && raw.referral ? (raw.referral as Record<string, unknown>) : null) ??
    raw;

  const code =
    asString(nested.code) ??
    asString(nested.referralCode) ??
    asString(nested.referral_code) ??
    asString(nested.inviteCode) ??
    fallbackCode;

  const inviteUrl =
    asString(nested.inviteUrl) ??
    asString(nested.invite_url) ??
    asString(nested.link) ??
    asString(nested.shareUrl) ??
    asString(nested.share_url) ??
    buildInviteUrl(code);

  const statsObj =
    (typeof nested.stats === "object" && nested.stats
      ? (nested.stats as Record<string, unknown>)
      : nested);

  const configObj =
    (typeof nested.config === "object" && nested.config
      ? (nested.config as Record<string, unknown>)
      : typeof nested.rewards === "object" && nested.rewards
        ? (nested.rewards as Record<string, unknown>)
        : nested);

  const referrerCents = asNumber(configObj.referrer_reward_cents);
  const refereeCents = asNumber(configObj.referee_reward_cents);

  const rewardAmount =
    asNumber(configObj.rewardAmount) ??
    asNumber(configObj.reward_amount) ??
    asNumber(configObj.referrerReward) ??
    (referrerCents != null ? referrerCents / 100 : null) ??
    asNumber(configObj.amount) ??
    FALLBACK_CONFIG.rewardAmount;

  const friendRewardAmount =
    asNumber(configObj.friendRewardAmount) ??
    asNumber(configObj.friend_reward_amount) ??
    asNumber(configObj.refereeReward) ??
    (refereeCents != null ? refereeCents / 100 : null) ??
    asNumber(configObj.friendAmount) ??
    FALLBACK_CONFIG.friendRewardAmount;

  const currency =
    asString(configObj.currency) ??
    asString(nested.currency) ??
    FALLBACK_CONFIG.currency;

  const requirementLabel =
    asString(configObj.requirementLabel) ??
    asString(configObj.requirement) ??
    asString(configObj.eligibility) ??
    FALLBACK_CONFIG.requirementLabel;

  const apiRules = Array.isArray(configObj.rules)
    ? configObj.rules.map((r) => asString(r)).filter((r): r is string => !!r)
    : [];

  const rules =
    apiRules.length > 0
      ? apiRules
      : [
          rewardAmount != null
            ? `You earn ${formatMoney(rewardAmount, currency)} for each successful referral.`
            : FALLBACK_CONFIG.rules[0],
          friendRewardAmount != null
            ? `Your friend also gets ${formatMoney(friendRewardAmount, currency)} after completion.`
            : FALLBACK_CONFIG.rules[1],
          requirementLabel
            ? `Requirement: ${requirementLabel}.`
            : FALLBACK_CONFIG.rules[2],
          "Rewards are credited after all referral requirements are verified.",
          "Cancelled challenges and ineligible accounts do not qualify.",
        ];

  return {
    code,
    inviteUrl,
    stats: {
      invitesSent:
        asNumber(statsObj.invitesSent) ??
        asNumber(statsObj.invites_sent) ??
        asNumber(statsObj.sent) ??
        null,
      friendsJoined:
        asNumber(statsObj.friendsJoined) ??
        asNumber(statsObj.friends_joined) ??
        asNumber(statsObj.joined) ??
        asNumber(statsObj.referrals) ??
        null,
      qualifiedReferrals:
        asNumber(statsObj.qualifiedReferrals) ??
        asNumber(statsObj.qualified_referrals) ??
        asNumber(statsObj.qualified) ??
        null,
      rewardsEarned:
        asNumber(statsObj.rewardsEarned) ??
        asNumber(statsObj.rewards_earned) ??
        asNumber(statsObj.totalRewards) ??
        asNumber(statsObj.total_rewards) ??
        (asNumber(statsObj.total_rewards_cents) != null
          ? asNumber(statsObj.total_rewards_cents)! / 100
          : null),
    },
    config: {
      rewardAmount,
      friendRewardAmount,
      currency,
      requirementLabel,
      rules,
    },
  };
}

/**
 * Loads referral details from the existing referral endpoints when available.
 * Falls back to the authenticated user's referral code + invite URL.
 */
export async function fetchReferralDetails(fallbackCode: string): Promise<ReferralDetails> {
  const code = fallbackCode.trim().toUpperCase();
  const endpoints = [
    "/api/referral",
    "/api/referrals/me",
    "/api/me/referral",
    "/api/profile/referral",
  ];

  for (const path of endpoints) {
    try {
      const res = await authFetch(path);
      if (!res.ok) continue;
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!json || typeof json !== "object") continue;
      return parseReferralPayload(json, code);
    } catch {
      // try next endpoint
    }
  }

  return {
    code,
    inviteUrl: buildInviteUrl(code),
    stats: {
      invitesSent: null,
      friendsJoined: null,
      qualifiedReferrals: null,
      rewardsEarned: null,
    },
    config: FALLBACK_CONFIG,
  };
}
