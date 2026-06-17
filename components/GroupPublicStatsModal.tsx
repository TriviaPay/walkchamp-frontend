import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  type DimensionValue,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { authFetch } from "@/utils/authFetch";
import { getApiBase } from "@/utils/apiUrl";
import { formatSteps } from "@/utils/format";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { rf, rs } from "@/utils/responsive";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GroupPublicInitialData {
  name?: string;
  type?: string;
  customGroupType?: string | null;
  groupImageUrl?: string | null;
  imageVersion?: number;
  memberCount?: number;
  totalSteps?: number;
}

interface GroupPublicProfile {
  group: {
    id: string;
    name: string;
    imageUrl: string | null;
    type: string;
    categoryLabel: string;
    memberCount: number;
    activeMembersToday: number;
    todaySteps: number;
    dailyGoal: number;
    progressPercent: number;
  };
  viewer: {
    membershipStatus: string;
    joinRequestStatus: string | null;
    joinRequestId: string | null;
    canRequestToJoin: boolean;
    canViewGroup: boolean;
    isAdmin: boolean;
  };
}

interface GroupPublicStatsModalProps {
  visible: boolean;
  groupId: string | null;
  onClose: () => void;
  initialData?: GroupPublicInitialData;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const GROUP_TYPE_ICON: Record<string, string> = {
  friends: "👫",
  family:  "👨‍👩‍👧",
  office:  "💼",
  custom:  "⭐",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function GroupPublicStatsModal({
  visible,
  groupId,
  onClose,
  initialData,
}: GroupPublicStatsModalProps) {
  const colors  = useColors();
  const router  = useRouter();
  const [data, setData]       = useState<GroupPublicProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/groups/${groupId}/public`);
      if (!res.ok) { setError("Could not load group"); return; }
      const json = (await res.json()) as GroupPublicProfile;
      setData(json);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    if (visible && groupId) {
      setData(null);
      setError(null);
      void fetchProfile();
    }
  }, [visible, groupId, fetchProfile]);

  const handleRequestToJoin = async () => {
    if (!groupId || joining) return;
    setJoining(true);
    try {
      const res = await authFetch(`/api/groups/${groupId}/join-request`, { method: "POST" });
      if (res.ok) {
        void fetchProfile();
      }
    } catch {
      // silent
    } finally {
      setJoining(false);
    }
  };

  const handleViewGroup = () => {
    onClose();
    if (groupId) router.push(`/groups/${groupId}` as never);
  };

  if (!visible) return null;

  const group  = data?.group;
  const viewer = data?.viewer;

  const displayName = group?.name ?? initialData?.name ?? "";
  const displayType = group?.type ?? initialData?.type ?? "custom";
  const displayCategoryLabel = group?.categoryLabel
    ?? (initialData?.customGroupType || (initialData?.type ? initialData.type.charAt(0).toUpperCase() + initialData.type.slice(1) : "Group"));
  const displayMemberCount = group?.memberCount ?? initialData?.memberCount ?? 0;
  const displayImageUrl = group?.imageUrl
    ? `${getApiBase()}${group.imageUrl}`
    : initialData?.groupImageUrl
      ? `${getApiBase()}/api/groups/${groupId}/image?v=${initialData.imageVersion ?? 0}`
      : null;

  const membershipStatus   = viewer?.membershipStatus ?? "none";
  const joinRequestStatus  = viewer?.joinRequestStatus ?? null;
  const canViewGroup       = viewer?.canViewGroup ?? false;

  // Resolve action button
  let actionLabel = "";
  let actionDisabled = false;
  let actionVariant: "primary" | "ghost" | "muted" = "primary";

  if (canViewGroup || membershipStatus === "active") {
    actionLabel   = "View Group";
    actionVariant = "primary";
  } else if (joinRequestStatus === "pending") {
    actionLabel    = "Request Pending";
    actionDisabled = true;
    actionVariant  = "muted";
  } else {
    actionLabel   = "Request to Join";
    actionVariant = "primary";
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={st.overlay} onPress={onClose}>
        <Pressable style={[st.card, { backgroundColor: colors.card }]} onPress={() => {}}>

          {/* Close button */}
          <TouchableOpacity style={st.closeBtn} onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={20} color={colors.mutedForeground} />
          </TouchableOpacity>

          {/* Avatar */}
          <View style={[st.avatar, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "40" }]}>
            {displayImageUrl ? (
              <Image source={{ uri: displayImageUrl }} style={st.avatarImg} />
            ) : (
              <Text style={st.avatarEmoji}>{GROUP_TYPE_ICON[displayType] ?? "⭐"}</Text>
            )}
          </View>

          {/* Name + type */}
          <Text style={[st.name, { color: colors.foreground }]} numberOfLines={2}>{displayName}</Text>
          <View style={[st.typePill, { backgroundColor: colors.primary + "15" }]}>
            <Text style={[st.typePillText, { color: colors.primary }]}>{displayCategoryLabel}</Text>
          </View>

          {/* Loading / Error */}
          {loading && !data && (
            <View style={st.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          )}
          {error && !data && (
            <Text style={[st.errorText, { color: colors.mutedForeground }]}>{error}</Text>
          )}

          {/* Stats grid */}
          {group && (
            <View style={st.statsGrid}>
              <View style={[st.statCell, { backgroundColor: colors.muted }]}>
                <Text style={[st.statValue, { color: colors.foreground }]}>{displayMemberCount}</Text>
                <Text style={[st.statLabel, { color: colors.mutedForeground }]}>Members</Text>
              </View>
              <View style={[st.statCell, { backgroundColor: colors.muted }]}>
                <Text style={[st.statValue, { color: colors.foreground }]}>{group.activeMembersToday}</Text>
                <Text style={[st.statLabel, { color: colors.mutedForeground }]}>Active Today</Text>
              </View>
              <View style={[st.statCell, { backgroundColor: colors.muted }]}>
                <Text style={[st.statValue, { color: colors.foreground }]}>{formatSteps(group.todaySteps)}</Text>
                <Text style={[st.statLabel, { color: colors.mutedForeground }]}>Steps Today</Text>
              </View>
            </View>
          )}

          {/* Daily goal progress */}
          {group && group.dailyGoal > 0 && (
            <View style={st.goalSection}>
              <View style={st.goalHeader}>
                <Text style={[st.goalLabel, { color: colors.mutedForeground }]}>Daily Goal</Text>
                <Text style={[st.goalLabel, { color: colors.mutedForeground }]}>
                  {group.progressPercent}% · {formatSteps(group.dailyGoal)} steps
                </Text>
              </View>
              <View style={[st.progressTrack, { backgroundColor: colors.muted }]}>
                <View
                  style={[
                    st.progressFill,
                    {
                      backgroundColor: group.progressPercent >= 100 ? colors.success : colors.primary,
                      width: `${Math.min(100, group.progressPercent)}%` as DimensionValue,
                    },
                  ]}
                />
              </View>
            </View>
          )}

          {/* Action button */}
          <TouchableOpacity
            style={[
              st.actionBtn,
              actionVariant === "primary" && { backgroundColor: colors.primary },
              actionVariant === "muted" && { backgroundColor: colors.muted },
              actionDisabled && { opacity: 0.6 },
            ]}
            onPress={canViewGroup || membershipStatus === "active" ? handleViewGroup : handleRequestToJoin}
            disabled={actionDisabled || joining || loading}
          >
            {joining ? (
              <ActivityIndicator size="small" color={actionVariant === "primary" ? colors.primaryForeground : colors.mutedForeground} />
            ) : (
              <Text
                style={[
                  st.actionBtnText,
                  actionVariant === "primary" && { color: colors.primaryForeground },
                  actionVariant === "muted" && { color: colors.mutedForeground },
                ]}
              >
                {actionLabel}
              </Text>
            )}
          </TouchableOpacity>

        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: rs(24),
  },
  card: {
    width: "100%",
    borderRadius: rs(20),
    paddingTop: rs(28),
    paddingBottom: rs(24),
    paddingHorizontal: rs(20),
    alignItems: "center",
    position: "relative",
    maxWidth: 380,
  },
  closeBtn: {
    position: "absolute",
    top: rs(14),
    right: rs(14),
    padding: rs(4),
  },
  avatar: {
    width: rs(72),
    height: rs(72),
    borderRadius: rs(36),
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    marginBottom: rs(14),
  },
  avatarImg: {
    width: rs(72),
    height: rs(72),
    borderRadius: rs(36),
  },
  avatarEmoji: {
    fontSize: rf(30),
  },
  name: {
    fontSize: rf(18),
    fontWeight: "700",
    textAlign: "center",
    marginBottom: rs(6),
    lineHeight: rf(24),
  },
  typePill: {
    borderRadius: rs(10),
    paddingHorizontal: rs(10),
    paddingVertical: rs(3),
    marginBottom: rs(18),
  },
  typePillText: {
    fontSize: rf(12),
    fontWeight: "600",
  },
  loadingRow: {
    paddingVertical: rs(16),
  },
  errorText: {
    fontSize: rf(13),
    textAlign: "center",
    paddingVertical: rs(12),
  },
  statsGrid: {
    flexDirection: "row",
    gap: rs(8),
    width: "100%",
    marginBottom: rs(14),
  },
  statCell: {
    flex: 1,
    borderRadius: rs(12),
    paddingVertical: rs(10),
    alignItems: "center",
  },
  statValue: {
    fontSize: rf(15),
    fontWeight: "700",
    marginBottom: rs(2),
  },
  statLabel: {
    fontSize: rf(10),
    fontWeight: "500",
  },
  goalSection: {
    width: "100%",
    marginBottom: rs(14),
  },
  goalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: rs(5),
  },
  goalLabel: {
    fontSize: rf(11),
    fontWeight: "500",
  },
  progressTrack: {
    height: rs(6),
    borderRadius: rs(3),
    overflow: "hidden",
    width: "100%",
  },
  progressFill: {
    height: "100%",
    borderRadius: rs(3),
  },
  actionBtn: {
    width: "100%",
    borderRadius: rs(12),
    paddingVertical: rs(14),
    alignItems: "center",
    justifyContent: "center",
    marginTop: rs(4),
    minHeight: rs(48),
  },
  actionBtnText: {
    fontSize: rf(15),
    fontWeight: "700",
  },
});
