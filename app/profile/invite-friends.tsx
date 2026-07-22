import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { useAuth } from "@/context/AuthContext";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { AppAlert } from "@/components/AppAlert";
import { SkeletonList } from "@/components/SkeletonRows";
import { rf, rs } from "@/utils/responsive";
import {
  buildReferralShareMessage,
  fetchReferralDetails,
  formatReferralReward,
  type ReferralDetails,
} from "@/utils/referral";

const ACCENT = "#A78BFA";
const ACCENT_2 = "#22C55E";
const REFERRAL_ART = require("../../assets/images/referal.png");

const HOW_IT_WORKS = [
  {
    icon: "share-2" as const,
    title: "Share Your Invite",
    body: "Send your unique invite link or referral code to friends.",
  },
  {
    icon: "user-plus" as const,
    title: "Friend Joins",
    body: "They create a Walk Champ account using your invite.",
  },
  {
    icon: "flag" as const,
    title: "Complete the Requirement",
    body: "They finish the qualifying action configured for referrals.",
  },
  {
    icon: "gift" as const,
    title: "Earn Rewards",
    body: "Rewards are credited after all referral requirements are verified.",
  },
];

function StatCard({
  label,
  value,
  icon,
  colors,
}: {
  label: string;
  value: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[st.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[st.statIcon, { backgroundColor: ACCENT + "18" }]}>
        <Feather name={icon} size={14} color={ACCENT} />
      </View>
      <Text style={[st.statValue, { color: colors.foreground }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={[st.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

export default function InviteFriendsScreen() {
  const colors = useColors();
  const { safeTop, safeBottom } = useSafeLayout();
  const { user } = useAuth();

  const [details, setDetails] = useState<ReferralDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedKind, setCopiedKind] = useState<"code" | "link" | null>(null);
  const [sharing, setSharing] = useState(false);

  const fallbackCode = (user?.referralCode ?? "").trim().toUpperCase();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!fallbackCode) {
        setError("Unable to load referral details.");
        setDetails(null);
        return;
      }
      const data = await fetchReferralDetails(fallbackCode);
      if (!data.code) {
        setError("Unable to load referral details.");
        setDetails(null);
        return;
      }
      setDetails(data);
    } catch {
      setError("Unable to load referral details.");
      setDetails(null);
    } finally {
      setLoading(false);
    }
  }, [fallbackCode]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!copiedKind) return;
    const id = setTimeout(() => setCopiedKind(null), 2200);
    return () => clearTimeout(id);
  }, [copiedKind]);

  const summaryCards = useMemo(() => {
    if (!details) return [];
    const cards: Array<{ label: string; value: string; icon: React.ComponentProps<typeof Feather>["name"] }> = [];
    if (details.stats.invitesSent != null) {
      cards.push({
        label: "Invites Sent",
        value: String(details.stats.invitesSent),
        icon: "send",
      });
    }
    if (details.stats.friendsJoined != null) {
      cards.push({
        label: "Friends Joined",
        value: String(details.stats.friendsJoined),
        icon: "users",
      });
    } else if (details.stats.qualifiedReferrals != null) {
      cards.push({
        label: "Qualified",
        value: String(details.stats.qualifiedReferrals),
        icon: "check-circle",
      });
    }
    if (details.stats.rewardsEarned != null) {
      cards.push({
        label: "Rewards Earned",
        value: formatReferralReward(details.stats.rewardsEarned, details.config.currency),
        icon: "dollar-sign",
      });
    }
    // Only show metrics the referral system actually returns — never invent placeholders.
    return cards.slice(0, 3);
  }, [details]);

  const handleCopyCode = useCallback(async () => {
    if (!details?.code) return;
    try {
      await Clipboard.setStringAsync(details.code);
      setCopiedKind("code");
    } catch {
      AppAlert.alert("Copy failed", "Could not copy your invite code. Please try again.");
    }
  }, [details?.code]);

  const handleCopyLink = useCallback(async () => {
    if (!details?.inviteUrl) return;
    try {
      await Clipboard.setStringAsync(details.inviteUrl);
      setCopiedKind("link");
    } catch {
      AppAlert.alert("Copy failed", "Could not copy your invite link. Please try again.");
    }
  }, [details?.inviteUrl]);

  const handleShare = useCallback(async () => {
    if (!details || sharing) return;
    setSharing(true);
    try {
      const message = buildReferralShareMessage(details);
      await Share.share({
        title: "Join Walk Champ",
        message,
        url: details.inviteUrl,
      });
    } catch {
      AppAlert.alert("Share failed", "Could not open the share sheet. You can still copy your invite link.");
    } finally {
      setSharing(false);
    }
  }, [details, sharing]);

  const maskedLink = details?.inviteUrl
    ? details.inviteUrl.replace(/^https?:\/\//, "")
    : "";

  return (
    <View style={[st.container, { backgroundColor: colors.background }]}>
      <View style={[st.header, { paddingTop: safeTop + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)/walk");
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={st.headerBtn}
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={st.headerCenter}>
          <Text style={[st.headerTitle, { color: colors.foreground }]}>Invite Friends</Text>
          <Text style={[st.headerSub, { color: colors.mutedForeground }]}>
            Walk together. Compete together. Earn rewards.
          </Text>
        </View>
        <TouchableOpacity
          onPress={() =>
            AppAlert.alert(
              "Referral Help",
              details?.config.requirementLabel
                ? `Share your invite code or link. ${details.config.requirementLabel}. Rewards are credited after verification.`
                : "Share your invite code or link. Rewards are credited after your friend completes the required action and verification finishes.",
            )
          }
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={st.headerBtn}
        >
          <Feather name="help-circle" size={20} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      {copiedKind && (
        <View style={[st.toast, { backgroundColor: ACCENT_2 + "22", borderColor: ACCENT_2 + "66" }]}>
          <Feather name="check-circle" size={14} color={ACCENT_2} />
          <Text style={[st.toastText, { color: ACCENT_2 }]}>
            {copiedKind === "code" ? "Invite code copied" : "Invite link copied"}
          </Text>
        </View>
      )}

      {loading ? (
        <View style={{ paddingTop: 12 }}>
          <SkeletonList count={5} variant="race" />
        </View>
      ) : error || !details ? (
        <View style={st.errorBox}>
          <Feather name="alert-circle" size={32} color={colors.mutedForeground} />
          <Text style={[st.errorTitle, { color: colors.foreground }]}>Unable to load referral details.</Text>
          <TouchableOpacity style={[st.retryBtn, { borderColor: ACCENT + "66", backgroundColor: ACCENT + "18" }]} onPress={() => void load()}>
            <Feather name="refresh-cw" size={14} color={ACCENT} />
            <Text style={[st.retryText, { color: ACCENT }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[st.content, { paddingBottom: safeBottom + 36 }]}
        >
          {/* Hero */}
          <LinearGradient
            colors={["#1E1B4B", "#0F172A", "#052e16"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[st.hero, { borderColor: ACCENT + "40" }]}
          >
            <View style={st.heroTextCol}>
              <View style={[st.heroBadge, { backgroundColor: ACCENT + "22", borderColor: ACCENT + "55" }]}>
                <Feather name="users" size={12} color={ACCENT} />
                <Text style={[st.heroBadgeText, { color: ACCENT }]}>REFERRAL</Text>
              </View>
              <Text style={[st.heroTitle, { color: colors.foreground }]}>
                Invite friends to{" "}
                <Text style={{ color: ACCENT }}>Walk Champ</Text>
              </Text>
              <Text style={[st.heroBody, { color: colors.mutedForeground }]}>
                Share your invite and earn rewards when your friends join and complete the required challenge.
              </Text>
            </View>
            <Image source={REFERRAL_ART} style={st.heroArt} resizeMode="contain" />
          </LinearGradient>

          {/* Code card */}
          <View style={[st.codeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[st.codeLabel, { color: colors.mutedForeground }]}>YOUR INVITE CODE</Text>
            <TouchableOpacity style={st.codeRow} onPress={() => void handleCopyCode()} activeOpacity={0.8}>
              <Text style={[st.codeValue, { color: colors.foreground }]} numberOfLines={1} adjustsFontSizeToFit>
                {details.code}
              </Text>
              <View style={[st.copyIconBtn, { backgroundColor: ACCENT + "18", borderColor: ACCENT + "44" }]}>
                <Feather name="copy" size={16} color={ACCENT} />
              </View>
            </TouchableOpacity>

            <View style={[st.linkPill, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <Feather name="link" size={13} color={colors.mutedForeground} />
              <Text style={[st.linkText, { color: colors.mutedForeground }]} numberOfLines={1}>
                {maskedLink}
              </Text>
              <TouchableOpacity onPress={() => void handleCopyLink()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[st.copyLinkText, { color: ACCENT }]}>Copy Link</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Actions */}
          <TouchableOpacity
            style={st.primaryBtn}
            onPress={() => void handleShare()}
            activeOpacity={0.88}
            disabled={sharing}
          >
            <LinearGradient
              colors={["#7C3AED", "#22C55E"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={st.primaryBtnGrad}
            >
              {sharing ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Feather name="share" size={16} color="#FFF" />
                  <Text style={st.primaryBtnText}>Share Invite</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity
            style={[st.secondaryBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            onPress={() => void handleCopyLink()}
            activeOpacity={0.85}
          >
            <Feather name="link-2" size={15} color={ACCENT} />
            <Text style={[st.secondaryBtnText, { color: colors.foreground }]}>Copy Invite Link</Text>
          </TouchableOpacity>

          {/* Summary */}
          {summaryCards.length > 0 && (
            <>
              <Text style={[st.sectionTitle, { color: colors.foreground }]}>Your Referral Progress</Text>
              <View style={st.statsRow}>
                {summaryCards.map((card) => (
                  <StatCard
                    key={card.label}
                    label={card.label}
                    value={card.value}
                    icon={card.icon}
                    colors={colors}
                  />
                ))}
              </View>
            </>
          )}

          {/* How it works */}
          <Text style={[st.sectionTitle, { color: colors.foreground }]}>How It Works</Text>
          <View style={[st.stepsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {HOW_IT_WORKS.map((step, index) => (
              <View
                key={step.title}
                style={[
                  st.stepRow,
                  index < HOW_IT_WORKS.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <View style={st.stepLeft}>
                  <View style={[st.stepNum, { backgroundColor: ACCENT + "22", borderColor: ACCENT + "55" }]}>
                    <Text style={[st.stepNumText, { color: ACCENT }]}>{index + 1}</Text>
                  </View>
                  {index < HOW_IT_WORKS.length - 1 && (
                    <View style={[st.stepLine, { backgroundColor: ACCENT + "33" }]} />
                  )}
                </View>
                <View style={[st.stepIcon, { backgroundColor: colors.background }]}>
                  <Feather name={step.icon} size={16} color={ACCENT} />
                </View>
                <View style={st.stepCopy}>
                  <Text style={[st.stepTitle, { color: colors.foreground }]}>{step.title}</Text>
                  <Text style={[st.stepBody, { color: colors.mutedForeground }]}>
                    {index === 2 && details.config.requirementLabel
                      ? details.config.requirementLabel
                      : step.body}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {/* Reward rules */}
          <Text style={[st.sectionTitle, { color: colors.foreground }]}>Reward Details</Text>
          <View style={[st.rulesCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[st.rulesIcon, { backgroundColor: ACCENT_2 + "18" }]}>
              <Feather name="gift" size={18} color={ACCENT_2} />
            </View>
            <View style={{ flex: 1, gap: 8 }}>
              {details.config.rules.map((rule) => (
                <View key={rule} style={st.ruleRow}>
                  <View style={[st.ruleDot, { backgroundColor: ACCENT_2 }]} />
                  <Text style={[st.ruleText, { color: colors.mutedForeground }]}>{rule}</Text>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: rs(16),
    paddingBottom: rs(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: rf(17), fontWeight: "800" },
  headerSub: { fontSize: rf(11), marginTop: 2, textAlign: "center" },
  toast: {
    alignSelf: "center",
    marginTop: rs(10),
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: rs(12),
    paddingVertical: rs(7),
  },
  toastText: { fontSize: rf(12), fontWeight: "700" },
  content: { paddingHorizontal: rs(16), paddingTop: rs(16), gap: rs(14) },
  hero: {
    borderRadius: 20,
    borderWidth: 1,
    padding: rs(16),
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    overflow: "hidden",
    minHeight: rs(148),
  },
  heroTextCol: { flex: 1, gap: 8 },
  heroBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  heroBadgeText: { fontSize: rf(10), fontWeight: "800", letterSpacing: 0.6 },
  heroTitle: { fontSize: rf(20), fontWeight: "900", lineHeight: rf(26) },
  heroBody: { fontSize: rf(12.5), lineHeight: rf(18) },
  heroArt: { width: rs(96), height: rs(96) },
  codeCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: rs(16),
    gap: 12,
  },
  codeLabel: { fontSize: rf(11), fontWeight: "800", letterSpacing: 1 },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  codeValue: { flex: 1, fontSize: rf(28), fontWeight: "900", letterSpacing: 1 },
  copyIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  linkPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  linkText: { flex: 1, fontSize: rf(12) },
  copyLinkText: { fontSize: rf(12), fontWeight: "800" },
  primaryBtn: { borderRadius: 14, overflow: "hidden" },
  primaryBtnGrad: {
    height: rs(52),
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryBtnText: { color: "#FFF", fontSize: rf(15), fontWeight: "800" },
  secondaryBtn: {
    height: rs(48),
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  secondaryBtnText: { fontSize: rf(14), fontWeight: "700" },
  sectionTitle: { fontSize: rf(16), fontWeight: "800", marginTop: 4 },
  statsRow: { flexDirection: "row", gap: 10 },
  statCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: rs(12),
    paddingHorizontal: rs(10),
    alignItems: "center",
    gap: 6,
  },
  statIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  statValue: { fontSize: rf(18), fontWeight: "900" },
  statLabel: { fontSize: rf(10), fontWeight: "600", textAlign: "center" },
  stepsCard: { borderRadius: 18, borderWidth: 1, overflow: "hidden" },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: rs(14),
    paddingVertical: rs(14),
  },
  stepLeft: { alignItems: "center", width: 28 },
  stepNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumText: { fontSize: rf(12), fontWeight: "800" },
  stepLine: { width: 2, flex: 1, minHeight: 18, marginTop: 4, borderRadius: 1 },
  stepIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 0,
  },
  stepCopy: { flex: 1, gap: 3 },
  stepTitle: { fontSize: rf(14), fontWeight: "800" },
  stepBody: { fontSize: rf(12.5), lineHeight: rf(17) },
  rulesCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: rs(14),
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  rulesIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  ruleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  ruleDot: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  ruleText: { flex: 1, fontSize: rf(12.5), lineHeight: rf(17) },
  errorBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 24,
  },
  errorTitle: { fontSize: rf(15), fontWeight: "700", textAlign: "center" },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryText: { fontSize: rf(14), fontWeight: "700" },
});
