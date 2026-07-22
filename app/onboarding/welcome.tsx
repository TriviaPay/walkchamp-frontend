import React, { useEffect } from "react";
import { StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import {
  OnboardingLayout,
  OnboardingMascot,
  OnboardingPrimaryButton,
} from "@/components/onboarding/OnboardingUI";
import { ONBOARDING_ASSETS, ONBOARDING_COLORS, ONBOARDING_ROUTES } from "@/constants/onboarding";
import { markOnboardingInProgress } from "@/utils/onboardingStorage";
import { rf } from "@/utils/responsive";

const C = ONBOARDING_COLORS;

export default function OnboardingWelcomeScreen() {
  useEffect(() => {
    void markOnboardingInProgress();
  }, []);

  return (
    <OnboardingLayout
      step={1}
      footer={
        <OnboardingPrimaryButton
          label="Start My Journey"
          onPress={() => router.push(ONBOARDING_ROUTES.howItWorks)}
        />
      }
    >
      <Text style={styles.brand}>WALK CHAMP</Text>
      <OnboardingMascot source={ONBOARDING_ASSETS.welcome} />
      <Text style={styles.title}>Make Every Step Count</Text>
      <Text style={styles.subtitle}>Walk, compete, and build healthier habits.</Text>
      <Text style={styles.benefits}>Verified steps • Live races • Real rewards</Text>
      <Text style={styles.legal}>
        By continuing, you agree to the{" "}
        <Text style={styles.link} onPress={() => router.push("/terms")}>
          Terms and Conditions
        </Text>{" "}
        and{" "}
        <Text style={styles.link} onPress={() => router.push("/legal")}>
          Privacy Policy
        </Text>
        .
      </Text>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  brand: {
    color: C.cyan,
    fontSize: rf(11),
    fontWeight: "900",
    letterSpacing: 1.2,
    textAlign: "center",
    marginTop: 2,
  },
  title: {
    color: C.text,
    fontSize: rf(28),
    fontWeight: "900",
    textAlign: "center",
    lineHeight: rf(32),
    marginTop: 4,
  },
  subtitle: {
    color: C.textSecondary,
    fontSize: rf(14.5),
    lineHeight: rf(19),
    textAlign: "center",
    marginTop: 2,
  },
  benefits: {
    color: C.cyan,
    fontSize: rf(13),
    fontWeight: "700",
    textAlign: "center",
    marginTop: 6,
  },
  legal: {
    color: C.textSecondary,
    fontSize: rf(11.5),
    lineHeight: rf(15),
    textAlign: "center",
    marginTop: 8,
  },
  link: { color: C.cyan, fontWeight: "700", textDecorationLine: "underline" },
});
