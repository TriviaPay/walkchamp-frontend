import React, { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { TouchableOpacity } from '@/components/HapticTouchableOpacity';

const SECTIONS = [
  {
    id: "platform",
    icon: "activity" as const,
    title: "Skill-Based Activity Platform",
    body: `Walk Champ Global is a skill-based race and activity platform. All races and challenges are competitions where your result is determined entirely by your physical performance — specifically the number of steps you complete during the race period. Participants may walk, jog, or run to accumulate steps.

Walk Champ is NOT a gambling platform. Outcomes are determined by your activity performance, not by chance.

Current challenge modes:
• Free Races — no entry fee, open to all registered users
• Coins Battles — coin-based entry; winner(s) take the prize pool
• Sponsored Events — brand-sponsored races with special prizes (see Sponsored Events section)`,
  },
  {
    id: "eligibility",
    icon: "shield" as const,
    title: "Eligibility Requirements",
    body: `To participate in any Walk Champ race or challenge you must:

• Have a complete and verified Walk Champ account
• Have agreed to the Walk Champ Terms of Service and Fair Play Policy
• Not be a resident of a restricted region (list available in account settings)

For Coins Battles and Sponsored Events involving prizes, you must additionally:

• Be located in a jurisdiction where skill-based activity competitions are permitted

Free races are open to all eligible registered users.`,
  },
  {
    id: "fairplay",
    icon: "flag" as const,
    title: "Fair Play & Anti-Fraud Policy",
    body: `Walk Champ uses automated and manual review to detect fraudulent activity. The following are strictly prohibited:

• Submitting falsified step counts or sensor data
• Using third-party apps, scripts, or devices to artificially inflate steps
• Creating multiple accounts to gain unfair advantage
• Coordinating with other participants to manipulate race results
• Any other activity that violates the spirit of fair competition

Violation may result in immediate account suspension, forfeiture of any pending rewards, and a permanent ban. Suspected fraud is reported to relevant authorities where required by law.`,
  },
  {
    id: "sponsored",
    icon: "award" as const,
    title: "Sponsored Events",
    body: `Sponsored Events are special races funded by brand partners and advertisers. Prize pools and reward structures vary by event and are clearly displayed before you register.

Prize distribution:
• 1st place winner receives the full sponsored prize unless the event explicitly states a split (e.g. top 3)
• Coins used for registration are non-refundable once a Sponsored Event has started
• If an event is cancelled before it starts, registration coins are fully refunded to your wallet
• Sponsored prize delivery timelines depend on the sponsoring partner (typically 5–10 business days after verification)

Walk Champ reserves the right to disqualify any participant found to have violated Fair Play rules. In such cases the prize passes to the next eligible finisher.`,
  },
  {
    id: "coins",
    icon: "zap" as const,
    title: "Coins Battles",
    body: `Coins Battles are skill-based races where participants wager an agreed number of Walk Champ coins. The participant with the highest verified step count at the end of the race wins the entire prize pool (minus any applicable platform fee, which is shown before you join).

• Coins are deducted from your wallet when the race begins — not when you join the lobby
• If you leave the lobby before the race starts, no coins are deducted
• In the event of a tie, the prize pool is split equally among tied participants
• Walk Champ coins have no guaranteed monetary value; they may be earned through activity or purchased in the Store`,
  },
  {
    id: "rewards",
    icon: "dollar-sign" as const,
    title: "Rewards & Verification",
    body: `All rewards — including Coins Battle prizes, Sponsored Event prizes, referral credits, and achievement bonuses — are subject to verification before payout.

• Step data is validated against session metadata and device signals
• Rankings may be adjusted after verification is complete
• Walk Champ reserves the right to withhold rewards pending investigation
• Submission of a withdrawal request does not guarantee approval or payout
• Cash withdrawals require a minimum of $5.00 and are subject to manual admin review (1–3 business days)
• Withdrawals must be enabled on your account to request a cash payout`,
  },
  {
    id: "refunds",
    icon: "refresh-cw" as const,
    title: "Coins & Refund Policy",
    body: `Coins deducted for Coins Battles or Sponsored Event registrations are non-refundable once the race has started.

If a race or event fails to start due to a technical error on Walk Champ's part, coins will be returned to your wallet balance automatically.

Purchased coins are non-refundable except where required by applicable law. Unused wallet balance may be reviewed for refund by contacting support, subject to verification that the balance was not earned through suspicious activity.`,
  },
  {
    id: "privacy",
    icon: "lock" as const,
    title: "Privacy & Data",
    body: `Walk Champ collects step count data, session metadata, and location signals (where permitted) solely for the purpose of operating the race platform and preventing fraud. We do not sell your personal data to third parties.

Your payout details (PayPal email, bank info, etc.) are encrypted and visible only to authorized payment processing staff. Walk Champ complies with applicable data protection laws including GDPR and CCPA where applicable.`,
  },
  {
    id: "responsible",
    icon: "heart" as const,
    title: "Responsible Participation",
    body: `Walk Champ is a fitness and wellness platform. We encourage healthy participation:

• Set a budget for coin usage and stick to it
• Races should be fun and support your fitness goals
• If you feel participation is becoming compulsive, take a break
• Contact support if you wish to self-exclude from Coins Battles or Sponsored Events

Walk Champ may impose participation limits or require cooling-off periods at its discretion to protect user wellbeing.`,
  },
  {
    id: "contact",
    icon: "mail" as const,
    title: "Contact & Disputes",
    body: `For questions, disputes, or compliance concerns:

Email: legal@walkchamp.app
Support: support@walkchamp.app

Disputes regarding race results must be submitted within 7 days of the race completion. Walk Champ's decision on disputes is final.

Walk Champ Global is operated under applicable laws and regulations. We reserve the right to update these policies at any time with notice provided through the app.`,
  },
];

function Section({ section, colors }: { section: typeof SECTIONS[0]; colors: ReturnType<typeof useColors> }) {
  const [open, setOpen] = useState(false);

  return (
    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.75}
      >
        <View style={[styles.sectionIconBox, { backgroundColor: colors.primary + "18" }]}>
          <Feather name={section.icon} size={18} color={colors.primary} />
        </View>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{section.title}</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} />
      </TouchableOpacity>
      {open && (
        <View style={[styles.sectionBody, { borderTopColor: colors.border }]}>
          <Text style={[styles.sectionText, { color: colors.mutedForeground }]}>{section.body}</Text>
        </View>
      )}
    </View>
  );
}

export default function LegalScreen() {
  const colors = useColors();
  const { insets, safeTop, safeBottom } = useSafeLayout();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: safeTop + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Rules & Legal</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: safeBottom + 32 }]}
      >
        {/* Top notice */}
        <View style={[styles.notice, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
          <Feather name="check-circle" size={18} color={colors.primary} />
          <Text style={[styles.noticeText, { color: colors.foreground }]}>
            Walk Champ is a <Text style={{ fontWeight: "700", color: colors.primary }}>skill-based race platform</Text>. Results are determined by your activity performance — walk, jog, or run. Not by chance.
          </Text>
        </View>

        {/* Last updated */}
        <Text style={[styles.lastUpdated, { color: colors.mutedForeground }]}>
          Last updated: June 2026 · Version 1.1
        </Text>

        {/* Sections */}
        {SECTIONS.map((s) => (
          <Section key={s.id} section={s} colors={colors} />
        ))}

        {/* Footer */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
            By using Walk Champ you agree to all policies described above. Walk Champ reserves the right to update these terms at any time with in-app notice. Continued use constitutes acceptance of the updated terms.
          </Text>
          <Text style={[styles.footerText, { color: colors.mutedForeground, marginTop: 8 }]}>
            © 2026 Walk Champ Global. All rights reserved.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 10 },
  notice: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 6,
  },
  noticeText: { flex: 1, fontSize: 14, lineHeight: 20 },
  lastUpdated: { fontSize: 12, marginBottom: 6 },
  section: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  sectionHeader: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 14, paddingVertical: 14,
  },
  sectionIconBox: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  sectionTitle: { flex: 1, fontSize: 15, fontWeight: "600" },
  sectionBody: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 14 },
  sectionText: { fontSize: 13, lineHeight: 20 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 20, marginTop: 10 },
  footerText: { fontSize: 12, lineHeight: 18, textAlign: "center" },
});
