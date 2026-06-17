export type RaceType = "quick" | "endurance" | "country_battle" | "friends" | "sponsored";
export type EntryType = "Free" | "$1" | "$3" | "$5";

export interface LiveRacePlayer {
  id: string;
  username: string;
  countryFlag: string;
  avatarColor: string;
  currentSteps: number;
  targetSteps: number;
  rank: number;
}

export interface LiveRaceComment {
  id: string;
  username: string;
  countryFlag: string;
  avatarColor: string;
  text: string;
  timestamp: string;
}

export interface LiveRace {
  id: string;
  title: string;
  type: RaceType;
  entryType: EntryType;
  playerCount: number;
  maxPlayers: number;
  targetSteps: number;
  elapsedSeconds: number;
  spectatorCount: number;
  commentCount: number;
  reactionCounts: Record<string, number>;
  players: LiveRacePlayer[];
  comments: LiveRaceComment[];
  prizePool: number;
  isLive: boolean;
}

export const REACTION_EMOJIS = ["🔥", "👏", "👑", "🏃", "🏆", "😮"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const MOCK_LIVE_RACES: LiveRace[] = [
  {
    id: "lr1",
    title: "$3 Endurance Race",
    type: "endurance",
    entryType: "$3",
    playerCount: 10,
    maxPlayers: 10,
    targetSteps: 2000,
    elapsedSeconds: 420,
    spectatorCount: 847,
    commentCount: 312,
    prizePool: 21,
    isLive: true,
    reactionCounts: { "🔥": 234, "👏": 189, "👑": 67, "🏃": 412, "🏆": 98 },
    players: [
      { id: "p1", username: "speedwalker_kai", countryFlag: "🇨🇳", avatarColor: "#00E676", currentSteps: 1820, targetSteps: 2000, rank: 1 },
      { id: "p2", username: "marathon_priya", countryFlag: "🇮🇳", avatarColor: "#00B4FF", currentSteps: 1740, targetSteps: 2000, rank: 2 },
      { id: "p3", username: "walker_james", countryFlag: "🇺🇸", avatarColor: "#06B6D4", currentSteps: 1680, targetSteps: 2000, rank: 3 },
      { id: "p4", username: "neon_stepper", countryFlag: "🇯🇵", avatarColor: "#FFD700", currentSteps: 1620, targetSteps: 2000, rank: 4 },
      { id: "p5", username: "swift_leo", countryFlag: "🇩🇪", avatarColor: "#FF6B35", currentSteps: 1550, targetSteps: 2000, rank: 5 },
      { id: "p6", username: "walk_queen_s", countryFlag: "🇫🇷", avatarColor: "#A855F7", currentSteps: 1490, targetSteps: 2000, rank: 6 },
      { id: "p7", username: "stepmaster_r", countryFlag: "🇮🇳", avatarColor: "#F472B6", currentSteps: 1420, targetSteps: 2000, rank: 7 },
      { id: "p8", username: "sunwalk_ko", countryFlag: "🇵🇱", avatarColor: "#34D399", currentSteps: 1350, targetSteps: 2000, rank: 8 },
      { id: "p9", username: "morningrun_oz", countryFlag: "🇦🇺", avatarColor: "#60A5FA", currentSteps: 1280, targetSteps: 2000, rank: 9 },
      { id: "p10", username: "pace_hero99", countryFlag: "🇲🇽", avatarColor: "#FBBF24", currentSteps: 1200, targetSteps: 2000, rank: 10 },
    ],
    comments: [
      { id: "c1", username: "fan_omar", countryFlag: "🇸🇦", avatarColor: "#00E676", text: "speedwalker_kai is flying 🔥", timestamp: "just now" },
      { id: "c2", username: "spectator_yui", countryFlag: "🇯🇵", avatarColor: "#00B4FF", text: "This race is insane!", timestamp: "5s ago" },
      { id: "c3", username: "go_india_fan", countryFlag: "🇮🇳", avatarColor: "#FF6B35", text: "Come on priya!! 👑", timestamp: "12s ago" },
      { id: "c4", username: "walker_bex", countryFlag: "🇬🇧", avatarColor: "#A855F7", text: "Who's gonna win??", timestamp: "20s ago" },
      { id: "c5", username: "race_addict", countryFlag: "🇺🇸", avatarColor: "#06B6D4", text: "Incredible pace by everyone!", timestamp: "35s ago" },
    ],
  },
  {
    id: "lr2",
    title: "🌍 Country Battle — India vs China",
    type: "country_battle",
    entryType: "Free",
    playerCount: 8,
    maxPlayers: 10,
    targetSteps: 5000,
    elapsedSeconds: 1200,
    spectatorCount: 2341,
    commentCount: 891,
    prizePool: 0,
    isLive: true,
    reactionCounts: { "🔥": 891, "👏": 445, "👑": 120, "🏃": 789, "🏆": 234 },
    players: [
      { id: "p1", username: "india_warrior1", countryFlag: "🇮🇳", avatarColor: "#FF6B35", currentSteps: 3200, targetSteps: 5000, rank: 1 },
      { id: "p2", username: "china_pace99", countryFlag: "🇨🇳", avatarColor: "#00E676", currentSteps: 3100, targetSteps: 5000, rank: 2 },
      { id: "p3", username: "desi_stride_r", countryFlag: "🇮🇳", avatarColor: "#00B4FF", currentSteps: 2950, targetSteps: 5000, rank: 3 },
      { id: "p4", username: "shenzhen_run", countryFlag: "🇨🇳", avatarColor: "#FFD700", currentSteps: 2800, targetSteps: 5000, rank: 4 },
      { id: "p5", username: "mumbai_steps", countryFlag: "🇮🇳", avatarColor: "#A855F7", currentSteps: 2700, targetSteps: 5000, rank: 5 },
      { id: "p6", username: "beijing_walk", countryFlag: "🇨🇳", avatarColor: "#F472B6", currentSteps: 2600, targetSteps: 5000, rank: 6 },
      { id: "p7", username: "pune_runner", countryFlag: "🇮🇳", avatarColor: "#34D399", currentSteps: 2500, targetSteps: 5000, rank: 7 },
      { id: "p8", username: "shanghai_ko", countryFlag: "🇨🇳", avatarColor: "#60A5FA", currentSteps: 2400, targetSteps: 5000, rank: 8 },
    ],
    comments: [
      { id: "c1", username: "india_pride", countryFlag: "🇮🇳", avatarColor: "#FF6B35", text: "India is taking over!! 🇮🇳🔥", timestamp: "just now" },
      { id: "c2", username: "cn_fan_xu", countryFlag: "🇨🇳", avatarColor: "#00E676", text: "China won't give up! 💪", timestamp: "8s ago" },
      { id: "c3", username: "neutral_watcher", countryFlag: "🇺🇸", avatarColor: "#00B4FF", text: "This country battle is epic!", timestamp: "15s ago" },
      { id: "c4", username: "soccer_fan_m", countryFlag: "🇧🇷", avatarColor: "#FFD700", text: "Both teams are fire 🔥🔥", timestamp: "28s ago" },
    ],
  },
  {
    id: "lr3",
    title: "$1 Quick Race",
    type: "quick",
    entryType: "$1",
    playerCount: 5,
    maxPlayers: 5,
    targetSteps: 1000,
    elapsedSeconds: 180,
    spectatorCount: 234,
    commentCount: 87,
    prizePool: 3.5,
    isLive: true,
    reactionCounts: { "🔥": 45, "👏": 32, "👑": 12, "🏃": 98, "🏆": 23 },
    players: [
      { id: "p1", username: "quick_kai", countryFlag: "🇰🇷", avatarColor: "#00E676", currentSteps: 720, targetSteps: 1000, rank: 1 },
      { id: "p2", username: "fast_ali", countryFlag: "🇸🇦", avatarColor: "#FFD700", currentSteps: 680, targetSteps: 1000, rank: 2 },
      { id: "p3", username: "sprint_nova", countryFlag: "🇧🇷", avatarColor: "#06B6D4", currentSteps: 650, targetSteps: 1000, rank: 3 },
      { id: "p4", username: "walk_ben", countryFlag: "🇬🇧", avatarColor: "#A855F7", currentSteps: 600, targetSteps: 1000, rank: 4 },
      { id: "p5", username: "mega_steps_g", countryFlag: "🇰🇪", avatarColor: "#34D399", currentSteps: 550, targetSteps: 1000, rank: 5 },
    ],
    comments: [
      { id: "c1", username: "fan_kim", countryFlag: "🇰🇷", avatarColor: "#00E676", text: "quick_kai about to finish first!", timestamp: "just now" },
      { id: "c2", username: "br_walker", countryFlag: "🇧🇷", avatarColor: "#06B6D4", text: "So close!! 😮", timestamp: "10s ago" },
    ],
  },
  {
    id: "lr4",
    title: "💎 $5 Champion Race",
    type: "endurance",
    entryType: "$5",
    playerCount: 10,
    maxPlayers: 10,
    targetSteps: 2000,
    elapsedSeconds: 600,
    spectatorCount: 1892,
    commentCount: 654,
    prizePool: 35,
    isLive: true,
    reactionCounts: { "🔥": 567, "👏": 298, "👑": 234, "🏃": 445, "🏆": 312 },
    players: [
      { id: "p1", username: "elite_ross", countryFlag: "🇺🇸", avatarColor: "#FFD700", currentSteps: 1450, targetSteps: 2000, rank: 1 },
      { id: "p2", username: "champion_yuri", countryFlag: "🇷🇺", avatarColor: "#00B4FF", currentSteps: 1390, targetSteps: 2000, rank: 2 },
      { id: "p3", username: "pro_walker_ax", countryFlag: "🇫🇷", avatarColor: "#00E676", currentSteps: 1340, targetSteps: 2000, rank: 3 },
      { id: "p4", username: "stride_king_n", countryFlag: "🇺🇦", avatarColor: "#06B6D4", currentSteps: 1290, targetSteps: 2000, rank: 4 },
      { id: "p5", username: "pace_pro_t", countryFlag: "🇯🇵", avatarColor: "#A855F7", currentSteps: 1230, targetSteps: 2000, rank: 5 },
      { id: "p6", username: "uk_racer_h", countryFlag: "🇬🇧", avatarColor: "#34D399", currentSteps: 1180, targetSteps: 2000, rank: 6 },
      { id: "p7", username: "au_champion_b", countryFlag: "🇦🇺", avatarColor: "#60A5FA", currentSteps: 1120, targetSteps: 2000, rank: 7 },
      { id: "p8", username: "de_walker_k", countryFlag: "🇩🇪", avatarColor: "#FBBF24", currentSteps: 1050, targetSteps: 2000, rank: 8 },
      { id: "p9", username: "kr_speeder_j", countryFlag: "🇰🇷", avatarColor: "#F472B6", currentSteps: 980, targetSteps: 2000, rank: 9 },
      { id: "p10", username: "br_stride_m", countryFlag: "🇧🇷", avatarColor: "#FF6B35", currentSteps: 900, targetSteps: 2000, rank: 10 },
    ],
    comments: [
      { id: "c1", username: "big_fan_r", countryFlag: "🇺🇸", avatarColor: "#FFD700", text: "elite_ross going for gold 👑", timestamp: "just now" },
      { id: "c2", username: "watch_fan", countryFlag: "🇬🇧", avatarColor: "#00B4FF", text: "$35 pool is huge!!", timestamp: "7s ago" },
      { id: "c3", username: "cheer_squad", countryFlag: "🇫🇷", avatarColor: "#00E676", text: "pro_walker_ax fighting for podium!", timestamp: "22s ago" },
    ],
  },
  {
    id: "lr5",
    title: "🎯 Sponsored Challenge — Nike",
    type: "sponsored",
    entryType: "Free",
    playerCount: 10,
    maxPlayers: 10,
    targetSteps: 3000,
    elapsedSeconds: 900,
    spectatorCount: 4120,
    commentCount: 1240,
    prizePool: 0,
    isLive: true,
    reactionCounts: { "🔥": 1234, "👏": 876, "👑": 345, "🏃": 1567, "🏆": 678 },
    players: [
      { id: "p1", username: "nike_runner_a", countryFlag: "🇺🇸", avatarColor: "#00E676", currentSteps: 2100, targetSteps: 3000, rank: 1 },
      { id: "p2", username: "just_do_walk", countryFlag: "🇬🇧", avatarColor: "#06B6D4", currentSteps: 2000, targetSteps: 3000, rank: 2 },
      { id: "p3", username: "airmax_stride", countryFlag: "🇩🇪", avatarColor: "#00B4FF", currentSteps: 1900, targetSteps: 3000, rank: 3 },
    ],
    comments: [
      { id: "c1", username: "sponsored_fan", countryFlag: "🇺🇸", avatarColor: "#00E676", text: "Love the Nike race! 🏆", timestamp: "just now" },
      { id: "c2", username: "brand_watcher", countryFlag: "🇬🇧", avatarColor: "#06B6D4", text: "Free race with prizes?? Sign me up!", timestamp: "3s ago" },
    ],
  },
];
