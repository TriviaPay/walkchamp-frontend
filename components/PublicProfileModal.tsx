/**
 * PublicProfileModal — shared profile popup for non-chat contexts.
 *
 * Same design as the Waiting Room player profile modal.
 * Opens from: race track, live board, leaderboard avatars.
 *
 * NOT used in Chat — do not import this in any chat screen.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ProfileAvatar } from "@/components/ProfileAvatar";
import { AppAlert } from "@/components/AppAlert";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { authFetch } from "@/utils/authFetch";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const blueShoeImg = require("@/assets/images/footstep.png") as number;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gameCoinImg = require("@/assets/images/game-coin.png") as number;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PublicProfileInitialData {
  username?: string;
  country?: string | null;
  countryFlag?: string | null;
  avatarColor?: string | null;
  avatarUrl?: string | null;
  avatarVersion?: number | null;
  isHost?: boolean;
  isCurrentUser?: boolean;
  activeTitle?: { code: string; title: string } | null;
  friendStatus?: string;
  friendRequestId?: string | null;
}

export interface WaitingRoomContext {
  raceId: string;
  roomStatus: string;
  isHostMode: boolean;
  entryType?: string;
  onParticipantRemoved: (userId: string) => void;
}

interface PublicProfileModalProps {
  visible: boolean;
  userId: string | null;
  onClose: () => void;
  /** Pre-fill from the list so the modal renders instantly before the API responds */
  initialData?: PublicProfileInitialData;
  /** Pass this only for Waiting Room avatar taps — enables the Remove from Room button */
  waitingRoomContext?: WaitingRoomContext;
}

interface ProfileData {
  username: string;
  country: string | null;
  countryFlag: string | null;
  avatarColor: string | null;
  avatarUrl: string | null;
  avatarVersion: number;
  isCurrentUser: boolean;
  isHost: boolean;
  activeTitle: { code: string; title: string } | null;
  friendStatus: string;
  friendRequestId: string | null;
}

interface PublicProfileStats {
  lifetimeSteps: number;
  coinsBalance: number;
  racesPlayed: number;
  raceWins: number;
  totalWinning: number;
  currentStreakDays: number;
}

// ── 60s in-memory stats cache ─────────────────────────────────────────────────

const statsCache = new Map<string, { stats: PublicProfileStats; at: number }>();
const CACHE_TTL = 60_000;

// ── Number formatter ──────────────────────────────────────────────────────────

function formatStat(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toLocaleString();
}

function formatWinning(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (amount >= 10_000) return `$${(amount / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${amount.toFixed(2)}`;
}

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow({ borderColor }: { borderColor: string }) {
  return (
    <View style={[sk.row, { borderColor }]}>
      <View style={[sk.labelBar, { backgroundColor: borderColor }]} />
      <View style={[sk.valueBar, { backgroundColor: borderColor }]} />
    </View>
  );
}

// ── Stats grid ────────────────────────────────────────────────────────────────

type StatIcon =
  | { kind: "png"; src: number }
  | { kind: "emoji"; char: string };

interface StatRow {
  icon: StatIcon;
  label: string;
  value: string;
}

function StatIconView({ icon }: { icon: StatIcon }) {
  if (icon.kind === "png") {
    return <Image source={icon.src} style={ss.icon} resizeMode="contain" />;
  }
  return <Text style={ss.iconEmoji}>{icon.char}</Text>;
}

function StatsSection({
  stats,
  loading,
  error,
  colors,
}: {
  stats: PublicProfileStats | null;
  loading: boolean;
  error: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  if (loading && !stats) {
    return (
      <View style={ss.wrap}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <SkeletonRow key={i} borderColor={colors.border} />
        ))}
      </View>
    );
  }

  if (error && !stats) {
    return (
      <View style={ss.errorWrap}>
        <Feather name="alert-circle" size={13} color={colors.mutedForeground} />
        <Text style={[ss.errorText, { color: colors.mutedForeground }]}>
          Stats unavailable
        </Text>
      </View>
    );
  }

  if (!stats) return null;

  const rows: StatRow[] = [
    {
      icon:  { kind: "png", src: blueShoeImg },
      label: "Lifetime Steps",
      value: formatStat(stats.lifetimeSteps),
    },
    {
      icon:  { kind: "png", src: gameCoinImg },
      label: "Coins",
      value: formatStat(stats.coinsBalance),
    },
    {
      icon:  { kind: "emoji", char: "🏁" },
      label: "Races Played",
      value: String(stats.racesPlayed),
    },
    {
      icon:  { kind: "emoji", char: "🏆" },
      label: "Race Wins",
      value: String(stats.raceWins),
    },
    {
      icon:  { kind: "emoji", char: "💰" },
      label: "Total Winning",
      value: formatWinning(stats.totalWinning),
    },
    {
      icon:  { kind: "emoji", char: "🔥" },
      label: "Streak",
      value: stats.currentStreakDays === 0
        ? "—"
        : `${stats.currentStreakDays} day${stats.currentStreakDays === 1 ? "" : "s"}`,
    },
  ];

  return (
    <View style={ss.wrap}>
      {rows.map((r) => (
        <View key={r.label} style={[ss.row, { borderColor: colors.border }]}>
          <View style={ss.labelRow}>
            <StatIconView icon={r.icon} />
            <Text style={[ss.label, { color: colors.mutedForeground }]}>{r.label}</Text>
          </View>
          <Text style={[ss.value, { color: colors.foreground }]}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PublicProfileModal({
  visible,
  userId,
  onClose,
  initialData,
  waitingRoomContext,
}: PublicProfileModalProps) {
  const colors = useColors();

  // Start with initialData so the modal renders instantly
  const [profile, setProfile] = useState<ProfileData | null>(
    initialData
      ? {
          username: initialData.username ?? "",
          country: initialData.country ?? null,
          countryFlag: initialData.countryFlag ?? null,
          avatarColor: initialData.avatarColor ?? null,
          avatarUrl: initialData.avatarUrl ?? null,
          avatarVersion: initialData.avatarVersion ?? 0,
          isCurrentUser: initialData.isCurrentUser ?? false,
          isHost: initialData.isHost ?? false,
          activeTitle: initialData.activeTitle ?? null,
          friendStatus: initialData.friendStatus ?? "none",
          friendRequestId: initialData.friendRequestId ?? null,
        }
      : null,
  );
  const [fetching, setFetching] = useState(false);
  const [friendLoading, setFriendLoading] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Stats — loaded separately with skeleton
  const [stats, setStats] = useState<PublicProfileStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState(false);

  // When visible + userId changes, fetch fresh profile data
  const lastFetchedUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!visible || !userId) return;
    if (lastFetchedUserId.current === userId) return;
    lastFetchedUserId.current = userId;

    // Seed from initialData immediately so UI renders without delay
    if (initialData) {
      setProfile({
        username: initialData.username ?? "",
        country: initialData.country ?? null,
        countryFlag: initialData.countryFlag ?? null,
        avatarColor: initialData.avatarColor ?? null,
        avatarUrl: initialData.avatarUrl ?? null,
        avatarVersion: initialData.avatarVersion ?? 0,
        isCurrentUser: initialData.isCurrentUser ?? false,
        isHost: initialData.isHost ?? false,
        activeTitle: initialData.activeTitle ?? null,
        friendStatus: initialData.friendStatus ?? "none",
        friendRequestId: initialData.friendRequestId ?? null,
      });
    }

    // Check stats cache before fetching
    const cached = statsCache.get(userId);
    if (cached && Date.now() - cached.at < CACHE_TTL) {
      setStats(cached.stats);
    } else {
      setStatsLoading(true);
      setStatsError(false);
    }

    if (__DEV__) console.log("[PublicProfile] modal opened:", userId);

    const fetchProfile = async () => {
      setFetching(true);
      try {
        if (__DEV__) console.log("[PublicProfile] fetch stats userId:", userId);
        const res = await authFetch(`/api/users/${userId}/public-profile`);
        if (!res.ok) {
          setStatsError(true);
          setStatsLoading(false);
          return;
        }
        const data = (await res.json()) as {
          userId: string;
          username: string;
          country: string | null;
          countryFlag: string | null;
          avatarUrl: string | null;
          avatarVersion: number;
          avatarColor: string | null;
          activeTitle: { code: string; title: string } | null;
          friendStatus: string;
          friendRequestId: string | null;
          stats?: {
            lifetimeSteps: number;
            coinsBalance: number;
            racesPlayed: number;
            raceWins: number;
            totalWinning: number;
            currentStreakDays: number;
          };
        };
        setProfile({
          username: data.username,
          country: data.country,
          countryFlag: data.countryFlag,
          avatarColor: data.avatarColor,
          avatarUrl: data.avatarUrl,
          avatarVersion: data.avatarVersion ?? 0,
          isCurrentUser: initialData?.isCurrentUser ?? false,
          isHost: initialData?.isHost ?? false,
          activeTitle: data.activeTitle,
          friendStatus: data.friendStatus,
          friendRequestId: data.friendRequestId,
        });

        if (data.stats) {
          const s: PublicProfileStats = {
            lifetimeSteps:    data.stats.lifetimeSteps,
            coinsBalance:     data.stats.coinsBalance,
            racesPlayed:      data.stats.racesPlayed,
            raceWins:         data.stats.raceWins,
            totalWinning:     data.stats.totalWinning ?? 0,
            currentStreakDays: data.stats.currentStreakDays,
          };
          statsCache.set(userId, { stats: s, at: Date.now() });
          setStats(s);
          if (__DEV__) console.log("[PublicProfile] stats loaded:", s);
        } else {
          setStatsError(true);
          if (__DEV__) console.log("[PublicProfile] stats failed: no stats in response");
        }
      } catch {
        setStatsError(true);
        if (__DEV__) console.log("[PublicProfile] stats failed: network error");
      } finally {
        setFetching(false);
        setStatsLoading(false);
      }
    };

    void fetchProfile();
  }, [visible, userId]);

  // Reset state when modal closes
  const handleClose = useCallback(() => {
    lastFetchedUserId.current = null;
    setProfile(null);
    setStats(null);
    setStatsLoading(false);
    setStatsError(false);
    setFriendLoading(false);
    setRemoving(false);
    onClose();
  }, [onClose]);

  // ── Friend actions ──────────────────────────────────────────────────────────

  const authPost = useCallback(async (path: string, body: Record<string, string>) => {
    const res = await authFetch(path, { method: "POST", body: JSON.stringify(body) });
    return res.ok ? res.json() : null;
  }, []);

  const handleAddFriend = async () => {
    if (!userId) return;
    setFriendLoading(true);
    try {
      const data = (await authPost("/api/friends/request", { targetUserId: userId })) as { request?: { id: string } } | null;
      if (data?.request) {
        setProfile((p) => p ? { ...p, friendStatus: "pending_sent", friendRequestId: data.request!.id } : p);
      }
    } catch { /* silent */ } finally { setFriendLoading(false); }
  };

  const handleCancelRequest = async () => {
    if (!profile?.friendRequestId) return;
    setFriendLoading(true);
    try {
      await authPost("/api/friends/cancel", { requestId: profile.friendRequestId });
      setProfile((p) => p ? { ...p, friendStatus: "none", friendRequestId: null } : p);
    } catch { /* silent */ } finally { setFriendLoading(false); }
  };

  const handleAccept = async () => {
    if (!profile?.friendRequestId) return;
    setFriendLoading(true);
    try {
      await authPost("/api/friends/accept", { requestId: profile.friendRequestId });
      setProfile((p) => p ? { ...p, friendStatus: "friends", friendRequestId: null } : p);
    } catch { /* silent */ } finally { setFriendLoading(false); }
  };

  const handleDecline = async () => {
    if (!profile?.friendRequestId) return;
    setFriendLoading(true);
    try {
      await authPost("/api/friends/reject", { requestId: profile.friendRequestId });
      setProfile((p) => p ? { ...p, friendStatus: "none", friendRequestId: null } : p);
    } catch { /* silent */ } finally { setFriendLoading(false); }
  };

  const handleRemoveFriend = async () => {
    if (!userId) return;
    setFriendLoading(true);
    try {
      await authPost("/api/friends/remove", { friendId: userId });
      setProfile((p) => p ? { ...p, friendStatus: "none" } : p);
    } catch { /* silent */ } finally { setFriendLoading(false); }
  };

  // ── Remove from room (waiting room context only) ────────────────────────────

  const REMOVABLE_ROOM_STATUSES = ["open", "full", "scheduled"];

  const handleRemoveFromRoom = async () => {
    if (!waitingRoomContext || !userId) return;
    setRemoving(true);
    try {
      const res = await authFetch(
        `/api/races/${waitingRoomContext.raceId}/participants/${userId}/remove`,
        { method: "POST" },
      );
      if (res.ok) {
        waitingRoomContext.onParticipantRemoved(userId);
        handleClose();
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string };
        Alert.alert("Error", body.error ?? "Unable to remove player. Please try again.");
      }
    } catch {
      Alert.alert("Error", "Unable to remove player. Please try again.");
    } finally {
      setRemoving(false);
    }
  };

  const canRemoveFromRoom =
    !!waitingRoomContext &&
    waitingRoomContext.isHostMode &&
    REMOVABLE_ROOM_STATUSES.includes(waitingRoomContext.roomStatus) &&
    !profile?.isCurrentUser;

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!visible) return null;

  const p = profile;
  const isSelf = p?.isCurrentUser ?? false;
  const status = p?.friendStatus ?? "none";

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleClose}>
      <Pressable style={[s.overlay, { backgroundColor: "rgba(0,0,0,0.72)" }]} onPress={handleClose}>
        <Pressable style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => {}}>

          {/* Close */}
          <TouchableOpacity
            style={[s.closeBtn, { backgroundColor: colors.border + "80" }]}
            onPress={handleClose}
          >
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>

          {/* Loading indicator (top-right, non-blocking) */}
          {fetching && (
            <ActivityIndicator
              size="small"
              color={colors.mutedForeground}
              style={s.fetchingSpinner}
            />
          )}

          {/* Header: avatar left + name/title right (as in design) */}
          <View style={s.headerRow}>
            <View style={s.avatarWrap}>
              <ProfileAvatar
                userId={userId ?? ""}
                profileImageUrl={p?.avatarUrl ?? null}
                avatarVersion={p?.avatarVersion ?? 0}
                avatarColor={p?.avatarColor ?? colors.primary}
                displayName={p?.username ?? ""}
                size={72}
                borderWidth={p?.isHost ? 2.5 : 2}
              />
              {p?.isHost && (
                <View style={[s.hostBadge, { backgroundColor: colors.gold }]}>
                  <Feather name="star" size={10} color="#000" />
                  <Text style={s.hostBadgeText}>Host</Text>
                </View>
              )}
              {isSelf && !p?.isHost && (
                <View style={[s.youBadge, { backgroundColor: colors.primary }]}>
                  <Text style={s.youBadgeText}>You</Text>
                </View>
              )}
            </View>

            <View style={s.identityBlock}>
              {p?.username ? (
                <Text style={[s.username, { color: colors.foreground }]} numberOfLines={1}>
                  @{p.username}
                </Text>
              ) : (
                <View style={[s.skeleton, { width: 140, backgroundColor: colors.border }]} />
              )}

              {(p?.countryFlag || p?.country) && (
                <Text style={[s.country, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {p.countryFlag ?? ""}{p.countryFlag && p.country ? " " : ""}{p.country ?? ""}
                </Text>
              )}

              {p?.activeTitle && (
                <View style={[s.titleBadge, { backgroundColor: colors.accent + "20", borderColor: colors.accent + "40" }]}>
                  <Text style={[s.titleText, { color: colors.accent }]} numberOfLines={1}>
                    🏅 {p.activeTitle.title}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* ── Public stats section ─────────────────────────────────── */}
          <StatsSection
            stats={stats}
            loading={statsLoading}
            error={statsError}
            colors={colors}
          />

          <View style={[s.divider, { backgroundColor: colors.border }]} />

          {/* Friend actions — only for other users */}
          {!isSelf && p && (
            <View style={s.actions}>
              {status === "none" && (
                <TouchableOpacity
                  style={[s.actionBtn, { backgroundColor: colors.primary + "15", borderColor: colors.primary }]}
                  onPress={handleAddFriend}
                  disabled={friendLoading}
                >
                  {friendLoading
                    ? <ActivityIndicator size="small" color={colors.primary} />
                    : (
                      <>
                        <Feather name="user-plus" size={15} color={colors.primary} />
                        <Text style={[s.actionText, { color: colors.primary }]}> Add Friend</Text>
                      </>
                    )
                  }
                </TouchableOpacity>
              )}

              {status === "pending_sent" && (
                <TouchableOpacity
                  style={[s.actionBtn, { backgroundColor: colors.mutedForeground + "15", borderColor: colors.mutedForeground }]}
                  onPress={handleCancelRequest}
                  disabled={friendLoading}
                >
                  {friendLoading
                    ? <ActivityIndicator size="small" color={colors.mutedForeground} />
                    : (
                      <>
                        <Feather name="clock" size={15} color={colors.mutedForeground} />
                        <Text style={[s.actionText, { color: colors.mutedForeground }]}> Request Sent · Cancel</Text>
                      </>
                    )
                  }
                </TouchableOpacity>
              )}

              {status === "pending_received" && (
                <View style={s.dualActions}>
                  <TouchableOpacity
                    style={[s.actionBtn, s.halfBtn, { backgroundColor: colors.success + "15", borderColor: colors.success }]}
                    onPress={handleAccept}
                    disabled={friendLoading}
                  >
                    {friendLoading
                      ? <ActivityIndicator size="small" color={colors.success} />
                      : <Text style={[s.actionText, { color: colors.success }]}>Accept</Text>
                    }
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.actionBtn, s.halfBtn, { backgroundColor: colors.destructive + "15", borderColor: colors.destructive }]}
                    onPress={handleDecline}
                    disabled={friendLoading}
                  >
                    <Text style={[s.actionText, { color: colors.destructive }]}>Decline</Text>
                  </TouchableOpacity>
                </View>
              )}

              {status === "friends" && (
                <TouchableOpacity
                  style={[s.actionBtn, { backgroundColor: colors.success + "15", borderColor: colors.success }]}
                  onPress={handleRemoveFriend}
                  disabled={friendLoading}
                >
                  {friendLoading
                    ? <ActivityIndicator size="small" color={colors.success} />
                    : (
                      <>
                        <Feather name="user-check" size={15} color={colors.success} />
                        <Text style={[s.actionText, { color: colors.success }]}> Friends · Remove</Text>
                      </>
                    )
                  }
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Waiting room: Remove from Room — host only, non-self */}
          {canRemoveFromRoom && (
            <TouchableOpacity
              style={[s.removeBtn, { borderColor: colors.destructive + "50" }]}
              onPress={handleRemoveFromRoom}
              disabled={removing}
            >
              {removing
                ? <ActivityIndicator size="small" color={colors.destructive} />
                : (
                  <>
                    <Feather name="user-x" size={14} color={colors.destructive} />
                    <Text style={[s.removeText, { color: colors.destructive }]}> Remove from Room</Text>
                  </>
                )
              }
            </TouchableOpacity>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
    alignItems: "stretch",
    gap: 10,
  },
  closeBtn: {
    position: "absolute",
    top: 14,
    right: 14,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  fetchingSpinner: {
    position: "absolute",
    top: 14,
    left: 14,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 8,
    paddingLeft: 10,
    paddingRight: 28,
    width: "100%",
  },
  avatarWrap: {
    alignItems: "center",
  },
  identityBlock: {
    flex: 1,
    justifyContent: "center",
    gap: 4,
    minWidth: 0,
  },
  hostBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 6,
  },
  hostBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#000",
  },
  youBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 6,
  },
  youBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#000",
  },
  username: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  skeleton: {
    height: 20,
    borderRadius: 6,
    opacity: 0.4,
  },
  country: {
    fontSize: 13,
  },
  titleBadge: {
    alignSelf: "flex-start",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 2,
  },
  titleText: {
    fontSize: 12,
    fontWeight: "600",
  },
  divider: {
    width: "100%",
    height: 1,
    marginVertical: 4,
  },
  actions: {
    width: "100%",
    gap: 8,
  },
  dualActions: {
    flexDirection: "row",
    gap: 8,
    width: "100%",
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  halfBtn: {
    flex: 1,
  },
  actionText: {
    fontSize: 14,
    fontWeight: "600",
  },
  removeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 11,
    paddingHorizontal: 16,
    width: "100%",
  },
  removeText: {
    fontSize: 14,
    fontWeight: "600",
  },
});

// Stats section styles
const ss = StyleSheet.create({
  wrap: {
    width: "100%",
    gap: 4,
    marginTop: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 7,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  icon: {
    width: 18,
    height: 18,
  },
  iconEmoji: {
    fontSize: 15,
    lineHeight: 18,
  },
  label: {
    fontSize: 13,
    fontWeight: "500",
  },
  value: {
    fontSize: 13,
    fontWeight: "700",
  },
  errorWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 8,
  },
  errorText: {
    fontSize: 13,
  },
});

// Skeleton styles
const sk = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 9,
  },
  labelBar: {
    width: 100,
    height: 10,
    borderRadius: 5,
    opacity: 0.35,
  },
  valueBar: {
    width: 40,
    height: 10,
    borderRadius: 5,
    opacity: 0.35,
  },
});
