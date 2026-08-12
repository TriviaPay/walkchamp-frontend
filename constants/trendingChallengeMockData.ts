/**
 * Frontend mock Trending Challenges for Walk-tab preview.
 * Stable themes/artwork — no Math.random().
 *
 * Enable/disable via featureFlags:
 *   ENABLE_WALK_TRENDING_CHALLENGES_MOCK / EXPO_PUBLIC_ENABLE_WALK_TRENDING_CHALLENGES_MOCK
 */

import type { TrendingChallenge } from "@/utils/trendingChallenges";
import {
  TRENDING_ARTWORK_KEYS,
  TRENDING_THEME_KEYS,
} from "@/constants/trendingChallengeThemes";
type MockSeed = {
  id: string;
  title: string;
  challengeFormat: TrendingChallenge["challengeFormat"];
  prizePoolDisplay: string;
  participantCount: number;
  /** Hours from now until start */
  startsInHours: number;
  /** Challenge length in days (for End Date) */
  durationDays: number;
  typeBadge: string;
};

/** 10 mock cards — titles match Streak Challenge card style on Walk. */
const MOCK_SEEDS: MockSeed[] = [
  {
    id: "mock-unlimited-01",
    title: "Streak challenge · 10,000 steps/day",
    challengeFormat: "unlimited_goal",
    prizePoolDisplay: "$10",
    participantCount: 1,
    startsInHours: 2,
    durationDays: 7,
    typeBadge: "Streak Challenge",
  },
  {
    id: "mock-unlimited-02",
    title: "Streak challenge · 8,000 steps/day",
    challengeFormat: "unlimited_goal",
    prizePoolDisplay: "$15",
    participantCount: 24,
    startsInHours: 5,
    durationDays: 3,
    typeBadge: "Streak Challenge",
  },
  {
    id: "mock-unlimited-03",
    title: "Streak challenge · 12,000 steps/day",
    challengeFormat: "unlimited_goal",
    prizePoolDisplay: "$25",
    participantCount: 86,
    startsInHours: 8,
    durationDays: 5,
    typeBadge: "Streak Challenge",
  },
  {
    id: "mock-unlimited-04",
    title: "Streak challenge · 5,000 steps/day",
    challengeFormat: "unlimited_goal",
    prizePoolDisplay: "$8",
    participantCount: 12,
    startsInHours: 12,
    durationDays: 1,
    typeBadge: "Streak Challenge",
  },
  {
    id: "mock-unlimited-05",
    title: "Streak challenge · 15,000 steps/day",
    challengeFormat: "unlimited_goal",
    prizePoolDisplay: "$40",
    participantCount: 210,
    startsInHours: 18,
    durationDays: 7,
    typeBadge: "Streak Challenge",
  },
  {
    id: "mock-unlimited-06",
    title: "Streak challenge · 7,500 steps/day",
    challengeFormat: "unlimited_goal",
    prizePoolDisplay: "$12",
    participantCount: 45,
    startsInHours: 24,
    durationDays: 2,
    typeBadge: "Streak Challenge",
  },
  {
    id: "mock-unlimited-07",
    title: "Streak challenge · 20,000 steps/day",
    challengeFormat: "unlimited_goal",
    prizePoolDisplay: "$50",
    participantCount: 318,
    startsInHours: 30,
    durationDays: 7,
    typeBadge: "Streak Challenge",
  },
  {
    id: "mock-unlimited-08",
    title: "Streak challenge · 6,000 steps/day",
    challengeFormat: "unlimited_goal",
    prizePoolDisplay: "$6",
    participantCount: 9,
    startsInHours: 36,
    durationDays: 1,
    typeBadge: "Streak Challenge",
  },
  {
    id: "mock-unlimited-09",
    title: "Streak challenge · 9,000 steps/day",
    challengeFormat: "unlimited_goal",
    prizePoolDisplay: "$18",
    participantCount: 67,
    startsInHours: 42,
    durationDays: 4,
    typeBadge: "Streak Challenge",
  },
  {
    id: "mock-unlimited-10",
    title: "Streak challenge · 11,000 steps/day",
    challengeFormat: "unlimited_goal",
    prizePoolDisplay: "$30",
    participantCount: 152,
    startsInHours: 48,
    durationDays: 5,
    typeBadge: "Streak Challenge",
  },
];

function startsAtFromHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

/** Returns 10 mock upcoming challenges sorted by soonest start. */
export function getTrendingChallengeMocks(timezone = "UTC"): TrendingChallenge[] {
  return [...MOCK_SEEDS]
    .sort((a, b) => a.startsInHours - b.startsInHours)
    .map((seed, index) => {
      const startsAtUtc = startsAtFromHours(seed.startsInHours);
      const endsAtUtc = new Date(
        new Date(startsAtUtc).getTime() + seed.durationDays * 86_400_000,
      ).toISOString();
      return {
        id: seed.id,
        title: seed.title,
        challengeFormat: seed.challengeFormat,
        prizePoolDisplay: seed.prizePoolDisplay,
        participantCount: seed.participantCount,
        startsAtUtc,
        endsAtUtc,
        timezone,
        themeKey: TRENDING_THEME_KEYS[index % TRENDING_THEME_KEYS.length]!,
        artworkKey: TRENDING_ARTWORK_KEYS[index % TRENDING_ARTWORK_KEYS.length]!,
        canJoin: true,
        status: "upcoming" as const,
        typeBadge: seed.typeBadge,
      };
    });
}
