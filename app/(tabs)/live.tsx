import { LinearGradient } from "expo-linear-gradient";
import { BlueShoe } from "@/components/BlueShoe";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { SkeletonList, SkeletonRaceRow } from "@/components/SkeletonRows";
import { screenCache } from "@/utils/screenCache";
import { prefetchLiveRaceDetailRoster } from "@/utils/warmLiveRaceDetail";
import { apiFetchAllowed, markApiFetched } from "@/utils/apiRequestCoordinator";
import { useScreenMountPerf } from "@/hooks/useScreenMountPerf";
import { LiveClockText } from "@/components/perf/LiveClockText";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  DeviceEventEmitter,
  Dimensions,
  FlatList,
  InteractionManager,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  groupRacesByDate,
  getRoomCountLabel,
  type DateGroup,
} from "@/utils/raceDateGrouping";
import { getChallengeDaysLeftLabel } from "@/utils/challengeSchedule";
import { ChallengeEndsPillLabel } from "@/components/ChallengeEndsPillLabel";
import { displayChallengeTitle } from "@/features/unlimited/mappers/unlimitedLiveUiCopy";
import { STREAK_ON_IMG } from "@/utils/brandImages";
import { AppAlert } from "@/components/AppAlert";
import { Image } from "expo-image";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/context/ThemeContext";
import { useTabBarHeight } from "@/hooks/useTabBarHeight";
import { usePresenceCounts } from "@/context/PresenceContext";
import { useAuth } from "@/context/AuthContext";
import { cashEligibilityForUser } from "@/config/featureFlags";
import { filterOutCashDiscovery } from "@/utils/cashEligibility";
import { authFetch } from "@/utils/authFetch";
import { connectPusher, subscribeToChannel, CHANNELS, EVENTS } from "@/services/realtimeService";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { rf, rs } from "@/utils/responsive";
import {
  FREE_TIER_COIN_REWARDS,
  freeRaceAwardsCoinPrizes,
  freeRaceCoinPrizePool,
} from "@/utils/freeRaceRewards";
import { PublicProfileModal } from "@/components/PublicProfileModal";
import type { PublicProfileInitialData } from "@/components/PublicProfileModal";
import { TrackThemeImageBackground, prefetchTrackThemes, prefetchTrackTheme } from "@/components/TrackThemeImage";
import type { TrackThemeImageSet } from "@/utils/trackThemeMedia";
import {
  CHALLENGE_LEFT_EVENT,
  isRecentlyLeftRaceId,
} from "@/utils/challengeLocalEvents";
import { isUserParticipatingInRace } from "@/utils/liveRaceParticipation";
import { appendInrHint } from "@/utils/currencyDisplay";

export { isUserParticipatingInRace } from "@/utils/liveRaceParticipation";

// ── Constants ─────────────────────────────────────────────────────────────────
const NEON_PURPLE  = "#7C3AED";
const NEON_GREEN   = "#22C55E";
const CARD_BG      = "#0D0D1E";
const MUTED        = "#6B7A94";

// Horizontal carousel card width — leaves ~15% peek of the next card so users
// can tell the row scrolls sideways. Capped so it never gets absurd on tablets.
const CAROUSEL_CARD_W = Math.min(340, Math.round(Dimensions.get("window").width * 0.85));

const FREE_TIER_COINS = FREE_TIER_COIN_REWARDS;
function calcFreeCoins(
  rank: number,
  isTied: boolean,
  tieGroupSize: number,
  targetSteps?: number,
): number {
  if (!freeRaceAwardsCoinPrizes(targetSteps)) return 0;
  if (isTied && tieGroupSize > 1) {
    const pool = FREE_TIER_COINS.slice(0, Math.min(tieGroupSize, FREE_TIER_COINS.length)).reduce((a, b) => a + b, 0);
    return Math.floor(pool / tieGroupSize);
  }
  return FREE_TIER_COINS[rank - 1] ?? 0;
}

const FILTERS = [
  "All",
  "My Races",
  "Free",
  "Coins Battle",
  "Cash Challenges",
  "Streak Challenges",
  "Sponsored Events",
] as const;
type FilterType = (typeof FILTERS)[number];

const CASH_ENTRY_TYPES = new Set([
  "paid_1", "paid_3", "paid_5", "paid_usd", "cash", "usd",
  "$1", "$3", "$5", "USD Entry",
]);

/** Classic cash entry types — never classify these as Unlimited. */
function isClassicCashEntryType(entryType: string): boolean {
  const et = entryType.trim();
  const lower = et.toLowerCase();
  if (CASH_ENTRY_TYPES.has(et) || CASH_ENTRY_TYPES.has(lower)) return true;
  if (lower === "paid_usd" || lower === "usd entry") return true;
  if (/^\$\d+(\.\d+)?$/.test(et)) return true;
  return false;
}

/** Unlimited Daily Goal challenges — strict markers only (never Free/classic cash). */
export function isUnlimitedChallengeRace(
  race: Pick<LiveRace, "entryType" | "type"> & {
    challengeType?: string | null;
    capacityMode?: string | null;
    maxPlayers?: number;
    challengeEndAt?: string | null;
    challengeDurationDays?: number | null;
    entryAmountCents?: number;
  },
): boolean {
  const challengeType = String(race.challengeType ?? "").trim().toLowerCase();
  const capacityMode = String(race.capacityMode ?? "").trim().toLowerCase();
  const entryType = String(race.entryType ?? "").trim().toLowerCase();
  if (challengeType === "unlimited_goal") return true;
  if (capacityMode === "unlimited") return true;
  if (entryType === "unlimited_goal") return true;
  // Classic cash / free / coins must never match the Unlimited heuristic
  // (cash rooms often have challengeEndAt for the race window).
  if (race.type === "sponsored") return false;
  if (entryType === "free" || entryType === "coins_battle" || entryType === "coins battle") {
    return false;
  }
  if (isClassicCashEntryType(entryType)) return false;
  // Live card label is often "$45" (not unlimited_goal). Unlimited rows use
  // maxPlayers 0/null plus a multi-day end window from the Unlimited API mapper.
  const maxPlayers = race.maxPlayers;
  const uncapped = maxPlayers == null || maxPlayers <= 0;
  const hasUnlimitedWindow =
    (typeof race.challengeDurationDays === "number" && race.challengeDurationDays > 0) ||
    !!race.challengeEndAt;
  if (uncapped && hasUnlimitedWindow) return true;
  return false;
}

/** All paid cash entry races (any amount), excluding sponsored / free / coins / Unlimited. */
export function isCashChallengeRace(
  race: Pick<LiveRace, "entryType" | "type"> & {
    entryAmountCents?: number;
    challengeType?: string | null;
    capacityMode?: string | null;
    maxPlayers?: number;
  },
): boolean {
  if (race.type === "sponsored") return false;
  if (isUnlimitedChallengeRace(race)) return false;
  const et = (race.entryType ?? "").trim();
  const lower = et.toLowerCase();
  if (lower === "free" || lower === "coins_battle" || lower === "coins battle") return false;
  if (CASH_ENTRY_TYPES.has(et) || CASH_ENTRY_TYPES.has(lower)) return true;
  // Dynamic $N labels from paid USD (e.g. "$30")
  if (/^\$\d+(\.\d+)?$/.test(et)) return true;
  if ((race.entryAmountCents ?? 0) > 0 && lower !== "free" && lower !== "coins_battle") return true;
  return false;
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface LiveRacePlayer {
  id: string;
  userId: string;
  username: string;
  countryFlag: string;
  avatarColor: string;
  avatarUrl?: string | null;
  avatarVersion?: number | null;
  currentSteps: number;
  targetSteps: number;
  rank: number;
  isHost: boolean;
  status?: string | null;
  participantStatus?: string | null;
  registrationStatus?: string | null;
  isForfeited?: boolean;
  prizeAmount?: number;
  isTied?: boolean;
  tieGroupSize?: number;
}

export interface LiveRace {
  id: string;
  title: string;
  type: "free" | "paid" | "country_battle" | string;
  entryType: string;
  playerCount: number;
  maxPlayers: number;
  targetSteps: number;
  status: string;
  prizePool: number;
  prizePoolCents: number;
  entryAmountCents?: number;
  coinEntryAmount: number;
  spectatorCount: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  players: LiveRacePlayer[];
  trackLayout: string;
  imageSet?: TrackThemeImageSet | null;
  imageUrl?: string | null;
  assetVersion?: number;
  width?: number;
  height?: number;
  reactionCounts: Record<string, number>;
  elapsedSeconds: number;
  challengeEndAt?: string | null;
  challengeDurationDays?: number;
  timeLeftSeconds?: number | null;
  daysLeft?: number | null;
  hoursLeft?: number | null;
  timeLeftLabel?: string | null;
  hostUserId?: string | null;
  currentUserRole?: string | null;
  currentUserParticipantStatus?: string | null;
  currentUserParticipating?: boolean;
  challengeType?: string | null;
  capacityMode?: string | null;
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function sameLocalCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Compact local times for finished-card Started / Ended (third stats column). */
function formatFinishedStartEnd(
  startedAt: string | null,
  completedAt: string | null,
): { started: string; ended: string } | null {
  if (!startedAt || !completedAt) return null;
  const start = new Date(startedAt);
  const end = new Date(completedAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const timeOnly = (d: Date) =>
    d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameLocalCalendarDay(start, end)) {
    return { started: timeOnly(start), ended: timeOnly(end) };
  }
  const dateTime = (d: Date) => {
    const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
    return `${date} · ${timeOnly(d)}`;
  };
  return { started: dateTime(start), ended: dateTime(end) };
}

function computeElapsed(startedAt: string | null, completedAt?: string | null): number {
  if (!startedAt) return 0;
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  return Math.floor((end - new Date(startedAt).getTime()) / 1000);
}

function filterToParam(filter: FilterType): string {
  if (filter === "All") return "all";
  // "My Races" / Unlimited reuse the normal live-races payload and filter locally.
  if (filter === "My Races") return "all";
  if (filter === "Streak Challenges") return "all";
  if (filter === "Free") return "free";
  if (filter === "Coins Battle") return "coins_battle";
  if (filter === "Cash Challenges") return "cash_challenges";
  if (filter === "Sponsored Events") return "sponsored";
  return "all";
}

function applyChipFilter(races: LiveRace[], filter: FilterType): LiveRace[] {
  if (filter === "Cash Challenges") return races.filter(isCashChallengeRace);
  if (filter === "Streak Challenges") return races.filter(isUnlimitedChallengeRace);
  if (filter === "Sponsored Events") {
    return races.filter((r) => r.type === "sponsored" && !isUnlimitedChallengeRace(r));
  }
  if (filter === "Free") {
    return races.filter(
      (r) =>
        !isUnlimitedChallengeRace(r) &&
        r.type !== "sponsored" &&
        String(r.entryType ?? "").trim().toLowerCase() === "free",
    );
  }
  if (filter === "Coins Battle") {
    return races.filter(
      (r) =>
        !isUnlimitedChallengeRace(r) &&
        String(r.entryType ?? "").trim().toLowerCase() === "coins_battle",
    );
  }
  return races;
}

/** Display-time tab isolation — never let Unlimited leak into other chips. */
function racesVisibleOnTab(
  races: LiveRace[],
  filter: FilterType,
  cashUiAllowed = true,
): LiveRace[] {
  let visible: LiveRace[];
  if (filter === "Streak Challenges") visible = races.filter(isUnlimitedChallengeRace);
  else if (filter === "All" || filter === "My Races") visible = races;
  else if (filter === "Cash Challenges") visible = races.filter(isCashChallengeRace);
  else if (filter === "Sponsored Events") {
    visible = races.filter((r) => r.type === "sponsored" && !isUnlimitedChallengeRace(r));
  } else {
    // Free / Coins / any other classic tab — strip Unlimited.
    visible = races.filter((r) => !isUnlimitedChallengeRace(r));
  }
  return filterOutCashDiscovery(visible, {
    cashUiAllowed,
    keepAll: filter === "My Races",
    isCash: isCashChallengeRace,
  });
}

function shouldMergeUnlimitedLive(filter: FilterType): boolean {
  // Only All / My Races / Unlimited tab. Never Cash or Sponsored (confuses users).
  return (
    filter === "All" ||
    filter === "My Races" ||
    filter === "Streak Challenges"
  );
}

/** Bump when Live membership/filter rules change so stale Unlimited cards drop. */
const LIVE_SCREEN_CACHE_PREFIX = "screen_live_v5_";

function mergeLiveById(primary: LiveRace[], extra: LiveRace[]): LiveRace[] {
  const seen = new Set(primary.map((r) => r.id));
  const out = [...primary];
  for (const race of extra) {
    if (seen.has(race.id)) continue;
    seen.add(race.id);
    out.push(race);
  }
  return out;
}

function mapRaceRow(r: Record<string, unknown>): LiveRace {
  return {
    id: r.id as string,
    title: r.title as string,
    type: (r.type as string) ?? "quick",
    entryType: (r.entryType as string) ?? "Free",
    playerCount: (r.playerCount as number) ?? 0,
    maxPlayers: (r.maxPlayers as number) ?? 10,
    targetSteps: (r.targetSteps as number) ?? 1000,
    status: r.status as string,
    prizePool: (r.prizePool as number) ?? 0,
    coinEntryAmount: (r.coin_entry_amount as number) ?? 0,
    spectatorCount: (r.spectatorCount as number) ?? 0,
    startedAt: (r.startedAt as string) ?? null,
    completedAt: (r.completedAt as string) ?? null,
    createdAt: (r.createdAt as string) ?? new Date().toISOString(),
    players: (r.players as LiveRacePlayer[]) ?? [],
    trackLayout: (r.trackLayout as string) ?? "bg",
    imageSet: (r.imageSet as TrackThemeImageSet | null | undefined) ?? null,
    imageUrl: (r.imageUrl as string | null | undefined) ?? null,
    assetVersion: (r.assetVersion as number | undefined) ?? (r.asset_version as number | undefined),
    width: (r.width as number | undefined),
    height: (r.height as number | undefined),
    prizePoolCents: (r.prizePoolCents as number) ?? 0,
    entryAmountCents: (r.entryAmountCents as number) ?? 0,
    reactionCounts: (r.reactionCounts as Record<string, number>) ?? {},
    elapsedSeconds: computeElapsed(r.startedAt as string | null, r.completedAt as string | null),
    challengeEndAt:
      (r.challengeEndAt as string | null | undefined) ??
      (r.challenge_end_at as string | null | undefined) ??
      null,
    challengeDurationDays:
      (r.challengeDurationDays as number | undefined) ??
      (r.challenge_duration_days as number | undefined) ??
      0,
    timeLeftSeconds:
      (r.timeLeftSeconds as number | undefined) ??
      (r.time_left_seconds as number | undefined) ??
      null,
    daysLeft:
      (r.daysLeft as number | undefined) ??
      (r.days_left as number | undefined) ??
      null,
    hoursLeft:
      (r.hoursLeft as number | undefined) ??
      (r.hours_left as number | undefined) ??
      null,
    timeLeftLabel:
      (r.timeLeftLabel as string | undefined) ??
      (r.time_left_label as string | undefined) ??
      (r.remainingLabel as string | undefined) ??
      (r.remaining_label as string | undefined) ??
      null,
    hostUserId:
      (r.hostUserId as string | null | undefined) ??
      (r.host_user_id as string | null | undefined) ??
      null,
    currentUserRole:
      (r.currentUserRole as string | null | undefined) ??
      (r.current_user_role as string | null | undefined) ??
      null,
    currentUserParticipantStatus:
      (r.currentUserParticipantStatus as string | null | undefined) ??
      (r.current_user_participant_status as string | null | undefined) ??
      (r.participantStatus as string | null | undefined) ??
      // Unlimited/streak challenge rows carry the viewer's own qualification status
      // under `participationStatus` (overlayMembership on the backend) — without this
      // the app can't tell "disqualified from this streak" from "never joined".
      (r.participationStatus as string | null | undefined) ??
      null,
    currentUserParticipating:
      (r.currentUserParticipating as boolean | undefined) ??
      (r.current_user_participating as boolean | undefined) ??
      (r.current_user_registered as boolean | undefined),
    challengeType:
      (r.challengeType as string | null | undefined) ??
      (r.challenge_type as string | null | undefined) ??
      null,
    capacityMode:
      (r.capacityMode as string | null | undefined) ??
      (r.capacity_mode as string | null | undefined) ??
      null,
  };
}

const FINISHED_PAGE_SIZE = 15;

async function fetchClassicLiveChallenges(
  filter: FilterType,
): Promise<{ live: LiveRace[]; finished: LiveRace[]; ok: boolean }> {
  const fp = filterToParam(filter);
  try {
    const [liveRes, finishedRes] = await Promise.all([
      authFetch(`/api/races?status=in_progress&filter=${encodeURIComponent(fp)}&limit=30`),
      authFetch(
        `/api/races?status=completed&filter=${encodeURIComponent(fp)}&limit=${FINISHED_PAGE_SIZE}&offset=0`,
      ),
    ]);
    if (!liveRes.ok && !finishedRes.ok) {
      return { live: [], finished: [], ok: false };
    }
    const liveData = liveRes.ok
      ? ((await liveRes.json()) as { races?: Record<string, unknown>[] })
      : { races: [] };
    const finishedData = finishedRes.ok
      ? ((await finishedRes.json()) as { races?: Record<string, unknown>[] })
      : { races: [] };
    const seenIds = new Set<string>();
    const live = applyChipFilter(
      (liveData.races ?? [])
        .filter((r) => {
          if (seenIds.has(r.id as string)) return false;
          seenIds.add(r.id as string);
          return true;
        })
        .map(mapRaceRow)
        .filter((r) => !isUnlimitedChallengeRace(r)),
      filter,
    );
    const finished = applyChipFilter(
      (finishedData.races ?? [])
        .filter((r) => {
          if (seenIds.has(r.id as string)) return false;
          seenIds.add(r.id as string);
          return true;
        })
        .map(mapRaceRow)
        .filter((r) => !isUnlimitedChallengeRace(r)),
      filter,
    );
    return { live, finished, ok: true };
  } catch {
    return { live: [], finished: [], ok: false };
  }
}

async function fetchLiveChallenges(
  filter: FilterType,
  opts?: { viewerUserId?: string | null },
): Promise<{
  live: LiveRace[];
  finished: LiveRace[];
  ok: boolean;
}> {
  const unlimitedOnly = filter === "Streak Challenges";
  try {
    // Unlimited tab: ONLY Unlimited APIs — trust that payload (already mapped).
    if (unlimitedOnly) {
      const unlimited = await import("@/services/unlimitedChallengesListApi")
        .then((m) =>
          m.fetchLiveUnlimitedChallenges({ viewerUserId: opts?.viewerUserId }),
        )
        .catch(() => ({ live: [] as LiveRace[], finished: [] as LiveRace[] }));
      return {
        live: unlimited.live as LiveRace[],
        finished: unlimited.finished as LiveRace[],
        ok: true,
      };
    }

    const unlimitedPromise = shouldMergeUnlimitedLive(filter)
      ? import("@/services/unlimitedChallengesListApi")
          .then((m) =>
            m.fetchLiveUnlimitedChallenges({ viewerUserId: opts?.viewerUserId }),
          )
          .catch(() => ({ live: [] as LiveRace[], finished: [] as LiveRace[] }))
      : Promise.resolve({ live: [] as LiveRace[], finished: [] as LiveRace[] });

    const [classic, unlimited] = await Promise.all([
      fetchClassicLiveChallenges(filter),
      unlimitedPromise,
    ]);

    if (!classic.ok && unlimited.live.length === 0 && unlimited.finished.length === 0) {
      return { live: [], finished: [], ok: false };
    }

    let live = classic.live;
    let finished = classic.finished;

    if (shouldMergeUnlimitedLive(filter)) {
      const ulLive = (unlimited.live as LiveRace[]).filter(isUnlimitedChallengeRace);
      const ulFinished = (unlimited.finished as LiveRace[]).filter(isUnlimitedChallengeRace);
      live = mergeLiveById(live, ulLive);
      finished = mergeLiveById(finished, ulFinished);
    }

    return { live, finished, ok: true };
  } catch {
    return { live: [], finished: [], ok: false };
  }
}

async function fetchMoreFinished(filter: FilterType, offset: number): Promise<LiveRace[]> {
  // Unlimited finished is loaded in one shot from Unlimited APIs — no classic pagination.
  if (filter === "Streak Challenges") return [];
  const fp = filterToParam(filter);
  try {
    const res = await authFetch(
      `/api/races?status=completed&filter=${encodeURIComponent(fp)}&limit=${FINISHED_PAGE_SIZE}&offset=${offset}`,
    );
    if (!res.ok) return [];
    const data = await res.json() as { races?: Record<string, unknown>[] };
    return applyChipFilter((data.races ?? []).map(mapRaceRow), filter).filter(
      (r) => !isUnlimitedChallengeRace(r),
    );
  } catch {
    return [];
  }
}

interface MyActiveRace {
  id: string;
  title: string;
  entryType: string;
  status: string;
  currentPlayers: number;
  maxPlayers: number | null;
  targetSteps: number;
  isHost: boolean;
  startedAt: string | null;
  type?: string;
  creatorId?: string;
  entryAmountCents?: number;
  challengeType?: string | null;
  capacityMode?: string | null;
  challengeEndAt?: string | null;
  createdAt?: string | null;
  currentUserParticipating?: boolean;
}

/** Map /api/races/my-active rows into Live cards so My Races always shows what you're in. */
function mapMyActiveToLiveRace(r: MyActiveRace): LiveRace {
  const isUnlimited =
    String(r.challengeType ?? "").toLowerCase() === "unlimited_goal" ||
    String(r.capacityMode ?? "").toLowerCase() === "unlimited" ||
    String(r.entryType ?? "").toLowerCase() === "unlimited_goal";
  const entryCents = typeof r.entryAmountCents === "number" ? r.entryAmountCents : 0;
  const entryDollars = entryCents / 100;
  const status =
    r.status === "in_progress" || r.status === "active" || r.status === "starting" || r.status === "settling"
      ? "in_progress"
      : r.status === "completed"
        ? "completed"
        : r.status || "in_progress";
  return {
    id: r.id,
    title: r.title || (isUnlimited ? "Streak Challenge" : "My Race"),
    type: isUnlimited ? "paid" : (r.type ?? "quick"),
    entryType: isUnlimited
      ? entryDollars > 0
        ? Number.isInteger(entryDollars)
          ? `$${entryDollars}`
          : `$${entryDollars.toFixed(2)}`
        : "unlimited_goal"
      : (r.entryType ?? "Free"),
    playerCount: Math.max(1, r.currentPlayers ?? 1),
    maxPlayers: isUnlimited ? 0 : (r.maxPlayers ?? 10),
    targetSteps: r.targetSteps ?? 0,
    status,
    prizePool: entryDollars > 0 ? entryDollars * Math.max(1, r.currentPlayers ?? 1) : 0,
    coinEntryAmount: 0,
    spectatorCount: 0,
    startedAt: r.startedAt ?? null,
    completedAt: null,
    createdAt: r.createdAt ?? r.startedAt ?? new Date().toISOString(),
    players: [],
    trackLayout: "bg",
    prizePoolCents: Math.round(entryCents * Math.max(1, r.currentPlayers ?? 1)),
    entryAmountCents: entryCents,
    reactionCounts: {},
    elapsedSeconds: computeElapsed(r.startedAt ?? null, null),
    challengeEndAt: r.challengeEndAt ?? null,
    challengeDurationDays: 0,
    hostUserId: r.creatorId ?? null,
    currentUserParticipating: true,
    challengeType: isUnlimited ? "unlimited_goal" : (r.challengeType ?? null),
    capacityMode: isUnlimited ? "unlimited" : (r.capacityMode ?? null),
  };
}

function mergeMyActiveIntoLiveList(
  live: LiveRace[],
  myActive: MyActiveRace[],
): LiveRace[] {
  const byId = new Map(live.map((r) => [r.id, r]));
  for (const mine of myActive) {
    if (!mine?.id) continue;
    const st = String(mine.status ?? "").toLowerCase();
    // Live My Races: in-progress / active only (not waiting room).
    const isLiveMine =
      st === "in_progress" ||
      st === "active" ||
      st === "starting" ||
      st === "settling" ||
      st === "running" ||
      st === "live" ||
      st === "started";
    if (!isLiveMine) continue;

    const existing = byId.get(mine.id);
    if (isRecentlyLeftRaceId(mine.id)) continue;
    if (existing) {
      byId.set(mine.id, {
        ...existing,
        currentUserParticipating: true,
        hostUserId: existing.hostUserId ?? mine.creatorId ?? null,
        challengeType: existing.challengeType ?? mine.challengeType ?? null,
        capacityMode: existing.capacityMode ?? mine.capacityMode ?? null,
        entryAmountCents: existing.entryAmountCents || mine.entryAmountCents || 0,
        challengeEndAt: existing.challengeEndAt ?? mine.challengeEndAt ?? null,
      });
      continue;
    }
    byId.set(mine.id, mapMyActiveToLiveRace(mine));
  }
  return [...byId.values()];
}

/** My Races tab: always show every live race the viewer is in. */
function buildMyRacesLiveList(
  live: LiveRace[],
  myActive: MyActiveRace[],
  opts: { userId?: string | null; username?: string | null; myActiveRaceIds: Set<string> },
): LiveRace[] {
  // 1) Start from public/unlimited live rows the user is in
  const participatingFromLive = live.filter((r) =>
    isUserParticipatingInRace(r, liveParticipationOpts(r, opts)),
  );
  // 2) Force-include /api/races/my-active (source of truth for membership)
  const merged = mergeMyActiveIntoLiveList(
    participatingFromLive,
    myActive.filter((r) => r?.id && !isRecentlyLeftRaceId(r.id)),
  );
  // 3) Keep only membership rows (my-active merge already stamped participating)
  return merged.filter((r) =>
    isUserParticipatingInRace(r, liveParticipationOpts(r, opts)),
  );
}

/** True only when the signed-in user is still racing (not forfeited / left). */
function liveParticipationOpts(
  race: Pick<LiveRace, "id">,
  opts: { userId?: string | null; username?: string | null; myActiveRaceIds?: Set<string> | null },
) {
  return {
    userId: opts.userId,
    username: opts.username,
    myActiveRaceIds: opts.myActiveRaceIds,
    recentlyLeft: isRecentlyLeftRaceId(race.id),
  };
}

function filterMyRaces(
  races: LiveRace[],
  opts: { userId?: string | null; username?: string | null; myActiveRaceIds?: Set<string> | null },
): LiveRace[] {
  return races.filter((race) =>
    isUserParticipatingInRace(race, liveParticipationOpts(race, opts)),
  );
}

async function fetchMyActiveRaces(): Promise<{ primary: MyActiveRace | null; all: MyActiveRace[] }> {
  const { runCoalesced } = require("@/utils/apiRequestCoordinator") as typeof import("@/utils/apiRequestCoordinator");
  return runCoalesced("api:GET:/api/races/my-active", async () => {
    try {
      const res = await authFetch(`/api/races/my-active`);
      if (!res.ok) return { primary: null, all: [] };
      const data = await res.json() as { race?: MyActiveRace | null; races?: MyActiveRace[] };
      const all = Array.isArray(data.races) && data.races.length > 0
        ? data.races
        : data.race
          ? [data.race]
          : [];
      return { primary: data.race ?? all[0] ?? null, all };
    } catch {
      return { primary: null, all: [] };
    }
  });
}

/** @deprecated use fetchMyActiveRaces — kept for any external callers */
async function fetchMyActiveRace(): Promise<MyActiveRace | null> {
  const { primary } = await fetchMyActiveRaces();
  return primary;
}

// ── Components ────────────────────────────────────────────────────────────────

function LiveDot() {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    ).start();
  }, [pulse]);
  return <Animated.View style={[st.liveDot, { opacity: pulse }]} />;
}

function SectionHeader({ label, sub, isFinished }: { label: string; sub: string; isFinished?: boolean }) {
  const colors = useColors();
  return (
    <View style={st.sectionHeader}>
      <Feather name={isFinished ? "award" : "zap"} size={16} color={isFinished ? colors.gold : NEON_GREEN} />
      <View>
        <Text style={[st.sectionLabel, { color: colors.foreground }]}>{label}</Text>
        <Text style={[st.sectionSub, { color: colors.mutedForeground }]}>{sub}</Text>
      </View>
    </View>
  );
}

function RankCircle({ rank, colors }: { rank: number; colors: ReturnType<typeof useColors> }) {
  const rc = [colors.gold, colors.silver, colors.bronze][rank - 1] ?? MUTED;
  return (
    <View style={[st.rankCircle, { borderColor: rc + "80", backgroundColor: rc + "18" }]}>
      <Text style={[st.rankCircleText, { color: rc }]}>{rank}</Text>
    </View>
  );
}

/** Image-2 style purple strip on Live list cards — centered on the card. */
function ChallengeEndsPill({ label }: { label: string }) {
  const colors = useColors();
  const { isDark } = useTheme();
  return (
    <View
      style={[
        st.endsPill,
        !isDark && {
          backgroundColor: colors.muted,
          borderColor: colors.border,
        },
      ]}
    >
      <Feather name="calendar" size={13} color={isDark ? "#FFFFFF" : colors.foreground} />
      <ChallengeEndsPillLabel
        label={label}
        style={[st.endsPillText, !isDark && { color: colors.foreground }]}
        dateTimeColor={isDark ? undefined : colors.foreground}
      />
    </View>
  );
}

function RaceCardBase({
  race,
  colors,
  isMyRace: _isMyRace,
  isHost,
  myUsername,
  myUserId,
  myActiveRaceIds,
  onAvatarPress,
  style,
}: {
  race: LiveRace;
  colors: ReturnType<typeof useColors>;
  isMyRace?: boolean;
  isHost?: boolean;
  myUsername?: string;
  myUserId?: string | null;
  myActiveRaceIds?: Set<string> | null;
  onAvatarPress?: (p: LiveRacePlayer) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { isDark } = useTheme();
  const isFinished = race.status === "completed";
  const participating = isUserParticipatingInRace(
    race,
    liveParticipationOpts(race, {
      userId: myUserId,
      username: myUsername,
      myActiveRaceIds,
    }),
  );

  // ── Per-card reaction counts (optimistic local state) ─────────────────────
  const [localReactions, setLocalReactions] = useState<Record<string, number>>(
    () => ({ ...race.reactionCounts }),
  );
  const [liked, setLiked] = useState(false);
  const sendingReaction = useRef(false);

  const handleReact = useCallback(async (emoji: string) => {
    if (sendingReaction.current) return;
    sendingReaction.current = true;
    setLiked(true);
    // Optimistic increment
    setLocalReactions((prev) => ({ ...prev, [emoji]: (prev[emoji] ?? 0) + 1 }));
    try {
      await authFetch(`/api/races/${race.id}/reactions`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      });
    } catch { /* silent — optimistic count stays */ }
    sendingReaction.current = false;
  }, [race.id]);
  const trackMedia = {
    code: race.trackLayout,
    trackLayout: race.trackLayout,
    imageSet: race.imageSet ?? null,
    imageUrl: race.imageUrl ?? null,
    assetVersion: race.assetVersion,
    width: race.width,
    height: race.height,
  };

  const openLiveRace = useCallback(() => {
    // 1) Sync mem seed only (no AsyncStorage stringify) so live-detail first paint is warm.
    // 2) Navigate immediately — disk persist + image prefetch run after push returns.
    if (myUserId) {
      const cacheKey = `live-race-detail:v1:${myUserId}:${race.id}`;
      if (!screenCache.getSync(cacheKey)) {
        const roster = (race.players ?? []).map((p, i) => ({
          id: p.userId || p.id || `p-${i}`,
          userId: p.userId,
          currentSteps: Math.max(0, p.currentSteps ?? 0),
          status: "active",
          rank: p.rank ?? i + 1,
          username: p.username,
          countryFlag: p.countryFlag ?? null,
          avatarColor: p.avatarColor ?? "#00E676",
          avatarUrl: p.avatarUrl ?? null,
          isHost: false,
        }));
        const shell = {
          race: {
            id: race.id,
            title: race.title || "Live Race",
            status: race.status || "in_progress",
            entryType: race.entryType || (isUnlimitedChallengeRace(race) ? "unlimited_goal" : "free"),
            entryAmountCents: race.entryAmountCents ?? 0,
            entryAmountDollars: (race.entryAmountCents ?? 0) / 100,
            targetSteps: race.targetSteps ?? 1000,
            currentPlayers: Math.max(roster.length, race.playerCount ?? 1),
            maxPlayers: isUnlimitedChallengeRace(race) ? null : race.maxPlayers ?? 10,
            startedAt: race.startedAt ?? new Date().toISOString(),
            completedAt: race.completedAt ?? null,
            creatorId: race.hostUserId ?? myUserId,
            prizePool: race.prizePool ?? 0,
            prizeTiers: [],
            spectatorCount: 0,
            capacityMode: race.capacityMode ?? (isUnlimitedChallengeRace(race) ? "unlimited" : null),
            challengeType:
              race.challengeType ??
              (isUnlimitedChallengeRace(race) ? "unlimited_goal" : null),
            trackLayout: race.trackLayout || "bg",
            challengeDurationDays: race.challengeDurationDays ?? null,
          },
          participants: roster,
        };
        screenCache.primeSync(cacheKey, shell);
        void screenCache.set(cacheKey, shell);
      }
    }
    router.push({
      pathname: "/race/live-detail",
      params: {
        id: race.id,
        trackLayout: race.trackLayout,
        ...(typeof race.targetSteps === "number" && race.targetSteps > 0
          ? { targetSteps: String(race.targetSteps) }
          : null),
        ...(race.title ? { title: race.title } : null),
        ...(race.challengeType === "unlimited_goal" || race.capacityMode === "unlimited"
          ? { challengeType: "unlimited_goal", capacityMode: "unlimited" }
          : null),
      },
    });
    // Theme decode must not compete with the transition / destination mount.
    queueMicrotask(() => {
      prefetchTrackTheme(trackMedia, "full");
    });
  }, [
    myUserId,
    race,
    trackMedia,
  ]);

  /** Press-in: lightweight mem seed + theme warm before navigation (no mutations). */
  const prefetchLiveRaceOnPressIn = useCallback(() => {
    if (!myUserId) return;
    const cacheKey = `live-race-detail:v1:${myUserId}:${race.id}`;
    if (!screenCache.getSync(cacheKey)) {
      const roster = (race.players ?? []).map((p, i) => ({
        id: p.userId || p.id || `p-${i}`,
        userId: p.userId,
        currentSteps: Math.max(0, p.currentSteps ?? 0),
        status: "active",
        rank: p.rank ?? i + 1,
        username: p.username,
        countryFlag: p.countryFlag ?? null,
        avatarColor: p.avatarColor ?? "#00E676",
        avatarUrl: p.avatarUrl ?? null,
        isHost: false,
      }));
      screenCache.primeSync(cacheKey, {
        race: {
          id: race.id,
          title: race.title || "Live Race",
          status: race.status || "in_progress",
          entryType: race.entryType || (isUnlimitedChallengeRace(race) ? "unlimited_goal" : "free"),
          entryAmountCents: race.entryAmountCents ?? 0,
          entryAmountDollars: (race.entryAmountCents ?? 0) / 100,
          targetSteps: race.targetSteps ?? 1000,
          currentPlayers: Math.max(roster.length, race.playerCount ?? 1),
          maxPlayers: isUnlimitedChallengeRace(race) ? null : race.maxPlayers ?? 10,
          startedAt: race.startedAt ?? new Date().toISOString(),
          completedAt: race.completedAt ?? null,
          creatorId: race.hostUserId ?? myUserId,
          prizePool: race.prizePool ?? 0,
          prizeTiers: [],
          spectatorCount: 0,
          capacityMode: race.capacityMode ?? (isUnlimitedChallengeRace(race) ? "unlimited" : null),
          challengeType:
            race.challengeType ??
            (isUnlimitedChallengeRace(race) ? "unlimited_goal" : null),
          trackLayout: race.trackLayout || "bg",
          challengeDurationDays: race.challengeDurationDays ?? null,
        },
        participants: roster,
      });
    }
    // Always warm full Unlimited roster (card strip is often incomplete).
    // Classic: only when the card has almost no players yet.
    if (isUnlimitedChallengeRace(race) || (race.players?.length ?? 0) < 2) {
      prefetchLiveRaceDetailRoster({
        raceId: race.id,
        userId: myUserId,
        unlimited: isUnlimitedChallengeRace(race),
      });
    }
    prefetchTrackTheme(trackMedia, "thumb");
  }, [myUserId, race, trackMedia]);

  const openSpectatorRace = useCallback(() => {
    // Same real race track / live board as participants — live-detail already
    // supports spectator mode (no step tracking, watch count, etc.).
    openLiveRace();
  }, [openLiveRace]);

  const entryColor: Record<string, string> = {
    Free: NEON_GREEN,
    "$1": "#60A5FA",
    "$3": "#A78BFA",
    "$5": colors.gold,
    "USD Entry": "#60A5FA",
    unlimited_goal: "#38BDF8",
    coins_battle: "#F59E0B",
  };
  const isCoinsBattle = race.entryType === "coins_battle";
  const isSponsored = race.type === "sponsored";
  const isUnlimited = isUnlimitedChallengeRace(race);
  const isCash = !isUnlimited && isCashChallengeRace(race);
  const cashBadgeLabel =
    typeof race.entryAmountCents === "number" && race.entryAmountCents > 0
      ? appendInrHint(
          race.entryAmountCents / 100,
          `$${
            race.entryAmountCents % 100 === 0
              ? (race.entryAmountCents / 100).toFixed(0)
              : (race.entryAmountCents / 100).toFixed(2)
          }`,
        )
      : race.entryType && /^\$\d/.test(race.entryType)
        ? race.entryType
        : "Cash";
  const entryBadgeLabel = isSponsored
    ? "🏆 Sponsored"
    : isCoinsBattle
      ? "⚔️ Coins"
      : isUnlimited
        ? race.entryType && /^\$\d/.test(race.entryType)
          ? `Entry fee ${race.entryType}`
          : "Streak"
        : isCash
          ? cashBadgeLabel
          : race.entryType;
  const ec = isSponsored
    ? "#F59E0B"
    : isUnlimited
      ? "#38BDF8"
      : (entryColor[race.entryType] ?? NEON_PURPLE);

  const cardBorderColor = isFinished ? "#22C55EAA" : NEON_PURPLE + "60";
  const cardShadowColor = isFinished ? NEON_GREEN : NEON_PURPLE;

  const top3 = (() => {
    const seen = new Set<string>();
    return race.players.filter((p) => {
      if (seen.has(p.userId)) return false;
      seen.add(p.userId);
      return true;
    });
  })().slice(0, 3);

  // For sponsored events use the actual prize pool; coins battles use coin pool; paid races use 70% winners pool
  const prizePoolDisplay = isSponsored && race.prizePoolCents > 0
    ? `${appendInrHint(race.prizePoolCents / 100, `$${(race.prizePoolCents / 100).toFixed(0)}`)} pool`
    : isCoinsBattle && race.coinEntryAmount > 0
    ? `${(race.coinEntryAmount * race.playerCount).toLocaleString()} coins`
    : race.prizePool > 0 ? appendInrHint(race.prizePool, `$${race.prizePool.toFixed(2)}`) : null;
  const elapsedLabel = "Elapsed";
  const finishedStartEnd = isFinished
    ? formatFinishedStartEnd(
        race.startedAt ?? race.createdAt,
        race.completedAt ??
          (race.startedAt && race.elapsedSeconds > 0
            ? new Date(new Date(race.startedAt).getTime() + race.elapsedSeconds * 1000).toISOString()
            : null),
      )
    : null;
  const challengeEndsLabel = !isFinished
    ? getChallengeDaysLeftLabel({
        challengeEndAt: race.challengeEndAt,
        challengeDurationDays: race.challengeDurationDays,
        startedAt: race.startedAt ?? race.createdAt,
        targetSteps: race.targetSteps,
        timeLeftSeconds: race.timeLeftSeconds,
        daysLeft: race.daysLeft,
        hoursLeft: race.hoursLeft,
        timeLeftLabel: race.timeLeftLabel,
      })
    : null;

  // Mirror backend numWinners: 2 players→1 winner, 3→2, 4+→3
  const numWin = race.playerCount <= 2 ? 1 : race.playerCount === 3 ? 2 : 3;
  const totalFreeCoins = freeRaceCoinPrizePool(race.playerCount, race.targetSteps);
  // Single reward block beside the challenge heading (all types, live + finished).
  // Never also show Prize Pool in the stats row or footer — that duplicated it next to Started/Ended.
  const headingReward: { kind: "coins" | "text"; value: string | number; sub?: string } | null =
    !isSponsored && !isUnlimited && race.entryType === "Free" && totalFreeCoins > 0
      ? { kind: "coins", value: totalFreeCoins, sub: "coins total" }
      : isCoinsBattle && race.coinEntryAmount > 0
        ? {
            kind: "text",
            value: `${(race.coinEntryAmount * Math.max(1, race.playerCount)).toLocaleString()} coins`,
          }
        : prizePoolDisplay
          ? { kind: "text", value: prizePoolDisplay.replace(/\s*pool$/i, "").trim() }
          : null;

  return (
    <View
      style={[
        st.card,
        {
          borderColor: cardBorderColor,
          backgroundColor: colors.card,
          shadowColor: cardShadowColor,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.35,
          shadowRadius: 10,
          elevation: 6,
        },
        style,
      ]}
    >
      {/* ── Card hero image ─────────────────────────────────────────────── */}
      <TrackThemeImageBackground
        media={trackMedia}
        variant="preview"
        style={st.cardHero}
        imageStyle={{ opacity: isDark ? 0.5 : 0.28, borderRadius: 0 }}
      >
        <LinearGradient
          colors={
            isDark
              ? ["transparent", colors.card + "F2", colors.card]
              : ["rgba(255,255,255,0.15)", colors.card + "F5", colors.card]
          }
          locations={isDark ? [0, 0.65, 1] : [0, 0.4, 1]}
          style={st.cardHeroGrad}
        >
          {/* Top row: badges + spectator */}
          <View style={st.cardTopRow}>
            <View style={st.cardTopLeft}>
              {isFinished ? (
                <View style={[st.finishedBadge, !isDark && { backgroundColor: "rgba(0,0,0,0.12)" }]}>
                  <Feather name="check-circle" size={10} color={NEON_GREEN} />
                  <Text style={st.finishedBadgeText}>FINISHED</Text>
                </View>
              ) : (
                <View style={st.liveBadge}>
                  <LiveDot />
                  <Text style={st.liveBadgeText}>LIVE</Text>
                </View>
              )}
              <View style={[st.entryBadge, { borderColor: ec + "90", backgroundColor: ec + "28" }]}>
                {isUnlimited ? (
                  <View style={st.entryBadgeRow}>
                    <Image
                      source={STREAK_ON_IMG}
                      style={st.entryBadgeIcon}
                      contentFit="contain"
                    />
                    <Text style={[st.entryBadgeText, { color: ec }]}>
                      {entryBadgeLabel}
                    </Text>
                  </View>
                ) : (
                  <Text style={[st.entryBadgeText, { color: ec }]}>
                    {entryBadgeLabel}
                  </Text>
                )}
              </View>
            </View>
            <View style={st.spectBadge}>
              <Feather name="eye" size={11} color={MUTED} />
              <Text style={st.spectText}>{isFinished ? race.spectatorCount + race.playerCount : race.spectatorCount}</Text>
            </View>
          </View>

          {/* Title row — reward sits beside the heading for every challenge type */}
          <View style={st.cardTitleRow}>
            <View style={st.cardTitleWrap}>
              <Text style={[st.cardTitle, { color: colors.foreground }]} numberOfLines={1}>{displayChallengeTitle(race.title)}</Text>
            </View>
            {headingReward ? (
              <View style={st.winnerBlock}>
                <Text style={[st.winnerLabel, { color: colors.mutedForeground }]}>REWARD</Text>
                {headingReward.kind === "coins" ? (
                  <>
                    <View style={st.winnerCoinRow}>
                      <Image
                        source={require("../../assets/images/game-coin.png")}
                        style={{ width: 18, height: 18 }}
                      />
                      <Text style={st.winnerCoinNum}>{headingReward.value}</Text>
                    </View>
                    {headingReward.sub ? (
                      <Text style={[st.winnerCoinsSub, { color: colors.mutedForeground }]}>
                        {headingReward.sub}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <Text style={st.winnerPrize}>{headingReward.value}</Text>
                )}
              </View>
            ) : null}
          </View>
        </LinearGradient>
      </TrackThemeImageBackground>

      {/* ── Stats row ───────────────────────────────────────────────────── */}
      <View
        style={[
          st.statsRow,
          { borderBottomColor: colors.border },
          // Slightly tighter vertical padding so Started/Ended stack fits without growing the card
          isFinished && finishedStartEnd ? { paddingVertical: rs(8) } : null,
        ]}
      >
        <View style={st.statItem}>
          <View style={st.statValueRow}>
            <Feather name="users" size={11} color={colors.mutedForeground} />
            <Text style={[st.statValue, { color: colors.foreground }]}>
              {isUnlimited || race.maxPlayers <= 0
                ? `${race.playerCount} joined`
                : `${race.playerCount}/${race.maxPlayers}`}
            </Text>
          </View>
          <Text style={[st.statLabel, { color: colors.mutedForeground }]}>Participants</Text>
        </View>
        <View style={[st.statDiv, { backgroundColor: colors.border }]} />
        <View style={st.statItem}>
          <View style={st.statValueRow}>
            <BlueShoe size={11} />
            <Text style={[st.statValue, { color: colors.foreground }]}>{race.targetSteps.toLocaleString()}</Text>
          </View>
          <Text style={[st.statLabel, { color: colors.mutedForeground }]}>Steps Goal</Text>
        </View>
        <View style={[st.statDiv, { backgroundColor: colors.border }]} />
        <View style={st.statItem}>
          {isFinished && finishedStartEnd ? (
            <View style={st.finishedTimeStack}>
              <Text style={[st.finishedTimeLabel, { color: colors.mutedForeground }]}>Started</Text>
              <Text style={[st.finishedTimeValue, { color: colors.foreground }]} numberOfLines={1}>
                {finishedStartEnd.started}
              </Text>
              <Text style={[st.finishedTimeLabel, st.finishedTimeLabelGap, { color: colors.mutedForeground }]}>
                Ended
              </Text>
              <Text style={[st.finishedTimeValue, { color: colors.foreground }]} numberOfLines={1}>
                {finishedStartEnd.ended}
              </Text>
            </View>
          ) : (
            <>
              <View style={st.statValueRow}>
                <Feather name="clock" size={11} color={colors.mutedForeground} />
                <LiveClockText
                  enabled={race.status === "in_progress" && !!race.startedAt}
                  style={[st.statValue, { color: colors.foreground }]}
                  format={(now) =>
                    formatElapsed(
                      race.startedAt
                        ? Math.max(
                            0,
                            Math.floor((now - new Date(race.startedAt).getTime()) / 1000),
                          )
                        : race.elapsedSeconds,
                    )
                  }
                />
              </View>
              <Text style={[st.statLabel, { color: colors.mutedForeground }]}>{elapsedLabel}</Text>
            </>
          )}
        </View>
      </View>

      {challengeEndsLabel ? (
        <ChallengeEndsPill label={challengeEndsLabel} />
      ) : null}

      {/* ── Players ─────────────────────────────────────────────────────── */}
      {top3.length > 0 && (
        <View style={[st.playersSection, { borderBottomColor: colors.border }]}>
          {top3.map((p, i) => {
            const pct = Math.min((p.currentSteps / Math.max(1, p.targetSteps)) * 100, 100);
            const rc = [colors.gold, colors.silver, colors.bronze][i] ?? MUTED;
            const isMe = myUsername ? p.username === myUsername : false;
            const coins =
              !isUnlimited && race.entryType === "Free" && p.rank <= numWin
                ? calcFreeCoins(
                    p.rank,
                    p.isTied ?? false,
                    p.tieGroupSize ?? 1,
                    race.targetSteps,
                  )
                : 0;
            return (
              <View key={p.userId} style={st.playerRow}>
                {/* Rank circle */}
                <RankCircle rank={i + 1} colors={colors} />

                {/* Avatar — tappable to open profile */}
                <ProfileAvatar
                  userId={p.userId}
                  avatarVersion={p.avatarVersion ?? 0}
                  avatarColor={p.avatarColor}
                  displayName={p.username}
                  size={rs(30)}
                  borderWidth={1.5}
                  onPress={() => onAvatarPress?.(p)}
                />

                {/* Name + progress */}
                <View style={st.playerMid}>
                  <View style={st.playerNameRow}>
                    <Text style={[st.playerName, { color: colors.foreground }]} numberOfLines={1}>{p.username}</Text>
                    <Text style={st.playerFlag}>{p.countryFlag}</Text>
                    {isMe && (
                      <View style={[st.tag, { backgroundColor: NEON_PURPLE + "22", borderColor: NEON_PURPLE + "60" }]}>
                        <Text style={[st.tagText, { color: NEON_PURPLE }]}>You</Text>
                      </View>
                    )}
                    {p.isHost && (
                      <View style={[st.tag, { backgroundColor: "#FFB70022", borderColor: "#FFB70055" }]}>
                        <Text style={[st.tagText, { color: "#FFB700" }]}>Host</Text>
                      </View>
                    )}
                    {isUnlimited &&
                      (p.status ?? p.participantStatus ?? "").trim().toLowerCase() === "disqualified" && (
                        <View style={[st.tag, { backgroundColor: "#EF444422", borderColor: "#EF444460" }]}>
                          <Text style={[st.tagText, { color: "#EF4444" }]}>DQ</Text>
                        </View>
                      )}
                  </View>
                  <View style={[st.progressTrack, { backgroundColor: colors.border }]}>
                    <LinearGradient
                      colors={[p.avatarColor, p.avatarColor + "66"]}
                      style={[st.progressFill, { width: `${pct}%` }]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                    />
                  </View>
                  {/* Below bar: prize on left, steps on right — finished only */}
                  {isFinished ? (
                    <View style={st.playerBelowBar}>
                      {!isUnlimited && race.entryType === "Free" ? (
                        <View style={st.playerPrizeRow}>
                          {coins > 0 && (
                            <>
                              <Image source={require("../../assets/images/game-coin.png")} style={{ width: 11, height: 11 }} />
                              <Text style={[st.playerPrizeText, { color: colors.gold }]}>{coins}</Text>
                            </>
                          )}
                          {p.isTied && (p.tieGroupSize ?? 1) > 1 && (
                            <View style={[st.tag, { backgroundColor: "#A0A0FF22", borderColor: "#A0A0FF55" }]}>
                              <Text style={[st.tagText, { color: "#A0A0FF" }]}>Tied</Text>
                            </View>
                          )}
                        </View>
                      ) : isCoinsBattle ? (
                        <View style={st.playerPrizeRow}>
                          {(() => {
                            if (!race.coinEntryAmount || race.coinEntryAmount <= 0) return null;
                            const total = race.coinEntryAmount * race.playerCount;
                            // Splits: 2p→100%, 3p→60%/40%, 4+p→50%/30%/20%
                            const splits = race.playerCount <= 2 ? [1.0] : race.playerCount === 3 ? [0.6, 0.4] : [0.5, 0.3, 0.2];
                            const pct = splits[i];
                            if (pct === undefined) return null;
                            const coins = Math.floor(total * pct);
                            return (
                              <>
                                <Image source={require("../../assets/images/game-coin.png")} style={{ width: 11, height: 11 }} />
                                <Text style={[st.playerPrizeText, { color: colors.gold }]}>
                                  {coins.toLocaleString()} coins
                                </Text>
                                {i === 0 && <Text style={[st.playerPrizeText, { color: colors.gold }]}> 🏆 Winner</Text>}
                              </>
                            );
                          })()}
                        </View>
                      ) : (
                        <View style={st.playerPrizeRow}>
                          {(p.prizeAmount ?? 0) > 0 && (
                            <Text style={[st.playerPrizeText, { color: colors.gold }]}>💰 ${p.prizeAmount!.toFixed(2)}</Text>
                          )}
                          {p.isTied && (p.tieGroupSize ?? 1) > 1 && (
                            <View style={[st.tag, { backgroundColor: "#A0A0FF22", borderColor: "#A0A0FF55" }]}>
                              <Text style={[st.tagText, { color: "#A0A0FF" }]}>Tied</Text>
                            </View>
                          )}
                        </View>
                      )}
                      <View style={st.playerStepsRow}>
                        <BlueShoe size={11} />
                        <Text style={[st.playerSteps, { color: colors.mutedForeground }]}>
                          {p.currentSteps.toLocaleString()}
                        </Text>
                        <Text style={[st.playerStepsUnit, { color: colors.mutedForeground }]}>Steps</Text>
                      </View>
                    </View>
                  ) : null}
                </View>

                {/* Steps (live only — right side) */}
                {!isFinished && (
                  <View style={st.playerRight}>
                    <View style={st.playerStepsRow}>
                      <BlueShoe size={12} />
                      <Text style={[st.playerSteps, { color: colors.mutedForeground }]}>
                        {p.currentSteps.toLocaleString()}
                      </Text>
                      <Text style={[st.playerStepsUnit, { color: colors.mutedForeground }]}>Steps</Text>
                    </View>
                  </View>
                )}

              </View>
            );
          })}
        </View>
      )}

      {/* ── Reactions footer (live only) — prize stays beside the title only ─ */}
      {!isFinished && (
        <View style={[st.reactFooter, { borderBottomColor: colors.border }]}>
          <View style={st.reactRow}>
            {["🔥", "👏", "👑"].map((r) => (
              <Text key={r} style={[st.reactItem, { color: colors.mutedForeground }]}>
                {r} {(race.reactionCounts[r] ?? 0) > 99 ? "99+" : (race.reactionCounts[r] ?? 0)}
              </Text>
            ))}
          </View>
        </View>
      )}

      {/* ── CTA button ──────────────────────────────────────────────────── */}
      {isFinished ? (
        <TouchableOpacity
          onPress={openLiveRace}
          onPressIn={prefetchLiveRaceOnPressIn}
          activeOpacity={0.85}
          style={st.ctaBtn}
        >
          <LinearGradient
            colors={[NEON_GREEN + "25", NEON_GREEN + "10"]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={[
              st.ctaGrad,
              {
                borderWidth: 1,
                borderColor: NEON_GREEN + "60",
                justifyContent: participating ? "space-between" : "center",
                paddingHorizontal: 16,
              },
            ]}
          >
            {participating ? (
              <TouchableOpacity
                onPress={(e) => { e.stopPropagation?.(); handleReact("❤️"); }}
                activeOpacity={0.7}
                style={st.finishedReactBtn}
              >
                <View style={st.heartRow}>
                  <Ionicons
                    name={liked ? "heart" : "heart-outline"}
                    size={18}
                    color={liked ? "#FF4D6D" : "#8B9AC0"}
                  />
                  <Text style={[st.finishedReactItem, { color: liked ? "#FF4D6D" : colors.mutedForeground }]}>
                    {(() => {
                      const total = Object.values(localReactions).reduce((s, v) => s + v, 0);
                      return total > 99 ? "99+" : String(total);
                    })()}
                  </Text>
                </View>
              </TouchableOpacity>
            ) : null}
            <View style={st.viewResultsRight}>
              <Feather name="award" size={15} color={NEON_GREEN} />
              <Text style={[st.ctaText, { color: NEON_GREEN }]}>View Results</Text>
            </View>
            {participating ? <View style={st.finishedReactBtn} /> : null}
          </LinearGradient>
        </TouchableOpacity>
      ) : participating ? (
        <TouchableOpacity
          onPress={openLiveRace}
          onPressIn={prefetchLiveRaceOnPressIn}
          activeOpacity={0.85}
          style={st.ctaBtn}
        >
          <LinearGradient
            colors={[NEON_PURPLE + "CC", "#4F46E5CC"]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={st.ctaGrad}
          >
            <Feather name="star" size={15} color="#FFF" />
            <Text style={[st.ctaText, { color: "#FFF" }]}>View My Race</Text>
          </LinearGradient>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={openSpectatorRace}
          onPressIn={prefetchLiveRaceOnPressIn}
          activeOpacity={0.85}
          style={st.ctaBtn}
        >
          <LinearGradient
            colors={["#4F46E5", "#7C3AED"]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={st.ctaGrad}
          >
            <Feather name="eye" size={16} color="#FFF" />
            <Text style={[st.ctaText, { color: "#FFF" }]}>Watch Live</Text>
          </LinearGradient>
        </TouchableOpacity>
      )}
    </View>
  );
}

// Memoized so stable cards (e.g. finished races) don't re-render when the parent
// re-renders on unrelated updates such as the 1-second live elapsed timer.
export const RaceCard = React.memo(RaceCardBase);

// ── List item types ───────────────────────────────────────────────────────────
type RaceOrigin = "live" | "finished";

type ListItem =
  | { kind: "header"; key: string; label: string; sub: string; isFinished: boolean }
  | { kind: "group"; key: string; origin: RaceOrigin; group: DateGroup<LiveRace>; isLastFinished?: boolean };

// ── Card-shaped shimmer placeholder shown while cards load / more load ─────────
function RaceCardSkeleton({
  colors,
  style,
}: {
  colors: ReturnType<typeof useColors>;
  style?: StyleProp<ViewStyle>;
}) {
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.85, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const bar = (w: number | `${number}%`, h: number, mt = 0) => (
    <Animated.View style={{ width: w, height: h, marginTop: mt, borderRadius: 6, backgroundColor: colors.border, opacity: pulse }} />
  );
  return (
    <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }, style]}>
      <Animated.View style={[st.cardHero, { backgroundColor: colors.border, opacity: pulse }]} />
      <View style={{ padding: rs(12), gap: 9 }}>
        {bar("60%", 16)}
        {bar("90%", 12)}
        {bar("80%", 12)}
        {bar("100%", 40, 8)}
      </View>
    </View>
  );
}

// ── Date section: date header + "View All" + horizontal card carousel ──────────
const CAROUSEL_ITEM_W = CAROUSEL_CARD_W + rs(12);

const DateGroupRow = React.memo(function DateGroupRow({
  group,
  origin,
  colors,
  myRace,
  myUsername,
  myUserId,
  myActiveRaceIds,
  onAvatarPress,
  onViewAll,
  showTrailingLoader,
}: {
  group: DateGroup<LiveRace>;
  origin: RaceOrigin;
  colors: ReturnType<typeof useColors>;
  myRace: MyActiveRace | null;
  myUsername?: string;
  myUserId?: string | null;
  myActiveRaceIds?: Set<string> | null;
  onAvatarPress: (p: LiveRacePlayer) => void;
  onViewAll: (origin: RaceOrigin, group: DateGroup<LiveRace>) => void;
  showTrailingLoader?: boolean;
}) {
  const handleViewAll = useCallback(() => onViewAll(origin, group), [onViewAll, origin, group]);

  return (
    <View style={st.dateSection}>
      <View style={st.dateHeaderRow}>
        <View style={{ flex: 1 }}>
          <Text style={[st.dateLabel, { color: colors.foreground }]} numberOfLines={1}>
            {group.dateLabel}
          </Text>
          <Text style={[st.dateCount, { color: colors.mutedForeground }]}>
            {getRoomCountLabel(group.races.length)}
          </Text>
        </View>
        <TouchableOpacity style={st.viewAllBtn} onPress={handleViewAll} activeOpacity={0.8}>
          <Text style={st.viewAllText}>View All</Text>
          <Feather name="chevron-right" size={14} color={NEON_PURPLE} />
        </TouchableOpacity>
      </View>
      {/* Eager render (plain ScrollView) so cards are never blank mid-swipe. Only
          the currently-visible date sections are mounted by the outer FlatList,
          so total mounted cards stay bounded. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={st.carousel}
        decelerationRate="fast"
        snapToInterval={CAROUSEL_ITEM_W}
        snapToAlignment="start"
        removeClippedSubviews
      >
        {group.races.map((item) => (
          <View key={item.id} style={{ width: CAROUSEL_CARD_W, marginRight: rs(12) }}>
            <RaceCard
              race={item}
              colors={colors}
              isMyRace={item.id === myRace?.id || myActiveRaceIds?.has(item.id)}
              isHost={item.id === myRace?.id ? myRace?.isHost : undefined}
              myUsername={myUsername}
              myUserId={myUserId}
              myActiveRaceIds={myActiveRaceIds}
              onAvatarPress={onAvatarPress}
              style={st.carouselCard}
            />
          </View>
        ))}
        {showTrailingLoader && (
          <View style={{ width: CAROUSEL_CARD_W, marginRight: rs(12) }}>
            <RaceCardSkeleton colors={colors} style={st.carouselCard} />
          </View>
        )}
      </ScrollView>
    </View>
  );
});

// ── Main screen ───────────────────────────────────────────────────────────────
export default function LiveTab() {
  useScreenMountPerf("Live");
  const colors = useColors();
  const { safeTop } = useSafeLayout();
  const { counts, formatCount } = usePresenceCounts();
  const { user } = useAuth();
  const cashUiAllowed = cashEligibilityForUser(user).allowed;
  const visibleFilters = useMemo(
    () => (cashUiAllowed ? FILTERS : FILTERS.filter((f) => f !== "Cash Challenges")),
    [cashUiAllowed],
  );
  const visibleOnTab = useCallback(
    (races: LiveRace[], filter: FilterType) =>
      racesVisibleOnTab(races, filter, cashUiAllowed),
    [cashUiAllowed],
  );
  const tabBarHeight = useTabBarHeight();
  const [activeFilter, setActiveFilter] = useState<FilterType>("All");
  useEffect(() => {
    if (!cashUiAllowed && activeFilter === "Cash Challenges") {
      setActiveFilter("All");
    }
  }, [activeFilter, cashUiAllowed]);
  // Sync mem seed — first paint can show cards before load() effect runs.
  const [liveChallenges, setLiveChallenges] = useState<LiveRace[]>(() => {
    const cached = screenCache.getSync<{ live: LiveRace[]; finished: LiveRace[] }>(
      `${LIVE_SCREEN_CACHE_PREFIX}All`,
    );
    return cached ? visibleOnTab(cached.live, "All") : [];
  });
  const [finishedChallenges, setFinishedChallenges] = useState<LiveRace[]>(() => {
    const cached = screenCache.getSync<{ live: LiveRace[]; finished: LiveRace[] }>(
      `${LIVE_SCREEN_CACHE_PREFIX}All`,
    );
    return cached ? visibleOnTab(cached.finished, "All") : [];
  });
  const [loading, setLoading] = useState(() => {
    const cached = screenCache.getSync(`${LIVE_SCREEN_CACHE_PREFIX}All`);
    return cached === null;
  });
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [finishedOffset, setFinishedOffset] = useState(FINISHED_PAGE_SIZE);
  const [hasMoreFinished, setHasMoreFinished] = useState(true);
  const [myRace, setMyRace] = useState<MyActiveRace | null>(null);
  const [myActiveRaceIds, setMyActiveRaceIds] = useState<Set<string>>(() => new Set());
  const [realtimeRaceIds, setRealtimeRaceIds] = useState<string[]>([]);
  const liveChallengesRef = useRef<LiveRace[]>([]);
  useEffect(() => { liveChallengesRef.current = liveChallenges; }, [liveChallenges]);
  /** Bumps on every load() so late responses cannot overwrite a newer filter/fetch. */
  const loadGenRef = useRef(0);
  const finishedChallengesRef = useRef<LiveRace[]>([]);
  useEffect(() => { finishedChallengesRef.current = finishedChallenges; }, [finishedChallenges]);

  // Warm theme images after interactions — never compete with list paint / View Race nav.
  useEffect(() => {
    if (liveChallenges.length === 0) return;
    const task = InteractionManager.runAfterInteractions(() => {
      prefetchTrackThemes(
        liveChallenges.map((r) => ({
          code: r.trackLayout,
          trackLayout: r.trackLayout,
          imageSet: r.imageSet ?? null,
          imageUrl: r.imageUrl ?? null,
          assetVersion: r.assetVersion,
        })),
        "full",
      );
    });
    return () => task.cancel();
  }, [liveChallenges]);
  const loadRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const hasFocusedOnceRef = useRef(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [profileInitialData, setProfileInitialData] = useState<PublicProfileInitialData | undefined>();

  const handleAvatarPress = useCallback((p: LiveRacePlayer) => {
    setProfileInitialData({
      username: p.username,
      countryFlag: p.countryFlag,
      avatarColor: p.avatarColor,
      avatarUrl: p.avatarUrl ?? undefined,
      avatarVersion: p.avatarVersion,
      isCurrentUser: p.username === user?.username,
    });
    setProfileUserId(p.userId);
  }, [user?.username]);

  const load = useCallback(async () => {
    const gen = ++loadGenRef.current;
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      const cacheKey = `${LIVE_SCREEN_CACHE_PREFIX}${activeFilter}`;

      // ── 1. Sync mem paint (never await disk before starting network) ────────
      let cached = screenCache.getSync<{ live: LiveRace[]; finished: LiveRace[] }>(cacheKey);
      if (
        !cached &&
        activeFilter === "Streak Challenges"
      ) {
        const allMem = screenCache.getSync<{ live: LiveRace[]; finished: LiveRace[] }>(
          `${LIVE_SCREEN_CACHE_PREFIX}All`,
        );
        if (allMem) {
          const ulLive = allMem.live.filter(isUnlimitedChallengeRace);
          const ulFinished = allMem.finished.filter(isUnlimitedChallengeRace);
          if (ulLive.length > 0 || ulFinished.length > 0) {
            cached = { live: ulLive, finished: ulFinished };
          }
        }
      }

      const paintCached = (data: { live: LiveRace[]; finished: LiveRace[] }) => {
        const livePaint = visibleOnTab(data.live, activeFilter);
        const finishedPaint = visibleOnTab(data.finished, activeFilter);
        setLiveChallenges(livePaint);
        setFinishedChallenges(finishedPaint);
        setFinishedOffset(FINISHED_PAGE_SIZE);
        setHasMoreFinished(
          activeFilter === "Streak Challenges"
            ? false
            : finishedPaint.length >= FINISHED_PAGE_SIZE,
        );
        setLoading(false);
      };

      if (cached) {
        paintCached(cached);
      } else {
        // Clear wrong-tab cards only when we have nothing valid for this filter.
        const sameTabVisible = visibleOnTab(liveChallengesRef.current, activeFilter);
        if (sameTabVisible.length === 0) {
          setLiveChallenges([]);
          setFinishedChallenges([]);
        } else {
          setLoading(false);
        }
      }

      // Disk warm in parallel with network — paint if still empty when disk arrives.
      void (async () => {
        if (cached) return;
        let disk = await screenCache.get<{ live: LiveRace[]; finished: LiveRace[] }>(cacheKey);
        if (
          !disk &&
          activeFilter === "Streak Challenges"
        ) {
          const allDisk = await screenCache.get<{ live: LiveRace[]; finished: LiveRace[] }>(
            `${LIVE_SCREEN_CACHE_PREFIX}All`,
          );
          if (allDisk) {
            const ulLive = allDisk.live.filter(isUnlimitedChallengeRace);
            const ulFinished = allDisk.finished.filter(isUnlimitedChallengeRace);
            if (ulLive.length > 0 || ulFinished.length > 0) {
              disk = { live: ulLive, finished: ulFinished };
            }
          }
        }
        if (gen !== loadGenRef.current || !disk) return;
        if (
          liveChallengesRef.current.length > 0 ||
          finishedChallengesRef.current.length > 0
        ) {
          return;
        }
        cached = disk;
        paintCached(disk);
        if (__DEV__) {
          const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
          console.log(`[Perf] Live diskCachePaintMs=${Math.round(ms)} filter=${activeFilter}`);
        }
      })();

      // ── 2. Network starts immediately (parallel with disk). Progressive Classic
      // paint is additive only (no clear→repaint) to avoid historical show/hide flicker. ──
      const wantsUnlimited = shouldMergeUnlimitedLive(activeFilter);
      const unlimitedOnly = activeFilter === "Streak Challenges";

      let live: LiveRace[] = [];
      let finished: LiveRace[] = [];
      let ok = false;
      let myRaceResult: { primary: MyActiveRace | null; all: MyActiveRace[] } = {
        primary: null,
        all: [],
      };

      if (unlimitedOnly) {
        const [ulResult, mine] = await Promise.all([
          fetchLiveChallenges(activeFilter, { viewerUserId: user?.id }),
          fetchMyActiveRaces(),
        ]);
        if (gen !== loadGenRef.current) return;
        live = ulResult.live;
        finished = ulResult.finished;
        ok = ulResult.ok;
        myRaceResult = mine;
      } else if (wantsUnlimited) {
        const classicP = fetchClassicLiveChallenges(activeFilter);
        const unlimitedP = import("@/services/unlimitedChallengesListApi")
          .then((m) => m.fetchLiveUnlimitedChallenges({ viewerUserId: user?.id }))
          .catch(() => ({ live: [] as LiveRace[], finished: [] as LiveRace[] }));
        const mineP = fetchMyActiveRaces();

        // Progressive: if cold (no mem/disk cards yet), paint Classic as soon as it arrives.
        void classicP.then((classic) => {
          if (gen !== loadGenRef.current) return;
          if (
            liveChallengesRef.current.length > 0 ||
            finishedChallengesRef.current.length > 0
          ) {
            return;
          }
          const livePaint = visibleOnTab(classic.live, activeFilter);
          const finishedPaint = visibleOnTab(classic.finished, activeFilter);
          if (livePaint.length === 0 && finishedPaint.length === 0) return;
          setLiveChallenges(livePaint);
          setFinishedChallenges(finishedPaint);
          setFinishedOffset(FINISHED_PAGE_SIZE);
          setHasMoreFinished(finishedPaint.length >= FINISHED_PAGE_SIZE);
          setLoading(false);
          if (__DEV__) {
            const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
            console.log(`[Perf] Live classicFirstPaintMs=${Math.round(ms)} filter=${activeFilter}`);
          }
        }).catch(() => {});

        const [classic, unlimited, mine] = await Promise.all([classicP, unlimitedP, mineP]);
        if (gen !== loadGenRef.current) return;
        myRaceResult = mine;
        const ulLive = (unlimited.live as LiveRace[]).filter(isUnlimitedChallengeRace);
        const ulFinished = (unlimited.finished as LiveRace[]).filter(isUnlimitedChallengeRace);
        live = mergeLiveById(classic.live, ulLive);
        finished = mergeLiveById(classic.finished, ulFinished);
        ok = classic.ok || ulLive.length > 0 || ulFinished.length > 0;
        if (ulLive.length > 0 || ulFinished.length > 0) {
          void screenCache.set(`${LIVE_SCREEN_CACHE_PREFIX}Streak Challenges`, {
            live: ulLive,
            finished: ulFinished,
          });
        }
      } else {
        const [classic, mine] = await Promise.all([
          fetchLiveChallenges(activeFilter, { viewerUserId: user?.id }),
          fetchMyActiveRaces(),
        ]);
        if (gen !== loadGenRef.current) return;
        live = classic.live;
        finished = classic.finished;
        ok = classic.ok;
        myRaceResult = mine;
      }

      const idSet = new Set(
        myRaceResult.all.map((r) => r.id).filter((id) => !isRecentlyLeftRaceId(id)),
      );
      for (const race of [...live, ...finished]) {
        if (isRecentlyLeftRaceId(race.id)) continue;
        if (race.currentUserParticipating === true) {
          idSet.add(race.id);
        }
      }
      try {
        const { loadHostedUnlimitedChallenges } = await import("@/utils/hostedUnlimitedCache");
        const hosted = await loadHostedUnlimitedChallenges({ includeStarted: true });
        for (const seed of hosted) {
          if (!seed.current_user_registered || !seed.room_id) continue;
          if (isRecentlyLeftRaceId(seed.room_id)) continue;
          idSet.add(seed.room_id);
        }
      } catch { /* optional */ }
      const participation = {
        userId: user?.id,
        username: user?.username,
        myActiveRaceIds: idSet,
      };
      let liveForMine = live;
      if (activeFilter === "My Races") {
        try {
          const { loadHostedUnlimitedChallenges } = await import("@/utils/hostedUnlimitedCache");
          const { mapUnlimitedUpcomingToLiveRaceFields } = await import("@/utils/unlimitedLiveRace");
          const hosted = await loadHostedUnlimitedChallenges({ includeStarted: true });
          const hostedLive: LiveRace[] = [];
          for (const seed of hosted) {
            if (!seed.current_user_registered) continue;
            if (seed.room_id && isRecentlyLeftRaceId(seed.room_id)) continue;
            const mapped = mapUnlimitedUpcomingToLiveRaceFields({
              ...seed,
              status: "active",
              current_user_registered: true,
            });
            if (mapped) hostedLive.push(mapped as LiveRace);
          }
          if (hostedLive.length > 0) {
            liveForMine = mergeLiveById(liveForMine, hostedLive);
          }
        } catch { /* optional */ }
      }
      let visibleLive =
        activeFilter === "My Races"
          ? buildMyRacesLiveList(liveForMine, myRaceResult.all, participation)
          : visibleOnTab(live, activeFilter);
      let visibleFinished =
        activeFilter === "My Races"
          ? filterMyRaces(finished, participation)
          : visibleOnTab(finished, activeFilter);

      // If a flaky Unlimited fetch dropped LIVE rows, keep only still-live ones.
      // Never re-inject finished/cancelled Unlimited that the new filter removed.
      if (
        activeFilter === "All" ||
        activeFilter === "Streak Challenges" ||
        activeFilter === "My Races"
      ) {
        const prevUlLive = liveChallengesRef.current.filter(
          (r) =>
            isUnlimitedChallengeRace(r) &&
            r.status !== "completed" &&
            String(r.status).toLowerCase() !== "cancelled" &&
            String(r.status).toLowerCase() !== "cancelled_by_platform",
        );
        const nextUl = visibleLive.filter(isUnlimitedChallengeRace);
        if (prevUlLive.length > 0 && nextUl.length === 0) {
          visibleLive = mergeLiveById(visibleLive, prevUlLive);
        }
      }
      // Finished: drop any Unlimited the viewer did not host/join (API is global).
      visibleFinished = visibleFinished.filter((r) => {
        if (!isUnlimitedChallengeRace(r)) return true;
        if (r.status !== "completed") return false;
        return (
          r.currentUserParticipating === true ||
          (!!user?.id && !!r.hostUserId && r.hostUserId === user.id)
        );
      });

      if (gen !== loadGenRef.current) return;

      const freshIsEmpty = visibleLive.length === 0 && visibleFinished.length === 0;
      // Only treat "had visible" as same-tab cards (not leftovers from another chip).
      const sameTabVisible = visibleOnTab(liveChallengesRef.current, activeFilter);
      const hadVisible =
        sameTabVisible.length > 0 ||
        (cached?.live?.length ?? 0) > 0 ||
        (cached?.finished?.length ?? 0) > 0;

      // Never blank All/Free/etc that already showed cards (refresh flicker).
      // My Races must apply an empty result after forfeit / leave.
      if (freshIsEmpty && hadVisible && activeFilter !== "My Races") {
        setLoading(false);
        setMyRace(
          myRaceResult.primary && !isRecentlyLeftRaceId(myRaceResult.primary.id)
            ? myRaceResult.primary
            : null,
        );
        setMyActiveRaceIds(idSet);
        return;
      }

      if (ok || !freshIsEmpty || activeFilter === "My Races") {
        setRealtimeRaceIds(
          (activeFilter === "My Races" ? visibleLive : live).map((race) => race.id),
        );
        setLiveChallenges(visibleLive);
        setFinishedChallenges(visibleFinished);
        void screenCache.set(cacheKey, { live: visibleLive, finished: visibleFinished });
        setFinishedOffset(FINISHED_PAGE_SIZE);
        setHasMoreFinished(
          activeFilter === "Streak Challenges"
            ? false
            : finished.length >= FINISHED_PAGE_SIZE,
        );
      }
      setMyRace(
        myRaceResult.primary && !isRecentlyLeftRaceId(myRaceResult.primary.id)
          ? myRaceResult.primary
          : null,
      );
      setMyActiveRaceIds(idSet);
      try {
        const { activeChallengeSync } = await import("@/services/activeChallengeSync");
        activeChallengeSync.registerMany([...idSet]);
      } catch { /* optional */ }
      setLoading(false);
      if (__DEV__) {
        const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
        console.log(
          `[Perf] Live loadCompleteMs=${Math.round(ms)} filter=${activeFilter} live=${visibleLive.length} finished=${visibleFinished.length}`,
        );
      }
    } catch {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [activeFilter, user?.id, user?.username]);

  const loadMoreFinished = useCallback(async () => {
    if (loadingMore || !hasMoreFinished) return;
    setLoadingMore(true);
    const fetched = await fetchMoreFinished(activeFilter, finishedOffset);
    const more = activeFilter === "My Races"
      ? filterMyRaces(fetched, {
          userId: user?.id,
          username: user?.username,
          myActiveRaceIds,
        })
      : fetched;
    if (more.length > 0) {
      const existingIds = new Set(finishedChallenges.map((r) => r.id));
      const newRaces = more.filter((r) => !existingIds.has(r.id));
      setFinishedChallenges((prev) => [...prev, ...newRaces]);
    }
    setFinishedOffset((prev) => prev + fetched.length);
    if (fetched.length < FINISHED_PAGE_SIZE) setHasMoreFinished(false);
    setLoadingMore(false);
  }, [activeFilter, finishedOffset, finishedChallenges, loadingMore, hasMoreFinished, myActiveRaceIds, user?.id, user?.username]);
  useEffect(() => { loadRef.current = load; }, [load]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      CHALLENGE_LEFT_EVENT,
      (payload?: { raceId?: string }) => {
        const raceId = String(payload?.raceId ?? "").trim();
        if (!raceId) return;
        setMyActiveRaceIds((prev) => {
          if (!prev.has(raceId)) return prev;
          const next = new Set(prev);
          next.delete(raceId);
          return next;
        });
        setMyRace((prev) => (prev?.id === raceId ? null : prev));
        setLiveChallenges((prev) => {
          const next = prev.map((r) =>
            r.id === raceId
              ? {
                  ...r,
                  currentUserParticipating: false,
                  currentUserParticipantStatus: "forfeited",
                  currentUserRole: "spectator",
                }
              : r,
          );
          return activeFilter === "My Races"
            ? next.filter((r) => r.id !== raceId)
            : next;
        });
        // Do not refetch immediately — leave POST may still be in flight and
        // my-active would resurrect streak / View My Race.
      },
    );
    return () => sub.remove();
  }, [activeFilter]);

  // Joining, withdrawing, or forfeiting often happens on another tab/screen.
  // Refresh immediately when the user returns — paint cache first so cards
  // never blank until network finishes (same feel as other challenge cards).
  useFocusEffect(useCallback(() => {
    if (!hasFocusedOnceRef.current) {
      hasFocusedOnceRef.current = true;
      return;
    }
    const cacheKey = `${LIVE_SCREEN_CACHE_PREFIX}${activeFilter}`;
    const cached = screenCache.getSync<{ live: LiveRace[]; finished: LiveRace[] }>(cacheKey);
    if (cached) {
      setLiveChallenges(visibleOnTab(cached.live, activeFilter));
      setFinishedChallenges(visibleOnTab(cached.finished, activeFilter));
      setLoading(false);
    }
    void loadRef.current();
  }, [activeFilter]));

  // Refresh data when app returns from the background (e.g. user locks phone, re-opens app).
  // useFocusEffect only fires on tab navigation, not on OS-level app resume.
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === "active") {
        // Only refetch on resume if the last fetch is genuinely stale. Rapid
        // background/foreground toggles no longer trigger a full data reload;
        // Pusher realtime keeps the list current in the meantime.
        if (apiFetchAllowed("live_resume", 30_000)) {
          markApiFetched("live_resume");
          void loadRef.current();
        }
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);


  useEffect(() => {
    // Skeleton only when this filter has neither mem cache nor already-visible cards.
    // Refreshing keeps existing cards; load() never blanks a populated same-tab list.
    const hasMem =
      screenCache.getSync(`${LIVE_SCREEN_CACHE_PREFIX}${activeFilter}`) !== null ||
      (activeFilter === "Streak Challenges" &&
        screenCache.getSync(`${LIVE_SCREEN_CACHE_PREFIX}All`) !== null);
    const sameTabVisible = visibleOnTab(liveChallengesRef.current, activeFilter);
    if (!hasMem && sameTabVisible.length === 0) {
      setLoading(true);
    } else {
      setLoading(false);
    }
    void load();
  }, [load, activeFilter]);

  useEffect(() => {
    // Safety poll at 60 s. Pusher pushes real-time updates for active races so
    // this interval only acts as a fallback (missed events, reconnects, etc.).
    // Previously 10 s — reduced 6× to cut redundant network traffic.
    const id = setInterval(() => { void load(); }, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // Elapsed labels tick inside RaceCard via LiveClockText — do not rewrite the
  // race list every second (that forced full carousel re-renders).
  useEffect(() => {
    connectPusher();
    const handlers: Array<() => void> = [];
    for (const raceId of realtimeRaceIds) {
      const channelName = CHANNELS.liveRace(raceId);
      const channel = subscribeToChannel(channelName);
      if (!channel) continue;
      const onProgress = (data: { participantId: string; userId?: string; steps: number; rank: number }) => {
        setLiveChallenges((prev) =>
          prev.map((r) => {
            if (r.id !== raceId) return r;
            const updated = r.players.map((p) =>
              p.userId === data.userId || p.id === data.participantId
                ? { ...p, currentSteps: Math.max(p.currentSteps, data.steps) }
                : p
            );
            const sorted = [...updated].sort((a, b) => b.currentSteps - a.currentSteps);
            return {
              ...r,
              players: sorted.map((p, i) => ({ ...p, rank: i + 1 })),
            };
          })
        );
      };
      const onReaction = (data: { emoji: string }) => {
        setLiveChallenges((prev) =>
          prev.map((r) => {
            if (r.id !== raceId) return r;
            const counts = { ...r.reactionCounts };
            counts[data.emoji] = (counts[data.emoji] ?? 0) + 1;
            return { ...r, reactionCounts: counts };
          })
        );
      };
      const onCompleted = () => {
        const completedRace = liveChallengesRef.current.find((r) => r.id === raceId);
        // Unlimited: never optimistically mark FINISHED with empty players —
        // reload from API so only true server completions appear.
        if (completedRace && isUnlimitedChallengeRace(completedRace)) {
          void loadRef.current();
          return;
        }
        setLiveChallenges((prev) => prev.filter((r) => r.id !== raceId));
        if (completedRace) {
          const updated = { ...completedRace, status: "completed", completedAt: new Date().toISOString() };
          setFinishedChallenges((pf) => pf.some((r) => r.id === raceId) ? pf : [updated, ...pf]);
        }
        void loadRef.current();
      };
      const onParticipationChanged = (data?: { userId?: string; participantId?: string }) => {
        // Keep "My Races" membership and card CTAs in sync without per-race
        // profile requests. Events without a user id are treated as room-wide.
        if (!data?.userId || !user?.id || data.userId === user.id) {
          void loadRef.current();
        }
      };
      channel.bind(EVENTS.RACE_PROGRESS, onProgress);
      channel.bind(EVENTS.RACE_REACTION, onReaction);
      channel.bind(EVENTS.RACE_COMPLETED, onCompleted);
      channel.bind(EVENTS.RACE_JOINED, onParticipationChanged);
      channel.bind(EVENTS.LEADERBOARD_UPDATED, onParticipationChanged);
      channel.bind("race:participant-forfeited", onParticipationChanged);
      channel.bind("race:participant-withdrew", onParticipationChanged);
      channel.bind("race:participant-removed", onParticipationChanged);
      channel.bind("race:closed", onParticipationChanged);
      channel.bind("race:cancelled", onParticipationChanged);
      channel.bind("race:results-available", onParticipationChanged);
      handlers.push(() => {
        channel.unbind(EVENTS.RACE_PROGRESS, onProgress);
        channel.unbind(EVENTS.RACE_REACTION, onReaction);
        channel.unbind(EVENTS.RACE_COMPLETED, onCompleted);
        channel.unbind(EVENTS.RACE_JOINED, onParticipationChanged);
        channel.unbind(EVENTS.LEADERBOARD_UPDATED, onParticipationChanged);
        channel.unbind("race:participant-forfeited", onParticipationChanged);
        channel.unbind("race:participant-withdrew", onParticipationChanged);
        channel.unbind("race:participant-removed", onParticipationChanged);
        channel.unbind("race:closed", onParticipationChanged);
        channel.unbind("race:cancelled", onParticipationChanged);
        channel.unbind("race:results-available", onParticipationChanged);
      });
    }
    return () => handlers.forEach((h) => h());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, realtimeRaceIds.join(",")]);

  useEffect(() => {
    connectPusher();
    const channel = subscribeToChannel(CHANNELS.PRESENCE);
    if (!channel) return;
    const onRaceStarted = () => { void load(); };
    channel.bind(EVENTS.RACE_STARTED, onRaceStarted);
    return () => { channel.unbind(EVENTS.RACE_STARTED, onRaceStarted); };
  }, [load]);

  const liveCount = liveChallenges.length;
  const racingDisplay = Math.max(
    counts.racing,
    liveChallenges.reduce((sum, r) => sum + Math.max(0, r.playerCount || 0), 0),
  );
  const finishedCount = finishedChallenges.length;

  // Open the date-specific "View All" screen. The already-filtered races for the
  // tapped date are stashed in screenCache (mem write is synchronous) so the
  // next screen renders instantly with identical data — no refetch, no dupes.
  const handleViewAll = useCallback((origin: RaceOrigin, group: DateGroup<LiveRace>) => {
    const cacheKey = `live_date_rooms:${origin}:${group.dateKey}:${activeFilter}`;
    void screenCache.set(cacheKey, group.races);
    router.push({
      pathname: "/live/date-rooms",
      params: {
        cacheKey,
        dateLabel: group.dateLabel,
        count: String(group.races.length),
        origin,
        myRaceId: myRace?.id ?? "",
        myRaceIsHost: myRace?.isHost ? "1" : "",
        myRaceIds: [...myActiveRaceIds].join(","),
      },
    });
  }, [activeFilter, myRace?.id, myRace?.isHost, myActiveRaceIds]);

  // Live rows are rebuilt on every elapsed-timer tick (the live races change
  // each second). Kept in its own memo so it doesn't touch finished rows.
  const liveRows = useMemo<ListItem[]>(() => {
    if (liveCount === 0) return [];
    const rows: ListItem[] = [{
      kind: "header",
      key: "sec-live",
      label: "Live Now",
      sub: `${liveCount} live challenge${liveCount !== 1 ? "s" : ""} right now`,
      isFinished: false,
    }];
    for (const g of groupRacesByDate(
      liveChallenges,
      (r) => r.startedAt ?? r.createdAt,
      { order: "desc", withinOrder: "desc" },
    )) {
      rows.push({ kind: "group", key: `live-${g.dateKey}`, origin: "live", group: g });
    }
    return rows;
  }, [liveCount, liveChallenges]);

  // Finished rows only recompute when finished races change — so their group
  // object references stay stable across live ticks and memoized carousels
  // (DateGroupRow) skip re-rendering, keeping scrolling smooth.
  const finishedRows = useMemo<ListItem[]>(() => {
    if (finishedCount === 0) return [];
    const rows: ListItem[] = [{
      kind: "header",
      key: "sec-finished",
      label: "Recently Finished",
      sub: "Here are the latest challenge results",
      isFinished: true,
    }];
    const groups = groupRacesByDate(
      finishedChallenges,
      (r) => r.completedAt ?? r.startedAt ?? r.createdAt,
      { order: "desc", withinOrder: "desc" },
    );
    groups.forEach((g, i) => {
      rows.push({
        kind: "group",
        key: `finished-${g.dateKey}`,
        origin: "finished",
        group: g,
        isLastFinished: i === groups.length - 1,
      });
    });
    return rows;
  }, [finishedCount, finishedChallenges]);

  const listItems = useMemo<ListItem[]>(
    () => [...liveRows, ...finishedRows],
    [liveRows, finishedRows],
  );

  // Memoized renderItem — stable function reference so FlatList rows don't
  // re-render just because the parent re-renders for an unrelated reason.
  const renderListItem = useCallback(({ item }: { item: ListItem }) => {
    if (item.kind === "header") {
      return (
        <SectionHeader
          label={item.label}
          sub={item.sub}
          isFinished={item.isFinished}
        />
      );
    }
    return (
      <DateGroupRow
        group={item.group}
        origin={item.origin}
        colors={colors}
        myRace={myRace}
        myUsername={user?.username}
        myUserId={user?.id}
        myActiveRaceIds={myActiveRaceIds}
        onAvatarPress={handleAvatarPress}
        onViewAll={handleViewAll}
        showTrailingLoader={item.origin === "finished" && item.isLastFinished && loadingMore}
      />
    );
  }, [colors, myRace, myActiveRaceIds, user?.username, user?.id, handleAvatarPress, handleViewAll, loadingMore]);

  return (
    <View style={[st.container, { paddingBottom: tabBarHeight, backgroundColor: colors.background }]}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={[st.hero, { paddingTop: safeTop, backgroundColor: colors.background }]}>
        <View style={st.heroRow}>
          <View>
            <Text style={[st.heroTitle, { color: colors.foreground }]}>Live Challenges</Text>
            <View style={st.presenceRow}>
              <Text style={st.racingDot}>●</Text>
              <Text style={[st.presenceText, { color: colors.mutedForeground }]}>{formatCount(racingDisplay)} racing</Text>
              <Feather name="eye" size={12} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
              <Text style={[st.presenceText, { color: colors.mutedForeground }]}>{formatCount(counts.spectating)} watching</Text>
            </View>
          </View>
          <View style={[st.livePill, liveCount === 0 && st.livePillOff]}>
            {liveCount > 0 ? <LiveDot /> : <View style={[st.liveDot, { backgroundColor: "#666" }]} />}
            <Text style={[st.livePillText, liveCount === 0 && { color: "#666" }]}>LIVE</Text>
          </View>
        </View>
      </View>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[st.filterRow, st.mainTabBar, { backgroundColor: colors.card, borderColor: colors.border }]}
        contentContainerStyle={st.mainTabContent}
      >
        {visibleFilters.map((f) => {
          const active = activeFilter === f;
          const textColor = active ? colors.primaryForeground : colors.mutedForeground;
          return (
            <TouchableOpacity
              key={f}
              onPress={() => setActiveFilter(f)}
              style={[st.mainTabBtn, active && { backgroundColor: colors.primary }]}
            >
              {f === "All" && (
                <Feather name="grid" size={12} color={textColor} style={{ marginRight: 2 }} />
              )}
              <Text style={[st.mainTabText, { color: textColor }]}>{f}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      {activeFilter === "Sponsored Events" ? (
        (() => {
          const sponsoredLive = visibleOnTab(liveChallenges, "Sponsored Events");
          const sponsoredFinished = visibleOnTab(finishedChallenges, "Sponsored Events");
          // Upcoming scheduled sponsored events are intentionally hidden on Live —
          // only in-progress and finished sponsored races appear here.
          const empty = sponsoredLive.length === 0 && sponsoredFinished.length === 0;
          if (loading && empty) {
            return (
              <View style={{ paddingTop: 8 }}>
                <SkeletonList count={5} variant="race" />
              </View>
            );
          }
          if (empty) {
            return (
              <View style={st.emptyBox}>
                <Feather name="calendar" size={32} color={colors.mutedForeground} />
                <Text style={[st.emptyText, { color: colors.mutedForeground }]}>
                  No sponsored events right now.
                </Text>
              </View>
            );
          }
          return (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingTop: 12, paddingBottom: 24, paddingHorizontal: 14 }}
              showsVerticalScrollIndicator={false}
            >
              {sponsoredLive.length > 0 && (
                <>
                  <SectionHeader
                    label="Live Now"
                    sub={`${sponsoredLive.length} sponsored event${sponsoredLive.length !== 1 ? "s" : ""} in progress`}
                    isFinished={false}
                  />
                  {sponsoredLive.map((r) => (
                    <View key={r.id} style={{ marginBottom: 16 }}>
                      <RaceCard
                        race={r}
                        colors={colors}
                        isMyRace={r.id === myRace?.id || myActiveRaceIds.has(r.id)}
                        isHost={r.id === myRace?.id ? myRace?.isHost : undefined}
                        myUsername={user?.username}
                        myUserId={user?.id}
                        myActiveRaceIds={myActiveRaceIds}
                        onAvatarPress={handleAvatarPress}
                      />
                    </View>
                  ))}
                </>
              )}
              {sponsoredFinished.length > 0 && (
                <>
                  <SectionHeader
                    label="Recently Finished"
                    sub="Here are the latest sponsored event results"
                    isFinished={true}
                  />
                  {sponsoredFinished.map((r) => (
                    <View key={r.id} style={{ marginBottom: 16 }}>
                      <RaceCard
                        race={r}
                        colors={colors}
                        isMyRace={r.id === myRace?.id || myActiveRaceIds.has(r.id)}
                        isHost={r.id === myRace?.id ? myRace?.isHost : undefined}
                        myUsername={user?.username}
                        myUserId={user?.id}
                        myActiveRaceIds={myActiveRaceIds}
                        onAvatarPress={handleAvatarPress}
                      />
                    </View>
                  ))}
                </>
              )}
            </ScrollView>
          );
        })()
      ) : loading ? (
        <View style={{ paddingTop: 8 }}>
          <SkeletonList count={5} variant="race" />
        </View>
      ) : liveCount === 0 && finishedCount === 0 ? (
        <View style={st.emptyBox}>
          {activeFilter === "My Races" ? (
            <>
              <Feather name="activity" size={32} color={colors.mutedForeground} />
              <Text style={[st.emptyTitle, { color: colors.foreground }]}>No Active Races</Text>
              <Text style={[st.emptySubText, { color: colors.mutedForeground }]}>
                You are not participating in any live races right now.
              </Text>
              <TouchableOpacity style={st.refreshBtn} onPress={() => setActiveFilter("All")}>
                <Feather name="grid" size={14} color={NEON_PURPLE} />
                <Text style={st.refreshText}>Browse Live Races</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Feather name="zap-off" size={32} color={colors.mutedForeground} />
              <Text style={[st.emptyText, { color: colors.mutedForeground }]}>
                {activeFilter === "Cash Challenges"
                  ? "No cash challenges available right now."
                  : activeFilter === "Streak Challenges"
                    ? "No Streak Challenges right now."
                    : "No races found."}
              </Text>
              {activeFilter === "Cash Challenges" && (
                <Text style={[st.emptySubText, { color: colors.mutedForeground }]}>
                  Host or join a cash challenge when one becomes available.
                </Text>
              )}
              {activeFilter === "Streak Challenges" && (
                <Text style={[st.emptySubText, { color: colors.mutedForeground }]}>
                  Live and recently finished Streak Challenges will show here.
                </Text>
              )}
            </>
          )}
        </View>
      ) : (
        <FlatList
          data={listItems}
          keyExtractor={(item) => item.key}
          style={{ flex: 1 }}
          contentContainerStyle={[st.list, { paddingBottom: 24 }]}
          showsVerticalScrollIndicator={false}
          initialNumToRender={4}
          maxToRenderPerBatch={4}
          windowSize={7}
          onEndReached={loadMoreFinished}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            loadingMore
              ? <View style={{ paddingVertical: 8 }}><SkeletonRaceRow /></View>
              : null
          }
          renderItem={renderListItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={NEON_PURPLE}
              colors={[NEON_PURPLE]}
            />
          }
        />
      )}

      <PublicProfileModal
        visible={!!profileUserId}
        userId={profileUserId}
        initialData={profileInitialData}
        onClose={() => { setProfileUserId(null); setProfileInitialData(undefined); }}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  container:        { flex: 1 },

  // Hero
  hero:             { width: "100%", paddingHorizontal: rs(18), paddingBottom: rs(14), paddingTop: rs(14) },
  heroRow:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heroTitle:        { fontSize: rf(26), fontWeight: "900", letterSpacing: -0.5 },
  presenceRow:      { flexDirection: "row", alignItems: "center", marginTop: 4, gap: 4 },
  racingDot:        { color: "#FF4444", fontSize: rf(13) },
  presenceText:     { fontSize: rf(13) },
  livePill:         { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#FF000022", borderRadius: 14, paddingHorizontal: rs(12), paddingVertical: rs(7), borderWidth: 1, borderColor: "#FF000050" },
  livePillOff:      { backgroundColor: "#33333322", borderColor: "#33333340" },
  livePillText:     { fontSize: rf(11), fontWeight: "900", color: "#FF4444", letterSpacing: 0.8 },
  liveDot:          { width: 6, height: 6, borderRadius: 3, backgroundColor: "#FF4444" },

  // Filters (matches Leaderboard main tabs)
  filterRow:        { flexGrow: 0, flexShrink: 0, marginHorizontal: rs(14), marginBottom: rs(10) },
  mainTabBar:       { borderRadius: 14, borderWidth: 1 },
  mainTabContent:   { flexDirection: "row", padding: 3, gap: 3 },
  mainTabBtn:       { flexDirection: "row", alignItems: "center", paddingVertical: rs(9), paddingHorizontal: rs(16), borderRadius: 11 },
  mainTabText:      { fontSize: rf(13), fontWeight: "700" },

  // Section headers
  sectionHeader:    { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 2, marginBottom: 10, marginTop: 4 },
  sectionLabel:     { fontSize: rf(15), fontWeight: "800" },
  sectionSub:       { fontSize: rf(12), marginTop: 1 },

  // Date section (grouped horizontal carousels)
  dateSection:      { marginBottom: rs(4) },
  dateHeaderRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2, marginBottom: rs(10) },
  dateLabel:        { fontSize: rf(15), fontWeight: "800", letterSpacing: -0.2 },
  dateCount:        { fontSize: rf(11.5), fontWeight: "600", marginTop: 1 },
  viewAllBtn:       { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: rs(10), paddingVertical: rs(6), borderRadius: 10, borderWidth: 1, borderColor: NEON_PURPLE + "45", backgroundColor: NEON_PURPLE + "12" },
  viewAllText:      { fontSize: rf(12.5), fontWeight: "700", color: NEON_PURPLE },
  carousel:         { paddingRight: rs(2), paddingBottom: rs(2), alignItems: "stretch" },
  carouselCard:     { flex: 1 },

  // List
  list:             { padding: rs(14), gap: 12 },
  loadingBox:       { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyBox:         { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  emptyTitle:       { fontSize: rf(18), fontWeight: "800", textAlign: "center" },
  emptyText:        { fontSize: rf(15), textAlign: "center" },
  emptySubText:     { fontSize: rf(13), textAlign: "center", paddingHorizontal: rs(24), lineHeight: rf(19) },
  refreshBtn:       { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: rs(20), paddingVertical: rs(10), borderRadius: 12, borderWidth: 1, borderColor: NEON_PURPLE + "50", backgroundColor: NEON_PURPLE + "15" },
  refreshText:      { fontSize: rf(14), fontWeight: "600", color: NEON_PURPLE },

  // Card
  card:             { borderRadius: 18, borderWidth: 1, overflow: "hidden", gap: 0 },
  cardHero:         { height: rs(110) },
  cardHeroImg:      { opacity: 0.45, borderRadius: 0 },
  cardHeroGrad:     { flex: 1, justifyContent: "space-between", padding: rs(12) },
  cardTopRow:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTopLeft:      { flexDirection: "row", alignItems: "center", gap: 7, flex: 1 },
  cardTitleRow:     { flexDirection: "row", alignItems: "center", gap: 10 },
  cardTitleWrap:    { flex: 1, minWidth: 0 },
  cardTitle:        { fontSize: rf(17), fontWeight: "900", letterSpacing: -0.3 },

  // Badges
  liveBadge:        { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FF000025", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4, borderWidth: 1, borderColor: "#FF000060" },
  liveBadgeText:    { fontSize: rf(10), fontWeight: "900", color: "#FF4444", letterSpacing: 0.6 },
  finishedBadge:    { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1.5, borderColor: NEON_GREEN },
  finishedBadgeText:{ fontSize: rf(11), fontWeight: "900", color: NEON_GREEN, letterSpacing: 0.6 },
  entryBadge:       { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1 },
  entryBadgeRow:    { flexDirection: "row", alignItems: "center", gap: 4 },
  entryBadgeIcon:   { width: 12, height: 12 },
  entryBadgeText:   { fontSize: rf(11), fontWeight: "800" },
  spectBadge:       { flexDirection: "row", alignItems: "center", gap: 3 },
  spectText:        { fontSize: rf(11), color: MUTED },

  // Date on finished cards
  dateBadge:        { backgroundColor: "#00000050", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, alignItems: "center", borderWidth: 1, borderColor: "#FFFFFF20" },
  dateMonth:        { fontSize: rf(9), fontWeight: "900", color: MUTED, letterSpacing: 0.5 },
  dateDay:          { fontSize: rf(16), fontWeight: "900", color: "#FFFFFF", lineHeight: 18 },

  // Reward beside challenge heading
  winnerBlock:      { alignItems: "flex-end", flexShrink: 0, maxWidth: "42%" },
  winnerLabel:      { fontSize: rf(9), fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  winnerCoinRow:    { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  winnerCoinNum:    { fontSize: rf(16), fontWeight: "900", color: "#FFD700" },
  winnerCoinsSub:   { fontSize: rf(9) },
  winnerPrize:      { fontSize: rf(15), fontWeight: "900", color: "#FFD700", marginTop: 2 },

  // Stats row
  statsRow:         { flexDirection: "row", alignItems: "center", paddingHorizontal: rs(14), paddingVertical: rs(12), borderBottomWidth: 1 },
  endsPill: {
    marginHorizontal: rs(14),
    marginTop: rs(10),
    marginBottom: rs(4),
    paddingHorizontal: rs(14),
    paddingVertical: rs(9),
    borderRadius: 999,
    backgroundColor: "#1E1535",
    borderWidth: 1,
    borderColor: "#3D2A6B",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  endsPillText: {
    color: "#F5F3FF",
    fontSize: rf(11.5),
    fontWeight: "600",
    textAlign: "center",
    flexShrink: 1,
  },
  statItem:         { flex: 1, alignItems: "center" },
  statValueRow:     { flexDirection: "row", alignItems: "center", gap: 4 },
  statValue:        { fontSize: rf(13), fontWeight: "800" },
  prizeStatValue:   {
    fontSize: rf(16),
    fontWeight: "900",
    textShadowColor: "rgba(245,158,11,0.65)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  statLabel:        { fontSize: rf(10), marginTop: 2 },
  statDiv:          { width: 1, height: 30 },
  finishedTimeStack: { alignItems: "center", justifyContent: "center", width: "100%" },
  finishedTimeLabel: { fontSize: rf(9), fontWeight: "600", lineHeight: rf(11) },
  finishedTimeLabelGap: { marginTop: 3 },
  finishedTimeValue: { fontSize: rf(11), fontWeight: "800", lineHeight: rf(13) },

  // Players
  playersSection:   { paddingHorizontal: rs(12), paddingVertical: rs(10), gap: 10, borderBottomWidth: 1 },
  playerRow:        { flexDirection: "row", alignItems: "center", gap: 8 },
  rankCircle:       { width: rs(26), height: rs(26), borderRadius: rs(13), borderWidth: 1.5, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  rankCircleText:   { fontSize: rf(11), fontWeight: "900" },
  avatar:           { width: rs(30), height: rs(30), borderRadius: rs(15), borderWidth: 1.5, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  avatarText:       { fontSize: rf(12), fontWeight: "800" },
  playerMid:        { flex: 1, gap: 4 },
  playerNameRow:    { flexDirection: "row", alignItems: "center", gap: 4 },
  playerName:       { fontSize: rf(13), fontWeight: "700", flexShrink: 1 },
  playerFlag:       { fontSize: rf(13) },
  tag:              { borderRadius: 5, borderWidth: 1, paddingHorizontal: 5, paddingVertical: 1 },
  tagText:          { fontSize: rf(9), fontWeight: "900" },
  progressTrack:    { height: 3, borderRadius: 2, overflow: "hidden" },
  progressFill:     { height: "100%", borderRadius: 2 },
  playerBelowBar:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  playerPrizeRow:   { flexDirection: "row", alignItems: "center", gap: 3 },
  playerPrizeText:  { fontSize: rf(10), fontWeight: "700" },
  playerRight:      { alignItems: "flex-end", gap: 2, minWidth: 54 },
  playerStepsRow:   { flexDirection: "row", alignItems: "center", gap: 3 },
  playerSteps:      { fontSize: rf(12), fontWeight: "700" },
  playerStepsUnit:  { fontSize: rf(10), fontWeight: "500" },
  addFriendBtn:     { width: rs(28), height: rs(28), borderRadius: rs(14), borderWidth: 1, alignItems: "center", justifyContent: "center", flexShrink: 0 },

  // Footer (live only)
  reactFooter:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: rs(14), paddingVertical: rs(10), borderBottomWidth: 1 },
  reactRow:         { flexDirection: "row", gap: 12 },
  reactItem:        { fontSize: rf(12) },
  footerPrize:      { fontSize: rf(12), fontWeight: "700" },
  prizeFooterValue: {
    fontSize: rf(14),
    fontWeight: "900",
    textShadowColor: "rgba(245,158,11,0.55)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 5,
  },

  // Finished race — reactions inside View Results row
  finishedReactRow:   { flexDirection: "row", alignItems: "center", gap: 6 },
  finishedReactBtn:   { paddingHorizontal: 6, paddingVertical: 4, borderRadius: 8 },
  heartRow:           { flexDirection: "row", alignItems: "center", gap: 5 },
  finishedReactItem:  { fontSize: rf(12) },
  viewResultsRight:   { flexDirection: "row", alignItems: "center", gap: 6 },

  // CTA button
  ctaBtn:           { overflow: "hidden", marginTop: "auto" },
  ctaGrad:          { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: rs(14) },
  ctaText:          { fontSize: rf(15), fontWeight: "900", letterSpacing: 0.3 },
});
