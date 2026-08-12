import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import {
  OnboardingFeatureCard,
  OnboardingLayout,
  OnboardingMascot,
  OnboardingPrimaryButton,
} from "@/components/onboarding/OnboardingUI";
import { ONBOARDING_ASSETS, ONBOARDING_COLORS, ONBOARDING_ROUTES } from "@/constants/onboarding";
import { rf } from "@/utils/responsive";

const C = ONBOARDING_COLORS;

export default function HowItWorksScreen() {
  return (
    <OnboardingLayout
      step={2}
      showBack
      footer={
        <OnboardingPrimaryButton
          label="Continue"
          onPress={() => router.push(ONBOARDING_ROUTES.stepGoal)}
        />
      }
    >
      <OnboardingMascot source={ONBOARDING_ASSETS.howItWorks} />
      <Text style={styles.title}>How WalkChamp Works</Text>
      <Text style={styles.subtitle}>Choose a challenge, walk, and climb the leaderboard.</Text>
      <View style={styles.cards}>
        <OnboardingFeatureCard
          icon="flag"
          title="Choose"
          body="Join Free, Coins, Cash, or Sponsored Challenges."
        />
        <OnboardingFeatureCard
          icon="trending-up"
          title="Walk"
          body="Verified steps move you through the race."
        />
        <OnboardingFeatureCard
          icon="award"
          title="Compete"
          body="Finish strong and earn the listed rewards."
        />
      </View>
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
});
