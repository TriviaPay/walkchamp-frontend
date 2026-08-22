import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  CHALLENGE_PARTICIPATION_KEYS,
  CHALLENGE_PARTICIPATION_ROWS,
  applyIncomingBreakdown,
  buildChallengeParticipationDisplayRows,
  clampPercentageBar,
  extractBreakdownFromProfileMePayload,
  extractBreakdownFromPublicUserPayload,
  formatPercentage,
  formatTotalParticipatedLabel,
  formatZeroParticipationLabel,
  parseChallengeParticipationBreakdown,
  rowAccessibilityLabel,
  sectionAccessibilityLabel,
  shouldRenderBreakdownSection,
  statsHasBreakdownField,
  type ChallengeParticipationBreakdown,
} from "./challengeParticipationBreakdown";

const SAMPLE: ChallengeParticipationBreakdown = {
  totalParticipatedChallenges: 9,
  byType: {
    free: { count: 3, percentage: 33.33 },
    coins: { count: 1, percentage: 11.11 },
    topFinishers: { count: 2, percentage: 22.22 },
    sponsoredEvents: { count: 1, percentage: 11.11 },
    streakChallenge: { count: 2, percentage: 22.22 },
  },
};

const ZERO: ChallengeParticipationBreakdown = {
  totalParticipatedChallenges: 0,
  byType: {
    free: { count: 0, percentage: 0 },
    coins: { count: 0, percentage: 0 },
    topFinishers: { count: 0, percentage: 0 },
    sponsoredEvents: { count: 0, percentage: 0 },
    streakChallenge: { count: 0, percentage: 0 },
  },
};

{
  assert.deepEqual(
    [...CHALLENGE_PARTICIPATION_KEYS],
    ["free", "coins", "topFinishers", "sponsoredEvents", "streakChallenge"],
  );
  assert.deepEqual(
    CHALLENGE_PARTICIPATION_ROWS.map((r) => r.key),
    ["free", "coins", "topFinishers", "sponsoredEvents", "streakChallenge"],
  );
  assert.deepEqual(
    CHALLENGE_PARTICIPATION_ROWS.map((r) => r.label),
    ["Free", "Coins", "Top Finishers", "Sponsored Events", "Streak Challenge"],
  );
}

{
  const rows = buildChallengeParticipationDisplayRows(SAMPLE);
  assert.equal(rows.length, 5);
  assert.deepEqual(
    rows.map((r) => r.key),
    ["free", "coins", "topFinishers", "sponsoredEvents", "streakChallenge"],
  );
  assert.deepEqual(
    rows.map((r) => r.count),
    [3, 1, 2, 1, 2],
  );
  assert.deepEqual(
    rows.map((r) => r.percentage),
    [33.33, 11.11, 22.22, 11.11, 22.22],
  );
  assert.equal(rows[0].formattedPercentage, formatPercentage(33.33));
}

{
  const streakOnly: ChallengeParticipationBreakdown = {
    totalParticipatedChallenges: 1,
    byType: {
      free: { count: 0, percentage: 0 },
      coins: { count: 0, percentage: 0 },
      topFinishers: { count: 0, percentage: 0 },
      sponsoredEvents: { count: 0, percentage: 0 },
      streakChallenge: { count: 1, percentage: 100 },
    },
  };
  const rows = buildChallengeParticipationDisplayRows(streakOnly);
  assert.equal(rows[4].count, 1);
  assert.equal(streakOnly.totalParticipatedChallenges, 1);
}

{
  const parsedZero = parseChallengeParticipationBreakdown(ZERO);
  assert.ok(parsedZero);
  assert.equal(parsedZero.totalParticipatedChallenges, 0);
  assert.equal(shouldRenderBreakdownSection({ loading: false, breakdown: parsedZero }), "show");
  assert.equal(formatZeroParticipationLabel(), "No challenges participated yet");
}

{
  assert.equal(parseChallengeParticipationBreakdown(undefined), undefined);
  assert.equal(parseChallengeParticipationBreakdown(null), undefined);
  assert.equal(parseChallengeParticipationBreakdown({}), undefined);
  assert.equal(shouldRenderBreakdownSection({ loading: false, breakdown: undefined }), "hide");
  assert.equal(shouldRenderBreakdownSection({ loading: true, breakdown: undefined }), "skeleton");
  assert.notEqual(
    shouldRenderBreakdownSection({ loading: false, breakdown: undefined }),
    "show",
  );
}

{
  assert.equal(formatPercentage(0), "0%");
  assert.equal(formatPercentage(25), "25%");
  assert.equal(formatPercentage(12.5), "12.5%");
  assert.equal(formatPercentage(33.33), "33.33%");
  assert.equal(formatPercentage(33.333), "33.33%");
  assert.equal(formatPercentage(Number.NaN), "0%");
  assert.equal(formatPercentage(Number.POSITIVE_INFINITY), "0%");
  assert.equal(formatPercentage(-4), "0%");
  assert.equal(formatPercentage(140), "100%");
}

{
  assert.equal(clampPercentageBar(0), 0);
  assert.equal(clampPercentageBar(50), 50);
  assert.equal(clampPercentageBar(100), 100);
  assert.equal(clampPercentageBar(-12), 0);
  assert.equal(clampPercentageBar(140), 100);
  assert.equal(clampPercentageBar(Number.NaN), 0);
  assert.equal(clampPercentageBar(Number.NEGATIVE_INFINITY), 0);
}

{
  assert.equal(formatTotalParticipatedLabel(1), "1 Challenge Participated");
  assert.equal(formatTotalParticipatedLabel(0), "0 Challenges Participated");
  assert.equal(formatTotalParticipatedLabel(9), "9 Challenges Participated");
  assert.equal(formatTotalParticipatedLabel(2), "2 Challenges Participated");
}

{
  const mePayload = { data: { stats: { challengeParticipationBreakdown: SAMPLE } } };
  const publicUsernamePayload = { data: { stats: { challengeParticipationBreakdown: SAMPLE } } };
  const publicUserPayload = { stats: { challengeParticipationBreakdown: SAMPLE } };

  assert.deepEqual(extractBreakdownFromProfileMePayload(mePayload), SAMPLE);
  assert.deepEqual(extractBreakdownFromProfileMePayload(publicUsernamePayload), SAMPLE);
  assert.deepEqual(extractBreakdownFromPublicUserPayload(publicUserPayload), SAMPLE);
  assert.equal(extractBreakdownFromProfileMePayload({ data: { stats: {} } }), undefined);
  assert.equal(extractBreakdownFromPublicUserPayload({ stats: { racesPlayed: 4 } }), undefined);
}

{
  const previous = SAMPLE;
  assert.equal(statsHasBreakdownField({ racesPlayed: 3 }), false);
  assert.equal(applyIncomingBreakdown({ racesPlayed: 3 }, previous), previous);
  assert.deepEqual(
    applyIncomingBreakdown({ challengeParticipationBreakdown: ZERO }, previous),
    ZERO,
  );
  assert.equal(
    applyIncomingBreakdown({ challengeParticipationBreakdown: null }, previous),
    undefined,
  );
}

{
  assert.equal(
    sectionAccessibilityLabel(SAMPLE),
    "Challenge participation breakdown. 9 challenges participated.",
  );
  assert.equal(
    sectionAccessibilityLabel({ ...SAMPLE, totalParticipatedChallenges: 1 }),
    "Challenge participation breakdown. 1 challenge participated.",
  );
  const freeRow = buildChallengeParticipationDisplayRows(SAMPLE)[0];
  assert.equal(
    rowAccessibilityLabel(freeRow),
    "Free challenges. 3 participated. 33.33 percent.",
  );
}

{
  const root = path.resolve(__dirname, "..");
  const utilSrc = fs.readFileSync(path.join(root, "utils", "challengeParticipationBreakdown.ts"), "utf8");
  const cardSrc = fs.readFileSync(path.join(root, "components", "ChallengeParticipationBreakdownCard.tsx"), "utf8");
  const profileSrc = fs.readFileSync(path.join(root, "app", "(tabs)", "profile.tsx"), "utf8");
  const modalSrc = fs.readFileSync(path.join(root, "components", "PublicProfileModal.tsx"), "utf8");
  const dashboardSrc = fs.readFileSync(path.join(root, "app", "profile", "dashboard.tsx"), "utf8");
  const hookSrc = fs.readFileSync(path.join(root, "hooks", "useInvalidateProfileOnChallengeStart.ts"), "utf8");

  for (const src of [utilSrc, cardSrc, dashboardSrc, hookSrc]) {
    assert.equal(src.includes("setInterval"), false);
    assert.equal(/setTimeout\([^)]*poll/i.test(src), false);
    assert.equal(src.includes("/api/challenges/participation"), false);
  }

  assert.match(utilSrc, /Do not derive them from/);
  assert.match(cardSrc, /useColors/);
  assert.match(cardSrc, /colors\.card/);
  assert.match(cardSrc, /colors\.foreground/);
  assert.match(cardSrc, /minWidth:\s*0/);
  assert.match(cardSrc, /\brf\(/);
  assert.match(cardSrc, /\brs\(/);
  assert.match(cardSrc, /flexShrink/);
  assert.match(cardSrc, /accessibilityLabel/);
  assert.match(cardSrc, /SilentErrorBoundary|ErrorBoundary/);

  assert.match(profileSrc, /ChallengeParticipationBreakdownCard/);
  assert.match(profileSrc, /Your Stats/);
  assert.match(profileSrc, /New dashboard/);
  assert.match(profileSrc, /Vibration/);
  assert.match(profileSrc, /Dark Theme/);
  assert.match(profileSrc, /Refer & Earn/);
  const newDashIdx = profileSrc.indexOf("New dashboard");
  const vibrationIdx = profileSrc.indexOf(">Vibration<") >= 0
    ? profileSrc.indexOf(">Vibration<")
    : profileSrc.indexOf("Vibration");
  assert.ok(newDashIdx > 0 && vibrationIdx > newDashIdx);

  assert.match(modalSrc, /ChallengeParticipationBreakdownCard/);
  assert.match(modalSrc, /extractBreakdownFromPublicUserPayload|applyIncomingBreakdown/);
  assert.match(modalSrc, /Lifetime Steps/);
  assert.match(modalSrc, /Races Played/);

  assert.match(dashboardSrc, /ChallengeParticipationBreakdownCard/);
  assert.match(dashboardSrc, /profileMePath|PROFILE_ME_CACHE_KEY/);
  assert.equal(dashboardSrc.includes("setInterval"), false);

  assert.match(hookSrc, /RACE_STARTED/);
  assert.match(hookSrc, /challenge_started/);
  assert.match(hookSrc, /invalidateQueries/);
  assert.equal(hookSrc.includes("RACE_PROGRESS"), false);
}

console.log("challengeParticipationBreakdown tests passed");
