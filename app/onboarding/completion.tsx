import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import {
  OnboardingLayout,
  OnboardingMascot,
  OnboardingPrimaryButton,
  OnboardingSecondaryButton,
} from "@/components/onboarding/OnboardingUI";
import { ONBOARDING_ASSETS, ONBOARDING_COLORS, ONBOARDING_ROUTES } from "@/constants/onboarding";
import { markOnboardingCompleted } from "@/utils/onboardingStorage";
import { rf } from "@/utils/responsive";

const C = ONBOARDING_COLORS;

export default function CompletionOnboardingScreen() {
  const goSignIn = async () => {
    await markOnboardingCompleted();
    router.replace(ONBOARDING_ROUTES.signIn);
  };

  return (
    <OnboardingLayout
      step={6}
      showBack
      footer={
        <>
          <OnboardingPrimaryButton label="Continue to Sign In" onPress={() => void goSignIn()} />
          <OnboardingSecondaryButton
            label="Review Terms and Privacy"
            onPress={() => router.push("/legal")}
          />
        </>
      }
    >
      <OnboardingMascot source={ONBOARDING_ASSETS.completion} />
      <Text style={styles.title}>You’re Ready to Walk Champ</Text>
      <Text style={styles.subtitle}>Sign in and join your first challenge.</Text>
      <View style={styles.cards}>
        {[
          "Free, Coins, and Cash Challenges",
          "Live Races and Leaderboards",
          "Groups, Achievements, and Rewards",
        ].map((label) => (
          <View key={label} style={styles.featureRow}>
            <Text style={styles.featureText} numberOfLines={1}>
              {label}
            </Text>
          </View>
        ))}
      </View>
      <Text style={styles.note}>
        Cash features are available only in supported regions for eligible users.
      </Text>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  title: {
    color: C.text,
    fontSize: rf(27),
    fontWeight: "900",
    textAlign: "center",
    marginTop: 4,
  },
  subtitle: {
    color: C.textSecondary,
    fontSize: rf(14.5),
    lineHeight: rf(19),
    textAlign: "center",
    marginTop: 2,
  },
  cards: { gap: 8, marginTop: 8 },
  featureRow: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
    justifyContent: "center",
  },
  featureText: {
    color: C.text,
    fontSize: rf(14.5),
    fontWeight: "700",
    textAlign: "center",
  },
  note: {
    color: C.textSecondary,
    fontSize: rf(11.5),
    lineHeight: rf(15),
    textAlign: "center",
    marginTop: 6,
  },
});
