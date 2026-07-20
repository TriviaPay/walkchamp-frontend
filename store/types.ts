export interface UserProfile {
  id: string;
  fullName: string;
  username: string;
  email: string;
  phone: string;
  country: string;
  countryFlag: string;
  countryCode: string;
  profileImageUrl: string | null;
  avatarVersion?: number;
  dateOfBirth: string;
  gender: string;
  referralCode: string;
  walletBalance: number;
  totalSteps: number;
  currentStreak: number;
  currentRank: number;
  bio: string;
  level: number;
  avatarColor: string;
  emailVerified: boolean;
  profileComplete: boolean;
  accountStatus: string;
  isAdult: boolean;
  paidRaceEnabled: boolean;
  withdrawalsEnabled: boolean;
  authProvider: string;
}
