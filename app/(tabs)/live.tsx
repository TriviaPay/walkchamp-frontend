import { LinearGradient } from "expo-linear-gradient";
import { BlueShoe } from "@/components/BlueShoe";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { SkeletonList, SkeletonRaceRow } from "@/components/SkeletonRows";
import { screenCache } from "@/utils/screenCache";
import { apiFetchAllowed, markApiFetched } from "@/utils/apiRequestCoordinator";
import { useScreenMountPerf } from "@/hooks/useScreenMountPerf";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  Dimensions,
  FlatList,
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
import { AppAlert } from "@/components/AppAlert";
import { Image } from "expo-image";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/context/ThemeContext";
import { useTabBarHeight } from "@/hooks/useTabBarHeight";
import { usePresence } from "@/context/PresenceContext";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import { connectPusher, subscribeToChannel, CHANNELS, EVENTS } from "@/services/realtimeService";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { rf, rs } from "@/utils/responsive";
import { PublicProfileModal } from "@/components/PublicProfileModal";
import type { PublicProfileInitialData } from "@/components/PublicProfileModal";
import { TrackThemeImageBackground, prefetchTrackThemes, prefetchTrackTheme } from "@/components/TrackThemeImage";
import type { TrackThemeImageSet } from "@/utils/trackThemeMedia";

// ── Constants ─────────────────────────────────────────────────────────────────
const NEON_PURPLE  = "#7C3AED";
const NEON_GREEN   = "#22C55E";
const CARD_BG      = "#0D0D1E";
const MUTED        = "#8090A8";

// Horizontal carousel card width — leaves ~15% peek of the next card so users
// can tell the row scrolls sideways. Capped so it never gets absurd on tablets.
const CAROUSEL_CARD_W = Math.min(340, Math.round(Dimensions.get("window").width * 0.85));

const FREE_TIER_COINS = [50, 30, 20];
function calcFreeCoins(rank: number, isTied: boolean, tieGroupSize: number): number {
  if (isTied && tieGroupSize > 1) {
    const pool = FREE_TIER_COINS.slice(0, Math.min(tieGroupSize, FREE_TIER_COINS.length)).reduce((a, b) => a + b, 0);
    return Math.floor(pool / tieGroupSize);
  }
  return FREE_TIER_COINS[rank - 1] ?? 0;
}

const FILTERS = ["All", "Free", "Coins Battle", "Cash Challenges", "Sponsored Events"] as const;
type FilterType = (typeof FILTERS)[number];

const CASH_ENTRY_TYPES = new Set([
  "paid_1", "paid_3", "paid_5", "paid_usd", "cash", "usd",
  "$1", "$3", "$5", "USD Entry",
]);

/** All paid cash entry races (any amount), excluding sponsored / free / coins. */
export function isCashChallengeRace(
  race: Pick<LiveRace, "entryType" | "type"> & { entryAmountCents?: number },
): boolean {
  if (race.type === "sponsored") return false;
  const et = (race.entryType ?? "").trim();
  const lower = et.toLowerCase();
  if (lower === "free" || lower === "coins_battle" || lower === "coins battle") return false;
  if (CASH_ENTRY_TYPES.has(et) || CASH_ENTRY_TYPES.has(lower)) return true;
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
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatFinishedAt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  // Time only — the calendar date is already shown in the date-group header.
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function computeElapsed(startedAt: string | null, completedAt?: string | null): number {
  if (!startedAt) return 0;
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  return Math.floor((end - new Date(startedAt).getTime()) / 1000);
}

function filterToParam(filter: FilterType): string {
  if (filter === "All") return "all";
  if (filter === "Free") return "free";
  if (filter === "Coins Battle") return "coins_battle";
  if (filter === "Cash Challenges") return "cash_challenges";
  if (filter === "Sponsored Events") return "sponsored";
  return "all";
}

function applyChipFilter(races: LiveRace[], filter: FilterType): LiveRace[] {
  if (filter === "Cash Challenges") return races.filter(isCashChallengeRace);
  return races;
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
  };
}

const FINISHED_PAGE_SIZE = 15;

async function fetchLiveChallenges(filter: FilterType): Promise<{
  live: LiveRace[];
  finished: LiveRace[];
  ok: boolean;
}> {
  const fp = filterToParam(filter);
  try {
    const [liveRes, finishedRes] = await Promise.all([
      authFetch(`/api/races?status=in_progress&filter=${encodeURIComponent(fp)}&limit=30`),
      authFetch(`/api/races?status=completed&filter=${encodeURIComponent(fp)}&limit=${FINISHED_PAGE_SIZE}&offset=0`),
    ]);
    if (!liveRes.ok && !finishedRes.ok) return { live: [], finished: [], ok: false };
    const liveData = liveRes.ok ? await liveRes.json() as { races?: Record<string, unknown>[] } : { races: [] };
    const finishedData = finishedRes.ok ? await finishedRes.json() as { races?: Record<string, unknown>[] } : { races: [] };
    const seenIds = new Set<string>();
    const live = applyChipFilter((liveData.races ?? []).filter((r) => {
      if (seenIds.has(r.id as string)) return false;
      seenIds.add(r.id as string);
      return true;
    }).map(mapRaceRow), filter);
    const finished = applyChipFilter((finishedData.races ?? []).filter((r) => {
      if (seenIds.has(r.id as string)) return false;
      seenIds.add(r.id as string);
      return true;
    }).map(mapRaceRow), filter);
    return { live, finished, ok: true };
  } catch {
    return { live: [], finished: [], ok: false };
  }
}

async function fetchMoreFinished(filter: FilterType, offset: number): Promise<LiveRace[]> {
  const fp = filterToParam(filter);
  try {
    const res = await authFetch(
      `/api/races?status=completed&filter=${encodeURIComponent(fp)}&limit=${FINISHED_PAGE_SIZE}&offset=${offset}`,
    );
    if (!res.ok) return [];
    const data = await res.json() as { races?: Record<string, unknown>[] };
    return applyChipFilter((data.races ?? []).map(mapRaceRow), filter);
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
  maxPlayers: number;
  targetSteps: number;
  isHost: boolean;
  startedAt: string | null;
}

interface ScheduledEvt {
  id: string;
  title: string;
  status: string;
  scheduledStartAt: string | null;
  prizePoolCents: number;
  targetSteps: number;
  registeredCount: number;
  maxSlots: number;
  isRegistered?: boolean;
  isActive?: boolean;
}

async function fetchMyActiveRace(): Promise<MyActiveRace | null> {
  try {
    const res = await authFetch(`/api/races/my-active`);
    if (!res.ok) return null;
    const data = await res.json() as { race?: MyActiveRace };
    return data.race ?? null;
  } catch {
    return null;
  }
}

// ── Palette cycling for sponsored event cards ──────────────────────────────────
const SPONSORED_PALETTES = [
  { grad: ["#0e0025", "#1d004e", "#0a0818"] as [string, string, string], border: "#7C3AFF55", bar: "#7C3AFF", glow: "#7C3AFF", btnGrad: ["#5B21B6", "#7C3AFF", "#C47BFF"] as [string, string, string] },
  { grad: ["#001a1a", "#003344", "#050f1a"] as [string, string, string], border: "#00B4FF45", bar: "#00B4FF", glow: "#00B4FF", btnGrad: ["#007ACC", "#00B4FF", "#00E5C8"] as [string, string, string] },
  { grad: ["#1a0800", "#2e1200", "#0f0a00"] as [string, string, string], border: "#FF8C0045", bar: "#FF8C00", glow: "#FF8C00", btnGrad: ["#CC4400", "#FF6600", "#FFB000"] as [string, string, string] },
];
const COIN_IMG_SRC = require("../../assets/images/game-coin.png");
const BLUE_SHOE_SRC = require("../../assets/images/footstep.png");

// ── Sponsored event card (premium) ────────────────────────────────────────────
function SponsoredEventRow({ evt, index }: { evt: ScheduledEvt; index: number }) {
  const isLive      = evt.status === "in_progress";
  const isCompleted = evt.status === "completed";
  const isUpcoming  = evt.status === "scheduled";
  const isFeatured  = index === 0;

  const palette = SPONSORED_PALETTES[index % SPONSORED_PALETTES.length];
  const statusLabel = isLive ? "LIVE NOW" : isCompleted ? "COMPLETED" : "UPCOMING";
  const statusColor = isLive ? NEON_GREEN : isCompleted ? "#F59E0B" : palette.glow;

  const isMorning = evt.title.toLowerCase().includes("morning");

  const dateStr = evt.scheduledStartAt
    ? new Date(evt.scheduledStartAt).toLocaleString([], {
        weekday: "short", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit",
      })
    : "Date TBD";

  const prizeAmount  = (evt.prizePoolCents / 100).toFixed(0);
  const hasPrize     = evt.prizePoolCents > 0;
  const slotsLeft    = Math.max(0, evt.maxSlots - evt.registeredCount);
  const isFull       = slotsLeft === 0;
  const fillPct      = evt.maxSlots > 0
    ? Math.min(100, Math.round((evt.registeredCount / evt.maxSlots) * 100))
    : 0;

  return (
    <LinearGradient
      colors={palette.grad}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        marginBottom: 16,
        borderRadius: 22, borderWidth: 1.5,
        borderColor: palette.border, overflow: "hidden",
      }}
    >
      {/* FEATURED diagonal banner */}
      {isFeatured && (
        <View style={{
          position: "absolute", top: 14, left: -22, zIndex: 10,
          backgroundColor: palette.glow, paddingHorizontal: 28, paddingVertical: 4,
          transform: [{ rotate: "-38deg" }],
        }}>
          <Text style={{ color: "#FFF", fontSize: rf(9), fontWeight: "800", letterSpacing: 1 }}>FEATURED</Text>
        </View>
      )}

      <View style={{ padding: 18 }}>
        {/* Header row: left circle icon + title + status */}
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 14, marginBottom: 16 }}>
          {/* Circle icon */}
          <View style={{
            width: 60, height: 60, borderRadius: 30,
            borderWidth: 2, borderColor: palette.glow + "AA",
            backgroundColor: palette.glow + "20",
            alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            {isMorning
              ? <Image source={BLUE_SHOE_SRC} style={{ width: 34, height: 34 }} contentFit="contain" />
              : <Feather name="moon" size={26} color={palette.glow} />}
          </View>

          {/* Title + date */}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <Text style={{ color: "#FFF", fontSize: rf(16), fontWeight: "900", letterSpacing: -0.3, flex: 1, marginRight: 8 }}
                numberOfLines={2}>
                {evt.title}
              </Text>
              {/* Status pill */}
              <View style={{
                paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8,
                backgroundColor: statusColor + "25", borderWidth: 1,
                borderColor: statusColor + "70", flexDirection: "row",
                alignItems: "center", gap: 4, flexShrink: 0,
              }}>
                {isLive && <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: NEON_GREEN }} />}
                <Text style={{ color: statusColor, fontSize: rf(9.5), fontWeight: "800", letterSpacing: 0.5 }}>
                  {statusLabel}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5 }}>
              <Feather name="calendar" size={11} color={MUTED} />
              <Text style={{ color: MUTED, fontSize: rf(12) }}>{dateStr}</Text>
            </View>
          </View>
        </View>

        {/* Stats tiles row */}
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
          {hasPrize && (
            <View style={{
              flex: 1, backgroundColor: "#F59E0B18", borderRadius: 14,
              paddingVertical: 10, paddingHorizontal: 6,
              borderWidth: 1, borderColor: "#F59E0B35", alignItems: "center",
            }}>
              <Text style={{ fontSize: rf(18) }}>🎁</Text>
              <Text style={{ color: "#F59E0B", fontSize: rf(15), fontWeight: "900", marginTop: 2 }}>
                $5 each
              </Text>
              <Text style={{ color: MUTED, fontSize: rf(9.5), marginTop: 2, fontWeight: "600", letterSpacing: 0.3 }}>2 WINNERS</Text>
            </View>
          )}
          <View style={{
            flex: 1, backgroundColor: palette.glow + "14", borderRadius: 14,
            paddingVertical: 10, paddingHorizontal: 6,
            borderWidth: 1, borderColor: palette.glow + "30", alignItems: "center",
          }}>
            <Image source={BLUE_SHOE_SRC} style={{ width: 26, height: 26 }} contentFit="contain" />
            <Text style={{ color: "#FFF", fontSize: rf(15), fontWeight: "900", marginTop: 4 }}>
              {evt.targetSteps >= 1000 ? `${(evt.targetSteps / 1000).toFixed(0)}K` : `${evt.targetSteps}`}
            </Text>
            <Text style={{ color: MUTED, fontSize: rf(9.5), marginTop: 2, fontWeight: "600", letterSpacing: 0.3 }}>STEPS GOAL</Text>
          </View>
          <View style={{
            flex: 1,
            backgroundColor: isFull ? "#EF444414" : "#FFFFFF0A",
            borderRadius: 14, paddingVertical: 10, paddingHorizontal: 6,
            borderWidth: 1, borderColor: isFull ? "#EF444430" : "#FFFFFF18", alignItems: "center",
          }}>
            <Feather name="users" size={24} color={isFull ? "#EF4444" : palette.glow} />
            <Text style={{ color: isFull ? "#EF4444" : "#FFF", fontSize: rf(15), fontWeight: "900", marginTop: 4 }}>
              {evt.registeredCount}/{evt.maxSlots}
            </Text>
            <Text style={{ color: MUTED, fontSize: rf(9.5), marginTop: 2, fontWeight: "600", letterSpacing: 0.3 }}>
              {isFull ? "FULL" : "REGISTERED"}
            </Text>
          </View>
        </View>

        {/* Progress bar + % */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <Feather name="users" size={12} color={MUTED} />
          <Text style={{ color: MUTED, fontSize: rf(11) }}>
            {isFull ? "Event is full" : `${slotsLeft} slot${slotsLeft !== 1 ? "s" : ""} remaining`}
          </Text>
          <View style={{ flex: 1, height: 5, backgroundColor: "#FFFFFF10", borderRadius: 3, overflow: "hidden" }}>
            <View style={{
              height: 5, width: `${fillPct}%`,
              backgroundColor: isFull ? "#EF4444" : palette.bar, borderRadius: 3,
            }} />
          </View>
          <Text style={{ color: MUTED, fontSize: rf(11), minWidth: 30, textAlign: "right" }}>{fillPct}%</Text>
        </View>

        {/* Action buttons */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <TouchableOpacity
            style={{
              flex: 1, paddingVertical: 11, borderRadius: 12,
              backgroundColor: "#FFFFFF0F", borderWidth: 1, borderColor: "#FFFFFF20",
              alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6,
            }}
            onPress={() => router.push("/sponsored-events")}
            activeOpacity={0.75}
          >
            <Text style={{ color: "#FFF", fontSize: rf(13), fontWeight: "700" }}>View Details</Text>
            <Feather name="chevron-right" size={14} color="#FFF" />
          </TouchableOpacity>
          {isLive && (evt.isActive || !evt.isRegistered) ? (
            <LinearGradient
              colors={evt.isActive ? (["#7C3AFF", "#C47BFF"] as [string, string]) : (["#00C853", "#007A33"] as [string, string])}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ flex: 1.3, borderRadius: 12 }}
            >
              <TouchableOpacity
                style={{ paddingVertical: 11, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 }}
                onPress={() => router.push({ pathname: "/race/live-detail", params: { id: evt.id } })}
                activeOpacity={0.8}
              >
                <Feather name={evt.isActive ? "zap" : "radio"} size={14} color="#FFF" />
                <Text style={{ color: "#FFF", fontSize: rf(13), fontWeight: "800" }}>
                  {evt.isActive ? "Continue Race" : "Watch Live"}
                </Text>
              </TouchableOpacity>
            </LinearGradient>
          ) : (
            <LinearGradient
              colors={palette.btnGrad}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ flex: 1.3, borderRadius: 12 }}
            >
              <TouchableOpacity
                style={{ paddingVertical: 11, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 }}
                onPress={() => router.push("/sponsored-events")}
                activeOpacity={0.8}
              >
                <Text style={{ color: "#FFF", fontSize: rf(13), fontWeight: "800" }}>
                  {isCompleted ? "View Results" : "Register Now"}
                </Text>
                <Feather name="chevron-right" size={14} color="#FFF" />
              </TouchableOpacity>
            </LinearGradient>
          )}
        </View>
      </View>
    </LinearGradient>
  );
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
  return (
    <View style={st.endsPill}>
      <Feather name="calendar" size={13} color="#FFFFFF" />
      <Text style={st.endsPillText} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function RaceCardBase({
  race,
  colors,
  isMyRace,
  isHost,
  myUsername,
  onAvatarPress,
  style,
}: {
  race: LiveRace;
  colors: ReturnType<typeof useColors>;
  isMyRace?: boolean;
  isHost?: boolean;
  myUsername?: string;
  onAvatarPress?: (p: LiveRacePlayer) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { isDark } = useTheme();
  const isFinished = race.status === "completed";

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
    prefetchTrackTheme(trackMedia, "full");
    router.push({
      pathname: "/race/live-detail",
      params: { id: race.id, trackLayout: race.trackLayout },
    });
  }, [race.id, race.trackLayout, race.imageSet, race.imageUrl, race.assetVersion, race.width, race.height]);

  const entryColor: Record<string, string> = {
    Free: NEON_GREEN,
    "$1": "#60A5FA",
    "$3": "#A78BFA",
    "$5": colors.gold,
    "USD Entry": "#60A5FA",
    coins_battle: "#F59E0B",
  };
  const isCoinsBattle = race.entryType === "coins_battle";
  const isSponsored = race.type === "sponsored";
  const ec = isSponsored ? "#F59E0B" : (entryColor[race.entryType] ?? NEON_PURPLE);

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
    ? `$${(race.prizePoolCents / 100).toFixed(0)} pool`
    : isCoinsBattle && race.coinEntryAmount > 0
    ? `${(race.coinEntryAmount * race.playerCount).toLocaleString()} coins`
    : race.prizePool > 0 ? `$${race.prizePool.toFixed(2)}` : null;
  const elapsedLabel = isFinished ? "Duration" : "Elapsed";
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
  const totalFreeCoins = FREE_TIER_COINS.slice(0, numWin).reduce((a, b) => a + b, 0);
  // Sponsored events show cash prize, not coins
  const rewardDisplay = (!isSponsored && race.entryType === "Free") ? (totalFreeCoins > 0 ? totalFreeCoins : 50) : null;
  const firstPlacePrize = prizePoolDisplay;

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
        imageStyle={{ opacity: isDark ? 0.45 : 0.18, borderRadius: 0 }}
      >
        <LinearGradient
          colors={["transparent", colors.card + "EE", colors.card]}
          locations={isDark ? [0, 0.7, 1] : [0, 0.35, 1]}
          style={st.cardHeroGrad}
        >
          {/* Top row: badges + spectator */}
          <View style={st.cardTopRow}>
            <View style={st.cardTopLeft}>
              {isFinished ? (
                <View style={[st.finishedBadge, !isDark && { backgroundColor: "rgba(0,0,0,0.06)" }]}>
                  <Feather name="check-circle" size={10} color={NEON_GREEN} />
                  <Text style={st.finishedBadgeText}>FINISHED</Text>
                </View>
              ) : (
                <View style={st.liveBadge}>
                  <LiveDot />
                  <Text style={st.liveBadgeText}>LIVE</Text>
                </View>
              )}
              <View style={[st.entryBadge, { borderColor: ec + "70", backgroundColor: ec + "18" }]}>
                <Text style={[st.entryBadgeText, { color: ec }]}>
                  {isSponsored ? "🏆 Sponsored" : isCoinsBattle ? "⚔️ Coins" : race.entryType}
                </Text>
              </View>
              {isFinished && race.completedAt && (
                <Text
                  style={[
                    st.cardTimestamp,
                    !isDark && { backgroundColor: "rgba(0,0,0,0.06)", color: colors.mutedForeground },
                  ]}
                >
                  {formatFinishedAt(race.completedAt)}
                </Text>
              )}
            </View>
            <View style={st.spectBadge}>
              <Feather name="eye" size={11} color={MUTED} />
              <Text style={st.spectText}>{isFinished ? race.spectatorCount + race.playerCount : race.spectatorCount}</Text>
            </View>
          </View>

          {/* Title row */}
          <View style={st.cardTitleRow}>
            <View style={st.cardTitleWrap}>
              <Text style={[st.cardTitle, { color: colors.foreground }]} numberOfLines={1}>{race.title}</Text>
            </View>
            {/* Reward badge — top-right, finished only */}
            {isFinished && (rewardDisplay !== null || firstPlacePrize) && (
              <View style={st.winnerBlock}>
                <Text style={[st.winnerLabel, { color: colors.mutedForeground }]}>Reward</Text>
                {rewardDisplay !== null ? (
                  <>
                    <View style={st.winnerCoinRow}>
                      <Image
                        source={require("../../assets/images/game-coin.png")}
                        style={{ width: 18, height: 18 }}
                      />
                      <Text style={st.winnerCoinNum}>{rewardDisplay}</Text>
                    </View>
                    <Text style={[st.winnerCoinsSub, { color: colors.mutedForeground }]}>coins total</Text>
                  </>
                ) : firstPlacePrize ? (
                  <Text style={st.winnerPrize}>{firstPlacePrize}</Text>
                ) : null}
              </View>
            )}
          </View>
        </LinearGradient>
      </TrackThemeImageBackground>

      {/* ── Stats row ───────────────────────────────────────────────────── */}
      <View style={[st.statsRow, { borderBottomColor: colors.border }]}>
        <View style={st.statItem}>
          <View style={st.statValueRow}>
            <Feather name="users" size={11} color={colors.mutedForeground} />
            <Text style={[st.statValue, { color: colors.foreground }]}>{race.playerCount}/{race.maxPlayers}</Text>
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
          <View style={st.statValueRow}>
            <Feather name="clock" size={11} color={colors.mutedForeground} />
            <Text style={[st.statValue, { color: colors.foreground }]}>{formatElapsed(race.elapsedSeconds)}</Text>
          </View>
          <Text style={[st.statLabel, { color: colors.mutedForeground }]}>{elapsedLabel}</Text>
        </View>
        {prizePoolDisplay && (!isFinished || isCoinsBattle || isSponsored) && (
          <>
            <View style={[st.statDiv, { backgroundColor: colors.border }]} />
            <View style={st.statItem}>
              <View style={st.statValueRow}>
                <Text style={{ fontSize: 11 }}>🏆</Text>
                <Text style={[st.statValue, { color: colors.gold }]}>{prizePoolDisplay}</Text>
              </View>
                <Text style={[st.statLabel, { color: colors.gold + "AA" }]}>Prize Pool</Text>
            </View>
          </>
        )}
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
            const coins = race.entryType === "Free" && p.rank <= numWin
              ? calcFreeCoins(p.rank, p.isTied ?? false, p.tieGroupSize ?? 1)
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
                      {race.entryType === "Free" ? (
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

      {/* ── Reactions + Prize footer (live only) ────────────────────────── */}
      {!isFinished && (
        <View style={[st.reactFooter, { borderBottomColor: colors.border }]}>
          <View style={st.reactRow}>
            {["🔥", "👏", "👑"].map((r) => (
              <Text key={r} style={[st.reactItem, { color: colors.mutedForeground }]}>
                {r} {(race.reactionCounts[r] ?? 0) > 99 ? "99+" : (race.reactionCounts[r] ?? 0)}
              </Text>
            ))}
          </View>
          {prizePoolDisplay && (
            <Text style={[st.footerPrize, { color: colors.gold }]}>🏆 Prize Pool {prizePoolDisplay}</Text>
          )}
        </View>
      )}

      {/* ── CTA button ──────────────────────────────────────────────────── */}
      {isFinished ? (
        <TouchableOpacity
          onPress={openLiveRace}
          activeOpacity={0.85}
          style={st.ctaBtn}
        >
          <LinearGradient
            colors={[NEON_GREEN + "25", NEON_GREEN + "10"]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={[st.ctaGrad, { borderWidth: 1, borderColor: NEON_GREEN + "60", justifyContent: "space-between", paddingHorizontal: 16 }]}
          >
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
            <View style={st.viewResultsRight}>
              <Feather name="award" size={15} color={NEON_GREEN} />
              <Text style={[st.ctaText, { color: NEON_GREEN }]}>View Results</Text>
            </View>
            <View style={st.finishedReactBtn} />
          </LinearGradient>
        </TouchableOpacity>
      ) : isMyRace ? (
        <TouchableOpacity
          onPress={openLiveRace}
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
          onPress={openLiveRace}
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
  onAvatarPress,
  onViewAll,
  showTrailingLoader,
}: {
  group: DateGroup<LiveRace>;
  origin: RaceOrigin;
  colors: ReturnType<typeof useColors>;
  myRace: MyActiveRace | null;
  myUsername?: string;
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
        removeClippedSubviews={false}
      >
        {group.races.map((item) => (
          <View key={item.id} style={{ width: CAROUSEL_CARD_W, marginRight: rs(12) }}>
            <RaceCard
              race={item}
              colors={colors}
              isMyRace={item.id === myRace?.id}
              isHost={myRace?.isHost}
              myUsername={myUsername}
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
  const { counts, formatCount } = usePresence();
  const { user } = useAuth();
  const tabBarHeight = useTabBarHeight();
  const [activeFilter, setActiveFilter] = useState<FilterType>("All");
  const [liveChallenges, setLiveChallenges] = useState<LiveRace[]>([]);
  const [finishedChallenges, setFinishedChallenges] = useState<LiveRace[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [finishedOffset, setFinishedOffset] = useState(FINISHED_PAGE_SIZE);
  const [hasMoreFinished, setHasMoreFinished] = useState(true);
  const [myRace, setMyRace] = useState<MyActiveRace | null>(null);
  const [scheduledEvents,  setScheduledEvents]  = useState<ScheduledEvt[]>([]);
  const [scheduledLoading, setScheduledLoading] = useState(false);
  // True after the first successful fetch — subsequent filter switches skip the skeleton.
  const scheduledLoadedRef = useRef(false);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveChallengesRef = useRef<LiveRace[]>([]);
  useEffect(() => { liveChallengesRef.current = liveChallenges; }, [liveChallenges]);

  // Warm full-size theme images while browsing the list so live race opens instantly.
  useEffect(() => {
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
  }, [liveChallenges]);
  const loadRef = useRef<() => Promise<void>>(() => Promise.resolve());
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
    try {
      const cacheKey = `screen_live_${activeFilter}`;

      // ── 1. Show cached data immediately (in-memory hit is synchronous) ──────
      let cached = screenCache.getSync<{ live: LiveRace[]; finished: LiveRace[] }>(cacheKey);
      // First app launch after a kill: warm mem from disk (fast, ~20 ms)
      if (!cached) cached = await screenCache.get<{ live: LiveRace[]; finished: LiveRace[] }>(cacheKey);
      if (cached) {
        setLiveChallenges(cached.live);
        setFinishedChallenges(cached.finished);
        setFinishedOffset(FINISHED_PAGE_SIZE);
        setHasMoreFinished(cached.finished.length >= FINISHED_PAGE_SIZE);
        setLoading(false); // clear spinner — fresh fetch happens silently below
      }

      // ── 2. Fetch fresh data in the background ────────────────────────────────
      const [{ live, finished, ok }, myRaceData] = await Promise.all([
        fetchLiveChallenges(activeFilter),
        fetchMyActiveRace(),
      ]);
      if (ok) {
        setLiveChallenges(live);
        setFinishedChallenges(finished);
        setFinishedOffset(FINISHED_PAGE_SIZE);
        setHasMoreFinished(finished.length >= FINISHED_PAGE_SIZE);
        // ── 3. Persist fresh data so the next open is instant ─────────────────
        void screenCache.set(cacheKey, { live, finished });
      }
      setMyRace(myRaceData);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, [activeFilter]);

  const loadMoreFinished = useCallback(async () => {
    if (loadingMore || !hasMoreFinished) return;
    setLoadingMore(true);
    const more = await fetchMoreFinished(activeFilter, finishedOffset);
    if (more.length > 0) {
      const existingIds = new Set(finishedChallenges.map((r) => r.id));
      const newRaces = more.filter((r) => !existingIds.has(r.id));
      setFinishedChallenges((prev) => [...prev, ...newRaces]);
      setFinishedOffset((prev) => prev + more.length);
    }
    if (more.length < FINISHED_PAGE_SIZE) setHasMoreFinished(false);
    setLoadingMore(false);
  }, [activeFilter, finishedOffset, finishedChallenges, loadingMore, hasMoreFinished]);
  useEffect(() => { loadRef.current = load; }, [load]);

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

  const fetchScheduledEvents = useCallback(async () => {
    // Show skeleton only on the very first load — subsequent filter switches
    // silently refresh the already-visible list with no flicker.
    if (!scheduledLoadedRef.current) setScheduledLoading(true);
    try {
      const res = await authFetch(`/api/sponsored-events`);
      if (res.ok) {
        const d = await res.json() as { events?: ScheduledEvt[] };
        setScheduledEvents(d.events ?? []);
        scheduledLoadedRef.current = true;
      }
    } catch {} finally {
      setScheduledLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeFilter === "Sponsored Events") void fetchScheduledEvents();
  }, [activeFilter, fetchScheduledEvents]);

  useEffect(() => {
    // Only show the full spinner if there is no cached data for this filter yet.
    // When cache exists, load() shows it instantly and fetches fresh silently.
    if (screenCache.getSync(`screen_live_${activeFilter}`) === null) setLoading(true);
    void load();
  }, [load, activeFilter]);

  useEffect(() => {
    // Safety poll at 60 s. Pusher pushes real-time updates for active races so
    // this interval only acts as a fallback (missed events, reconnects, etc.).
    // Previously 10 s — reduced 6× to cut redundant network traffic.
    const id = setInterval(() => { void load(); }, 60_000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    elapsedTimerRef.current = setInterval(() => {
      setLiveChallenges((prev) =>
        prev.map((race) => {
          if (race.status !== "in_progress") return race;
          return { ...race, elapsedSeconds: race.elapsedSeconds + 1 };
        })
      );
    }, 1000);
    return () => {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    connectPusher();
    const handlers: Array<() => void> = [];
    for (const race of liveChallenges) {
      const channelName = CHANNELS.liveRace(race.id);
      const channel = subscribeToChannel(channelName);
      if (!channel) continue;
      const raceId = race.id;
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
        setLiveChallenges((prev) => prev.filter((r) => r.id !== raceId));
        if (completedRace) {
          const updated = { ...completedRace, status: "completed", completedAt: new Date().toISOString() };
          setFinishedChallenges((pf) => pf.some((r) => r.id === raceId) ? pf : [updated, ...pf]);
        }
        void loadRef.current();
      };
      channel.bind(EVENTS.RACE_PROGRESS, onProgress);
      channel.bind(EVENTS.RACE_REACTION, onReaction);
      channel.bind(EVENTS.RACE_COMPLETED, onCompleted);
      handlers.push(() => {
        channel.unbind(EVENTS.RACE_PROGRESS, onProgress);
        channel.unbind(EVENTS.RACE_REACTION, onReaction);
        channel.unbind(EVENTS.RACE_COMPLETED, onCompleted);
      });
    }
    return () => handlers.forEach((h) => h());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveChallenges.map((r) => r.id).join(",")]);

  useEffect(() => {
    connectPusher();
    const channel = subscribeToChannel(CHANNELS.PRESENCE);
    if (!channel) return;
    const onRaceStarted = () => { void load(); };
    channel.bind(EVENTS.RACE_STARTED, onRaceStarted);
    return () => { channel.unbind(EVENTS.RACE_STARTED, onRaceStarted); };
  }, [load]);

  const liveCount = liveChallenges.length;
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
      },
    });
  }, [activeFilter, myRace?.id, myRace?.isHost]);

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
      { order: "asc", withinOrder: "asc" },
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
        onAvatarPress={handleAvatarPress}
        onViewAll={handleViewAll}
        showTrailingLoader={item.origin === "finished" && item.isLastFinished && loadingMore}
      />
    );
  }, [colors, myRace, user?.username, handleAvatarPress, handleViewAll, loadingMore]);

  return (
    <View style={[st.container, { paddingBottom: tabBarHeight, backgroundColor: colors.background }]}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={[st.hero, { paddingTop: safeTop, backgroundColor: colors.background }]}>
        <View style={st.heroRow}>
          <View>
            <Text style={[st.heroTitle, { color: colors.foreground }]}>Live Challenges</Text>
            <View style={st.presenceRow}>
              <Text style={st.racingDot}>●</Text>
              <Text style={[st.presenceText, { color: colors.mutedForeground }]}>{formatCount(counts.racing)} racing</Text>
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
        {FILTERS.map((f) => {
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
        (scheduledLoading && liveChallenges.length === 0 && finishedChallenges.length === 0 && scheduledEvents.length === 0) ? (
          <View style={{ paddingTop: 8 }}>
            <SkeletonList count={5} variant="race" />
          </View>
        ) : (liveChallenges.length === 0 && finishedChallenges.length === 0 && scheduledEvents.filter(e => e.status !== "cancelled").length === 0) ? (
          <View style={st.emptyBox}>
            <Feather name="calendar" size={32} color={colors.mutedForeground} />
            <Text style={[st.emptyText, { color: colors.mutedForeground }]}>No sponsored events right now.</Text>
            <TouchableOpacity style={st.refreshBtn} onPress={() => { void fetchScheduledEvents(); void load(); }}>
              <Feather name="refresh-cw" size={14} color={NEON_PURPLE} />
              <Text style={st.refreshText}>Refresh</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 12, paddingBottom: 24, paddingHorizontal: 14 }} showsVerticalScrollIndicator={false}>
            {liveChallenges.length > 0 && (
              <>
                <SectionHeader label="Live Now" sub={`${liveChallenges.length} sponsored event${liveChallenges.length !== 1 ? "s" : ""} in progress`} isFinished={false} />
                {liveChallenges.map((r) => (
                  <View key={r.id} style={{ marginBottom: 16 }}>
                    <RaceCard race={r} colors={colors} isMyRace={r.id === myRace?.id} isHost={myRace?.isHost} myUsername={user?.username} onAvatarPress={handleAvatarPress} />
                  </View>
                ))}
              </>
            )}
            {finishedChallenges.length > 0 && (
              <>
                <SectionHeader label="Recently Finished" sub="Here are the latest sponsored event results" isFinished={true} />
                {finishedChallenges.map((r) => (
                  <View key={r.id} style={{ marginBottom: 16 }}>
                    <RaceCard race={r} colors={colors} isMyRace={r.id === myRace?.id} isHost={myRace?.isHost} myUsername={user?.username} onAvatarPress={handleAvatarPress} />
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        )
      ) : loading ? (
        <View style={{ paddingTop: 8 }}>
          <SkeletonList count={5} variant="race" />
        </View>
      ) : liveCount === 0 && finishedCount === 0 ? (
        <View style={st.emptyBox}>
          <Feather name="zap-off" size={32} color={colors.mutedForeground} />
          <Text style={[st.emptyText, { color: colors.mutedForeground }]}>
            {activeFilter === "Cash Challenges"
              ? "No cash challenges available right now."
              : "No races found."}
          </Text>
          {activeFilter === "Cash Challenges" && (
            <Text style={[st.emptySubText, { color: colors.mutedForeground }]}>
              Host or join a cash challenge when one becomes available.
            </Text>
          )}
          <TouchableOpacity
            style={st.refreshBtn}
            onPress={load}
          >
            <Feather name="refresh-cw" size={14} color={NEON_PURPLE} />
            <Text style={st.refreshText}>Refresh</Text>
          </TouchableOpacity>
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
  cardTitleRow:     { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  cardTitleWrap:    { flex: 1 },
  cardTitle:        { fontSize: rf(17), fontWeight: "900", letterSpacing: -0.3 },
  cardTimestamp:    { fontSize: rf(10), color: "#C8D8E8", flexShrink: 1, backgroundColor: "rgba(0,0,0,0.50)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3, overflow: "hidden" },

  // Badges
  liveBadge:        { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FF000025", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4, borderWidth: 1, borderColor: "#FF000060" },
  liveBadgeText:    { fontSize: rf(10), fontWeight: "900", color: "#FF4444", letterSpacing: 0.6 },
  finishedBadge:    { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1.5, borderColor: NEON_GREEN },
  finishedBadgeText:{ fontSize: rf(11), fontWeight: "900", color: NEON_GREEN, letterSpacing: 0.6 },
  entryBadge:       { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1 },
  entryBadgeText:   { fontSize: rf(11), fontWeight: "800" },
  spectBadge:       { flexDirection: "row", alignItems: "center", gap: 3 },
  spectText:        { fontSize: rf(11), color: MUTED },

  // Date on finished cards
  dateBadge:        { backgroundColor: "#00000050", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, alignItems: "center", borderWidth: 1, borderColor: "#FFFFFF20" },
  dateMonth:        { fontSize: rf(9), fontWeight: "900", color: MUTED, letterSpacing: 0.5 },
  dateDay:          { fontSize: rf(16), fontWeight: "900", color: "#FFFFFF", lineHeight: 18 },

  // WINNER block
  winnerBlock:      { alignItems: "flex-end" },
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
  statLabel:        { fontSize: rf(10), marginTop: 2 },
  statDiv:          { width: 1, height: 30 },

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
