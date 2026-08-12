import { authFetch } from "@/utils/authFetch";
import { getApiBase } from "@/utils/apiUrl";

export type ReferralStats = {
  invitesSent: number | null;
  friendsJoined: number | null;
  qualifiedReferrals: number | null;
  rewardsEarned: number | null;
  pendingReferrals: number | null;
};

export type ReferralConfig = {
  rewardAmount: number | null;
  friendRewardAmount: number | null;
  currency: string;
  requirementLabel: string | null;
  rules: string[];
};

export type ReferralEntry = {
  userId: string;
  username: string;
  status: string;
  joinedAt: string | null;
  creditedAt: string | null;
};

export type ReferralDetails = {
  code: string;
  inviteUrl: string;
  stats: ReferralStats;
  config: ReferralConfig;
  referrals: ReferralEntry[];
};

export type ValidateReferralResult =
  | {
      valid: true;
      referrer: { username: string; fullName?: string | null };
    }
  | {
      valid: false;
      reason: string;
    };

export type ApplyReferralResult =
  | {
      ok: true;
      applied: true;
      referrerUsername?: string;
      message?: string;
    }
  | {
      ok: false;
      error: string;
      message: string;
      status: number;
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

export function buildReferralShareMessage(
  details: Pick<ReferralDetails, "code" | "inviteUrl" | "config">,
): string {
  const reward = formatMoney(details.config.rewardAmount, details.config.currency);
  const friendReward = formatMoney(details.config.friendRewardAmount, details.config.currency);
  const rewardLine =
    details.config.rewardAmount != null && details.config.friendRewardAmount != null
      ? `\nYou both can earn ${reward} / ${friendReward} after they complete the requirement.`
      : details.config.requirementLabel
        ? `\n${details.config.requirementLabel}.`
        : "";

  return [
    "Join me on WalkChamp!",
    "Walk together. Compete together. Earn rewards.",
    "",
    `My invite code: ${details.code}`,
    details.inviteUrl,
    rewardLine.trim(),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function parseReferralsList(raw: unknown): ReferralEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ReferralEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const userId = asString(row.userId) ?? asString(row.user_id) ?? "";
    const username = asString(row.username) ?? "Player";
    if (!userId && !username) continue;
    out.push({
      userId: userId || username,
      username,
      status: asString(row.status) ?? "pending",
      joinedAt: asString(row.joinedAt) ?? asString(row.joined_at),
      creditedAt: asString(row.creditedAt) ?? asString(row.credited_at),
    });
  }
  return out;
}

function parseReferralPayload(
  raw: Record<string, unknown>,
  fallbackCode: string,
): ReferralDetails {
  const nested =
    (typeof raw.data === "object" && raw.data ? (raw.data as Record<string, unknown>) : null) ??
    (typeof raw.referral === "object" && raw.referral ? (raw.referral as Record<string, unknown>) : null) ??
    raw;

  const summary =
    typeof nested.summary === "object" && nested.summary
      ? (nested.summary as Record<string, unknown>)
      : null;

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
  const bonusMinor = asNumber(nested.bonusAmountMinor) ?? asNumber(nested.bonus_amount_minor);

  const rewardAmount =
    asNumber(nested.bonusAmount) ??
    asNumber(nested.bonus_amount) ??
    (bonusMinor != null ? bonusMinor / 100 : null) ??
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
    asString(nested.currency) ??
    asString(configObj.currency) ??
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

  const totalEarnedMinor =
    asNumber(summary?.totalEarnedMinor) ?? asNumber(summary?.total_earned_minor);
  const totalEarned =
    asNumber(summary?.totalEarned) ??
    asNumber(summary?.total_earned) ??
    (totalEarnedMinor != null ? totalEarnedMinor / 100 : null);

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
        asNumber(summary?.totalReferred) ??
        asNumber(summary?.total_referred) ??
        asNumber(statsObj.friendsJoined) ??
        asNumber(statsObj.friends_joined) ??
        asNumber(statsObj.joined) ??
        asNumber(statsObj.referrals) ??
        null,
      qualifiedReferrals:
        asNumber(summary?.credited) ??
        asNumber(statsObj.qualifiedReferrals) ??
        asNumber(statsObj.qualified_referrals) ??
        asNumber(statsObj.qualified) ??
        null,
      pendingReferrals:
        asNumber(summary?.pending) ??
        asNumber(statsObj.pendingReferrals) ??
        asNumber(statsObj.pending) ??
        null,
      rewardsEarned:
        totalEarned ??
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
    referrals: parseReferralsList(nested.referrals),
  };
}

/**
 * GET /api/referral/validate?code=XXX — JWT required (signup session is enough).
 */
export async function validateReferralCode(
  code: string,
  sessionJwt: string,
): Promise<ValidateReferralResult> {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) {
    return { valid: false, reason: "empty" };
  }
  if (!sessionJwt) {
    return { valid: false, reason: "unauthorized" };
  }

  try {
    const res = await fetch(
      `${getApiBase()}/api/referral/validate?code=${encodeURIComponent(trimmed)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${sessionJwt}`,
        },
      },
    );
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !data || typeof data !== "object") {
      return { valid: false, reason: "not_found" };
    }
    if (data.valid === true) {
      const referrer =
        typeof data.referrer === "object" && data.referrer
          ? (data.referrer as Record<string, unknown>)
          : {};
      return {
        valid: true,
        referrer: {
          username: asString(referrer.username) ?? "friend",
          fullName: asString(referrer.fullName) ?? asString(referrer.full_name),
        },
      };
    }
    return {
      valid: false,
      reason: asString(data.reason) ?? "not_found",
    };
  } catch {
    return { valid: false, reason: "network_error" };
  }
}

/**
 * POST /api/referral/apply — attach a code after signup (authenticated).
 * Non-throwing: maps known API error codes for the UI.
 */
export async function applyReferralCode(code: string): Promise<ApplyReferralResult> {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) {
    return {
      ok: false,
      error: "invalid_request",
      message: "Referral code is required.",
      status: 400,
    };
  }

  try {
    const res = await authFetch("/api/referral/apply", {
      method: "POST",
      body: JSON.stringify({ code: trimmed }),
      retryOnUnauthorized: false,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (res.ok && data.applied === true) {
      const referrer =
        typeof data.referrer === "object" && data.referrer
          ? (data.referrer as Record<string, unknown>)
          : {};
      return {
        ok: true,
        applied: true,
        referrerUsername: asString(referrer.username) ?? undefined,
        message: asString(data.message) ?? undefined,
      };
    }

    return {
      ok: false,
      error: asString(data.error) ?? "invalid_code",
      message:
        asString(data.message) ??
        (res.status === 409
          ? "This referral could not be applied."
          : "Invalid referral code."),
      status: res.status,
    };
  } catch {
    return {
      ok: false,
      error: "network_error",
      message: "Could not apply referral code. Please try again.",
      status: 0,
    };
  }
}

/**
 * GET /api/referral — authenticated dashboard.
 * Primary field for the Invite Friends code card: `referralCode`.
 */
export async function fetchReferralDetails(fallbackCode = ""): Promise<ReferralDetails> {
  const code = fallbackCode.trim().toUpperCase();

  try {
    const res = await authFetch("/api/referral");
    if (res.ok) {
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (json && typeof json === "object") {
        return parseReferralPayload(json, code);
      }
    }
  } catch {
    // fall through to legacy paths
  }

  const legacy = [
    "/api/referrals/me",
    "/api/me/referral",
    "/api/profile/referral",
  ];
  for (const path of legacy) {
    try {
      const res = await authFetch(path);
      if (!res.ok) continue;
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!json || typeof json !== "object") continue;
      return parseReferralPayload(json, code);
    } catch {
      // try next
    }
  }

  return {
    code,
    inviteUrl: buildInviteUrl(code),
    stats: {
      invitesSent: null,
      friendsJoined: null,
      qualifiedReferrals: null,
      pendingReferrals: null,
      rewardsEarned: null,
    },
    config: FALLBACK_CONFIG,
    referrals: [],
  };
}
