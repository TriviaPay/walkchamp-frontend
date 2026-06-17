import type { UserProfile } from "@/store/types";
import type { DbProfile } from "@/services/authService";

export type { UserProfile };

export function dbProfileToUserProfile(p: DbProfile): UserProfile {
  return {
    id: p.id as string,
    fullName: (p.fullName ?? p.full_name ?? "") as string,
    username: (p.username ?? "") as string,
    email: (p.email ?? "") as string,
    phone: (p.phoneNumber ?? p.phone_number ?? "") as string,
    country: (p.country ?? "") as string,
    countryFlag: (p.countryFlag ?? p.country_flag ?? "") as string,
    countryCode: (p.countryCode ?? p.country_code ?? "") as string,
    profileImageUrl: (p.avatarUrl ?? p.avatar_url ?? null) as string | null,
    avatarVersion: (p.avatarVersion as number | undefined) ?? (p.updatedAt ? new Date(p.updatedAt as unknown as string).getTime() : 0),
    dateOfBirth: (p.dateOfBirth ?? p.date_of_birth ?? "") as string,
    gender: "prefer_not_to_say",
    referralCode: (p.referralCode ?? p.referral_code ?? "") as string,
    walletBalance: (p.walletBalance ?? p.wallet_balance ?? 0) as number,
    totalSteps: (p.totalSteps ?? p.total_steps ?? 0) as number,
    currentStreak: (p.currentStreak ?? p.current_streak ?? 0) as number,
    currentRank: (p.currentRank ?? p.current_rank ?? 9999) as number,
    bio: (p.bio ?? "") as string,
    level: (p.level ?? 1) as number,
    avatarColor: (p.avatarColor ?? p.avatar_color ?? "#00E676") as string,
    emailVerified: (p.emailVerified ?? p.email_verified ?? false) as boolean,
    profileComplete: !!(p.username && p.country && (p.dateOfBirth ?? p.date_of_birth)),
    accountStatus: (p.accountStatus ?? p.account_status ?? "pending_verification") as string,
    isAdult: (p.isAdult ?? p.is_adult ?? false) as boolean,
    paidRaceEnabled: (p.paidRaceEnabled ?? p.paid_race_enabled ?? false) as boolean,
    withdrawalsEnabled: (p.withdrawalsEnabled ?? p.withdrawals_enabled ?? false) as boolean,
    authProvider: (p.authProvider ?? p.auth_provider ?? "email") as string,
  };
}
