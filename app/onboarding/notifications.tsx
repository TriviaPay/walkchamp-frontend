import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import {
  OnboardingFeatureCard,
  OnboardingLayout,
  OnboardingMascot,
  OnboardingPrimaryButton,
  OnboardingSecondaryButton,
} from "@/components/onboarding/OnboardingUI";
import { ONBOARDING_ASSETS, ONBOARDING_COLORS, ONBOARDING_ROUTES } from "@/constants/onboarding";
import { setNotificationOnboardingChoice } from "@/utils/onboardingStorage";
import {
  optInNotifications,
  requestNotificationPermission,
} from "@/services/notificationService";
import { rf } from "@/utils/responsive";

const C = ONBOARDING_COLORS;

export default function NotificationsOnboardingScreen() {
  const [loading, setLoading] = useState(false);

  const continueNext = async (choice: "accepted" | "skipped" | "denied") => {
    await setNotificationOnboardingChoice(choice);
    router.push(ONBOARDING_ROUTES.completion);
  };

  const enableNotifications = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const granted = await requestNotificationPermission();
      if (granted) {
        await optInNotifications();
        await continueNext("accepted");
      } else {
        await continueNext("denied");
      }
    } catch {
      await continueNext("denied");
    } finally {
      setLoading(false);
    }
  };

  return (
    <OnboardingLayout
      step={5}
      showBack
      footer={
        <>
          <OnboardingPrimaryButton
            label="Enable Notifications"
            onPress={() => void enableNotifications()}
            loading={loading}
          />
          <OnboardingSecondaryButton
            label="Maybe Later"
            onPress={() => void continueNext("skipped")}
          />
        </>
      }
    >
      <OnboardingMascot source={ONBOARDING_ASSETS.notifications} />
      <Text style={styles.title}>Never Miss a Challenge</Text>
      <Text style={styles.subtitle}>Get reminders for races, progress, and rewards.</Text>
      <View style={styles.cards}>
        <OnboardingFeatureCard
          icon="bell"
          title="Race Alerts"
          body="Start times and Waiting Room updates."
        />
        <OnboardingFeatureCard
          icon="activity"
          title="Progress Reminders"
          body="Step goals and active Challenge updates."
        />
        <OnboardingFeatureCard
          icon="gift"
          title="Results & Rewards"
          body="Results, achievements, Coins, and rewards."
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
