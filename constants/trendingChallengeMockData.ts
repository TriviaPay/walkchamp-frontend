/**
 * Frontend mock Trending Challenges for Walk-tab Unlimited Challenge preview.
 * Stable themes/artwork — no Math.random().
 *
 * Flip TRENDING_CHALLENGES_USE_MOCK to false to use live Available Rooms API.
 */

import type { TrendingChallenge } from "@/utils/trendingChallenges";
import {
  TRENDING_ARTWORK_KEYS,
  TRENDING_THEME_KEYS,
} from "@/constants/trendingChallengeThemes";

/** Local UI preview — keep false so live Available / Unlimited APIs feed Trending. */
export const TRENDING_CHALLENGES_USE_MOCK = false;

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

/** Prefer unlimited_goal + fixed_cash so the Unlimited Challenge carousel has content. */
const MOCK_SEEDS: MockSeed[] = [
  {
    id: "mock-unlimited-01",
    title: "Unlimited Dawn March",
    challengeFormat: "unlimited_goal",
    prizePoolDisplay: "$1,180",
    participantCount: 742,
    startsInHours: 4,
    durationDays: 1,
    typeBadge: "Unlimited",
  },
  {
    id: "mock-unlimited-02",
    title: "Open Goal Night Walk",
    challengeFormat: "unlimited_goal",
    prizePoolDisplay: "$2,040",
    participantCount: 891,
    startsInHours: 10,
    durationDays: 3,
    typeBadge: "Unlimited",
  },
  {
    id: "mock-unlimited-03",
    title: "No Cap City Steps",
    challengeFormat: "unlimited_goal",
    prizePoolDisplay: "$3,600",
    participantCount: 1204,
    startsInHours: 18,
    durationDays: 7,
    typeBadge: "Unlimited",
  },
  {
    id: "mock-unlimited-04",
    title: "Endless Trail Cash Run",
    challengeFormat: "unlimited_goal",
    prizePoolDisplay: "$890",
    participantCount: 456,
    startsInHours: 28,
    durationDays: 1,
    typeBadge: "Unlimited",
  },
  {
    id: "mock-unlimited-05",
    title: "Skyline Unlimited Goal",
    challengeFormat: "unlimited_goal",
    prizePoolDisplay: "$5,250",
    participantCount: 1688,
    startsInHours: 36,
    durationDays: 5,
    typeBadge: "Unlimited",
  },
  {
    id: "mock-fixed-01",
    title: "City Steps Showdown",
    challengeFormat: "fixed_cash",
    prizePoolDisplay: "$2,500",
    participantCount: 1240,
    startsInHours: 6,
    durationDays: 1,
    typeBadge: "Fixed Cash",
  },
  {
    id: "mock-fixed-02",
    title: "Stadium 10K Clash",
    challengeFormat: "fixed_cash",
    prizePoolDisplay: "$3,200",
    participantCount: 1588,
    startsInHours: 14,
    durationDays: 1,
    typeBadge: "Fixed Cash",
  },
  {
    id: "mock-fixed-03",
    title: "Lightning Path Dash",
    challengeFormat: "fixed_cash",
    prizePoolDisplay: "$980",
    participantCount: 654,
    startsInHours: 22,
    durationDays: 2,
    typeBadge: "Fixed Cash",
  },
  {
    id: "mock-fixed-04",
    title: "Harbor Cash Challenge",
    challengeFormat: "fixed_cash",
    prizePoolDisplay: "$1,750",
    participantCount: 932,
    startsInHours: 40,
    durationDays: 1,
    typeBadge: "Fixed Cash",
  },
];

function startsAtFromHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

/** Returns mock upcoming challenges sorted by soonest start. */
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
