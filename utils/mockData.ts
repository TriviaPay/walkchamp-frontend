export interface LeaderboardUser {
  id: string;
  username: string;
  fullName: string;
  country: string;
  countryFlag: string;
  steps: number;
  rank: number;
  badge: string;
  isVerified: boolean;
  rewardAmount: number;
  avatarColor: string;
}

export type WalletTransactionType =
  | "reward"
  | "withdrawal"
  | "bonus"
  | "referral"
  | "deposit"
  | "challenge_entry"
  | "prize"
  | "refund"
  | "reversal";

export interface WalletTransaction {
  id: string;
  type: WalletTransactionType;
  amount: number;
  description: string;
  date: string;
  status: "completed" | "pending" | "rejected";
  /** Raw backend ledger type when available (deposit_credit, prize_credit, etc.). */
  ledgerType?: string;
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  target: number;
  reward: number;
  type: "daily" | "weekly" | "special";
  endTime: string;
  icon: string;
}

export interface Announcement {
  id: string;
  title: string;
  message: string;
  date: string;
  winners: Array<{ username: string; flag: string; steps: number; reward: number }>;
}

const avatarColors = [
  "#00E676", "#00B4FF", "#06B6D4", "#FFD700", "#FF6B35",
  "#A855F7", "#F472B6", "#34D399", "#60A5FA", "#FBBF24",
];

export const MOCK_LEADERBOARD: LeaderboardUser[] = [
  { id: "1", username: "speedwalker_kai", fullName: "Kai Chen", country: "China", countryFlag: "🇨🇳", steps: 42850, rank: 1, badge: "Global Champion", isVerified: true, rewardAmount: 50, avatarColor: avatarColors[0] },
  { id: "2", username: "marathon_priya", fullName: "Priya Sharma", country: "India", countryFlag: "🇮🇳", steps: 39200, rank: 2, badge: "Global Champion", isVerified: true, rewardAmount: 30, avatarColor: avatarColors[1] },
  { id: "3", username: "walker_james", fullName: "James Wilson", country: "United States", countryFlag: "🇺🇸", steps: 36700, rank: 3, badge: "Weekly Champion", isVerified: true, rewardAmount: 20, avatarColor: avatarColors[2] },
  { id: "4", username: "neon_stepper", fullName: "Aiko Tanaka", country: "Japan", countryFlag: "🇯🇵", steps: 34100, rank: 4, badge: "Weekly Champion", isVerified: true, rewardAmount: 15, avatarColor: avatarColors[3] },
  { id: "5", username: "swift_leo", fullName: "Leo Muller", country: "Germany", countryFlag: "🇩🇪", steps: 31500, rank: 5, badge: "Daily Champion", isVerified: true, rewardAmount: 10, avatarColor: avatarColors[4] },
  { id: "6", username: "walk_queen_s", fullName: "Sophie Martin", country: "France", countryFlag: "🇫🇷", steps: 28900, rank: 6, badge: "Daily Champion", isVerified: false, rewardAmount: 8, avatarColor: avatarColors[5] },
  { id: "7", username: "stepmaster_r", fullName: "Raj Patel", country: "India", countryFlag: "🇮🇳", steps: 26400, rank: 7, badge: "Fast Walker", isVerified: true, rewardAmount: 6, avatarColor: avatarColors[6] },
  { id: "8", username: "sunwalk_ko", fullName: "Mia Kowalski", country: "Poland", countryFlag: "🇵🇱", steps: 24100, rank: 8, badge: "Fast Walker", isVerified: true, rewardAmount: 5, avatarColor: avatarColors[7] },
  { id: "9", username: "morningrun_oz", fullName: "Liam O'Brien", country: "Australia", countryFlag: "🇦🇺", steps: 22300, rank: 9, badge: "Fast Walker", isVerified: false, rewardAmount: 5, avatarColor: avatarColors[8] },
  { id: "10", username: "pace_hero99", fullName: "Carlos Reyes", country: "Mexico", countryFlag: "🇲🇽", steps: 21000, rank: 10, badge: "Fast Walker", isVerified: true, rewardAmount: 5, avatarColor: avatarColors[9] },
  { id: "11", username: "steppingstone_a", fullName: "Amara Okafor", country: "Nigeria", countryFlag: "🇳🇬", steps: 19800, rank: 11, badge: "Daily Champion", isVerified: true, rewardAmount: 0, avatarColor: avatarColors[0] },
  { id: "12", username: "ultra_walker_b", fullName: "Boris Ivanov", country: "Russia", countryFlag: "🇷🇺", steps: 18500, rank: 12, badge: "Fast Walker", isVerified: true, rewardAmount: 0, avatarColor: avatarColors[1] },
  { id: "13", username: "walkforce_y", fullName: "Yuna Park", country: "South Korea", countryFlag: "🇰🇷", steps: 17200, rank: 13, badge: "Fast Walker", isVerified: false, rewardAmount: 0, avatarColor: avatarColors[2] },
  { id: "14", username: "daily_trekker_f", fullName: "Fatima Al-Rashid", country: "UAE", countryFlag: "🇦🇪", steps: 16000, rank: 14, badge: "Beginner Walker", isVerified: true, rewardAmount: 0, avatarColor: avatarColors[3] },
  { id: "15", username: "ground_pounder_t", fullName: "Tom Hughes", country: "United Kingdom", countryFlag: "🇬🇧", steps: 14800, rank: 15, badge: "Beginner Walker", isVerified: true, rewardAmount: 0, avatarColor: avatarColors[4] },
  { id: "16", username: "stepzone_v", fullName: "Valentina Cruz", country: "Brazil", countryFlag: "🇧🇷", steps: 13500, rank: 16, badge: "Beginner Walker", isVerified: false, rewardAmount: 0, avatarColor: avatarColors[5] },
  { id: "17", username: "walk_n_win_h", fullName: "Hassan Ali", country: "Egypt", countryFlag: "🇪🇬", steps: 12200, rank: 17, badge: "Beginner Walker", isVerified: true, rewardAmount: 0, avatarColor: avatarColors[6] },
  { id: "18", username: "stride_king_n", fullName: "Nadia Petrov", country: "Ukraine", countryFlag: "🇺🇦", steps: 11100, rank: 18, badge: "Beginner Walker", isVerified: true, rewardAmount: 0, avatarColor: avatarColors[7] },
  { id: "19", username: "power_walk_s", fullName: "Samuel Kimani", country: "Kenya", countryFlag: "🇰🇪", steps: 10200, rank: 19, badge: "Beginner Walker", isVerified: false, rewardAmount: 0, avatarColor: avatarColors[8] },
  { id: "20", username: "strider_e", fullName: "Elena Rossi", country: "Italy", countryFlag: "🇮🇹", steps: 9400, rank: 20, badge: "Beginner Walker", isVerified: true, rewardAmount: 0, avatarColor: avatarColors[9] },
];

export const MOCK_CHALLENGES: Challenge[] = [
  { id: "c1", title: "Morning March", description: "Walk 5,000 steps before noon", target: 5000, reward: 2, type: "daily", endTime: "12:00 PM", icon: "sunrise" },
  { id: "c2", title: "Step Sprint", description: "Walk 2,000 steps in the next hour", target: 2000, reward: 1, type: "daily", endTime: "1 hour", icon: "zap" },
  { id: "c3", title: "Daily Champion", description: "Walk 10,000 steps today", target: 10000, reward: 5, type: "daily", endTime: "11:59 PM", icon: "award" },
  { id: "c4", title: "Global Race", description: "Highest steps in 30-min race", target: 4000, reward: 10, type: "special", endTime: "30 min race", icon: "flag" },
  { id: "c5", title: "Weekly Warrior", description: "Walk 50,000 steps this week", target: 50000, reward: 15, type: "weekly", endTime: "Sunday", icon: "shield" },
];

export const MOCK_ANNOUNCEMENT: Announcement = {
  id: "ann1",
  title: "Today's Top Walkers",
  message: "Congratulations to today's champions! They walked their way to glory.",
  date: "Today at 8:00 PM EST",
  winners: [
    { username: "speedwalker_kai", flag: "🇨🇳", steps: 42850, reward: 50 },
    { username: "marathon_priya", flag: "🇮🇳", steps: 39200, reward: 30 },
    { username: "walker_james", flag: "🇺🇸", steps: 36700, reward: 20 },
  ],
};

export const MOCK_TRANSACTIONS: WalletTransaction[] = [
  { id: "t1", type: "reward", amount: 5, description: "Daily Top 10 Reward — Day #7", date: "2 days ago", status: "completed" },
  { id: "t2", type: "bonus", amount: 1, description: "7-Day Streak Bonus", date: "3 days ago", status: "completed" },
  { id: "t3", type: "reward", amount: 5, description: "Daily Top 10 Reward — Day #5", date: "4 days ago", status: "completed" },
  { id: "t4", type: "referral", amount: 2, description: "Referral Bonus — @stepzone_v joined", date: "5 days ago", status: "completed" },
  { id: "t5", type: "withdrawal", amount: -10, description: "Withdrawal — PayPal", date: "1 week ago", status: "completed" },
  { id: "t6", type: "reward", amount: 5, description: "Daily Top 10 Reward — Day #3", date: "10 days ago", status: "completed" },
];

export const MOTIVATIONAL_QUOTES = [
  "Every step brings you closer to the top.",
  "Walk your way to greatness. One step at a time.",
  "Champions are built by showing up every day.",
  "Your feet are the engine. Your goal is the fuel.",
  "The road to #1 starts with today's first step.",
  "Consistency beats intensity. Walk every day.",
  "The longest journeys begin with a single step.",
];

export function getBadgeColor(badge: string): string {
  switch (badge) {
    case "Global Champion": return "#FFD700";
    case "Legend Walker": return "#A855F7";
    case "Weekly Champion": return "#00B4FF";
    case "Daily Champion": return "#00E676";
    case "Fast Walker": return "#FF9800";
    default: return "#7B7E97";
  }
}
